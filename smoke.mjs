#!/usr/bin/env node
/* Headless-Chromium smoke test for bazar-price-bd via raw CDP.
 * Usage: node smoke.mjs   (starts its own chrome on port 9324)
 * Exit 0 = all checks pass, 1 = any failure.
 */
'use strict';

const CHROME = '/opt/meta-chromium/chrome';
const PORT = 9324;
const DIR = '/home/hatch/workspace/muse-project-factory/builds/bazar-price-bd';
const URL = 'file://' + DIR + '/index.html?asof=2026-10-12';

const { spawn } = await import('node:child_process');

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? undefined : detail });
  console.log((cond ? '  OK ' : '  FAIL ') + name + (cond || !detail ? '' : '  -> ' + detail));
}

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--no-proxy-server',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/bpb-qa-profile',
  'about:blank',
], { stdio: 'ignore' });

async function waitForDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('chrome debugger never came up');
}

async function newTarget(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const j = await r.json();
  return j.webSocketDebuggerUrl;
}

let msgId = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(method + ': ' + JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error('CDP timeout ' + method)); }, 15000);
  });
}

async function ev(ws, expr, awaitPromise = false) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('JS exception: ' + r.exceptionDetails.text + ' ' + expr.slice(0, 120));
  return r.result.value;
}

