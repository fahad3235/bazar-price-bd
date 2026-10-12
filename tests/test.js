'use strict';
/* Unit tests for bazar-price-bd pure logic. Run: node --test tests/test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../app.js');

function fresh() { return L.newState(); }
function bnDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => String.fromCharCode(0x09E6 + Number(d)));
}
/* Deterministic fixture builder: item + prices on fixed dates. */
function fixture() {
  const s = fresh();
  const r = L.addItem(s, 'Test Rice', 'kg');
  assert.equal(r.ok, true);
  const id = r.item.id;
  const T = '2026-10-12';
  assert.equal(L.addPrice(s, id, 100, '2026-10-05', '', T).ok, true);
  assert.equal(L.addPrice(s, id, 130, '2026-10-10', '', T).ok, true);
  assert.equal(L.addPrice(s, id, 140, '2026-10-11', '', T).ok, true);
  assert.equal(L.addPrice(s, id, 150, '2026-10-12', 'Karwan Bazar', T).ok, true);
  return { s, id };
}

test('item CRUD validation', () => {
  const s = fresh();
  assert.deepEqual(L.addItem(s, '', 'kg'), { ok: false, error: 'eNameReq' });
  assert.deepEqual(L.addItem(s, '   ', 'kg'), { ok: false, error: 'eNameReq' });
  const r1 = L.addItem(s, 'Onion', 'kg');
  assert.equal(r1.ok, true);
  assert.equal(r1.item.name, 'Onion');
  assert.equal(L.addItem(s, 'onion', 'kg').error, 'eNameDup'); /* case-insensitive dup */
  assert.equal(L.addItem(s, ' Onion ', 'kg').error, 'eNameDup'); /* whitespace dup */
  assert.equal(L.addItem(s, 'Potato', 'sack').error, 'eItemReq'); /* bad unit */
  assert.equal(s.items.length, 1);
  const del = L.deleteItem(s, r1.item.id);
  assert.equal(del.ok, true);
  assert.equal(s.items.length, 0);
});

test('price validation: rejects bad input', () => {
  const s = fresh();
  const id = L.addItem(s, 'Egg', 'dozen').item.id;
  const T = '2026-10-12';
  assert.equal(L.addPrice(s, id, '', T, '', T).error, 'ePriceReq');
  assert.equal(L.addPrice(s, id, 0, T, '', T).error, 'ePricePos');
  assert.equal(L.addPrice(s, id, -5, T, '', T).error, 'ePricePos');
  assert.equal(L.addPrice(s, id, 'abc', T, '', T).error, 'ePricePos');
  assert.equal(L.addPrice(s, id, NaN, T, '', T).error, 'ePricePos');
  assert.equal(L.addPrice(s, id, 50, '2026-13-01', '', T).error, 'eDateBad');
  assert.equal(L.addPrice(s, id, 50, '2026-02-30', '', T).error, 'eDateBad');
  assert.equal(L.addPrice(s, id, 50, 'not-a-date', '', T).error, 'eDateBad');
  assert.equal(L.addPrice(s, id, 50, '2026-10-13', '', T).error, 'eDateFuture');
  assert.equal(L.addPrice(s, 'nope', 50, T, '', T).error, 'eItemReq');
  assert.equal(s.prices.length, 0);
});

test('price logging: multiple entries per day allowed', () => {
  const s = fresh();
  const id = L.addItem(s, 'Sugar', 'kg').item.id;
  const T = '2026-10-12';
  assert.equal(L.addPrice(s, id, 120, T, 'morning', T).ok, true);
  assert.equal(L.addPrice(s, id, 125, T, 'evening', T).ok, true);
  assert.equal(L.addPrice(s, id, 110, '2026-10-11', '', T).ok, true);
  assert.equal(s.prices.length, 3);
});

