#!/usr/bin/env python3
"""
FPL Mini-League Tracker — fetch + compute + write data/league.json

Runs server-side (GitHub Actions or locally) because the FPL API sends no CORS
headers, so the browser can never call it directly. This script does all the
fetching and computation and writes a single self-contained data/league.json
(plus an immutable data/results.json) that the static site reads.

Stdlib only — no third-party dependencies — so it does not rot mid-season.

Run locally with no arguments:

    python scripts/fetch.py

Exits non-zero on any API/validation failure and leaves existing data files
untouched. Stale data beats broken data.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE_URL = "https://fantasy.premierleague.com/api"
REQUEST_SLEEP = 0.5          # seconds between per-entry history requests
REQUEST_TIMEOUT = 30         # seconds per HTTP request
USER_AGENT = "fpl-mini-league-tracker/1.0 (+https://github.com)"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(ROOT, "config")
DATA_DIR = os.path.join(ROOT, "data")

LEAGUE_CFG = os.path.join(CONFIG_DIR, "league.json")
PRIZES_CFG = os.path.join(CONFIG_DIR, "prizes.json")
PERIODS_CFG = os.path.join(CONFIG_DIR, "periods.json")
MEMBERS_CFG = os.path.join(CONFIG_DIR, "members.json")

LEAGUE_OUT = os.path.join(DATA_DIR, "league.json")
RESULTS_OUT = os.path.join(DATA_DIR, "results.json")

# Calendar month -> prize period. August (8) and September (9) are combined.
MONTH_TO_PERIOD = {8: 1, 9: 1, 10: 2, 11: 3, 12: 4, 1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
PERIOD_NAMES = {
    1: "August + September",
    2: "October",
    3: "November",
    4: "December",
    5: "January",
    6: "February",
    7: "March",
    8: "April",
    9: "May",
}
TOTAL_GAMEWEEKS = 38


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def die(msg):
    """Fail loudly and non-zero, without touching existing data files."""
    sys.stderr.write("ERROR: " + msg + "\n")
    sys.exit(1)


def warn(msg):
    sys.stderr.write("WARNING: " + msg + "\n")


def log(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def require(condition, msg):
    if not condition:
        die(msg)


def load_json(path, required=True, default=None):
    if not os.path.exists(path):
        if required:
            die("missing required config file: " + path)
        return default
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        die("could not read %s: %s" % (path, exc))


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def http_get_json(url):
    """GET a URL and parse JSON, raising a clear error on any failure."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        die("HTTP %s fetching %s" % (exc.code, url))
    except urllib.error.URLError as exc:
        die("network error fetching %s: %s" % (url, exc.reason))
    except Exception as exc:  # noqa: BLE001 - fail loudly on anything unexpected
        die("failed fetching %s: %s" % (url, exc))
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        die("invalid JSON from %s: %s" % (url, exc))


def month_of(iso_ts):
    """Month number from an ISO deadline timestamp like 2026-08-14T17:30:00Z."""
    try:
        cleaned = iso_ts.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned).month
    except (ValueError, AttributeError):
        return None


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #

def fetch_bootstrap():
    log("Fetching bootstrap-static ...")
    data = http_get_json(BASE_URL + "/bootstrap-static/")
    require(isinstance(data, dict) and isinstance(data.get("events"), list),
            "bootstrap-static response missing 'events' array")
    events = []
    for ev in data["events"]:
        require(isinstance(ev, dict) and "id" in ev,
                "bootstrap event missing 'id'")
        events.append({
            "id": ev["id"],
            "name": ev.get("name", "Gameweek %s" % ev["id"]),
            "deadline_time": ev.get("deadline_time"),
            "finished": bool(ev.get("finished")),
            "is_current": bool(ev.get("is_current")),
            "is_next": bool(ev.get("is_next")),
        })
    events.sort(key=lambda e: e["id"])
    require(len(events) > 0, "bootstrap-static returned zero gameweeks")
    return events


def _normalize_standings_row(row):
    """standings.results shape: has a ready-made player_name."""
    require("entry" in row, "standings row missing 'entry'")
    return {
        "entry_id": row["entry"],
        "player_name": row.get("player_name", ""),
        "entry_name": row.get("entry_name", ""),
    }


