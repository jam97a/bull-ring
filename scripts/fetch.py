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


def load_and_sync_members(current_members, current_gw):
    """
    Maintain config/members.json as the persisted source of truth.

    `current_members` is the UNION of standings + new_entries (see
    fetch_members): the set of managers currently in the league. in_league is
    derived from that union, not from standings alone.

    - Append newly-seen entry IDs (default paid=false, prize_eligible=false).
    - Never remove; mark absent members in_league=false, present ones true.
    - Never set or overwrite the human-edited paid / prize_eligible fields.
    - Freeze locked_player_count the first run roster_locked is observed true.
    """
    doc = load_json(MEMBERS_CFG, required=False)
    if doc is None:
        doc = {"roster_locked": False, "members": []}
    doc.setdefault("roster_locked", False)
    doc.setdefault("members", [])

    by_id = {m["entry_id"]: m for m in doc["members"]}
    current_ids = set()

    for row in current_members:
        eid = row["entry_id"]
        current_ids.add(eid)
        if eid in by_id:
            m = by_id[eid]
            m["in_league"] = True
            # Refresh display names from the live data; these are not
            # human-owned fields, unlike paid / prize_eligible.
            if row.get("player_name"):
                m["player_name"] = row["player_name"]
            if row.get("entry_name"):
                m["entry_name"] = row["entry_name"]
        else:
            log("  new member seen: %s (%s) — appended, paid=false, "
                "prize_eligible=false" % (row.get("player_name"), eid))
            new_member = {
                "entry_id": eid,
                "player_name": row.get("player_name", ""),
                "entry_name": row.get("entry_name", ""),
                "paid": False,
                "prize_eligible": False,
                "in_league": True,
                "first_seen_gw": current_gw if current_gw else 1,
                "notes": "",
            }
            doc["members"].append(new_member)
            by_id[eid] = new_member

    # Members no longer in the league (in neither standings nor new_entries):
    # keep them, flag as departed.
    for m in doc["members"]:
        m.setdefault("paid", False)
        m.setdefault("prize_eligible", False)
        m.setdefault("first_seen_gw", current_gw if current_gw else 1)
        m.setdefault("notes", "")
        if m["entry_id"] not in current_ids:
            m["in_league"] = False

    # Freeze N the first time the roster is locked.
    if doc["roster_locked"] and "locked_player_count" not in doc:
        locked = sum(1 for m in doc["members"] if m.get("prize_eligible"))
        doc["locked_player_count"] = locked
        log("roster_locked is true — froze locked_player_count = %d" % locked)

    write_json(MEMBERS_CFG, doc)
    return doc


# --------------------------------------------------------------------------- #
# Computation
# --------------------------------------------------------------------------- #

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
    require("buy_in" in prizes and "monthly_per_player" in prizes,
            "config/prizes.json must define buy_in and monthly_per_player")
    buy_in = prizes["buy_in"]
    monthly = prizes["monthly_per_player"]
    periods = prizes.get("monthly_periods", 9)
    require(isinstance(periods, int) and periods > 0,
            "monthly_periods must be a positive integer")
    overall_per_player = buy_in - monthly * periods
    if overall_per_player < 0:
        die("invalid prize config: buy_in (%s) - monthly_per_player (%s) * "
            "monthly_periods (%s) = %s, which is negative. Config that cannot "
            "produce a valid overall pot is a bug — fix config/prizes.json."
            % (buy_in, monthly, periods, overall_per_player))
    return buy_in, monthly, periods, overall_per_player


def period_gameweeks(gw_to_period):
    """period number -> sorted list of gameweek ids."""
    out = {}
    for gw_str, period in gw_to_period.items():
        out.setdefault(period, []).append(int(gw_str))
    for p in out:
        out[p].sort()
    return out


