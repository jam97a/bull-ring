# FPL Mini-League Tracker — Build Spec

Build a static website that tracks a Fantasy Premier League mini-league: every gameweek score, monthly leaderboards, and a running prize-money table.

**The league:** "Bull Ring 26/27", league ID `1472020`. Use this as the default in `config/league.json`, but keep it configurable rather than hardcoded in the script.

Hard constraint: **must be free to host forever.** Use GitHub Pages for the site and a GitHub Actions cron job for data fetching. No paid services, no database, no backend server.

---

## Critical constraint: CORS

The FPL API does **not** send CORS headers. Browser `fetch()` calls to it will fail even though they work fine in curl or Postman. Do not attempt to call the FPL API from client-side JavaScript.

The architecture must therefore be:

1. A Python script runs in GitHub Actions on a schedule
2. It fetches from the FPL API server-side (no CORS restriction)
3. It computes everything and writes a single `data/league.json`
4. The Actions job commits that JSON back to the repo
5. The static site reads only the local `data/league.json`

The browser never touches the FPL API.

---

## Data source

Base URL: `https://fantasy.premierleague.com/api`

These endpoints are unofficial and undocumented. They can change without warning, so validate the shape of every response and fail loudly with a clear error rather than silently writing garbage.

### `GET /bootstrap-static/`
Returns an `events` array — one object per gameweek. Fields needed:
- `id` — gameweek number (1–38)
- `name` — e.g. "Gameweek 12"
- `deadline_time` — ISO timestamp, used to map gameweeks to calendar months
- `finished` — boolean
- `is_current`, `is_next` — booleans

### `GET /leagues-classic/{LEAGUE_ID}/standings/`
Returns `standings.results` — the league members. Fields needed:
- `entry` — the manager's entry ID (used for the next endpoint)
- `player_name` — the person's real name
- `entry_name` — their team name

This response is **paginated**. If `standings.has_next` is true, request the next page with `?page_standings=2` and so on until exhausted. Do not assume one page.

### `GET /entry/{ENTRY_ID}/history/`
Returns:
- `current` — array of per-gameweek objects with `event`, `points`, `total_points`, `event_transfers`, `event_transfers_cost`, `points_on_bench`
- `chips` — array of chips played, each with `name` and `event`

Fetch this once per league member. Sleep ~0.5s between requests to avoid hammering the API.

---

## Scoring rules

**Net points is the scoring basis everywhere in this app.**

```
net_points(gameweek) = points - event_transfers_cost
```

Transfer hits count against you. Never display raw `points` as a score without making it clear it excludes hits.

Season total for a manager is the sum of net points across all gameweeks they have played.

---

## Prize periods

Nine periods, not nine calendar months — August and September are combined:

| Period | Covers |
|---|---|
| 1 | August + September |
| 2 | October |
| 3 | November |
| 4 | December |
| 5 | January |
| 6 | February |
| 7 | March |
| 8 | April |
| 9 | May |

Derive the gameweek-to-period mapping from each gameweek's `deadline_time` month, **but write the resolved mapping into a config file** (`config/periods.json`) that a human can hand-edit and that the app reads at runtime.

This matters because the boundaries are judgement calls, not facts. A gameweek with a Friday deadline at the end of a month has most of its fixtures in the next month. The December fixture pile-up and any rescheduled gameweeks make it worse. The mapping must be agreed with the league before the season and then frozen — so generate a sensible default, but never recompute it silently on later runs. If a run would produce a mapping different from the frozen config, log a loud warning and keep the config.

---

## Prize money

Put all of this in `config/prizes.json`:

```json
{
  "buy_in": 50,
  "monthly_per_player": 3,
  "currency": "EUR"
}
```

Player count `N` comes from the actual number of league members, so prizes scale automatically as people join.

- Monthly prize = `monthly_per_player * N` (at N=10: €30)
- Overall prize = `(buy_in - monthly_per_player * 9) * N` (at N=10: €230)

Display these as computed values, never hardcoded. Show the current `N` on the page so it's obvious why the numbers are what they are.

### Tiebreaks

Ties on net points within a period are possible and must resolve deterministically. Apply this chain in order, stopping at the first step that separates the tied managers:

**1. Head-to-head gameweek wins.** Within the tied period only, count the gameweeks in which each tied manager scored more net points than the other. Most wins takes the prize.

**2. Highest single gameweek.** Best individual gameweek net score within the period.

**3. Fewest transfers.** Lowest total `event_transfers` within the period.

**4. Split the prize.** If still tied, divide the prize equally between the tied managers and display it as a split on the site.

Implementation notes:

- Head-to-head is only well-defined for two managers. For **three or more tied**, compute each manager's total head-to-head gameweek wins against all other tied managers combined, and take the highest. This can still produce a cycle (A beats B, B beats C, C beats A) resulting in equal counts — that is expected, and it falls through to step 2.
- An even number of gameweeks in a period can produce a 2-2 style deadlock. This is also expected and falls through to step 2. Do not special-case it.
- Only gameweeks that both tied managers actually played count toward head-to-head. If one joined mid-period, exclude the gameweeks the other played alone.
- The full chain must be recorded in the output JSON: for any resolved tie, store which step resolved it and the values at that step, so the site can display *why* someone won. People will ask.

Keep the chain configurable in `config/prizes.json` as an ordered list, defaulting to the order above.

---

## Roster management

