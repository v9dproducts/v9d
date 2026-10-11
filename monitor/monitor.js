// V9D monitor — runs on a computer at home (on the printers' network), watches the
// printers and sends Web Push notifications to phones that enabled them in V9D.
// Also serves live printer status to the app. Requires Node.js 22+.

const fs = require('fs');
const path = require('path');
const http = require('http');
const webpush = require('web-push');
const { MOONRAKER_OBJECTS, estimateMoonraker, estimateCreality, profileFor, standbyW } = require('./power');
const { Usage, moonrakerHistory, crealityHistory } = require('./usage');
const { Maintenance, sampleMessages } = require('./maintenance');
const { Trends } = require('./trends');

const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const config = {
  port: 8787,
  printersUrl: 'https://v9dproducts.github.io/v9d/printers.json',
  allowedOrigins: ['https://v9dproducts.github.io', 'http://localhost:8099'],
  offlineAfterSec: 120,
  ...readJson(path.join(__dirname, 'config.json'), {}),
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function log(...args) {
  console.log(new Date().toLocaleString('sv-SE'), ...args);
}

// ---------- Web Push ----------
const KEYS_FILE = path.join(DATA, 'vapid.json');
const SUBS_FILE = path.join(DATA, 'subscriptions.json');

let vapid = readJson(KEYS_FILE, null);
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  writeJson(KEYS_FILE, vapid);
  log('Generated new push keys');
}
webpush.setVapidDetails('https://v9dproducts.github.io/v9d/', vapid.publicKey, vapid.privateKey);

let subscriptions = readJson(SUBS_FILE, []);

async function notify(title, body, tag) {
  log('NOTIFY', title, '-', body);
  const payload = JSON.stringify({ title, body, tag, url: './#/printers' });
  for (const sub of [...subscriptions]) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: 'high' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        log('Removing expired subscription');
        subscriptions = subscriptions.filter((s) => s.endpoint !== sub.endpoint);
        writeJson(SUBS_FILE, subscriptions);
      } else {
        log('Push failed:', err.statusCode || '', err.body || err.message);
      }
    }
  }
}

// ---------- Usage & power ----------
const usage = new Usage(DATA, log);
usage.onSessionEnd = (id) => setTimeout(() => syncHistory(id), 20000);
const maintenance = new Maintenance(DATA, usage, (...a) => notify(...a), log);
const trends = new Trends(DATA, config, log);

// Motors stay energised for a while after a print, then the firmware switches them off.
function holding(id, state) {
  const p = printers.get(id);
  if (!p) return false;
  if (state === 'printing' || state === 'paused') p.lastActive = Date.now();
  return Date.now() - (p.lastActive || 0) < 10 * 60 * 1000;
}

function recordPower(id, power, state) {
  const p = printers.get(id);
  if (!p) return;
  p.power = power;
  usage.sample(id, power.watts, state);
}

async function syncHistory(id) {
  const p = printers.get(id);
  if (!p?.watcher.history) return;
  try { usage.mergeHistory(p.cfg, await p.watcher.history()); }
  catch (err) { log(`${p.cfg.name}: history sync failed (${err.message})`); }
  maintenance.check(printers);
}

// ---------- Printer state & events ----------
// Normalised states: idle, printing, paused, complete, cancelled, error, offline
const printers = new Map(); // id -> { cfg, status, watcher }