test('trendSeries: exact math on 3-entry fixture', () => {
  const s = fresh();
  const id = L.addItem(s, 'Lentil', 'kg').item.id;
  const T = '2026-10-12';
  L.addPrice(s, id, 100, '2026-10-10', '', T);
  L.addPrice(s, id, 200, '2026-10-10', '', T); /* duplicate day -> aggregated */
  L.addPrice(s, id, 150, '2026-10-12', '', T);
  const ser = L.trendSeries(s, id, 7, T);
  assert.equal(ser.length, 7);
  const byDate = {};
  ser.forEach((r) => { byDate[r.date] = r; });
  /* hand-verified: 7-day window 2026-10-06..2026-10-12 */
  assert.deepEqual(Object.keys(byDate), [
    '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.equal(byDate['2026-10-06'].avg, null);
  assert.equal(byDate['2026-10-11'].count, 0);
  assert.equal(byDate['2026-10-10'].avg, 150); /* (100+200)/2 */
  assert.equal(byDate['2026-10-10'].min, 100);
  assert.equal(byDate['2026-10-10'].max, 200);
  assert.equal(byDate['2026-10-10'].count, 2);
  assert.equal(byDate['2026-10-12'].avg, 150);
  assert.equal(byDate['2026-10-12'].min, 150);
  assert.equal(byDate['2026-10-12'].max, 150);
});

test('windowStats: 7-day avg/min/max/change% exact', () => {
  const { s, id } = fixture();
  const st = L.windowStats(s, id, 7, '2026-10-12');
  /* hand-verified: 7-day window 2026-10-06..2026-10-12 holds 130,140,150 */
  assert.equal(st.count, 3);
  assert.equal(st.avg, 140);
  assert.equal(st.min, 130);
  assert.equal(st.max, 150);
  assert.equal(st.latest.price, 150);
  assert.equal(st.latest.date, '2026-10-12');
  /* change vs closest day to 7 days before latest -> 2026-10-05 (avg 100): (150-100)/100*100 = 50 */
  assert.equal(st.changePct, 50);
  assert.equal(st.changeRefDate, '2026-10-05');
});

test('windowStats: partial window falls back to nearest earlier day', () => {
  const s = fresh();
  const id = L.addItem(s, 'Oil', 'litre').item.id;
  const T = '2026-10-12';
  L.addPrice(s, id, 140, '2026-10-11', '', T);
  L.addPrice(s, id, 150, '2026-10-12', '', T);
  const st = L.windowStats(s, id, 7, T);
  assert.equal(st.avg, 145);
  /* ref day 2026-10-05 has no data -> nearest earlier day in window: 2026-10-11 (140) */
  assert.ok(Math.abs(st.changePct - (10 / 140 * 100)) < 1e-9);
  assert.equal(L.fmtPct(st.changePct, 'en'), '+7.14%');
  assert.equal(st.changeRefDate, '2026-10-11');
});

test('windowStats: null change when no reference day exists', () => {
  const s = fresh();
  const id = L.addItem(s, 'Salt', 'kg').item.id;
  const T = '2026-10-12';
  L.addPrice(s, id, 40, T, '', T);
  const st = L.windowStats(s, id, 7, T);
  assert.equal(st.changePct, null);
  assert.equal(L.fmtPct(st.changePct, 'en'), '--');
  assert.equal(L.windowStats(s, id, 7, T).avg, 40);
});

test('windowStats: 30-day window aggregates correctly', () => {
  const { s, id } = fixture();
  const st = L.windowStats(s, id, 30, '2026-10-12');
  assert.equal(st.count, 4);
  assert.equal(st.avg, 130);
  assert.equal(st.changePct, 50);
});

test('latestEntry: same-day tie broken by sequence', () => {
  const s = fresh();
  const id = L.addItem(s, 'Flour', 'kg').item.id;
  const T = '2026-10-12';
  L.addPrice(s, id, 90, T, 'first', T);
  L.addPrice(s, id, 95, T, 'second', T);
  assert.equal(L.latestEntry(s, id).price, 95);
});

test('deleteItem cascades its prices', () => {
  const { s, id } = fixture();
  const other = L.addItem(s, 'Other', 'kg').item.id;
  L.addPrice(s, other, 10, '2026-10-12', '', '2026-10-12');
  const r = L.deleteItem(s, id);
  assert.equal(r.ok, true);
  assert.equal(r.removedPrices, 4);
  assert.equal(s.items.length, 1);
  assert.equal(s.prices.length, 1);
});

test('deletePrice removes exactly one entry', () => {
  const { s } = fixture();
  const pid = s.prices[0].id;
  assert.equal(L.deletePrice(s, pid).ok, true);
  assert.equal(s.prices.length, 3);
  assert.equal(L.deletePrice(s, 'pr999').ok, false);
});

test('export -> wipe -> import round-trip preserves data', () => {
  const { s } = fixture();
  const json = L.exportJSON(s);
  const parsed = JSON.parse(json);
  assert.equal(parsed.app, 'bazar-price-bd');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.prices.length, 4);
  const s2 = L.newState();
  const r = L.importJSON(s2, json);
  assert.equal(r.ok, true);
  assert.equal(r.items, 1);
  assert.equal(r.prices, 4);
  assert.deepEqual(s2.items, s.items);
  /* seq is an internal ordering counter: import reassigns it, but must preserve order */
  const strip = (arr) => arr.map((p) => ({ id: p.id, itemId: p.itemId, price: p.price, date: p.date, note: p.note }));
  assert.deepEqual(strip(s2.prices), strip(s.prices));
  const seqs = s2.prices.map((p) => p.seq);
  assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b), 'imported seqs strictly increasing');
  assert.equal(new Set(seqs).size, seqs.length, 'imported seqs unique');
  /* new ids keep working after import */
  const add = L.addItem(s2, 'New Item', 'piece');
  assert.equal(add.ok, true);
});

