'use strict';
/* Bazar Price BD - bilingual (EN/BN) daily grocery price tracker for Bangladesh.
 * Fully offline static app. This file holds BOTH the pure, node-requireable
 * business logic and the browser DOM wiring (guarded by `typeof window`).
 * SOURCE CONSTRAINT: this file is pure ASCII. All Bengali text is produced
 * at runtime from \uXXXX escapes (I18N_BN), and Bengali digits are produced
 * with String.fromCharCode(0x09E6 + d). Verify: grep -P "[^\x00-\x7F]" app.js */

var UNITS = ['kg', 'litre', 'piece', 'dozen'];
var APP_KEY = 'bpb-state-v1';
var LANG_KEY = 'bpb-lang-v1';
var TAKA = String.fromCharCode(0x09F3); /* BDT taka sign, ASCII-safe */

/* ---------------- date helpers ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function isoFromDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function todayISO() { return isoFromDate(new Date()); }
function parseDateStrict(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var parts = s.split('-');
  var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  var dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}
function addDaysISO(iso, n) {
  var dt = parseDateStrict(iso);
  if (!dt) return null;
  dt.setDate(dt.getDate() + n);
  return isoFromDate(dt);
}

/* ---------------- state ---------------- */
function newState() { return { seq: 1, items: [], prices: [] }; }
function cloneState(s) { return JSON.parse(JSON.stringify(s)); }
function nextId(state, prefix) { return prefix + (state.seq++); }
function findItem(state, id) {
  for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
  return null;
}

/* ---------------- item logic ---------------- */
function validateItem(state, name, unit) {
  var n = (name || '').trim();
  if (!n) return { ok: false, error: 'eNameReq' };
  if (n.length > 80) return { ok: false, error: 'eNameReq' };
  if (UNITS.indexOf(unit) === -1) return { ok: false, error: 'eItemReq' };
  var low = n.toLowerCase();
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].name.trim().toLowerCase() === low) return { ok: false, error: 'eNameDup' };
  }
  return { ok: true, name: n };
}
function addItem(state, name, unit) {
  var v = validateItem(state, name, unit);
  if (!v.ok) return v;
  var item = { id: nextId(state, 'it'), name: v.name, unit: unit, createdAt: todayISO() };
  state.items.push(item);
  return { ok: true, item: item };
}
function deleteItem(state, itemId) {
  var idx = -1;
  for (var i = 0; i < state.items.length; i++) if (state.items[i].id === itemId) { idx = i; break; }
  if (idx === -1) return { ok: false, error: 'eItemReq' };
  state.items.splice(idx, 1);
  var removed = 0;
  state.prices = state.prices.filter(function (p) {
    if (p.itemId === itemId) { removed++; return false; }
    return true;
  });
  return { ok: true, removedPrices: removed };
}

/* ---------------- price logic ---------------- */
function validatePriceInput(priceRaw, dateStr, todayStr) {
  var raw = (priceRaw === undefined || priceRaw === null) ? '' : String(priceRaw).trim();
  if (raw === '') return { ok: false, error: 'ePriceReq' };
  /* Bengali-digit input tolerance: map 0x09E6-0x09EF to 0-9 */
  var norm = raw.replace(/[\u09E6-\u09EF]/g, function (ch) { return String(ch.charCodeAt(0) - 0x09E6); });
  var price = Number(norm);
  if (!isFinite(price) || price <= 0 || price > 1000000000) return { ok: false, error: 'ePricePos' };
  if (!parseDateStrict(dateStr)) return { ok: false, error: 'eDateBad' };
  if (dateStr > todayStr) return { ok: false, error: 'eDateFuture' };
  if (dateStr < '2000-01-01') return { ok: false, error: 'eDateBad' };
  return { ok: true, price: price };
}
function addPrice(state, itemId, priceRaw, dateStr, note, todayStr) {
  if (!findItem(state, itemId)) return { ok: false, error: 'eItemReq' };
  var v = validatePriceInput(priceRaw, dateStr, todayStr || todayISO());
  if (!v.ok) return v;
  var entry = {
    id: nextId(state, 'pr'), itemId: itemId, price: v.price,
    date: dateStr, note: (note || '').trim().slice(0, 120), seq: state.seq
  };
  state.prices.push(entry);
  return { ok: true, entry: entry };
}
function deletePrice(state, priceId) {
  var before = state.prices.length;
  state.prices = state.prices.filter(function (p) { return p.id !== priceId; });
  return { ok: state.prices.length < before };
}
function itemPrices(state, itemId) {
  return state.prices.filter(function (p) { return p.itemId === itemId; });
}
function latestEntry(state, itemId) {
  var ps = itemPrices(state, itemId);
  if (!ps.length) return null;
  var best = ps[0];
  for (var i = 1; i < ps.length; i++) {
    var p = ps[i];
    if (p.date > best.date || (p.date === best.date && p.seq > best.seq)) best = p;
  }
  return best;
}
function dailyAvgMap(state, itemId) {
  var map = {};
  itemPrices(state, itemId).forEach(function (p) {
    var d = map[p.date] || (map[p.date] = { sum: 0, count: 0, min: Infinity, max: -Infinity });
    d.sum += p.price; d.count++;
    if (p.price < d.min) d.min = p.price;
    if (p.price > d.max) d.max = p.price;
  });
  Object.keys(map).forEach(function (k) { map[k].avg = map[k].sum / map[k].count; });
  return map;
}
/* Trend series: one row per day over the last `days` days ending at asOf.
 * Multiple entries on the same day are aggregated (avg/min/max). */
