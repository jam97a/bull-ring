# Design & Rules — Addendum to SPEC.md

Replaces all styling guidance in SPEC.md and adds a fifth view, the rules page. The data layer, `fetch.py`, and the JSON contract are unchanged — this is frontend only.

---

## Who this is for

Fourteen mates in a €50 league, on a phone, one-handed, answering one of three questions: *where am I, who's winning the month, am I up or down.* Every decision below serves those three.

**Reference point: a broadcast scoreboard, not a web app.** Dark ground, restrained palette, type doing the work, numbers that read at a glance from arm's length. The league is called Bull Ring, so the accent is the red of the muleta and the mark is a bull — but the execution stays sober. One flash of colour on a dark field is what makes it look expensive.

---

## Tokens

Define as CSS custom properties on `:root`. No colour or size may be hardcoded anywhere else in the stylesheet.

### Colour

```css
--pitch:      #14100F;  /* page ground — warm near-black, never blue-black */
--surface:    #1F1917;  /* raised panels, table bodies */
--surface-hi: #2B2321;  /* row stripes, hover, sticky column */
--oxblood:    #3D1620;  /* header band and section rules */
--sangre:     #C41E3A;  /* the bull — identity, live states, hits */
--oro:        #D4A94A;  /* money and winners, nothing else */
--bone:       #F2EDE6;  /* primary text */
--sombra:     #9A8F86;  /* secondary text, labels, muted rows */
--line:       #332B28;  /* hairlines and table borders */
```

Two rules that matter more than the values:

**Gold is only ever money or a winner.** It is the scarcest colour on the page. That scarcity is what makes the prize table read instantly without a legend.

**The ground is warm, not neutral.** `#14100F` has red-brown in it. A cold `#0A0A0A` with a red accent is the generic dark-mode look; the warmth is what stops this reading as a template. Never substitute pure black or a grey with blue in it.

Build depth with the three surface levels — `--pitch` behind, `--surface` for panels, `--surface-hi` for stripes and the sticky column. A flat single-black page is the thing to avoid.

### Type

From Google Fonts:

- **Display — `Archivo Black`.** Wordmark, view headings, and the single largest number on each screen. Tight tracking (`-0.02em`). Never below 18px, never for body copy.
- **Body — `Public Sans`.** Prose, labels, navigation, the rules page.
- **Data — `IBM Plex Mono`.** Every number in every table, with `font-variant-numeric: tabular-nums`. Non-negotiable in the gameweek grid — columns must align or the grid is unreadable.

Scale: 12 / 14 / 16 / 20 / 28 / 46. Nothing between. Body 16, table data 14, labels 12 in small caps with `letter-spacing: 0.08em`.

### Structure

```css
--radius: 4px;
--line-thin: 1px solid var(--line);
--gap: 16px;
```

Restrained corners. Hairlines rather than heavy borders — on a dark ground a 1px `--line` reads as a division without adding weight.

---

## Signature: sol y sombra

Bullrings sell seats as **sol** or **sombra** depending which side of the arena they're on. That's the organising device of the prize table, which is the view people actually open.

Every member is above or below their €50 buy-in:

- **Sol** — in profit. `--surface` row, prize figure in `--oro`, name in `--bone`.
- **Sombra** — down on the year. `--pitch` row, everything in `--sombra`, prize figure in `--bone` rather than gold.

A single 2px `--sangre` rule runs across the table exactly at the break-even line, with `SOL` and `SOMBRA` set in 12px small caps in the margins above and below it.

In August the line sits near the top and nearly everyone is in shade. By May it will have travelled down the table. That movement is the season, and it costs nothing to show.

**This is the only bold move on the site.** Everything else stays quiet and disciplined. Do not add a second signature.

---

## Layout

Mobile-first, single column, content capped at 720px and centred on desktop.