test('malformed import rejected with data intact', () => {
  const { s } = fixture();
  const before = JSON.stringify(s);
  const bad = [
    '{not json',
    JSON.stringify({ app: 'other', items: [], prices: [] }),
    JSON.stringify({ app: 'bazar-price-bd', items: 'x', prices: [] }),
    JSON.stringify({ app: 'bazar-price-bd', items: [{ id: 'it1', name: '  ', unit: 'kg' }], prices: [] }),
    JSON.stringify({ app: 'bazar-price-bd', items: [{ id: 'it1', name: 'A', unit: 'sack' }], prices: [] }),
    JSON.stringify({ app: 'bazar-price-bd', items: [{ id: 'it1', name: 'A', unit: 'kg' }], prices: [{ id: 'pr1', itemId: 'it9', price: 5, date: '2026-10-12' }] }),
    JSON.stringify({ app: 'bazar-price-bd', items: [{ id: 'it1', name: 'A', unit: 'kg' }], prices: [{ id: 'pr1', itemId: 'it1', price: -5, date: '2026-10-12' }] }),
    JSON.stringify({ app: 'bazar-price-bd', items: [{ id: 'it1', name: 'A', unit: 'kg' }], prices: [{ id: 'pr1', itemId: 'it1', price: 5, date: '2026-13-40' }] }),
    JSON.stringify({ app: 'bazar-price-bd', items: [{ id: 'it1', name: 'A', unit: 'kg' }, { id: 'it1', name: 'B', unit: 'kg' }], prices: [] }),
  ];
  for (const b of bad) {
    const r = L.importJSON(s, b);
    assert.equal(r.ok, false, 'should reject: ' + b.slice(0, 40));
    assert.equal(r.error, 'importBad');
  }
  assert.equal(JSON.stringify(s), before, 'state must be untouched after rejected imports');
});

test('toBnDigits converts 0-9 to Bengali digits', () => {
  assert.equal(L.toBnDigits('0123456789'), bnDigits('0123456789'));
  assert.equal(L.toBnDigits('Price: 150.50'), bnDigits('Price: ') + bnDigits('150') + '.' + bnDigits('50'));
  /* spot-check exact code points: 0x09E6 + d */
  assert.equal(L.toBnDigits('5'), String.fromCharCode(0x09EB));
  assert.equal(L.toBnDigits('abc'), 'abc');
});

test('fmtPrice: integer vs decimal, EN vs BN', () => {
  assert.equal(L.fmtPrice(150, 'en'), L.TAKA + '150');
  assert.equal(L.fmtPrice(150.5, 'en'), L.TAKA + '150.50');
  assert.equal(L.fmtPrice(150, 'bn'), L.TAKA + bnDigits('150'));
  assert.equal(L.fmtPrice(99.99, 'bn'), L.TAKA + bnDigits('99') + '.' + bnDigits('99'));
});

test('Bengali-digit price input is accepted', () => {
  const s = fresh();
  const id = L.addItem(s, 'Ginger', 'kg').item.id;
  const T = '2026-10-12';
  const bn150 = '\u09E7\u09EB\u09E6'; /* Bengali digits for 150 */
  const r = L.addPrice(s, id, bn150, T, '', T);
  assert.equal(r.ok, true);
  assert.equal(r.entry.price, 150);
});

test('date helpers: strict parsing and day arithmetic', () => {
  assert.equal(L.parseDateStrict('2026-02-30'), null);
  assert.equal(L.parseDateStrict('2026-13-01'), null);
  assert.equal(L.parseDateStrict('12-10-2026'), null);
  assert.ok(L.parseDateStrict('2026-10-12') instanceof Date);
  assert.equal(L.addDaysISO('2026-10-12', -7), '2026-10-05');
  assert.equal(L.addDaysISO('2026-01-01', -1), '2025-12-31');
  assert.equal(L.todayISO(), new Date().getFullYear() + '-' +
    String(new Date().getMonth() + 1).padStart(2, '0') + '-' +
    String(new Date().getDate()).padStart(2, '0'));
});

test('i18n: BN dict has every EN key and suggestions are name-only', () => {
  const enKeys = Object.keys(L.I18N_EN).sort();
  const bnKeys = Object.keys(L.I18N_BN).sort();
  assert.deepEqual(bnKeys, enKeys);
  assert.equal(L.SUGGESTIONS.length, 12);
  L.SUGGESTIONS.forEach((s) => assert.equal(typeof s, 'string'));
});

test('escapeHTML neutralizes markup', () => {
  assert.equal(L.escapeHTML('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(L.escapeHTML('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
});