function trendSeries(state, itemId, days, asOf) {
  var map = dailyAvgMap(state, itemId);
  var out = [];
  for (var i = days - 1; i >= 0; i--) {
    var date = addDaysISO(asOf, -i);
    var d = map[date];
    out.push(d
      ? { date: date, avg: d.avg, min: d.min, max: d.max, count: d.count }
      : { date: date, avg: null, min: null, max: null, count: 0 });
  }
  return out;
}
/* Window stats + % change of the latest price vs the daily average on the
 * day with data closest to 7 days before the latest entry (strictly earlier
 * days only, within the prior 30 days; null when no earlier data exists). */
function windowStats(state, itemId, days, asOf) {
  var start = addDaysISO(asOf, -(days - 1));
  var ps = itemPrices(state, itemId).filter(function (p) { return p.date >= start && p.date <= asOf; });
  var latest = latestEntry(state, itemId);
  if (!ps.length || !latest) return null;
  var sum = 0, min = Infinity, max = -Infinity;
  ps.forEach(function (p) { sum += p.price; if (p.price < min) min = p.price; if (p.price > max) max = p.price; });
  var map = dailyAvgMap(state, itemId);
  /* Change reference: the day with data closest to (latest.date - 7 days),
   * strictly before the latest entry's day, within the prior 30 days.
   * Ties prefer the earlier day. Null when no earlier data exists. */
  var target = addDaysISO(latest.date, -7);
  var floor = addDaysISO(latest.date, -30);
  function dnum(d) { return Number(d.replace(/-/g, '')); }
  var best = null, bestDist = Infinity;
  Object.keys(map).forEach(function (d) {
    if (d >= latest.date || d < floor) return;
    var dist = Math.abs(dnum(d) - dnum(target));
    if (dist < bestDist || (dist === bestDist && (best === null || d < best))) { best = d; bestDist = dist; }
  });
  var changePct = (best === null) ? null : (latest.price - map[best].avg) / map[best].avg * 100;
  return {
    count: ps.length, avg: sum / ps.length, min: min, max: max,
    latest: latest, changePct: changePct, changeRefDate: best
  };
}