function prettyFile(file) {
  if (!file) return '';
  return path.basename(String(file))
    .replace(/\.gcode$/i, '')
    .replace(/^obj_\d+_/, '')          // Creality Print prefix
    .replace(/\.(stl|3mf|obj|step)_.*$/i, ''); // "...stl_PLA_23m39s"
}
function duration(sec) {
  if (!sec || sec < 1) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Wording of print alerts (shared with the test samples).
function printMessage(event, name, s) {
  const job = prettyFile(s.file);
  switch (event) {
    case 'complete': return { title: `✅ ${name} finished`, body: [job, duration(s.printTime)].filter(Boolean).join(' · ') || 'Print complete' };
    case 'error': return { title: `❌ ${name} error`, body: s.message || (s.errorCode ? `Error code ${s.errorCode}` : job ? `Print failed: ${job}` : 'The printer reported an error') };
    case 'cancelled': return { title: `⏹ ${name} cancelled`, body: job || 'Print cancelled' };
    case 'paused': return { title: `⏸ ${name} paused`, body: s.message || (job ? `${job} is paused — check filament` : 'Print paused') };
    case 'offline': return { title: `⚠️ ${name} went offline`, body: `Lost connection during ${job || 'a print'}` };
  }
}
function notifyPrint(event, id, name, s) {
  const m = printMessage(event, name, s);
  const tag = { complete: 'done', error: 'error', cancelled: 'cancel', paused: 'pause', offline: 'offline' }[event];
  notify(m.title, m.body, `${id}-${tag}`);
}

// Called by watchers with a fresh reading.
function update(id, next) {
  const p = printers.get(id);
  if (!p) return;
  const prev = p.status;
  p.status = { ...prev, ...next, lastSeen: Date.now() };
  if (!prev.state) return; // first reading after start-up: no events
  const s = p.status, name = p.cfg.name, job = prettyFile(s.file);

  if (s.state !== prev.state) {
    log(`${name}: ${prev.state} -> ${s.state}`);
    const was = prev.state;
    const active = was === 'printing' || was === 'paused';
    if (s.state === 'complete' && active) notifyPrint('complete', id, name, s);
    else if (s.state === 'error') notifyPrint('error', id, name, { ...s, errorCode: '' });
    else if (s.state === 'cancelled' && active) notifyPrint('cancelled', id, name, s);
    else if (s.state === 'paused' && was === 'printing') notifyPrint('paused', id, name, s);
  } else if (s.errorCode && s.errorCode !== prev.errorCode && s.state !== 'error') {
    notifyPrint('error', id, name, { ...s, file: '' });
  }
}

function markOfflineIfStale(id) {
  const p = printers.get(id);
  if (p && p.status.state && p.status.state !== 'offline' &&
      Date.now() - p.status.lastSeen > config.offlineAfterSec * 1000) {
    const prev = p.status;
    p.status = { ...prev, state: 'offline' };
    p.power = null;
    // keep lastSeen so the next real reading is compared against 'offline'
    if (prev.state) {
      log(`${p.cfg.name}: ${prev.state} -> offline`);
      const active = prev.state === 'printing' || prev.state === 'paused';
      if (active) notifyPrint('offline', id, p.cfg.name, prev);
    }
  }
}

// ---------- Watcher: Klipper / Moonraker (e.g. Creality K2 Plus) ----------
function watchMoonraker(p) {
  const base = `http://${p.cfg.ip}:${p.cfg.moonrakerPort || 7125}`;
  const MAP = { standby: 'idle', printing: 'printing', paused: 'paused', complete: 'complete', cancelled: 'cancelled', error: 'error' };
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const objects = ['print_stats', 'webhooks', 'virtual_sdcard', ...MOONRAKER_OBJECTS].map(encodeURIComponent).join('&');
      const res = await fetch(`${base}/printer/objects/query?${objects}`, { signal: AbortSignal.timeout(5000) });
      const st = (await res.json()).result.status;
      const ps = st.print_stats || {}, wh = st.webhooks || {}, sd = st.virtual_sdcard || {};
      const klipperBroken = wh.state === 'shutdown' || wh.state === 'error';
      const state = klipperBroken ? 'error' : (MAP[ps.state] || 'idle');
      recordPower(p.cfg.id, estimateMoonraker(p.cfg, st, state === 'printing', holding(p.cfg.id, state)), state);
      update(p.cfg.id, {
        state,
        message: klipperBroken ? wh.state_message : ps.message || '',
        file: ps.filename || '',
        progress: Math.round((sd.progress || 0) * 100),
        printTime: ps.print_duration || 0,
        timeLeft: ps.state === 'printing' && sd.progress > 0.02
          ? Math.round(ps.print_duration / sd.progress - ps.print_duration) : 0,
      });
    } catch {
      markOfflineIfStale(p.cfg.id);
    }
    setTimeout(tick, 5000);
  };
  tick();
  return { stop: () => { stopped = true; }, history: () => moonrakerHistory(p.cfg) };
}

