# Design & Rules — Addendum to SPEC.md

This replaces the styling guidance in SPEC.md. The data layer, `fetch.py`, and the JSON contract are unchanged — this is frontend only.

---

## Who this is for

Fourteen mates in a €50 FPL league, checking it on a phone, usually one-handed, usually to answer one of three questions: *where am I, who's winning the month, am I up or down on the year.* Every design decision serves those three. Nobody is going to sit and browse this.

The league is called Bull Ring, so the visual language comes from the **cartel de toros** — the printed bullfight poster. Heavy condensed type, arena sand, deep blood red, black, a thin line of gold. Bold and printed-looking, not a dashboard.

---

## Tokens

Define these as CSS custom properties on `:root` and derive everything from them. No colour or size may be hardcoded elsewhere in the stylesheet.

### Colour

```css
--sand:    #E8DCC4;  /* arena floor — page background */
--sand-lo: #D9C9AB;  /* recessed surfaces, table stripes */
--sangre:  #B01B2E;  /* the muleta — primary accent, headings, the bull */
--tinta:   #1A1614;  /* near-black — body text, the bull's mass */
--oro:     #C89B3C;  /* gold trim — winners, prize amounts, hairlines */
--sombra:  #8A7A5E;  /* shade side of the ring — secondary text, muted rows */
```

Deep red on sand, black type, gold used *only* for money and winners. Gold is the scarcest colour on the page and that scarcity is what makes the prize table read instantly.

### Type

Load from Google Fonts:

- **Display — `Alfa Slab One`.** Poster weight. Used for the wordmark, view headings, and the single biggest number on each screen. Never below 20px, never for body copy, never more than a few words at a time.
- **Body — `Libre Franklin`.** All prose, labels, navigation.
- **Data — `IBM Plex Mono`.** Every number in every table. Set `font-variant-numeric: tabular-nums` so columns align — this is non-negotiable in the gameweek grid.

Scale: 12 / 14 / 16 / 20 / 28 / 44. Nothing between. Body 16, table data 14, captions 12.

### Other

```css
--radius: 2px;        /* printed, not soft */
--rule: 1px solid var(--tinta);
--rule-gold: 1px solid var(--oro);
```

Sharp corners throughout. This is a poster, not a card UI.

---

## Signature element: sol y sombra

Bullrings sell seats as **sol** (sun) or **sombra** (shade) depending on which side of the arena they're on. Use this as the organising device of the **prize table**, which is the page people actually care about.

Every member sits above or below their €50 buy-in:

- **Sol** — in profit. Sand background, gold prize figures, tinta text.
- **Sombra** — down on the year. `--sand-lo` background, `--sombra` text, prize figures in tinta rather than gold.

Draw a single heavy horizontal rule in `--sangre` across the table exactly at the break-even line, labelled `SOL` above and `SOMBRA` below in small caps. Early in the season almost everyone is in shade and the line sits near the top; by May it will have travelled down. That movement is the story of the season and it costs nothing to show.

This is the one bold move on the site. Everything else stays quiet.

---

## Layout

Mobile-first, single column, max content width 720px centred on desktop. Four views plus rules, switched by a persistent tab bar.

```
┌──────────────────────────────┐
│  [bull]  BULL RING           │  ← wordmark, Alfa Slab, sangre
│          2026/27             │
│  ─────────────────────────   │  ← gold hairline
│  14 playing · €42 a month    │  ← live pot line, mono
│          · €322 overall      │
├──────────────────────────────┤
│ TABLE  MONTH  MONEY  GWS  ⓘ │  ← tab bar, sticky
├──────────────────────────────┤
│                              │
│      (active view)           │
│                              │
├──────────────────────────────┤
│  Updated 2 hours ago         │
└──────────────────────────────┘
```

The tab bar sticks to the **bottom** on screens under 600px — that's where a thumb is — and to the top on desktop.