def _normalize_new_entry_row(row):
    """
    new_entries.results has a DIFFERENT shape to standings.results: no
    player_name field, only player_first_name / player_last_name. Build the
    display name from those rather than assuming the standings shape.
    """
    require("entry" in row, "new_entries row missing 'entry'")
    first = (row.get("player_first_name") or "").strip()
    last = (row.get("player_last_name") or "").strip()
    return {
        "entry_id": row["entry"],
        "player_name": (first + " " + last).strip(),
        "entry_name": row.get("entry_name", ""),
    }


def fetch_members(league_id):
    """
    Return the current membership as the UNION of standings.results and
    new_entries.results, deduped on entry ID.

    A manager who has joined but whose first gameweek has not yet been scored
    sits in new_entries, not standings — that is true pre-season and for every
    mid-season joiner until the next gameweek settles. Reading standings alone
    would miss them (and, when standings is empty, would wrongly flag everyone
    as departed). The two arrays paginate independently: standings via
    page_standings, new_entries via page_new_entries.
    """
    log("Fetching league standings + new entries ...")
    members = {}   # entry_id -> normalized row
    order = []     # preserve first-seen order for stable output
    league_name = None

    def add(row, prefer):
        eid = row["entry_id"]
        if eid not in members:
            members[eid] = row
            order.append(eid)
        else:
            existing = members[eid]
            # standings names win once available; otherwise fill any blanks.
            if prefer or not existing.get("player_name"):
                if row.get("player_name"):
                    existing["player_name"] = row["player_name"]
            if not existing.get("entry_name") and row.get("entry_name"):
                existing["entry_name"] = row["entry_name"]

    # --- standings pages (page_standings) ---
    page = 1
    while True:
        url = "%s/leagues-classic/%s/standings/?page_standings=%d" % (
            BASE_URL, league_id, page)
        data = http_get_json(url)
        require(isinstance(data, dict) and isinstance(data.get("standings"), dict),
                "standings response missing 'standings' object")
        standings = data["standings"]
        require(isinstance(standings.get("results"), list),
                "standings.results is not a list")
        if league_name is None:
            league_name = (data.get("league") or {}).get("name")
        for row in standings["results"]:
            add(_normalize_standings_row(row), prefer=True)
        if not standings.get("has_next"):
            break
        page += 1
        time.sleep(REQUEST_SLEEP)

    std_count = len(order)

    # --- new_entries pages (page_new_entries) — paginated independently ---
    page = 1
    while True:
        url = "%s/leagues-classic/%s/standings/?page_new_entries=%d" % (
            BASE_URL, league_id, page)
        data = http_get_json(url)
        require(isinstance(data, dict) and isinstance(data.get("new_entries"), dict),
                "response missing 'new_entries' object")
        new_entries = data["new_entries"]
        require(isinstance(new_entries.get("results"), list),
                "new_entries.results is not a list")
        for row in new_entries["results"]:
            add(_normalize_new_entry_row(row), prefer=False)
        if not new_entries.get("has_next"):
            break
        page += 1
        time.sleep(REQUEST_SLEEP)

    result = [members[eid] for eid in order]
    log("  found %d member(s): %d in standings, %d additional in new_entries"
        % (len(result), std_count, len(result) - std_count))
    return result, league_name


def fetch_history(entry_id):
    url = "%s/entry/%s/history/" % (BASE_URL, entry_id)
    data = http_get_json(url)
    require(isinstance(data, dict), "history response for entry %s not an object" % entry_id)
    current = data.get("current")
    chips = data.get("chips")
    require(isinstance(current, list),
            "history for entry %s missing 'current' array" % entry_id)
    require(chips is None or isinstance(chips, list),
            "history for entry %s has non-list 'chips'" % entry_id)
    return current, (chips or [])


# --------------------------------------------------------------------------- #
# Config: periods (frozen) and members (persisted roster)
# --------------------------------------------------------------------------- #

def derive_gw_to_period(events):
    mapping = {}
    for ev in events:
        m = month_of(ev.get("deadline_time"))
        period = MONTH_TO_PERIOD.get(m)
        if period is None:
            warn("gameweek %s has no month->period mapping (deadline=%r); "
                 "leaving unmapped" % (ev["id"], ev.get("deadline_time")))
            continue
        mapping[str(ev["id"])] = period
    return mapping