```
┌────────────────────────────────┐
│ ▓▓ oxblood band ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  [bull]  BULL RING             │
│          2026/27               │
├────────────────────────────────┤
│  €42        €322       14      │  ← Archivo Black 46
│  A MONTH    OVERALL    PLAYING │  ← 12px small caps, sombra
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

The three-figure strip under the wordmark is the hero. Real money, scaling with how many played — the most characteristic fact about this league. Three figures, three labels, a `--line` divider between each, nothing else.

Header band in `--oxblood`, full-bleed, with the bull mark at 40px and the wordmark in Archivo Black beside it. This band is the only large area of colour on the page.

Tab bar sticks to the **bottom** under 600px, where a thumb is. Top on desktop. Active tab marked with a 2px `--sangre` underline, not a filled pill.

### Gameweek grid

The hard view. Sticky first column (first name + last initial) on `--surface-hi`, sticky header row of gameweek numbers, horizontal scroll for the body. Minimum 36px cell height for thumb accuracy. A soft shadow on the right edge of the sticky column so it's obvious the table scrolls sideways.

Cells colour **relative to that gameweek's league average**, as already specced — not fixed thresholds. Above average shades toward `--sangre` at low opacity; below shades toward `--pitch`. Hits show as `62 −4` with the `−4` in `--sangre` at 12px. Chips get a single `--oro` letter in the cell corner: W, B, T, F.

---

## Motion

Three things only:

1. Tab switches cross-fade, 150ms.
2. The break-even rule draws left to right on first paint, 400ms, ease-out. It's the signature — let it announce itself once, then never again.
3. Row hover lifts to `--surface-hi`, 100ms.

Everything else static. Respect `prefers-reduced-motion: reduce` and drop all of it.

## Quality floor

Responsive from 320px. Visible keyboard focus — 2px `--sangre` outline with 2px offset, never `outline: none`. Real `<table>` markup with `<th scope>`. `<meta charset="utf-8">` so accented team names render properly. `--bone` and `--sombra` on `--pitch` both pass AA; `--sangre` on `--pitch` is for large text and 2px rules only, never body copy.

## Empty and error states

Written in the interface's voice, not an apology.

- Before GW1 is scored: **"No scores yet. First gameweek deadline is Friday."** Show the roster and the money strip — those exist.
- Fetch failed: **"Showing scores from [timestamp]. The update job hasn't run since."** Never a blank screen, never a hanging spinner.
- Member with no history: blank cells, not zeros. Zero is a score; blank is an absence.

---

## Rules page

Fifth view, on the ⓘ tab. Static prose with `--sangre` headings in Archivo Black at 20px, body in Public Sans at 16px, generous line height. No cards, no accordions — people need to scroll it and screenshot a section to settle an argument.

Figures in braces bind to `data/league.json` so they never go stale.

**The buy-in**
€50 each. {N} playing, so the pot is €{N × 50}.

**How the money splits**
€3 of everyone's €50 goes to each of the nine monthly prizes. The remaining €23 goes to the overall winner. That makes each month worth **€{3 × N}** and the season worth **€{23 × N}**.

**The nine months**
August and September count as one period. Then October, November, December, January, February, March, April, May.

Render the period table from `config/periods.json`: name, gameweeks, gameweek count. Underneath, state plainly that periods vary in length — December is six gameweeks, March and April three — and that every period is worth the same regardless. Someone will ask; answer it first.

**How scores are counted**
Net points. Transfer hits come off. A 62 with a −4 counts as 58, for the month and for the season.

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
Roster locked at the GW1 deadline. Anyone unpaid by then isn't in the prize money. Leaving the mini-league mid-season doesn't remove your scores — you paid, your team still scores.

**Payment**
All €50s to the league admin before the deadline. You're only eligible once the money's in.

---

## Files

- `assets/bull.svg` — the mark, drawn for the dark ground. Original artwork for this league.
- Generate 32×32 and 180×180 PNGs from it for favicon and iOS home screen icon.
- `<meta name="theme-color" content="#3D1620">` so the browser chrome matches the header band when saved to a home screen. People will add this to their phone — make that path look finished.
