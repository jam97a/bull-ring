# Design & Rules — Addendum to SPEC.md

Replaces all styling guidance in SPEC.md and adds a fifth view, the rules page. Data layer, `fetch.py`, and the JSON contract unchanged — frontend only.

**Layout and structure below are settled and should not be redesigned.** What changed in this revision is energy: texture, heat, movement, and scale contrast. The previous version was correct and dull. The fix is not more decoration — it is making the *data itself* the thing that moves.

---

## Who this is for

Fourteen mates in a €50 league, on a phone, one-handed, answering one of three questions: *where am I, who's winning the month, am I up or down.*

Reference point: a broadcast scoreboard with the graphics package turned up. Dark ground, disciplined structure, but the numbers are alive — they count, they run hot and cold, they move up and down the table. **Static tables are what made the last version dull.** Nothing on this page should look like it was printed and left there.

---

## Tokens

CSS custom properties on `:root`. No colour or size hardcoded anywhere else.

### Colour

```css
--pitch:      #14100F;  /* page ground — warm near-black, never blue-black */
--surface:    #1F1917;  /* raised panels, table bodies */
--surface-hi: #2B2321;  /* row stripes, hover, sticky column */
--oxblood:    #3D1620;  /* header band */
--sangre:     #C41E3A;  /* the bull — identity, live states, hits */
--ember:      #FF6B35;  /* top of the heat scale, biggest riser — hot only */
--ice:        #4A6670;  /* bottom of the heat scale — cold only */
--oro:        #D4A94A;  /* money and winners, nothing else */
--bone:       #F2EDE6;  /* primary text */
--sombra:     #9A8F86;  /* secondary text, labels */
--line:       #332B28;  /* hairlines */
```

Three rules that matter more than the values:

**Gold is only ever money or a winner.** Scarcest colour on the page. That scarcity is why the prize table reads instantly with no legend.

**Ember and ice belong to the heat scale only.** They never appear as UI colour — no ember buttons, no ice borders. Seeing ember means *someone had a huge week*, always.

**The ground is warm, not neutral.** `#14100F` has red-brown in it. Cold `#0A0A0A` with a red accent is the generic dark-mode look. Never substitute pure black or any grey with blue in it.

### Texture — do not skip this

Flat black is most of why the last version felt dull. Two treatments, both subtle:

1. **Grain.** A fine noise overlay across the whole page at 3–4% opacity, generated as an inline SVG `feTurbulence` filter, `pointer-events: none`, fixed position. It should be invisible as an effect and obvious in its absence.
2. **The bull, oversized.** The mark at roughly 380px, `--sangre` at 6% opacity, bleeding off the top-right corner behind the header band so the horns are cropped. Never a centred watermark. On screens under 600px, scale to 220px and crop harder.

### Type

From Google Fonts:

- **Display — `Archivo` variable, weight 900, width 125 (expanded).** Not plain Archivo Black — the expanded width is what gives the big numbers presence. Tracking `-0.02em`. Big numbers only, 28px and up.
- **Labels — `Archivo` variable, weight 700, width 75 (condensed), 12px, uppercase, `letter-spacing: 0.12em`.** The condensed-against-expanded contrast is the type idea. Wide numbers, narrow labels, nothing in between.
- **Body — `Public Sans`.** Prose, navigation, rules page.
- **Data — `IBM Plex Mono`** with `font-variant-numeric: tabular-nums`. Every number in every table. Non-negotiable in the grid.

Scale: 12 / 14 / 16 / 20 / 32 / 56. Nothing between. **Push the extremes** — a 56px expanded figure directly above a 12px condensed label is the effect. Timid scale contrast is what reads as plain.

---

## Signature: sol y sombra

Bullrings sell seats as **sol** or **sombra** depending which side of the arena they're on. This organises the prize table, the view people actually open.

Every member is above or below their €50 buy-in:

- **Sol** — in profit. `--surface` row, prize figure in `--oro`, name in `--bone`.
- **Sombra** — down. `--pitch` row, everything in `--sombra`, prize figure in `--bone` not gold.

A 2px `--sangre` rule runs across the table exactly at break-even, with `SOL` and `SOMBRA` in 12px condensed caps in the margins above and below.

In August the line sits near the top and nearly everyone is in shade. By May it will have travelled down. That movement is the season.

This remains the signature. Everything below adds energy without competing with it.

---

## Making it move

Five additions. All of them make data legible — none is decoration.

### 1. The money strip counts up

The three hero figures animate from zero on first paint, 900ms, ease-out, staggered 80ms apart. Mono tabular so the width never jumps. It happens once per session, not on every tab switch.

### 2. The grid is a real heat map

The previous "shades toward sangre at low opacity" was timid. Use the full ramp, scaled to that gameweek's league average:

```
ice ──── surface ──── sangre ──── ember
cold      average       good       huge
```

A genuine ramp with `--ember` reserved for genuinely enormous weeks (roughly top 10% of all scores in the season so far). Recompute the scale as the season goes so it stays meaningful. Text stays `--bone` throughout; the cell background carries the heat.

This makes the grid the most visually alive thing on the site, which is right — it holds every score anyone has ever had.

### 3. Movement arrows

Overall table shows rank change since last gameweek: a small triangle plus the number of places. `--ember` for up, `--sombra` for down, nothing for unchanged. Sports tables live on movement, and a table with no movement indicators is a spreadsheet.

### 4. The form strip

Beside each name in the overall table, the last five gameweeks as five small squares coloured from the same heat scale. A tiny sparkline of who is running hot. Reads instantly, takes 40px, and answers "who's on a heater" without opening the grid.