def load_or_freeze_periods(events):
    """
    Return the frozen gameweek->period mapping.

    Generate config/periods.json only on a full 38-event bootstrap and only if
    it does not already exist. Never recompute a frozen file silently: if the
    derived mapping differs from the frozen one, warn loudly and keep the file.
    """
    existing = load_json(PERIODS_CFG, required=False)
    derived = derive_gw_to_period(events)

    if existing is not None:
        frozen = existing.get("gameweek_to_period", {})
        # Compare only gameweeks present in both so a partial-season derivation
        # does not spam warnings for weeks we cannot yet map.
        diffs = [gw for gw, p in derived.items()
                 if gw in frozen and frozen[gw] != p]
        if diffs:
            warn("derived period mapping differs from frozen config/periods.json "
                 "for gameweek(s) %s — KEEPING the frozen config. Edit the file "
                 "by hand if this is intentional." % ", ".join(sorted(diffs, key=int)))
        return frozen

    # No frozen file yet. Only freeze on a complete 38-event bootstrap.
    if len(events) < TOTAL_GAMEWEEKS:
        warn("config/periods.json not found and bootstrap has only %d/%d "
             "gameweeks — NOT freezing a partial mapping yet. Using the "
             "in-memory derivation for this run." % (len(events), TOTAL_GAMEWEEKS))
        return derived

    frozen_obj = {
        "_comment": ("Frozen gameweek -> prize-period mapping. Agreed with the "
                     "league before the season and hand-editable. The script "
                     "will warn but never overwrite this file."),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period_names": {str(k): v for k, v in PERIOD_NAMES.items()},
        "gameweek_to_period": derived,
    }
    write_json(PERIODS_CFG, frozen_obj)
    log("Froze config/periods.json (%d gameweeks mapped)" % len(derived))
    return derived


def load_and_sync_members(current_members, current_gw, locked, lock_moment):
    """
    Maintain config/members.json as the persisted source of truth.

    `current_members` is the UNION of standings + new_entries (see
    fetch_members): the set of managers currently in the league.

    Everyone in the roster is a paid, prize-eligible entrant — there is no
    paid/eligible state. Prize figures scale with the member count, so the
    roster locks at the GW1 deadline to keep the announced pot correct:

    - Before the GW1 deadline (`locked` is False): append every newly-seen
      entry ID; refresh names; mark absent members in_league=false but keep
      them (their scores still count).
    - At/after the GW1 deadline (`locked` is True): the roster is frozen. Any
      entry ID not already in the file is IGNORED — not added, not flagged — so
      the member count (and therefore the pot) stops growing. Existing members
      still get name/in_league updates. `roster_locked_at` records when the lock
      took effect, for audit.
    """
    doc = load_json(MEMBERS_CFG, required=False)
    if doc is None:
        doc = {"members": []}
    doc.setdefault("members", [])

    by_id = {m["entry_id"]: m for m in doc["members"]}
    current_ids = set()

    for row in current_members:
        eid = row["entry_id"]
        current_ids.add(eid)
        if eid in by_id:
            m = by_id[eid]
            m["in_league"] = True
            # Refresh display names from the live data.
            if row.get("player_name"):
                m["player_name"] = row["player_name"]
            if row.get("entry_name"):
                m["entry_name"] = row["entry_name"]
        elif locked:
            log("  roster locked — ignoring new entry %s (%s); not counted"
                % (eid, row.get("player_name")))
        else:
            log("  new member seen: %s (%s) — appended"
                % (row.get("player_name"), eid))
            doc["members"].append({
                "entry_id": eid,
                "player_name": row.get("player_name", ""),
                "entry_name": row.get("entry_name", ""),
                "in_league": True,
                "first_seen_gw": current_gw if current_gw else 1,
                "notes": "",
            })
            by_id[eid] = doc["members"][-1]

    # Members no longer in the league (in neither standings nor new_entries):
    # keep them, flag as departed. They've paid; their scores still count.
    for m in doc["members"]:
        m.setdefault("first_seen_gw", current_gw if current_gw else 1)
        m.setdefault("notes", "")
        if m["entry_id"] not in current_ids:
            m["in_league"] = False

    # Record the moment the roster locked, once, for audit.
    if locked and not doc.get("roster_locked_at"):
        doc["roster_locked_at"] = lock_moment or datetime.now(timezone.utc).isoformat()
        log("roster locked at %s — member count frozen at %d"
            % (doc["roster_locked_at"], len(doc["members"])))

    write_json(MEMBERS_CFG, doc)
    return doc