def resolve_tie(tied_ids, gws_in_period, member_gw, tiebreak_chain):
    """
    Resolve a tie on net points using the configured chain. Returns
    (winner_ids, resolved_by, detail). winner_ids has one element unless the
    chain falls through to 'split'.
    """
    tied = list(tied_ids)

    for step in tiebreak_chain:
        if step == "head_to_head":
            h2h = {}
            for m in tied:
                wins = 0
                for o in tied:
                    if o == m:
                        continue
                    for gw in gws_in_period:
                        a = member_gw.get(m, {}).get(gw)
                        b = member_gw.get(o, {}).get(gw)
                        if a is not None and b is not None and a["net"] > b["net"]:
                            wins += 1
                h2h[m] = wins
            best = max(h2h.values())
            winners = [m for m in tied if h2h[m] == best]
            if len(winners) == 1:
                return winners, "head_to_head", {"h2h_wins": h2h}
            tied = winners

        elif step == "highest_single_gw":
            highest = {}
            for m in tied:
                vals = [member_gw[m][gw]["net"] for gw in gws_in_period
                        if gw in member_gw.get(m, {})]
                highest[m] = max(vals) if vals else None
            best = max(v for v in highest.values() if v is not None)
            winners = [m for m in tied if highest[m] == best]
            if len(winners) == 1:
                return winners, "highest_single_gw", {"highest_single_gw": highest}
            tied = winners

        elif step == "fewest_transfers":
            transfers = {}
            for m in tied:
                transfers[m] = sum(member_gw[m][gw]["transfers"]
                                   for gw in gws_in_period
                                   if gw in member_gw.get(m, {}))
            fewest = min(transfers.values())
            winners = [m for m in tied if transfers[m] == fewest]
            if len(winners) == 1:
                return winners, "fewest_transfers", {"transfers": transfers}
            tied = winners

        elif step == "split":
            return list(tied), "split", {"split_between": list(tied)}

        else:
            warn("unknown tiebreak step %r in config/prizes.json — skipping" % step)

    # Chain exhausted without a 'split' entry: split among whoever remains.
    return list(tied), "split", {"split_between": list(tied)}


