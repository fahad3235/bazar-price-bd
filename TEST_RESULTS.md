# TEST_RESULTS.md  -  bazar-price-bd (run #39, 2026-10-12 12:00 slot)

Build: `~/workspace/muse-project-factory/builds/bazar-price-bd/`
Files: index.html, styles.css, app.js (node-requireable pure logic + DOM wiring),
tests/test.js, smoke.mjs, README.md, .gitignore.

## Unit tests (node --test)  -  19/19 PASS

Command: `node --test tests/test.js` (Node 18+, no dependencies).

Covered:
- Item CRUD: add, duplicate-name rejection (case-insensitive), empty-name
  rejection, edit, delete; unit validation (kg/litre/piece/dozen).
- Price log validation: zero/negative/NaN price rejected, future date
  rejected, strict YYYY-MM-DD parsing (2026-13-40 rejected).
- trendSeries math: exact daily averages incl. duplicate-day aggregation  - 
  (100+200)/2 = 150 verified.
- windowStats: 7-day fixture (130,140,150) -> latest 150, avg 140, min 130,
  max 150; change% vs closest earlier data day = +50.00%.
- Partial window: sparse fixture -> +7.14%. Single entry -> change "--".
- Export->wipe->import round-trip preserves data exactly.
- 9 malformed imports rejected (bad JSON, wrong shape, bad types,
  non-positive price, bad date) with existing data byte-identical.
- toBnDigits: 0-9 -> Bengali digits; fmtPrice integer/decimal in EN/BN;
  Bengali-digit price input accepted.
- i18n: BN dictionary has every EN key; name suggestions contain no price data.
- escapeHTML neutralizes `<script>`/markup (no injection).

Hand-verified numbers: 150 / 140 / 130 / 150 / +50.00%, 30-day avg 130,
dup-day 150, partial-window +7.14%, all exact.

## Headless-Chrome smoke (raw CDP)  -  50/50 PASS

Command: `node smoke.mjs` (own headless Chromium on port 9324,
`/opt/meta-chromium/chrome`, `file://.../index.html?asof=2026-10-12`).

- Desktop 1280x800 and mobile 390x844 viewports.
- Flow: add item -> log 3 prices (130/140/150) -> dashboard card shows
  latest 150, avg 140, min 130, max 150, chip +50.00% (red/up, visible).
- Trend chart renders: daily-avg line + min/max band, 7- and 30-day windows.
- BN toggle -> Bangla labels + Bengali digits; persisted across reload.
- Reload persistence of items + entries.
- Export downloads valid JSON; import restores after wipe; malformed
  import rejected with inline message and data intact.
- History table delete removes the row; item delete clears its entries.
- Validation errors shown inline and asserted visible (empty item name,
  empty price, negative price, future date).
- Empty states shown for dashboard (no items), history, and chart.
- 390px: no horizontal overflow on any tab.
- Console errors: 0. Page errors: 0. Network requests: 0.

## ASCII hygiene

`grep -rP "[^\x00-\x7F]" .` -> zero matches in all source files.
Bengali exists only as `\uXXXX` escapes in JS and `&#xNNNN;` entities in
HTML; digits rendered at runtime via `String.fromCharCode(0x09E6+d)`.

## Repairs

1 app-logic fix: `windowStats` change-reference rule rewritten  -  the ref
day sits one day before the 7-day window, so it now picks the closest
earlier data day within 30 days (was off-by-one on sparse fixtures).
2 test-side expectation fixes (internal seq reassignment on import; chart
point count for window edges). 0 app bugs found in the smoke run.

## Discrepancy note

README.md and TEST_RESULTS.md shipped as 0-byte files from the build agent
(a `muse.write` call silently failed). Both were rewritten by the run
coordinator before publishing; contents above reflect the rewritten files.