# --------------------------------------------------------------------------- #
# Computation
# --------------------------------------------------------------------------- #

def check_net_identity(entry_id, name, current):
    """
    Guard against FPL silently changing what `points` means.

    We assume per-gameweek `points` is GROSS (before transfer hits) and that the
    cumulative `total_points` is already net of hits, so across every played
    gameweek:

        sum(points) - sum(event_transfers_cost) == total_points(final gameweek)

    If that identity breaks, `points` is probably already net and the whole app
    would double-deduct every hit. Fail loudly with the member and both figures
    rather than publish wrong scores. No-ops until a member has played a
    gameweek (empty `current` before GW1).
    """
    if not current:
        return
    final = max(current, key=lambda r: r.get("event") or 0)
    final_total = final.get("total_points")
    if final_total is None:
        return
    gross = sum((r.get("points") or 0) for r in current)
    cost = sum((r.get("event_transfers_cost") or 0) for r in current)
    computed = gross - cost
    if computed != final_total:
        die("net-points self-check FAILED for %s (entry %s): "
            "sum(points) - sum(event_transfers_cost) = %d - %d = %d, but the "
            "final gameweek total_points = %d. FPL's `points` field may already "
            "be net of hits — do not trust these scores until this is resolved."
            % (name, entry_id, gross, cost, computed, final_total))


def build_member_gw(current):
    """Turn a raw history 'current' array into {gw: {...net, transfers, ...}}."""
    by_gw = {}
    for row in current:
        gw = row.get("event")
        if gw is None:
            continue
        points = row.get("points", 0) or 0
        cost = row.get("event_transfers_cost", 0) or 0
        by_gw[gw] = {
            "points": points,
            "net": points - cost,
            "hit": cost,
            "transfers": row.get("event_transfers", 0) or 0,
            "bench": row.get("points_on_bench", 0) or 0,
        }
    return by_gw


def validate_prizes(prizes):
    for key in ("buy_in", "monthly_1st", "monthly_2nd", "overall_1st"):
        require(key in prizes, "config/prizes.json must define %s" % key)
    buy_in = prizes["buy_in"]
    m1 = prizes["monthly_1st"]
    m2 = prizes["monthly_2nd"]
    o1 = prizes["overall_1st"]
    periods = prizes.get("monthly_periods", 9)
    require(isinstance(periods, int) and periods > 0,
            "monthly_periods must be a positive integer")
    # Invariant: the per-player shares must sum to EXACTLY the buy-in. This is
    # the thing most likely to break silently in a future edit, so fail loud.
    total = round((m1 + m2) * periods + o1, 2)
    if total != round(buy_in, 2):
        die("invalid prize config: (monthly_1st %s + monthly_2nd %s) * "
            "monthly_periods %s + overall_1st %s = %s, which is not the buy-in "
            "%s. The per-player prize shares must sum to exactly the buy-in — "
            "fix config/prizes.json." % (m1, m2, periods, o1, total, buy_in))
    return buy_in, m1, m2, o1, periods


def period_gameweeks(gw_to_period):
    """period number -> sorted list of gameweek ids."""
    out = {}
    for gw_str, period in gw_to_period.items():
        out.setdefault(period, []).append(int(gw_str))
    for p in out:
        out[p].sort()
    return out


_TIEBREAK_STEPS = ("head_to_head", "highest_single_gw", "fewest_transfers")


def _h2h_wins(m, group, gws, member_gw):
    """Head-to-head gameweek wins of m against the rest of a net-tied group."""
    wins = 0
    for o in group:
        if o == m:
            continue
        for gw in gws:
            a = member_gw.get(m, {}).get(gw)
            b = member_gw.get(o, {}).get(gw)
            if a is not None and b is not None and a["net"] > b["net"]:
                wins += 1
    return wins