// ---------- Watcher: Creality K1 series (WebSocket on port 9999) ----------
function watchCreality(p) {
  // state: 0 idle, 1 printing, 2 complete, 3 failed, 4 stopped, 5 paused
  const MAP = { 0: 'idle', 1: 'printing', 2: 'complete', 3: 'error', 4: 'cancelled', 5: 'paused' };
  const id = p.cfg.id;
  let ws, stopped = false, lastMsg = 0, raw = {}, lastPower = 0, historyWaiters = [];

  const connect = () => {
    if (stopped) return;
    raw = {};
    try { ws = new WebSocket(`ws://${p.cfg.ip}:${p.cfg.websocketPort || 9999}/`); } catch { return setTimeout(connect, 10000); }
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      const text = String(ev.data);
      if (text.includes('heart_beat')) { try { ws.send('ok'); } catch {} return; }
      let m; try { m = JSON.parse(text); } catch { return; }
      if (m.historyList) { historyWaiters.splice(0).forEach((w) => w(m.historyList)); return; }
      Object.assign(raw, m);
      if (raw.state === undefined) return;
      const err = raw.err || {};
      const errorCode = err.errcode ? `${err.errcode}${err.key ? '/' + err.key : ''}` : '';
      const state = MAP[raw.state] || 'idle';
      if (Date.now() - lastPower >= 5000) { // updates arrive many times a second
        lastPower = Date.now();
        recordPower(id, estimateCreality(p.cfg, raw, state === 'printing', holding(id, state)), state);
      }
      update(id, {
        state,
        message: errorCode ? (err.value || `Error code ${errorCode}`) : '',
        errorCode,
        file: raw.printFileName || '',
        progress: raw.printProgress ?? 0,
        printTime: raw.printJobTime || 0,
        timeLeft: raw.printLeftTime || 0,
      });
    };
    ws.onclose = () => { if (!stopped) setTimeout(connect, 5000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  connect();

  // The printer streams updates constantly; silence means the connection is dead.
  const guard = setInterval(() => {
    if (Date.now() - lastMsg > 60000) { try { ws.close(); } catch {} }
    markOfflineIfStale(id);
  }, 15000);

  const history = () => new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('not connected'));
    const timer = setTimeout(() => reject(new Error('no reply')), 15000);
    historyWaiters.push((list) => { clearTimeout(timer); resolve(crealityHistory(list)); });
    ws.send(JSON.stringify({ method: 'get', params: { reqHistory: 1 } }));
  });

  return { stop: () => { stopped = true; clearInterval(guard); try { ws.close(); } catch {} }, history };
}

const WATCHERS = { moonraker: watchMoonraker, creality: watchCreality };

// ---------- Printer list (from the V9D site, so it stays in sync with the app) ----------
async function loadPrinters() {
  let list;
  try {
    list = await (await fetch(config.printersUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) })).json();
    writeJson(path.join(DATA, 'printers-cache.json'), list);
  } catch {
    list = readJson(path.join(DATA, 'printers-cache.json'), null) || readJson(path.join(__dirname, '..', 'printers.json'), []);
  }
  const wanted = new Map(list.filter((x) => WATCHERS[x.type]).map((x) => [x.id, x]));
  for (const [id, p] of printers) {
    if (JSON.stringify(p.cfg) !== JSON.stringify(wanted.get(id))) { p.watcher.stop(); printers.delete(id); }
  }
  for (const [id, cfg] of wanted) {
    if (printers.has(id)) continue;
    const p = { cfg, status: { lastSeen: Date.now() } };
    printers.set(id, p);
    p.watcher = WATCHERS[cfg.type](p);
    log(`Watching ${cfg.name} (${cfg.type}, ${cfg.ip})`);
  }
}