/* ---------------- export / import ---------------- */
function exportJSON(state) {
  return JSON.stringify({
    app: 'bazar-price-bd', version: 1,
    exportedAt: new Date().toISOString(),
    items: state.items, prices: state.prices
  }, null, 2);
}
function importJSON(state, text) {
  var data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'importBad' }; }
  if (!data || typeof data !== 'object' || data.app !== 'bazar-price-bd' ||
      !Array.isArray(data.items) || !Array.isArray(data.prices)) {
    return { ok: false, error: 'importBad' };
  }
  var ids = {};
  for (var i = 0; i < data.items.length; i++) {
    var it = data.items[i];
    if (!it || typeof it.id !== 'string' || typeof it.name !== 'string' || !it.name.trim() ||
        UNITS.indexOf(it.unit) === -1 || ids[it.id]) return { ok: false, error: 'importBad' };
    ids[it.id] = true;
  }
  for (var j = 0; j < data.prices.length; j++) {
    var p = data.prices[j];
    if (!p || typeof p.id !== 'string' || !ids[p.itemId] ||
        typeof p.price !== 'number' || !isFinite(p.price) || p.price <= 0 ||
        !parseDateStrict(p.date) || (p.note !== undefined && typeof p.note !== 'string')) {
      return { ok: false, error: 'importBad' };
    }
  }
  /* Valid: replace state atomically. */
  var maxSeq = 0;
  data.items.concat(data.prices).forEach(function (o) {
    var m = /^[a-z]+(\d+)$/.exec(o.id);
    if (m && Number(m[1]) > maxSeq) maxSeq = Number(m[1]);
  });
  var next = { seq: maxSeq + 1, items: [], prices: [] };
  data.items.forEach(function (it) { next.items.push({ id: it.id, name: it.name, unit: it.unit, createdAt: it.createdAt || '' }); });
  data.prices.forEach(function (p) {
    next.prices.push({ id: p.id, itemId: p.itemId, price: p.price, date: p.date, note: p.note || '', seq: (next.seq++) });
  });
  state.seq = next.seq; state.items = next.items; state.prices = next.prices;
  return { ok: true, items: next.items.length, prices: next.prices.length };
}