### 5. The monthly winner card

When a period closes, don't render it as another table row. A full-width `--surface` card: the bull mark at 64px in `--oro`, the winner's team name at 32px expanded, their net total, the amount won in gold, and a single line naming the tiebreak if one was used. This is the moment the whole site exists for — design it like one.

Current period gets the same card, marked `LIVE` in `--sangre` with a slow pulse, showing the current leader and gameweeks remaining.

---

## Layout

Settled. Mobile-first, single column, 720px cap centred on desktop.

```
┌────────────────────────────────┐
│ ▓▓ oxblood ▓▓▓▓▓▓▓▓▓ [bull ⌐  │  ← mark bleeds off corner
│  [bull]  BULL RING             │
│          2026/27               │
├────────────────────────────────┤
│  €42        €322       14      │  ← 56px expanded, counts up
│  A MONTH    OVERALL    PLAYING │  ← 12px condensed caps
├────────────────────────────────┤
│ TABLE   MONTH   MONEY   GWS  ⓘ │
├────────────────────────────────┤
│                                │
│         (active view)          │
│                                │
├────────────────────────────────┤
│  Updated 2 hours ago           │
└────────────────────────────────┘
```

Header band `--oxblood`, full-bleed, mark at 40px beside the wordmark. Tab bar sticks to the **bottom** under 600px where a thumb is, top on desktop. Active tab gets a 2px `--sangre` underline, not a filled pill.

### Gameweek grid

Sticky first column (first name + last initial) on `--surface-hi`, sticky header row, horizontal scroll for the body. 36px minimum cell height. Shadow on the sticky column's right edge so it's clear the table scrolls.

Hits show as `62 −4`, the `−4` in `--bone` at 12px (not sangre — the cell is already carrying heat colour). Chips get a single `--oro` letter in the corner: W, B, T, F.

---

## Copy

Dry labels are half of what made it dull. Plain, not corporate, and never cute for its own sake.

- Section headings: `THE MONEY`, `THIS MONTH`, `EVERY GAMEWEEK`, `THE TABLE`
- Above the leader on the overall table: `TOP OF THE SHOP`
- Live period card: `LIVE — 2 GAMEWEEKS LEFT`
- Empty grid cell tooltip: `Didn't play`
- Break-even markers: `SOL` / `SOMBRA`

Sentence case in prose, condensed caps in labels. No exclamation marks anywhere.

## Motion

1. Money strip counts up, 900ms, once per session.
2. Break-even rule draws left to right, 400ms, on first paint of the prize table.
3. Tab cross-fade, 150ms.
4. Row hover to `--surface-hi`, 100ms.
5. `LIVE` badge pulses at 2s, opacity only.

Nothing else. Respect `prefers-reduced-motion: reduce` and drop all five — the counting numbers land on their final value immediately.

## Quality floor

Responsive from 320px. Visible keyboard focus, 2px `--sangre` outline with 2px offset, never `outline: none`. Real `<table>` markup with `<th scope>`. `<meta charset="utf-8">` for accented team names. `--bone` and `--sombra` on `--pitch` pass AA; `--sangre` and `--ember` are for large text and rules only, never body copy. Heat map cells must stay legible at every point on the ramp — check `--bone` against the ember end.

## Empty and error states

The interface's voice, not an apology.

- Before GW1: **"No scores yet. First gameweek deadline is Friday."** Show the roster and money strip — those exist.
- Fetch failed: **"Showing scores from [timestamp]. The update job hasn't run since."** Never blank, never a hanging spinner.
- Member with no history: blank cells, not zeros. Zero is a score; blank is an absence.

---

## Rules page

Fifth view, ⓘ tab. Prose with `--sangre` headings in expanded 900 at 20px, body Public Sans 16px, generous line height. No cards, no accordions — people scroll it and screenshot a section to settle an argument.

Braced figures bind to `data/league.json` so they never go stale.

**The buy-in**
€50 each. {N} playing, so the pot is €{N × 50}.

**How the money splits**
€3 of everyone's €50 goes to each of the nine monthly prizes. The remaining €23 goes to the overall winner. Each month is worth **€{3 × N}**, the season **€{23 × N}**.

**The nine months**
August and September count as one period. Then October, November, December, January, February, March, April, May.

Render the period table from `config/periods.json`: name, gameweeks, count. Underneath, state plainly that periods vary in length — December is six gameweeks, March and April three — and that every period pays the same regardless. Someone will ask; answer it first.

**How scores are counted**
Net points. Transfer hits come off. A 62 with a −4 counts as 58, for the month and the season.

**Chips**
No restrictions. Wildcard, bench boost, triple captain and free hit can be played whenever, including to win a month.

**Ties**
Settled in order, stopping at the first that separates you:
1. Head-to-head — who won more gameweeks against the other in that period
2. Highest single gameweek in the period
3. Fewest transfers made in the period
4. Still level, the prize splits

The site shows which rule settled a tie and the numbers behind it.

**Who's in**
Roster locked at the GW1 deadline. Unpaid by then means no prize money. Leaving the mini-league mid-season doesn't remove your scores — you paid, your team still scores.

**Payment**
All €50s to the league admin before the deadline. Eligible once the money's in.

---

## Files

- `assets/bull.svg` — the mark. Original artwork for this league.
- Generate 32×32 and 180×180 PNGs for favicon and iOS home screen icon.
- `<meta name="theme-color" content="#3D1620">` so browser chrome matches the header band on a home screen. People will save this to their phone — make that path look finished.