def rank_period(period, gws, members, member_gw, eligible_ids,
                tiebreak_chain, prize_amount):
    """
    Build the standings for one period plus the resolved winner(s).
    Standings include everyone (for display); only prize_eligible members
    can win. resolved_by is 'net_points' when there is no tie.
    """
    standings = []
    totals = {}
    for m in members:
        eid = m["entry_id"]
        played = [gw for gw in gws if gw in member_gw.get(eid, {})]
        net = sum(member_gw[eid][gw]["net"] for gw in played)
        totals[eid] = net
        standings.append({
            "entry_id": eid,
            "player_name": m["player_name"],
            "entry_name": m["entry_name"],
            "net": net,
            "gws_played": len(played),
            "prize_eligible": bool(m.get("prize_eligible")),
            "in_league": bool(m.get("in_league", True)),
        })
    standings.sort(key=lambda r: (-r["net"], r["player_name"]))

    # Winner determined among eligible members only.
    eligible_standings = [r for r in standings if r["entry_id"] in eligible_ids]
    winner = None
    if eligible_standings:
        top_net = eligible_standings[0]["net"]
        tied = [r["entry_id"] for r in eligible_standings if r["net"] == top_net]
        if len(tied) == 1:
            winner = {
                "entry_ids": tied,
                "amount_each": prize_amount,
                "resolved_by": "net_points",
                "detail": {"net_points": top_net},
            }
        else:
            winner_ids, resolved_by, detail = resolve_tie(
                tied, gws, member_gw, tiebreak_chain)
            winner = {
                "entry_ids": winner_ids,
                "amount_each": round(prize_amount / len(winner_ids), 2),
                "resolved_by": resolved_by,
                "detail": detail,
            }

    return {
        "period": period,
        "name": PERIOD_NAMES.get(period, "Period %d" % period),
        "gameweeks": gws,
        "standings": standings,
        "winner": winner,
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    league_cfg = load_json(LEAGUE_CFG)
    prizes = load_json(PRIZES_CFG)
    require("league_id" in league_cfg, "config/league.json must define league_id")
    league_id = league_cfg["league_id"]

    buy_in, monthly_per_player, monthly_periods, overall_per_player = \
        validate_prizes(prizes)
    currency = prizes.get("currency", "EUR")
    tiebreak_chain = prizes.get(
        "tiebreak_chain",
        ["head_to_head", "highest_single_gw", "fewest_transfers", "split"])

    events = fetch_bootstrap()
    current_ev = next((e for e in events if e["is_current"]), None)
    current_gw = current_ev["id"] if current_ev else None

    gw_to_period = load_or_freeze_periods(events)
    period_gws = period_gameweeks(gw_to_period)

    current_members, live_league_name = fetch_members(league_id)
    members_doc = load_and_sync_members(current_members, current_gw)
    members = members_doc["members"]

    # Fetch history for EVERY member, including departed ones.
    member_gw = {}
    member_chips = {}
    log("Fetching per-entry history for %d member(s) ..." % len(members))
    for m in members:
        eid = m["entry_id"]
        current, chips = fetch_history(eid)
        member_gw[eid] = build_member_gw(current)
        chip_by_gw = {}
        for c in chips:
            if isinstance(c, dict) and c.get("event") is not None:
                chip_by_gw[c["event"]] = c.get("name", "chip")
        member_chips[eid] = chip_by_gw
        time.sleep(REQUEST_SLEEP)

    # Frozen N for prizes.
    eligible_members = [m for m in members if m.get("prize_eligible")]
    if members_doc.get("roster_locked") and "locked_player_count" in members_doc:
        n_eligible = members_doc["locked_player_count"]
    else:
        n_eligible = len(eligible_members)
    eligible_ids = {m["entry_id"] for m in eligible_members}

    monthly_prize = monthly_per_player * n_eligible
    overall_prize = overall_per_player * n_eligible

    # Per-gameweek league average net (relative colour-coding basis).
    gw_meta = []
    for ev in events:
        nets = [member_gw[eid][ev["id"]]["net"]
                for eid in member_gw if ev["id"] in member_gw[eid]]
        avg = round(sum(nets) / len(nets), 1) if nets else None
        gw_meta.append({
            "id": ev["id"],
            "name": ev["name"],
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

    periods_out = []
    for period in sorted(period_gws):
        gws = period_gws[period]
        complete = len(gws) > 0 and all(gw in finished_gws for gw in gws)
        remaining = sum(1 for gw in gws if gw not in finished_gws)
        computed = rank_period(period, gws, members, member_gw, eligible_ids,
                               tiebreak_chain, monthly_prize)

        winner = computed["winner"]
        pkey = str(period)
        if complete:
            if pkey in prior_results["periods"]:
                recorded = prior_results["periods"][pkey]
                # Immutable: keep the recorded winner; warn if we would differ.
                rec_ids = sorted(recorded.get("winner", {}).get("entry_ids", []))
                new_ids = sorted((winner or {}).get("entry_ids", []))
                if rec_ids != new_ids:
                    warn("period %d already recorded with winner(s) %s but a "
                         "recompute gives %s — KEEPING the recorded result."
                         % (period, rec_ids, new_ids))
                winner = recorded.get("winner")
            else:
                prior_results["periods"][pkey] = {
                    "winner": winner,
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                }
                log("Recorded immutable result for period %d" % period)

        computed.update({
            "complete": complete,
            "remaining_gws": remaining,
            "prize": monthly_prize,
            "is_current": current_ev is not None and gw_to_period.get(
                str(current_gw)) == period,
            "winner": winner,
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
                "chip": member_chips.get(eid, {}).get(gw),
                "provisional": gw not in finished_gws,
            }
        members_out.append({
            "entry_id": eid,
            "player_name": m["player_name"],
            "entry_name": m["entry_name"],
            "paid": bool(m.get("paid")),
            "prize_eligible": bool(m.get("prize_eligible")),
            "in_league": bool(m.get("in_league", True)),
            "first_seen_gw": m.get("first_seen_gw"),
            "total_net": total_net,
            "hits_total": hits_total,
            "gws_played": len(gws),
            "by_gw": by_gw,
        })
    members_out.sort(key=lambda r: (-r["total_net"], r["player_name"]))

    # --- Prize table.
    money_won = {m["entry_id"]: 0.0 for m in members}
    periods_won = {m["entry_id"]: 0 for m in members}
    for p in periods_out:
        w = p["winner"]
        if p["complete"] and w:
            for eid in w["entry_ids"]:
                money_won[eid] = money_won.get(eid, 0) + w["amount_each"]
                periods_won[eid] = periods_won.get(eid, 0) + 1

    prize_table = []
    for m in members_out:
        eid = m["entry_id"]
        won = round(money_won.get(eid, 0), 2)
        prize_table.append({
            "entry_id": eid,
            "player_name": m["player_name"],
            "entry_name": m["entry_name"],
            "periods_won": periods_won.get(eid, 0),
            "money_won": won,
            "net_position": round(won - buy_in, 2) if m["prize_eligible"] else None,
            "prize_eligible": m["prize_eligible"],
            "in_league": m["in_league"],
            "paid": m["paid"],
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
        "n_eligible": n_eligible,
        "roster_locked": bool(members_doc.get("roster_locked")),
        "prizes": {
            "currency": currency,
            "buy_in": buy_in,
            "monthly_per_player": monthly_per_player,
            "monthly_periods": monthly_periods,
            "monthly": monthly_prize,
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
    log("Wrote %s (%d member(s), N=%d, current GW=%s)"
        % (LEAGUE_OUT, len(members_out), n_eligible, current_gw))


if __name__ == "__main__":
    main()
