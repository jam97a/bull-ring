# Bull Ring — FPL Mini-League Tracker

A **free-forever** static site that tracks a Fantasy Premier League mini-league:
every gameweek score, monthly leaderboards, and a running prize-money table.

- **Frontend:** vanilla HTML/CSS/JS, no build step, hosted on GitHub Pages.
- **Backend:** a Python script (`scripts/fetch.py`) that runs in GitHub Actions
  every 6 hours, fetches the FPL API server-side, computes everything, and
  commits a single `data/league.json` back to the repo.

The browser only ever reads the local `data/league.json`. It **never** calls
the FPL API directly — the FPL API sends no CORS headers, so browser `fetch()`
to it always fails even though it works in curl.

---

## How it fits together

```
FPL API  ──(server-side, in Actions)──►  scripts/fetch.py  ──►  data/league.json
                                                                      │
                                            GitHub Pages  ◄───────────┘
                                          index.html + app.js + style.css
```

`fetch.py` uses the **Python standard library only** — no `pip install`, nothing
to rot mid-season.

---

## Configuration

All config lives in `config/`. Edit these by hand; the script reads them.

### `config/league.json` — which league

```json
{ "league_id": 1472020, "league_name": "Bull Ring 26/27", "season": "2026/27" }
```

Change `league_id` to point at a different mini-league. It is read at runtime,
never hardcoded in the script.

### `config/prizes.json` — the money

```json
{
  "currency": "EUR",
  "buy_in": 50,
  "monthly_periods": 9,
  "monthly_1st": 2.50,
  "monthly_2nd": 1.25,
  "overall_1st": 16.25,
  "tiebreak_chain": ["head_to_head", "highest_single_gw", "fewest_transfers", "split"]
}
```

Each period pays **two** monthly prizes — a 1st and a 2nd — plus one overall
prize at the end of the season. The three figures above are **per-player
shares** of the €50 buy-in. Prizes scale with `N`, the **member count** (frozen
at the GW1 deadline):

- Monthly 1st = `monthly_1st * N`   (at N=20: €50)
- Monthly 2nd = `monthly_2nd * N`   (at N=20: €25)
- Overall = `overall_1st * N`       (at N=20: €325)

**Invariant:** the per-player shares must sum to exactly the buy-in —
`(monthly_1st + monthly_2nd) * monthly_periods + overall_1st == buy_in`
(`(2.50 + 1.25) × 9 + 16.25 = 50.00`). The script asserts this at startup and
**fails loudly** if a future edit breaks it. There is no third monthly place
and no second overall prize.

`tiebreak_chain` is applied in order, stopping at the first step that separates
tied managers:

1. **head_to_head** — most head-to-head gameweek wins within the period
   (only gameweeks both managers played count).
2. **highest_single_gw** — best single gameweek net score in the period.
3. **fewest_transfers** — lowest total `event_transfers` in the period (the raw
   transfer count, not hits).
4. **split** — divide the prize equally.

### `config/periods.json` — the frozen gameweek → period mapping

Nine prize periods (August + September are combined into period 1). This file is
**generated automatically on the first run that sees a full 38-gameweek
bootstrap**, from each gameweek's deadline month.

**The boundaries are judgement calls, not facts.** A gameweek with a Friday
deadline at the end of a month plays most of its fixtures in the next month, and
December pile-ups / rescheduled gameweeks make it worse. So:

1. Let the first run generate a sensible default.
2. **Agree it with the league and edit it by hand** before the season matters.
3. After that it is frozen. The script **never overwrites it** — if a later run
   would derive a different mapping, it logs a loud warning and keeps your file.

Edit `gameweek_to_period` (a `{"gameweek": period}` map) to move a boundary.

### `config/members.json` — the roster (source of truth)

**The member list is persisted here, not rebuilt from the standings each run.**
If a manager leaves the mini-league they vanish from the FPL standings endpoint —
along with all their history — so rebuilding from it would erase past winners.

**Everyone in the roster is a paid, prize-eligible entrant** — there is no
paid/eligible state anywhere. The prize pool is simply member count × buy-in.

The script maintains this file automatically:

- **Appends** any newly-seen entry (until the roster locks — see below).
- **Never removes** anyone. A departed member is kept and flagged `in_league: false`;
  they've paid and their scores still count.

**The roster locks at the GW1 deadline.** Once the first gameweek's deadline has
passed, the script stops appending: anyone who appears in the live standings after
that point is ignored, not added — so the member count (and therefore the announced
pot) can't grow mid-season. The moment the lock took effect is recorded as
`roster_locked_at` in this file, for audit. There is nothing to edit by hand.

```json
{
  "roster_locked_at": "2026-08-21T17:30:00Z",
  "members": [
    {
      "entry_id": 123456,
      "player_name": "...",
      "entry_name": "...",
      "in_league": true,
      "first_seen_gw": 1,
      "notes": ""
    }
  ]
}
```

(`roster_locked_at` is absent until the GW1 deadline passes.)

### `data/results.json` — immutable period results

When a period finishes, its winner and the resolving tiebreak are written here
**once** and never recomputed. This protects the season against roster changes,
retroactive FPL point adjustments, and later tiebreak-config edits. If a
recompute would produce a different winner for a recorded period, the script
warns loudly and keeps the recorded result. Don't hand-edit this unless you
genuinely need to correct a recorded result.

---

## Running the fetch locally

Requires only Python 3.8+ (standard library). From the repo root:

```bash
python scripts/fetch.py
```

It fetches live FPL data, updates `config/members.json` / `config/periods.json`
as described above, and writes `data/league.json` (and `data/results.json`).
Runs with **no arguments**. It exits non-zero and leaves existing data untouched
if the FPL API fails or returns an unexpected shape.

### Previewing the site locally

The frontend loads `data/league.json` with `fetch()`, so open it through a local
web server (not `file://`):

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>.

---

## Deploying (free forever)

1. Push this repo to a **public** GitHub repository (public = unlimited Actions
   minutes; there are no secrets).
2. **Settings → Pages** → deploy from the `main` branch, root folder.
3. **Settings → Actions → General** → allow workflows to write, so the scheduled
   job can commit `data/league.json`.
4. The workflow (`.github/workflows/update.yml`) runs every 6 hours and on manual
   dispatch. It commits only when `data/league.json` actually changed.

---

## Views

- **Overall** — season standings by total net points (points minus transfer hits).
- **Monthly** — the live current period on top with its prize and gameweeks
  remaining; completed periods below, collapsed to winner + amount, expandable to
  the full table and the reason a tie was resolved.
- **Prizes** — money won per member, and each person's net position against their
  buy-in. The overall prize shows as a pending row until the season ends.
- **Grid** — every manager × every gameweek, net points per cell, colour-coded
  **relative to that gameweek's league average**, with hits shown as `62 (-4)`
  and chip icons. Sticky header row and name column.

## A note on the numbers

**Net points** — `points - event_transfers_cost` — is the scoring basis
everywhere. Transfer hits count against you. Unfinished gameweeks are marked
provisional (`*`) because FPL adjusts bonus points and stat corrections after
matches end.