/* ---------------- i18n ---------------- */
var I18N_EN = {
  tagline: 'Track your daily bazar prices',
  dashboard: 'Dashboard', logTab: 'Log Price', items: 'Items', history: 'History', backup: 'Backup',
  win7: '7 days', win30: '30 days',
  addItem: 'Add item', itemName: 'Item name', unit: 'Unit', price: 'Price',
  date: 'Date', note: 'Vendor note (optional)', logPrice: 'Save price',
  del: 'Delete', latest: 'Latest', avg: 'Avg', min: 'Min', max: 'Max',
  noPrices: 'No prices logged yet', noItems: 'No items yet. Add your first item below.',
  noHistory: 'No price records yet.',
  eNameReq: 'Please enter an item name.', eNameDup: 'This item already exists.',
  ePriceReq: 'Please enter a price.', ePricePos: 'Price must be greater than 0.',
  eDateBad: 'Enter a valid date (YYYY-MM-DD).', eDateFuture: 'Date cannot be in the future.',
  eItemReq: 'Please choose an item.',
  exportBtn: 'Export JSON', importBtn: 'Import JSON',
  importOk: 'Import successful.', importBad: 'Invalid backup file - nothing was changed.',
  delItemQ: 'Delete this item and ALL its prices?',
  footer: 'Personal price tracker. Your own records - not market data, not financial advice. Works fully offline in your browser.',
  unitKg: 'kg', unitLitre: 'litre', unitPiece: 'piece', unitDozen: 'dozen',
  allItems: 'All items', actions: 'Actions',
  itemAdded: 'Item added.', priceLogged: 'Price saved.',
  deleted: 'Deleted.', trend: 'Price trend',
  copyJson: 'Copy', copied: 'Copied.'
};
const I18N_BN = {
  tagline: "\u0986\u09aa\u09a8\u09be\u09b0 \u09a6\u09c8\u09a8\u09bf\u0995 \u09ac\u09be\u099c\u09be\u09b0\u09a6\u09b0\u09c7\u09b0 \u09b9\u09bf\u09b8\u09be\u09ac \u09b0\u09be\u0996\u09c1\u09a8",
  dashboard: "\u09a1\u09cd\u09af\u09be\u09b6\u09ac\u09cb\u09b0\u09cd\u09a1",
  logTab: "\u09a6\u09be\u09ae \u09b2\u09bf\u0996\u09c1\u09a8",
  items: "\u09aa\u09a3\u09cd\u09af",
  history: "\u09b9\u09bf\u09b8\u09be\u09ac",
  backup: "\u09ac\u09cd\u09af\u09be\u0995\u0986\u09aa",
  win7: "\u09ed \u09a6\u09bf\u09a8",
  win30: "\u09e9\u09e6 \u09a6\u09bf\u09a8",
  addItem: "\u09aa\u09a3\u09cd\u09af \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8",
  itemName: "\u09aa\u09a3\u09cd\u09af\u09c7\u09b0 \u09a8\u09be\u09ae",
  unit: "\u098f\u0995\u0995",
  price: "\u09a6\u09be\u09ae",
  date: "\u09a4\u09be\u09b0\u09bf\u0996",
  note: "\u09ac\u09bf\u0995\u09cd\u09b0\u09c7\u09a4\u09be\u09b0 \u09a8\u09cb\u099f (\u0990\u099a\u09cd\u099b\u09bf\u0995)",
  logPrice: "\u09a6\u09be\u09ae \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09a3 \u0995\u09b0\u09c1\u09a8",
  del: "\u09ae\u09c1\u099b\u09c1\u09a8",
  latest: "\u09b8\u09b0\u09cd\u09ac\u09b6\u09c7\u09b7",
  avg: "\u0997\u09a1\u09bc",
  min: "\u09b8\u09b0\u09cd\u09ac\u09a8\u09bf\u09ae\u09cd\u09a8",
  max: "\u09b8\u09b0\u09cd\u09ac\u09cb\u099a\u09cd\u099a",
  noPrices: "\u098f\u0996\u09a8\u0993 \u09a6\u09be\u09ae \u09af\u09cb\u0997 \u09b9\u09af\u09bc\u09a8\u09bf",
  noItems: "\u098f\u0996\u09a8\u0993 \u0995\u09cb\u09a8\u09cb \u09aa\u09a3\u09cd\u09af \u09a8\u09c7\u0987\u0964 \u09aa\u09cd\u09b0\u09a5\u09ae \u09aa\u09a3\u09cd\u09af \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8\u0964",
  noHistory: "\u098f\u0996\u09a8\u0993 \u0995\u09cb\u09a8\u09cb \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09a8\u09c7\u0987\u0964",
  eNameReq: "\u09aa\u09a3\u09cd\u09af\u09c7\u09b0 \u09a8\u09be\u09ae \u09a6\u09bf\u09a8\u0964",
  eNameDup: "\u098f\u0987 \u09aa\u09a3\u09cd\u09af\u099f\u09bf \u0987\u09a4\u09bf\u09ae\u09a7\u09cd\u09af\u09c7 \u0986\u099b\u09c7\u0964",
  ePriceReq: "\u09a6\u09be\u09ae \u09b2\u09bf\u0996\u09c1\u09a8\u0964",
  ePricePos: "\u09a6\u09be\u09ae \u09e6-\u098f\u09b0 \u09ac\u09c7\u09b6\u09bf \u09b9\u09a4\u09c7 \u09b9\u09ac\u09c7\u0964",
  eDateBad: "\u09b8\u09a0\u09bf\u0995 \u09a4\u09be\u09b0\u09bf\u0996 \u09a6\u09bf\u09a8 (YYYY-MM-DD)\u0964",
  eDateFuture: "\u09ad\u09ac\u09bf\u09b7\u09cd\u09af\u09a4\u09c7\u09b0 \u09a4\u09be\u09b0\u09bf\u0996 \u09a6\u09c7\u0993\u09af\u09bc\u09be \u09af\u09be\u09ac\u09c7 \u09a8\u09be\u0964",
  eItemReq: "\u098f\u0995\u099f\u09bf \u09aa\u09a3\u09cd\u09af \u09ac\u09c7\u099b\u09c7 \u09a8\u09bf\u09a8\u0964",
  exportBtn: "JSON \u098f\u0995\u09cd\u09b8\u09aa\u09cb\u09b0\u09cd\u099f",
  importBtn: "JSON \u0987\u09ae\u09aa\u09cb\u09b0\u09cd\u099f",
  importOk: "\u0987\u09ae\u09aa\u09cb\u09b0\u09cd\u099f \u09b8\u09ab\u09b2 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
  importBad: "\u09ab\u09be\u0987\u09b2\u099f\u09bf \u09b8\u09a0\u09bf\u0995 \u09a8\u09af\u09bc \u2014 \u0995\u09bf\u099b\u09c1\u0987 \u09ac\u09a6\u09b2\u09be\u09af\u09bc\u09a8\u09bf\u0964",
  delItemQ: "\u098f\u0987 \u09aa\u09a3\u09cd\u09af \u0993 \u098f\u09b0 \u09b8\u09ac \u09a6\u09be\u09ae \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09ac\u09c7\u09a8?",
  footer: "\u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u09a6\u09be\u09ae-\u09b9\u09bf\u09b8\u09be\u09ac\u0964 \u0986\u09aa\u09a8\u09be\u09b0 \u09a8\u09bf\u099c\u09c7\u09b0 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u2014 \u09ac\u09be\u099c\u09be\u09b0\u09a6\u09b0 \u09ac\u09be \u0986\u09b0\u09cd\u09a5\u09bf\u0995 \u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6 \u09a8\u09af\u09bc\u0964 \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u0985\u09ab\u09b2\u09be\u0987\u09a8\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 \u09ac\u09cd\u09b0\u09be\u0989\u099c\u09be\u09b0\u09c7 \u099a\u09b2\u09c7\u0964",
  unitKg: "\u0995\u09c7\u099c\u09bf",
  unitLitre: "\u09b2\u09bf\u099f\u09be\u09b0",
  unitPiece: "\u099f\u09bf",
  unitDozen: "\u09a1\u099c\u09a8",
  allItems: "\u09b8\u09ac \u09aa\u09a3\u09cd\u09af",
  actions: "\u0995\u09b0\u09a3\u09c0\u09af\u09bc",
  itemAdded: "\u09aa\u09a3\u09cd\u09af \u09af\u09cb\u0997 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
  priceLogged: "\u09a6\u09be\u09ae \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09a3 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
  deleted: "\u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
  trend: "\u09a6\u09be\u09ae\u09c7\u09b0 \u09a7\u09be\u09b0\u09be",
  copyJson: "\u0995\u09aa\u09bf \u0995\u09b0\u09c1\u09a8",
  copied: "\u0995\u09aa\u09bf \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
};
const SUGGESTIONS = [
  "\u09ae\u09bf\u09a8\u09bf\u0995\u09c7\u099f \u099a\u09be\u09b2",
  "\u09ae\u09b8\u09c1\u09b0 \u09a1\u09be\u09b2",
  "\u09b8\u09af\u09bc\u09be\u09ac\u09bf\u09a8 \u09a4\u09c7\u09b2",
  "\u09aa\u09c7\u0981\u09af\u09bc\u09be\u099c",
  "\u0986\u09b2\u09c1",
  "\u09a1\u09bf\u09ae",
  "\u09ae\u09c1\u09b0\u0997\u09bf",
  "\u099a\u09bf\u09a8\u09bf",
  "\u09b2\u09ac\u09a3",
  "\u0986\u099f\u09be",
  "\u09b0\u09b8\u09c1\u09a8",
  "\u0986\u09a6\u09be"
];