def rank_field(ids, gws, member_gw, tiebreak_chain):
    """
    Rank the whole field for a period into ordered tiers, applying the
    tiebreak chain to separate managers level on net points. Returns
    (tiers, nets) where tiers is a list of {"ids": [...], "sep": step} ordered
    best-first; `sep` names the step that separates a tier from the one below
    it ("net_points", a chain step, or None for the last tier). A tier with
    more than one id is a genuinely unresolvable tie — the chain could not
    separate them, so they share the rank rather than being split arbitrarily.
    """
    nets = {}
    highest = {}
    transfers = {}
    for i in ids:
        played = [gw for gw in gws if gw in member_gw.get(i, {})]
        nets[i] = sum(member_gw[i][gw]["net"] for gw in played)
        highest[i] = max((member_gw[i][gw]["net"] for gw in played), default=None)
        transfers[i] = sum(member_gw[i][gw]["transfers"] for gw in played)

    key_steps = [s for s in tiebreak_chain if s in _TIEBREAK_STEPS]
    groups = {}
    for i in ids:
        groups.setdefault(nets[i], []).append(i)
    net_values = sorted(groups, reverse=True)

    tiers = []
    for gi, nv in enumerate(net_values):
        group = groups[nv]
        if len(group) == 1:
            subtiers = [[group[0]]]
            keys = {group[0]: ()}
        else:
            h2h = {m: _h2h_wins(m, group, gws, member_gw) for m in group}

            def key(m):
                parts = []
                for step in key_steps:
                    if step == "head_to_head":
                        parts.append(-h2h[m])
                    elif step == "highest_single_gw":
                        parts.append(-(highest[m] if highest[m] is not None else -10 ** 9))
                    elif step == "fewest_transfers":
                        parts.append(transfers[m])
                return tuple(parts)

            keys = {m: key(m) for m in group}
            ordered = sorted(group, key=lambda m: keys[m])
            subtiers = []
            for m in ordered:
                if subtiers and keys[m] == keys[subtiers[-1][0]]:
                    subtiers[-1].append(m)
                else:
                    subtiers.append([m])

        for si, tier_ids in enumerate(subtiers):
            sep = None
            if si + 1 < len(subtiers):
                ka = keys[tier_ids[0]]
                kb = keys[subtiers[si + 1][0]]
                for idx in range(len(ka)):
                    if ka[idx] != kb[idx]:
                        sep = key_steps[idx]
                        break
            elif gi < len(net_values) - 1:
                sep = "net_points"
            tiers.append({"ids": tier_ids, "sep": sep})

    return tiers, nets


def assign_placings(tiers, first_total, second_total):
    """
    Read 1st and 2nd off the ranked tiers. A tier occupying several positions
    (an unresolvable tie) pools the prizes for those positions and splits them
    equally. Returns (first, second); `second` is None when a tie for 1st has
    already consumed the second position.
    """
    pos_amount = {1: first_total, 2: second_total}
    first = second = None
    pos = 1
    for tier in tiers:
        k = len(tier["ids"])
        span = range(pos, pos + k)
        total = sum(pos_amount.get(p, 0) for p in span)
        placing = {
            "entry_ids": list(tier["ids"]),
            "amount_each": round(total / k, 2),
            "resolved_by": "unresolved" if k > 1 else tier["sep"],
        }
        if pos == 1:
            first = placing
            if k >= 2:      # tie for 1st also occupies 2nd
                break
        elif pos == 2:
            second = placing
            break
        pos += k
        if pos > 2:
            break
    return first, second