// ---------- HTTP API (exposed to the phone via `tailscale serve`) ----------
function send(res, code, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Vary'] = 'Origin';
  }
  res.writeHead(code, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, undefined, origin);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const out = {};
      for (const [id, p] of printers) {
        const { lastSeen, ...s } = p.status;
        out[id] = { ...s, file: prettyFile(s.file), state: s.state || 'connecting' };
      }
      return send(res, 200, { printers: out }, origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/power') {
      const out = {};
      for (const [id, p] of printers) {
        out[id] = {
          name: p.cfg.name, state: p.status.state || 'connecting',
          watts: p.power?.watts ?? null, parts: p.power?.parts || null, inputs: p.power?.inputs || null,
          todayWh: Math.round(usage.todayWh(id)), sessionWh: Math.round(usage.currentSession(id)?.wh || 0),
          samples: usage.samples(id),
        };
      }
      return send(res, 200, { printers: out, time: Date.now() }, origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const profiles = {};
      for (const [id, p] of printers) {
        const prof = profileFor(p.cfg);
        profiles[id] = { name: p.cfg.name, ...prof, typicalPrintW: Math.round(usage.typicalPrintW(p.cfg)), standbyW: Math.round(usage.standbyW(p.cfg, standbyW(prof)) * 10) / 10 };
      }
      return send(res, 200, { jobs: usage.jobList(), days: usage.days, since: usage.since, printers: profiles }, origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/maintenance') {
      return send(res, 200, maintenance.report(printers), origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/maintenance/perform') {
      const { printer, items, date, note } = await readBody(req);
      const p = printers.get(printer);
      if (!p || !Array.isArray(items)) return send(res, 400, { error: 'bad request' }, origin);
      maintenance.perform(p.cfg, items, date, note);
      return send(res, 200, maintenance.report(printers), origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/trends') {
      return send(res, 200, await trends.report(), origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/trends/refresh') {
      if (!trends.apiKey()) return send(res, 400, { error: 'no API key' }, origin);
      if (trends.running) return send(res, 409, { error: 'already running' }, origin);
      if (Date.now() - (trends.state.updatedAt || 0) < 30 * 60 * 1000) return send(res, 429, { error: 'updated less than 30 minutes ago' }, origin);
      trends.run().catch(() => {});
      return send(res, 202, { ok: true }, origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/push-key') {
      return send(res, 200, { publicKey: vapid.publicKey }, origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/subscribe') {
      const { subscription } = await readBody(req);
      if (!subscription?.endpoint || !subscription?.keys) return send(res, 400, { error: 'bad subscription' }, origin);
      subscriptions = subscriptions.filter((s) => s.endpoint !== subscription.endpoint).concat(subscription);
      writeJson(SUBS_FILE, subscriptions);
      log('Phone subscribed; total', subscriptions.length);
      return send(res, 200, { ok: true }, origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/unsubscribe') {
      const { endpoint } = await readBody(req);
      subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
      writeJson(SUBS_FILE, subscriptions);
      return send(res, 200, { ok: true }, origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/test') {
      const { endpoint, kind } = await readBody(req);
      const sub = subscriptions.find((s) => s.endpoint === endpoint);
      if (!sub) return send(res, 404, { error: 'not subscribed' }, origin);
      let messages = [{ title: '🔔 V9D', body: 'Notifications are working.' }];
      if (kind === 'maintenance') messages = sampleMessages(printers);
      if (kind === 'prints') {
        const [id, p] = [...printers][0] || ['x', { cfg: { name: 'Printer' } }];
        const sample = { file: 'obj_1_Benchy.stl_PLA_1h.gcode', printTime: 3725 };
        messages = [
          printMessage('complete', p.cfg.name, sample),
          printMessage('error', p.cfg.name, { ...sample, message: 'Heater extruder not heating at expected rate' }),
          printMessage('paused', p.cfg.name, sample),
          printMessage('cancelled', p.cfg.name, sample),
          printMessage('offline', p.cfg.name, sample),
        ];
      }
      // Separate tags so each test shows as its own notification; small gap keeps the order.
      for (const [n, m] of messages.entries()) {
        const url = kind === 'maintenance' ? './#/maintenance' : './#/printers';
        await webpush.sendNotification(sub, JSON.stringify({ title: m.title, body: `${m.body} (test)`, tag: `test-${kind || 'basic'}-${n}`, url }));
        await new Promise((r) => setTimeout(r, 400));
      }
      return send(res, 200, { ok: true, sent: messages.length }, origin);
    }
    send(res, 404, { error: 'not found' }, origin);
  } catch (err) {
    log('API error:', err.message);
    send(res, 500, { error: err.message }, origin);
  }
}).listen(config.port, '127.0.0.1', () => log(`V9D monitor on http://127.0.0.1:${config.port}`));

loadPrinters().then(() => setTimeout(() => { for (const id of printers.keys()) syncHistory(id); }, 10000));
setInterval(loadPrinters, 10 * 60 * 1000);
setInterval(() => { for (const id of printers.keys()) syncHistory(id); }, 30 * 60 * 1000);
setInterval(() => maintenance.check(printers), 60 * 60 * 1000); // day-based items
process.on('SIGINT', () => { usage.dirty = true; usage.save(); process.exit(0); });
process.on('SIGTERM', () => { usage.dirty = true; usage.save(); process.exit(0); });