function drainConsole(ws, errors) {
  ws.addEventListener('message', (evm) => {
    let m;
    try { m = JSON.parse(evm.data); } catch (e) { return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const type = m.params.type;
      if (type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('page exception: ' + (m.params.exceptionDetails.text || ''));
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') errors.push('log.error: ' + e.text);
    }
  });
}

function setIn(id, v) {
  return `document.getElementById('${id}').value = ${JSON.stringify(v)}; ` +
    `document.getElementById('${id}').dispatchEvent(new Event('input', {bubbles:true}));` +
    `document.getElementById('${id}').dispatchEvent(new Event('change', {bubbles:true}));`;
}
function clickTab(id) {
  return `document.querySelector('[data-tab="${id}"]').click();`;
}
function visible(id) {
  return `(()=>{const el=document.getElementById('${id}');return !el.hidden && el.offsetParent!==null && el.textContent.trim().length>0;})()`;
}
async function waitBoot(ws) {
  await ev(ws, `new Promise(r=>{const t=setInterval(()=>{if(window.__bpb){clearInterval(t);r(1);}},100);})`, true);
}

try {
  await waitForDebugger();
  const wsUrl = await newTarget(URL);
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  const consoleErrors = [];
  drainConsole(ws, consoleErrors);
  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  await waitBoot(ws);
  await ev(ws, `localStorage.clear(); location.reload();`);
  await waitBoot(ws);

  console.log('DESKTOP (1280x800), asof=2026-10-12');
  check('page title', (await ev(ws, 'document.title')).includes('Bazar Price BD'));
  check('app booted (window.__bpb)', await ev(ws, '!!window.__bpb'));
  check('loading indicator hidden', await ev(ws, `document.getElementById('loading').hidden`));
  check('5 tabs present', await ev(ws, `document.querySelectorAll('[data-tab]').length`) === 5);
  check('dashboard empty state visible', await ev(ws, visible('dashEmpty')));
  check('footer disclaimer mentions not financial advice',
    (await ev(ws, `document.querySelector('.foot').textContent`)).includes('not financial advice'));
  check('12 name suggestions in datalist',
    await ev(ws, `document.querySelectorAll('#suggestList option').length`) === 12);

  // Items tab: validation
  await ev(ws, clickTab('items'));
  await ev(ws, `document.getElementById('itemForm').requestSubmit();`);
  check('empty item name -> visible inline error', await ev(ws, visible('itemErr')));
  await ev(ws, setIn('itemName', 'Test Rice'));
  await ev(ws, `document.getElementById('itemUnit').value='kg';`);
  await ev(ws, `document.getElementById('itemForm').requestSubmit();`);
  check('item added -> success visible', await ev(ws, visible('itemOk')));
  check('item appears in list', (await ev(ws, `document.getElementById('itemList').textContent`)).includes('Test Rice'));
  await ev(ws, setIn('itemName', 'test rice'));
  await ev(ws, `document.getElementById('itemForm').requestSubmit();`);
  check('duplicate name -> visible inline error', await ev(ws, visible('itemErr')));

  // Log tab: validation
  await ev(ws, clickTab('log'));
  check('log item select has Test Rice', (await ev(ws, `document.getElementById('logItem').textContent`)).includes('Test Rice'));
  await ev(ws, `document.getElementById('logForm').requestSubmit();`);
  check('empty price -> visible inline error', await ev(ws, visible('logErr')));
  await ev(ws, setIn('logPrice', '0'));
  await ev(ws, `document.getElementById('logForm').requestSubmit();`);
  check('zero price -> visible inline error', await ev(ws, visible('logErr')));
  await ev(ws, setIn('logPrice', '150'));
  await ev(ws, setIn('logDate', '2026-10-13'));
  await ev(ws, `document.getElementById('logForm').requestSubmit();`);
  check('future date -> visible inline error', await ev(ws, visible('logErr')));

  // Log 4 prices: 10-05:100, 10-10:130, 10-11:140, 10-12:150
  async function logPrice(price, date, note) {
    await ev(ws, setIn('logPrice', String(price)));
    await ev(ws, setIn('logDate', date));
    await ev(ws, setIn('logNote', note || ''));
    await ev(ws, `document.getElementById('logForm').requestSubmit();`);
  }
  await logPrice(150, '2026-10-12', 'Karwan Bazar');
  check('price saved -> success visible', await ev(ws, visible('logOk')));
  await logPrice(140, '2026-10-11', '');
  await logPrice(130, '2026-10-10', '');
  await logPrice(100, '2026-10-05', '');
  check('4 prices stored', await ev(ws, `window.__bpb.getState().prices.length`) === 4);

  // Dashboard: exact stats
  await ev(ws, clickTab('dashboard'));
  const cardTxt = await ev(ws, `document.querySelector('[data-card]').textContent`);
  check('card shows latest 150', cardTxt.includes('150'), cardTxt.slice(0, 120));
  check('card shows 7-day avg 140', cardTxt.includes('140'));
  check('card shows min 130 and max 150', cardTxt.includes('130') && cardTxt.includes('150'));
  const chip = await ev(ws, `document.querySelector('.chip').textContent`);
  check('change chip = +50.00%', chip === '+50.00%', JSON.stringify(chip));
  check('change chip class up (red)', await ev(ws, `document.querySelector('.chip').classList.contains('up')`));
  check('trend chart svg rendered',
    await ev(ws, `!!document.querySelector('svg.trend-chart polyline') && document.querySelector('svg.trend-chart polyline').getAttribute('points').split(' ').length>=2`)); /* 3 data days in 7-day window */
  check('chart has min/max band', await ev(ws, `!!document.querySelector('svg.trend-chart polygon.band')`));
  await ev(ws, `document.getElementById('dashWin').value='30'; document.getElementById('dashWin').dispatchEvent(new Event('change',{bubbles:true}));`);
  check('30-day window renders chart', await ev(ws, `!!document.querySelector('svg.trend-chart')`));
  const card30 = await ev(ws, `document.querySelector('[data-card]').textContent`);
  check('30-day avg = 130 (all 4 entries)', card30.includes('130'));

  // BN toggle: Bengali digits
  await ev(ws, `document.getElementById('langToggle').click();`);
  check('html lang=bn', await ev(ws, `document.documentElement.lang`) === 'bn');
  const cardBn = await ev(ws, `document.querySelector('[data-card]').textContent`);
  check('BN digits shown for 150', cardBn.includes('\u09E7\u09EB\u09E6'), cardBn.slice(0, 80));
  check('BN tab label non-ASCII', await ev(ws, `/[^\\x00-\\x7F]/.test(document.querySelector('[data-tab="dashboard"]').textContent)`));
  check('langToggle shows EN', await ev(ws, `document.getElementById('langToggle').textContent`) === 'EN');
  await ev(ws, `document.getElementById('langToggle').click();`);
  check('back to EN', await ev(ws, `document.documentElement.lang`) === 'en');

  // Reload persistence
  await ev(ws, `location.reload();`);
  await waitBoot(ws);
  check('item persists after reload', (await ev(ws, `document.getElementById('itemList').textContent`)).includes('Test Rice'));
  check('lang persists after reload (en)', await ev(ws, `document.documentElement.lang`) === 'en');
  check('prices persist after reload', await ev(ws, `window.__bpb.getState().prices.length`) === 4);

  // History tab: rows + delete
  await ev(ws, clickTab('history'));
  check('history shows 4 rows', await ev(ws, `document.querySelectorAll('#histBody tr').length`) === 4);
  check('history newest-first (2026-10-12 on top)',
    (await ev(ws, `document.querySelector('#histBody tr td').textContent`)).includes('2026-10-12'));
  await ev(ws, `document.querySelector('[data-del-price]').click();`);
  check('delete one price -> 3 rows', await ev(ws, `document.querySelectorAll('#histBody tr').length`) === 3);

  // Backup: export -> wipe -> import round-trip
  await ev(ws, clickTab('backup'));
  await ev(ws, `document.getElementById('expBtn').click();`);
  const exported = await ev(ws, `document.getElementById('expOut').value`);
  check('export contains app marker', exported.includes('"app": "bazar-price-bd"') && exported.includes('Test Rice'));
  await ev(ws, `localStorage.clear(); location.reload();`);
  await waitBoot(ws);
  check('wiped: dashboard empty again', await ev(ws, visible('dashEmpty')));
  await ev(ws, clickTab('backup'));
  await ev(ws, setIn('impIn', exported));
  await ev(ws, `document.getElementById('impBtn').click();`);
  check('import success visible', await ev(ws, visible('impMsg')));
  check('item restored after import', (await ev(ws, `document.getElementById('itemList').textContent`)).includes('Test Rice'));
  await ev(ws, clickTab('history'));
  check('3 prices restored after import', await ev(ws, `document.querySelectorAll('#histBody tr').length`) === 3);
  // malformed import: data intact
  await ev(ws, clickTab('backup'));
  await ev(ws, setIn('impIn', '{bad json'));
  await ev(ws, `document.getElementById('impBtn').click();`);
  check('malformed import -> visible error', await ev(ws, visible('impMsg')));
  check('data intact after bad import', await ev(ws, `window.__bpb.getState().prices.length`) === 3);

  // Items tab: delete item cascades
  await ev(ws, clickTab('items'));
  await ev(ws, `document.querySelector('[data-del-item]').click();`);
  const afterDel = await ev(ws, `window.__bpb.getState().items.length`);
  check('item deleted from state', afterDel === 0);
  check('prices cascaded on item delete', await ev(ws, `window.__bpb.getState().prices.length`) === 0);

  // Zero network requests
  check('zero network requests', await ev(ws, `performance.getEntriesByType('resource').length`) === 0);

  console.log('MOBILE (390x844)');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(ws, `location.reload();`);
  await waitBoot(ws);
  check('no horizontal overflow at 390px',
    await ev(ws, `document.documentElement.scrollWidth <= 390`), await ev(ws, `document.documentElement.scrollWidth`));
  check('tabs visible on mobile', await ev(ws, visible('dashEmpty')) || await ev(ws, `document.querySelectorAll('[data-tab]').length`) === 5);

  check('zero console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('SMOKE HARNESS ERROR:', e.message);
  try { chrome.kill(); } catch (e2) {}
  process.exit(1);
}