def rank_period(period, gws, members, member_gw, tiebreak_chain,
                first_total, second_total):
    """
    Build the standings for one period plus the resolved 1st and 2nd placings.
    Everyone in the roster can place. There are no placings until at least one
    member has played a gameweek in the period.
    """
    standings = []
    for m in members:
        eid = m["entry_id"]
        played = [gw for gw in gws if gw in member_gw.get(eid, {})]
        net = sum(member_gw[eid][gw]["net"] for gw in played)
        standings.append({
            "entry_id": eid,
            "player_name": m["player_name"],
            "entry_name": m["entry_name"],
            "net": net,
            "gws_played": len(played),
            "in_league": bool(m.get("in_league", True)),
        })
    standings.sort(key=lambda r: (-r["net"], r["player_name"]))

    first = second = None
    if standings and any(r["gws_played"] > 0 for r in standings):
        tiers, _ = rank_field([m["entry_id"] for m in members], gws,
                              member_gw, tiebreak_chain)
        first, second = assign_placings(tiers, first_total, second_total)

    return {
        "period": period,
        "name": PERIOD_NAMES.get(period, "Period %d" % period),
        "gameweeks": gws,
        "standings": standings,
        "first": first,
        "second": second,
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    league_cfg = load_json(LEAGUE_CFG)
    prizes = load_json(PRIZES_CFG)
    require("league_id" in league_cfg, "config/league.json must define league_id")
    league_id = league_cfg["league_id"]

    buy_in, monthly_1st_pp, monthly_2nd_pp, overall_pp, monthly_periods = \
        validate_prizes(prizes)
    currency = prizes.get("currency", "EUR")
    tiebreak_chain = prizes.get(
        "tiebreak_chain",
        ["head_to_head", "highest_single_gw", "fewest_transfers", "split"])

    events = fetch_bootstrap()
    current_ev = next((e for e in events if e["is_current"]), None)
    current_gw = current_ev["id"] if current_ev else None

    # Roster locks at the GW1 deadline so the member count (and the pot) stops
    # growing once the season is under way.
    gw1 = next((e for e in events if e["id"] == 1), None)
    lock_moment = gw1.get("deadline_time") if gw1 else None
    roster_locked = False
    if gw1:
        if gw1.get("finished"):
            roster_locked = True
        elif lock_moment:
            try:
                deadline = datetime.fromisoformat(lock_moment.replace("Z", "+00:00"))
                roster_locked = datetime.now(timezone.utc) >= deadline
            except (ValueError, AttributeError):
                roster_locked = False

    gw_to_period = load_or_freeze_periods(events)
    period_gws = period_gameweeks(gw_to_period)

    current_members, live_league_name = fetch_members(league_id)
    members_doc = load_and_sync_members(
        current_members, current_gw, roster_locked, lock_moment)
    members = members_doc["members"]

    # Fetch history for EVERY member, including departed ones.
    member_gw = {}
    member_chips = {}
    log("Fetching per-entry history for %d member(s) ..." % len(members))
    for m in members:
        eid = m["entry_id"]
        current, chips = fetch_history(eid)
        check_net_identity(eid, m.get("player_name", ""), current)
        member_gw[eid] = build_member_gw(current)
        chip_by_gw = {}
        for c in chips:
            if isinstance(c, dict) and c.get("event") is not None:
                chip_by_gw[c["event"]] = c.get("name", "chip")
        member_chips[eid] = chip_by_gw
        time.sleep(REQUEST_SLEEP)

    # N is the member count. Everyone in the roster is in the pot; the roster
    # lock (above) is what keeps this from growing mid-season. Every prize is
    # per-player-share * N, so the figures stay consistent at any count.
    players = len(members)

    monthly_1st_prize = round(monthly_1st_pp * players, 2)
    monthly_2nd_prize = round(monthly_2nd_pp * players, 2)
    overall_prize = round(overall_pp * players, 2)

    # Per-gameweek league average net (relative colour-coding basis).
    gw_meta = []
    for ev in events:
        nets = [member_gw[eid][ev["id"]]["net"]
                for eid in member_gw if ev["id"] in member_gw[eid]]
        avg = round(sum(nets) / len(nets), 1) if nets else None
        gw_meta.append({
            "id": ev["id"],
            "name": ev["name"],
            "deadline_time": ev.get("deadline_time"),
            "finished": ev["finished"],
            "is_current": ev["is_current"],
            "period": gw_to_period.get(str(ev["id"])),
            "average_net": avg,
            "played_count": len(nets),
        })
    finished_gws = {ev["id"] for ev in events if ev["finished"]}

    # --- Periods: compute live, but read completed ones from immutable results.
    prior_results = load_json(RESULTS_OUT, required=False) or {"periods": {}}
    prior_results.setdefault("periods", {})

    def _placing_ids(p):
        return sorted((p or {}).get("entry_ids", [])) if p else []

    periods_out = []
    for period in sorted(period_gws):
        gws = period_gws[period]
        complete = len(gws) > 0 and all(gw in finished_gws for gw in gws)
        remaining = sum(1 for gw in gws if gw not in finished_gws)
        computed = rank_period(period, gws, members, member_gw,
                               tiebreak_chain, monthly_1st_prize, monthly_2nd_prize)

        first = computed["first"]
        second = computed["second"]
        pkey = str(period)
        if complete:
            if pkey in prior_results["periods"]:
                recorded = prior_results["periods"][pkey]
                # Immutable: keep the recorded placings; warn if we would differ.
                if (_placing_ids(recorded.get("first")) != _placing_ids(first) or
                        _placing_ids(recorded.get("second")) != _placing_ids(second)):
                    warn("period %d already recorded (1st %s, 2nd %s) but a "
                         "recompute gives (1st %s, 2nd %s) — KEEPING the recorded "
                         "result." % (
                             period, _placing_ids(recorded.get("first")),
                             _placing_ids(recorded.get("second")),
                             _placing_ids(first), _placing_ids(second)))
                first = recorded.get("first")
                second = recorded.get("second")
            else:
                prior_results["periods"][pkey] = {
                    "first": first,
                    "second": second,
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                }
                log("Recorded immutable result for period %d" % period)

        computed.update({
            "complete": complete,
            "remaining_gws": remaining,
            "prize_1st": monthly_1st_prize,
            "prize_2nd": monthly_2nd_prize,
            "is_current": current_ev is not None and gw_to_period.get(
                str(current_gw)) == period,
            "first": first,
            "second": second,
        })
        periods_out.append(computed)

    if prior_results["periods"]:
        write_json(RESULTS_OUT, prior_results)

    # --- Per-member season aggregates.
    members_out = []
    for m in members:
        eid = m["entry_id"]
        gws = member_gw.get(eid, {})
        total_net = sum(g["net"] for g in gws.values())
        hits_total = sum(g["hit"] for g in gws.values())
        by_gw = {}
        for gw, g in gws.items():
            by_gw[str(gw)] = {
                "net": g["net"],
                "points": g["points"],
                "hit": g["hit"],
                "transfers": g["transfers"],
                "bench": g["bench"],
                "chip": member_chips.get(eid, {}).get(gw),
                "provisional": gw not in finished_gws,
            }
        members_out.append({
            "entry_id": eid,
            "player_name": m["player_name"],
            "entry_name": m["entry_name"],
            "in_league": bool(m.get("in_league", True)),
            "first_seen_gw": m.get("first_seen_gw"),
            "total_net": total_net,
            "hits_total": hits_total,
            "gws_played": len(gws),
            "by_gw": by_gw,
        })
    members_out.sort(key=lambda r: (-r["total_net"], r["player_name"]))

    # --- Prize table. "won" sums monthly 1sts, monthly 2nds (and the overall
    # once the season finishes); "prizes_won" counts placings.
    money_won = {m["entry_id"]: 0.0 for m in members}
    prizes_won = {m["entry_id"]: 0 for m in members}
    for p in periods_out:
        if not p["complete"]:
            continue
        for placing in (p["first"], p["second"]):
            if not placing:
                continue
            for eid in placing["entry_ids"]:
                money_won[eid] = money_won.get(eid, 0) + placing["amount_each"]
                prizes_won[eid] = prizes_won.get(eid, 0) + 1

    prize_table = []
    for m in members_out:
        eid = m["entry_id"]
        won = round(money_won.get(eid, 0), 2)
        prize_table.append({
            "entry_id": eid,
            "player_name": m["player_name"],
            "entry_name": m["entry_name"],
            "prizes_won": prizes_won.get(eid, 0),
            "money_won": won,
            "net_position": round(won - buy_in, 2),
            "in_league": m["in_league"],
        })
    prize_table.sort(key=lambda r: (-r["money_won"], r["player_name"]))

    season_finished = all(ev["finished"] for ev in events) and len(events) >= TOTAL_GAMEWEEKS

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "league": {
            "id": league_id,
            "name": league_cfg.get("league_name") or live_league_name or "",
            "season": league_cfg.get("season", ""),
        },
        "current_gw": current_gw,
        "players": players,
        "roster_locked_at": members_doc.get("roster_locked_at"),
        "prizes": {
            "currency": currency,
            "buy_in": buy_in,
            "monthly_periods": monthly_periods,
            "monthly_1st_per_player": monthly_1st_pp,
            "monthly_2nd_per_player": monthly_2nd_pp,
            "overall_per_player": overall_pp,
            "monthly_1st": monthly_1st_prize,
            "monthly_2nd": monthly_2nd_prize,
            "overall": overall_prize,
        },
        "gameweeks": gw_meta,
        "periods": periods_out,
        "members": members_out,
        "prize_table": prize_table,
        "overall_prize": {
            "amount": overall_prize,
            "pending": not season_finished,
            "winner": None,  # resolved at season end; pending until then
        },
    }

    write_json(LEAGUE_OUT, output)
    log("Wrote %s (%d member(s), players=%d, current GW=%s, roster %s)"
        % (LEAGUE_OUT, len(members_out), players, current_gw,
           "LOCKED" if roster_locked else "open"))


if __name__ == "__main__":
    main()