/* ---------------- formatting ---------------- */
function toBnDigits(str) {
  return String(str).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x09E6 + Number(d)); });
}
function fmtPrice(p, lang) {
  var s = (p % 1 === 0) ? String(p) : p.toFixed(2);
  return TAKA + (lang === 'bn' ? toBnDigits(s) : s);
}
function fmtPct(pct, lang) {
  if (pct === null || pct === undefined || !isFinite(pct)) return '--';
  var s = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  return lang === 'bn' ? toBnDigits(s) : s;
}
function fmtDate(iso, lang) {
  return lang === 'bn' ? toBnDigits(iso) : iso;
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* node export */
var API = {
  UNITS: UNITS, TAKA: TAKA, APP_KEY: APP_KEY, LANG_KEY: LANG_KEY,
  newState: newState, cloneState: cloneState,
  validateItem: validateItem, addItem: addItem, deleteItem: deleteItem,
  validatePriceInput: validatePriceInput, addPrice: addPrice, deletePrice: deletePrice,
  itemPrices: itemPrices, latestEntry: latestEntry, dailyAvgMap: dailyAvgMap,
  trendSeries: trendSeries, windowStats: windowStats,
  exportJSON: exportJSON, importJSON: importJSON,
  parseDateStrict: parseDateStrict, addDaysISO: addDaysISO, todayISO: todayISO,
  toBnDigits: toBnDigits, fmtPrice: fmtPrice, fmtPct: fmtPct, fmtDate: fmtDate,
  escapeHTML: escapeHTML, I18N_EN: I18N_EN, I18N_BN: I18N_BN, SUGGESTIONS: SUGGESTIONS
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;

/* ---------------- browser DOM wiring ---------------- */
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  'use strict';
  var qs = new URLSearchParams(window.location.search);
  var asofParam = qs.get('asof');
  var TODAY = (asofParam && parseDateStrict(asofParam)) ? asofParam : todayISO();
  var dashDays = 7;

  function loadState() {
    try {
      var raw = localStorage.getItem(APP_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.items) && Array.isArray(s.prices) && typeof s.seq === 'number') return s;
      }
    } catch (e) { /* corrupted storage -> start fresh */ }
    return newState();
  }
  function loadLang() {
    try { var l = localStorage.getItem(LANG_KEY); if (l === 'bn' || l === 'en') return l; } catch (e) {}
    return 'en';
  }
  var state = loadState();
  var lang = loadLang();
  function saveState() { try { localStorage.setItem(APP_KEY, JSON.stringify(state)); } catch (e) {} }
  function saveLang() { try { localStorage.setItem(LANG_KEY, lang); } catch (e) {} }
  function T(key) { var d = (lang === 'bn' ? I18N_BN : I18N_EN); return d[key] !== undefined ? d[key] : key; }
  var UNIT_KEY = { kg: 'unitKg', litre: 'unitLitre', piece: 'unitPiece', dozen: 'unitDozen' };
  function unitLabel(u) { return T(UNIT_KEY[u] || 'unitKg'); }

  function applyLang() {
    document.documentElement.lang = lang;
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].textContent = T(els[i].getAttribute('data-i18n'));
    var phs = document.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < phs.length; j++) phs[j].setAttribute('placeholder', T(phs[j].getAttribute('data-i18n-ph')));
    document.getElementById('langToggle').textContent = (lang === 'bn') ? 'EN' : '\u09ac\u09be\u0982\u09b2\u09be';
  }

  function showErr(id, key) {
    var el = document.getElementById(id);
    el.textContent = key ? T(key) : '';
    el.hidden = !key;
  }

  /* ----- SVG trend chart: daily-avg line + min/max band ----- */
  function chartSVG(series, lg) {
    var W = 340, H = 150, pl = 6, pr = 6, pt = 8, pb = 20;
    var pts = series.filter(function (s) { return s.avg !== null; });
    if (!pts.length) return '';
    var lo = pts[0].min, hi = pts[0].max, k;
    for (k = 1; k < pts.length; k++) {
      if (pts[k].min < lo) lo = pts[k].min;
      if (pts[k].max > hi) hi = pts[k].max;
    }
    if (lo === hi) { lo = lo - 1; hi = hi + 1; }
    else { var pad = (hi - lo) * 0.15; lo -= pad; hi += pad; }
    var n = series.length;
    function X(i) { return (pl + (W - pl - pr) * (n === 1 ? 0.5 : i / (n - 1))).toFixed(1); }
    function Y(v) { return (pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo))).toFixed(1); }
    var top = [], bot = [], line = [];
    series.forEach(function (s, i) {
      if (s.avg === null) return;
      top.push(X(i) + ',' + Y(s.max));
      bot.push(X(i) + ',' + Y(s.min));
      line.push(X(i) + ',' + Y(s.avg));
    });
    var svg = '<svg class="trend-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + T('trend') + '">';
    svg += '<polygon class="band" points="' + top.join(' ') + ' ' + bot.reverse().join(' ') + '"/>';
    svg += '<polyline class="avgline" points="' + line.join(' ') + '"/>';
    series.forEach(function (s, i) {
      if (s.avg !== null) svg += '<circle class="dot" cx="' + X(i) + '" cy="' + Y(s.avg) + '" r="3"/>';
    });
    var first = series[0].date.slice(5), last = series[n - 1].date.slice(5);
    svg += '<text class="axis" x="' + pl + '" y="' + (H - 6) + '">' + (lg === 'bn' ? toBnDigits(first) : first) + '</text>';
    svg += '<text class="axis" x="' + (W - pr) + '" y="' + (H - 6) + '" text-anchor="end">' + (lg === 'bn' ? toBnDigits(last) : last) + '</text>';
    svg += '</svg>';
    return svg;
  }

  /* ----- dashboard ----- */
  function statRow(label, value) {
    return '<div class="srow"><span class="slabel">' + label + '</span><span class="sval">' + value + '</span></div>';
  }
  function cardHTML(item) {
    var st = windowStats(state, item.id, dashDays, TODAY);
    var body;
    if (!st) {
      body = '<p class="empty">' + T('noPrices') + '</p>';
    } else {
      var pct = st.changePct;
      var cls = pct === null ? 'flat' : (pct > 0.005 ? 'up' : (pct < -0.005 ? 'down' : 'flat'));
      var txt = pct === null ? '--' : fmtPct(pct, lang);
      body = '<div class="stats">' +
        statRow(T('latest'), '<strong>' + fmtPrice(st.latest.price, lang) + '</strong><span class="perunit"> / ' + escapeHTML(unitLabel(item.unit)) + '</span><span class="pdate">' + fmtDate(st.latest.date, lang) + '</span>') +
        statRow(T('avg') + ' (' + T(dashDays === 7 ? 'win7' : 'win30') + ')', fmtPrice(st.avg, lang)) +
        statRow(T('min') + ' / ' + T('max'), fmtPrice(st.min, lang) + ' / ' + fmtPrice(st.max, lang)) +
        '</div>' +
        '<div class="change"><span class="chip ' + cls + '">' + escapeHTML(txt) + '</span></div>' +
        chartSVG(trendSeries(state, item.id, dashDays, TODAY), lang);
    }
    return '<article class="card" data-card="' + item.id + '">' +
      '<header><h3>' + escapeHTML(item.name) + '</h3>' +
      '<span class="unitbadge">' + escapeHTML(unitLabel(item.unit)) + '</span></header>' + body + '</article>';
  }
  function renderDashboard() {
    var wrap = document.getElementById('dashCards');
    if (!state.items.length) {
      wrap.innerHTML = '<p class="empty" id="dashEmpty">' + T('noItems') + '</p>';
      return;
    }
    wrap.innerHTML = state.items.map(cardHTML).join('');
  }

  /* ----- log form ----- */
  function renderLogForm() {
    var sel = document.getElementById('logItem');
    sel.innerHTML = state.items.map(function (it) {
      return '<option value="' + it.id + '">' + escapeHTML(it.name) + ' (' + escapeHTML(unitLabel(it.unit)) + ')</option>';
    }).join('');
    document.getElementById('logDate').value = TODAY;
    document.getElementById('logDate').max = TODAY;
  }
  function onLogSubmit(ev) {
    ev.preventDefault();
    showErr('logErr', null);
    var r = addPrice(state,
      document.getElementById('logItem').value,
      document.getElementById('logPrice').value,
      document.getElementById('logDate').value,
      document.getElementById('logNote').value,
      TODAY);
    if (!r.ok) { showErr('logErr', r.error); return; }
    saveState();
    document.getElementById('logPrice').value = '';
    document.getElementById('logNote').value = '';
    var ok = document.getElementById('logOk');
    ok.textContent = T('priceLogged'); ok.hidden = false;
    setTimeout(function () { ok.hidden = true; }, 2500);
    renderAll();
  }

  /* ----- items tab ----- */
  function renderItems() {
    var ul = document.getElementById('itemList');
    if (!state.items.length) {
      ul.innerHTML = '<li class="empty">' + T('noItems') + '</li>';
      return;
    }
    ul.innerHTML = state.items.map(function (it) {
      var n = itemPrices(state, it.id).length;
      return '<li class="itemrow" data-item="' + it.id + '"><span class="iname">' + escapeHTML(it.name) + '</span>' +
        '<span class="unitbadge">' + escapeHTML(unitLabel(it.unit)) + '</span>' +
        '<span class="pcount">' + (lang === 'bn' ? toBnDigits(String(n)) : String(n)) + '</span>' +
        '<button class="btn danger sm" data-del-item="' + it.id + '">' + T('del') + '</button></li>';
    }).join('');
    var btns = ul.querySelectorAll('[data-del-item]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        deleteItem(state, this.getAttribute('data-del-item'));
        saveState(); renderAll();
        var ok = document.getElementById('itemOk');
        ok.textContent = T('deleted'); ok.hidden = false;
        setTimeout(function () { ok.hidden = true; }, 2500);
      });
    }
  }
  function onAddItem(ev) {
    ev.preventDefault();
    showErr('itemErr', null);
    var r = addItem(state,
      document.getElementById('itemName').value,
      document.getElementById('itemUnit').value);
    if (!r.ok) { showErr('itemErr', r.error); return; }
    saveState();
    document.getElementById('itemName').value = '';
    var ok = document.getElementById('itemOk');
    ok.textContent = T('itemAdded'); ok.hidden = false;
    setTimeout(function () { ok.hidden = true; }, 2500);
    renderAll();
  }

  /* ----- history tab ----- */
  function renderHistory() {
    var sel = document.getElementById('histFilter');
    var cur = sel.value || 'all';
    var opts = '<option value="all">' + T('allItems') + '</option>' + state.items.map(function (it) {
      return '<option value="' + it.id + '"' + (cur === it.id ? ' selected' : '') + '>' + escapeHTML(it.name) + '</option>';
    }).join('');
    sel.innerHTML = opts;
    var rows = state.prices.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : (a.date > b.date ? -1 : b.seq - a.seq);
    });
    if (cur !== 'all') rows = rows.filter(function (p) { return p.itemId === cur; });
    var tb = document.getElementById('histBody');
    document.getElementById('histEmpty').hidden = rows.length > 0;
    tb.innerHTML = rows.map(function (p) {
      var it = findItem(state, p.itemId);
      return '<tr data-price="' + p.id + '"><td>' + fmtDate(p.date, lang) + '</td>' +
        '<td>' + escapeHTML(it ? it.name : '?') + '</td>' +
        '<td class="num">' + fmtPrice(p.price, lang) + '</td>' +
        '<td>' + escapeHTML(p.note || '') + '</td>' +
        '<td><button class="btn danger sm" data-del-price="' + p.id + '">' + T('del') + '</button></td></tr>';
    }).join('');
    var btns = tb.querySelectorAll('[data-del-price]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        deletePrice(state, this.getAttribute('data-del-price'));
        saveState(); renderAll();
      });
    }
  }

  /* ----- backup tab ----- */
  function onExport() {
    var txt = exportJSON(state);
    document.getElementById('expOut').value = txt;
    try {
      var blob = new Blob([txt], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bazar-price-bd-backup.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { /* textarea copy still works */ }
  }
  function onCopy() {
    var ta = document.getElementById('expOut');
    function done() {
      var ok = document.getElementById('copyOk');
      ok.textContent = T('copied'); ok.hidden = false;
      setTimeout(function () { ok.hidden = true; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); done(); });
    } else { ta.select(); try { document.execCommand('copy'); } catch (e) {} done(); }
  }
  function onImport() {
    var msg = document.getElementById('impMsg');
    var before = JSON.stringify(state);
    var r = importJSON(state, document.getElementById('impIn').value);
    if (!r.ok) {
      if (JSON.stringify(state) !== before) { /* safety: should never happen */ }
      msg.textContent = T(r.error); msg.className = 'msg err'; msg.hidden = false;
      return;
    }
    saveState(); renderAll();
    msg.textContent = T('importOk'); msg.className = 'msg ok'; msg.hidden = false;
  }

  /* ----- tabs ----- */
  function switchTab(name) {
    var tabs = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i].getAttribute('data-tab') === name;
      tabs[i].classList.toggle('active', active);
      document.getElementById('tab-' + tabs[i].getAttribute('data-tab')).hidden = !active;
    }
  }

  function renderAll() {
    applyLang();
    renderDashboard();
    renderLogForm();
    renderItems();
    renderHistory();
  }

  /* ----- init ----- */
  function init() {
    var dl = document.getElementById('suggestList');
    dl.innerHTML = SUGGESTIONS.map(function (s) { return '<option value="' + escapeHTML(s) + '">'; }).join('');
    var unitSel = document.getElementById('itemUnit');
    unitSel.innerHTML = UNITS.map(function (u) {
      return '<option value="' + u + '">' + escapeHTML(unitLabel(u)) + '</option>';
    }).join('');
    var tabs = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { switchTab(this.getAttribute('data-tab')); });
    }
    document.getElementById('logForm').addEventListener('submit', onLogSubmit);
    document.getElementById('itemForm').addEventListener('submit', onAddItem);
    document.getElementById('histFilter').addEventListener('change', renderHistory);
    document.getElementById('expBtn').addEventListener('click', onExport);
    document.getElementById('copyBtn').addEventListener('click', onCopy);
    document.getElementById('impBtn').addEventListener('click', onImport);
    document.getElementById('dashWin').addEventListener('change', function () {
      dashDays = Number(this.value) === 30 ? 30 : 7;
      renderDashboard();
    });
    document.getElementById('langToggle').addEventListener('click', function () {
      lang = (lang === 'bn') ? 'en' : 'bn';
      saveLang(); renderAll();
    });
    var ld = document.getElementById('loading');
    if (ld) ld.hidden = true;
    renderAll();
    window.__bpb = {
      TODAY: TODAY, getLang: function () { return lang; },
      getState: function () { return state; },
      t: T, trendSeries: trendSeries, windowStats: windowStats
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