The pot line under the wordmark is the hero. It's the most characteristic fact about this league: real money, and it scales with how many played. Render the two figures in Alfa Slab at 28px, the words around them small and quiet.

### Gameweek grid on a phone

The hard one. Sticky first column (names, truncated to first name + last initial), sticky header row (GW numbers), horizontal scroll for the rest. Cell height 36px minimum for thumb accuracy. Add a soft shadow on the right edge of the sticky column so it's obvious the table scrolls.

Cell colouring is **relative to that gameweek's league average**, as already specced — not fixed thresholds. Above average shades toward `--sangre` at low opacity, below toward `--sombra`. A gameweek where a hit was taken shows the hit in `--sangre` at 12px: `62 −4`. Chips get a single letter in `--oro` in the cell corner: W, B, T, F.

---

## Motion

Restraint. Three things only:

1. Tab switches cross-fade at 150ms.
2. The break-even rule on the prize table draws in from left to right on first paint, 400ms. It's the signature; let it announce itself once.
3. Focus states are visible and immediate — a 2px `--sangre` outline.

Respect `prefers-reduced-motion: reduce` and drop all of it.

## Quality floor

Responsive from 320px up. Visible keyboard focus on every interactive element. Real `<table>` markup with `<th scope>` — people will read this with the screen zoomed. `<meta charset="utf-8">` so accented team names render correctly. Contrast: tinta on sand and sangre on sand both pass AA at body size; sombra on sand is for secondary text only, never for anything you must read.

---

## Empty and error states

Write them in the interface's voice, not an apology.

- Before GW1 is scored: **"No scores yet. First gameweek deadline is Friday."** Show the roster and the pot, since those exist.
- Fetch failed: **"Showing scores from [timestamp]. The update job hasn't run since then."** Never a blank screen and never a spinner that hangs.
- A member with no history yet: blank cells, not zeros. Zero is a score; blank is an absence.

---

## Rules page

A fifth view, reached from the ⓘ tab. Static content, no data binding except the figures marked below, which come from `data/league.json` so they never go stale.

Set it as a single column of prose with `--sangre` headings in Alfa Slab at 20px. No cards, no accordions — people need to be able to scroll it and screenshot a bit to settle an argument.

### Content

**The buy-in**
€50 each. {N} playing, so the pot is €{N × 50}.

**How the money splits**
€3 of everyone's €50 goes to each of the nine monthly prizes. The remaining €23 goes to the overall winner.

That makes each month worth **€{3 × N}** and the season worth **€{23 × N}**.

**The nine months**
August and September count as one period. Then October, November, December, January, February, March, April and May.

Show the period table here, generated from `config/periods.json`: period name, gameweeks, and gameweek count. State plainly underneath that periods vary in length — December is six gameweeks, March and April are three — and that every period is worth the same regardless. Someone will ask; answer it before they do.

**How scores are counted**
Net points. Transfer hits come off your score. A 62 with a −4 hit counts as 58, for the month and for the season.

**Chips**
No restrictions. Wildcards, bench boosts, triple captains and free hits can all be played whenever you like, including to win a month.

**Ties**
Settled in this order, stopping at the first one that separates you:
1. Head-to-head — who won more gameweeks against the other in that period
2. Highest single gameweek in the period
3. Fewest transfers made in the period
4. If still level, the prize is split

The site shows which rule settled any tie and the numbers behind it.

**Who's in**
The roster locked at the GW1 deadline. Anyone who hadn't paid by then isn't in the prize money. If you leave the mini-league during the season your scores still count — you paid, your team still scores.

**Payment**
All €50s to the league admin before the deadline. The site only counts you as eligible once the money's in.

---

## Files

- `assets/bull.svg` — the wordmark logo. An original mark drawn for this league; also generate 32×32 and 180×180 PNGs from it for the favicon and iOS home screen icon.
- Set `<meta name="theme-color" content="#B01B2E">` so it looks right when saved to a phone home screen. People will add this to their home screen — make that path work properly.