League membership changes during the season. People join late, and people leave. This has two consequences the app must handle explicitly.

### The member list is persisted, not derived

**Do not rebuild the member list from the league standings endpoint on every run.**

If a manager leaves the mini-league, they disappear from `/leagues-classic/{id}/standings/` — and with them, every gameweek score they ever recorded. A prize table rebuilt from a shrunken roster would silently rewrite history and erase past monthly winners.

Instead:

1. Maintain `config/members.json` as the source of truth for who is in the competition
2. On each run, fetch the league standings and **add** any newly-seen entry IDs to that file
3. **Never remove** an entry from `config/members.json` automatically. If someone is no longer in the standings, mark them `"in_league": false` and keep them
4. Fetch `/entry/{ENTRY_ID}/history/` for **every** member in the file, including departed ones. This endpoint works independently of league membership, so their history stays retrievable

`config/members.json` shape:

```json
{
  "roster_locked": true,
  "members": [
    {
      "entry_id": 123456,
      "player_name": "...",
      "entry_name": "...",
      "paid": true,
      "prize_eligible": true,
      "in_league": true,
      "first_seen_gw": 1,
      "notes": ""
    }
  ]
}
```

### Paid status is manual

The FPL API has no idea who has handed over €50. `paid` and `prize_eligible` are human-edited fields. The script must never set or overwrite them — only ever append new members with `paid: false` and `prize_eligible: false` as the default, for a human to confirm.

### Prize eligibility and the frozen N

- `N` for all prize calculations is the count of members where `prize_eligible` is true
- Once `roster_locked` is set to true in `config/members.json`, **N is frozen for the remainder of the season**. Store the locked value as `locked_player_count` and use it for every calculation from that point on, even if the eligible count later changes
- Members who are not prize-eligible still appear in all standings and the gameweek grid — they just cannot win money. Display them with a visual marker so it's obvious why they're skipped in the prize table
- A member with `in_league: false` who is still `prize_eligible` remains eligible. They paid; their team still scores points. Show them with a marker indicating they left the mini-league

### Results are immutable once a period ends

When a prize period finishes, write the winner and the resolved tiebreak into `data/results.json` and **never recompute it**. Subsequent runs read past results from that file rather than recalculating them from current data.

This is what protects the season against roster changes, retroactive FPL point adjustments, and any later change to the tiebreak configuration. If a recomputation would produce a different winner for a period already recorded, log a loud warning and keep the recorded result.

---

## Views

Mobile-first. The people using this will check it on their phones, standing in a pub. Everything must be readable and tappable on a small screen. Desktop is secondary.

### 1. Overall table
Season standings by total net points. Columns: rank, name, team name, total net points, total hits taken, gameweeks played. Highlight the leader.

### 2. Monthly leaderboard
- The **current period** shown live at the top, with the prize amount and how many gameweeks remain in it
- **Completed periods** below, each collapsed to show the winner and the amount won, expandable to the full table for that period

### 3. Prize leaderboard
The money table. Every league member, sorted by total won so far. Columns: name, periods won, total money won, and net position against their €50 buy-in (so people can see who's actually up).

Include the overall prize as a pending row until the season finishes.

### 4. Gameweek grid
Every manager × every gameweek. Net points in each cell. Sticky header row and sticky name column so it stays readable while scrolling horizontally on a phone.

Colour-code cells: strong scores, poor scores, and mark any gameweek where a hit was taken (show it as e.g. `62 (-4)`). Mark chip usage with a small icon — wildcard, bench boost, triple captain, free hit — since chips distort monthly results and people will want to see them.

---

## Repo layout

```
.github/workflows/update.yml
config/
  league.json          # league_id
  periods.json         # frozen gameweek → period mapping
  prizes.json          # buy-in, monthly amount, tiebreak rule
scripts/
  fetch.py             # fetch + compute + write data/league.json
data/
  league.json          # generated, committed by CI
index.html
app.js
style.css
README.md
```

## GitHub Actions workflow

- Schedule: every 6 hours via cron, plus `workflow_dispatch` so it can be triggered manually
- Needs `permissions: contents: write` to commit the updated JSON
- Commit only if `data/league.json` actually changed, so the history doesn't fill with no-op commits
- Use the **public repo** — Actions minutes are unlimited on public repos, and there are no secrets involved
- If the FPL API fails, exit non-zero so the run shows as failed, and leave the previous `data/league.json` untouched. Stale data beats broken data.

## Edge cases to handle

- **Managers joining mid-season** — their `current` array starts at a later gameweek. Don't treat missing early gameweeks as zeros in the season total, but do show them as blank in the grid.
- **Gameweek not finished** — mark scores as provisional; FPL adjusts for bonus points and late stat corrections after matches end.
- **Blank and double gameweeks** — no special handling needed since everything keys off the `event` number, but don't assume gameweek count equals fixture count anywhere.
- **Empty league** — the script should handle a league with zero or one member without crashing.
- **First run before the season starts** — `entry/{id}/history/` may return an empty `current` array. Render an empty-state page, don't crash.

## Also

- Write a `README.md` explaining how to set the league ID, edit the period mapping, and run the fetch script locally
- Make `scripts/fetch.py` runnable locally with no arguments for testing
- Show a "last updated" timestamp on the site, read from the JSON
- Keep the frontend dependency-free — vanilla HTML/CSS/JS, no build step. It has to still work in May without anything having rotted.
