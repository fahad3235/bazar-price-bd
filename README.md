# Bazar Price BD

![tests](https://img.shields.io/badge/unit%20tests-19%2F19%20passing-brightgreen)
![smoke](https://img.shields.io/badge/smoke%20tests-50%2F50%20passing-brightgreen)
![offline](https://img.shields.io/badge/offline-yes-blue)

A free, fully offline bilingual (English/Bangla) daily bazar grocery price
tracker for Bangladesh. Log what things cost at your local bazar each day,
watch per-item trends, and spot price jumps  -  all in the browser, nothing
leaves your device.

## Problem

Bazar prices in Bangladesh move every day  -  onions one week, eggs the next.
Remembering what you paid last week (and whether a shopkeeper's quote is
fair) is guesswork. Bazar Price BD turns that guesswork into your own
personal price diary with trends and 7/30-day averages.

## Features

1. **Item catalog**  -  add, edit, and delete items with units (kg, litre,
   piece, dozen). 12 common bazar item names offered as type-ahead
   suggestions (names only  -  no prices shipped).
2. **Price log**  -  record date, item, price, and an optional vendor note.
   Multiple entries per day allowed; future dates rejected.
3. **Dashboard cards**  -  per item: latest price, 7-day average, min/max,
   and % change vs ~7 days ago (up = red, down = green).
4. **Trend chart**  -  inline SVG line of daily-average price with a min/max
   band, over a 7- or 30-day window.
5. **History table**  -  every entry with date, item, price, vendor; delete
   any row.
6. **Backup**  -  JSON export (download) and import with strict validation;
   a malformed file is rejected and your data stays intact.
7. **Bilingual + offline**  -  EN/Bangla toggle persisted, Bengali digits,
   localStorage persistence, responsive at 390px, zero network requests.

## Stack

Vanilla HTML/CSS/JS. No frameworks, no build step, no CDN. `app.js` holds
all logic and is node-requireable (`module.exports`) so the pure functions
are unit-tested directly.

## Prerequisites

Any modern browser. For tests: Node.js 18+ (uses `node --test`) and
headless Chromium for the smoke suite.

## Install / run

No install needed  -  open `index.html` in a browser, or serve the folder:

```sh
npx serve .
# then open http://localhost:3000
```

Data is stored in your browser's localStorage under `bpb-state-v1`
(language choice under `bpb-lang-v1`).

## Development

- `app.js`  -  pure logic + DOM wiring; node-requireable
- `tests/test.js`  -  node unit tests: `node --test tests/test.js`
- `smoke.mjs`  -  headless-Chromium smoke suite via raw CDP:
  `node smoke.mjs` (uses `/opt/meta-chromium/chrome` if present)
- Deterministic dates: the app reads a `?asof=YYYY-MM-DD` query param as
  "today" for testing.

## Testing

- **Unit:** 19/19 `node --test`  -  item CRUD validation, price/date
  validation (zero/negative price, future date), trend-series math,
  7/30-day stats, change% (incl. partial windows and single-entry `--`),
  duplicate-day aggregation, export->wipe->import round-trip, 9 malformed
  imports rejected with data byte-identical, Bengali digit conversion,
  XSS escaping.
- **Smoke:** 50/50 headless-Chromium (raw CDP, `?asof=2026-10-12`,
  desktop 1280x800 + mobile 390x844)  -  add item, log prices, dashboard
  stats exact (latest 150, avg 140, min 130, max 150, +50.00% chip),
  chart renders, BN toggle with Bengali digits, reload persistence,
  export/import round-trip, delete flows, inline validation messages
  visible, empty states, 390px no-overflow, 0 console/page errors,
  0 network requests.

See `TEST_RESULTS.md` for the full record.

## Deployment

Static site  -  any static host works. GitHub Pages: push `main` and serve
from `/ (root)`.

## Limitations

- A personal tracker, not market data: prices you enter are your own
  records. It is not financial advice and cannot tell you what the
  "correct" market price is.
- Data lives in one browser's localStorage; back it up via Backup/Export.
- No multi-device sync, no live price feeds (by design: fully offline).

## Status

Complete MVP, tested and published. See
https://fahad3235.github.io/bazar-price-bd/
