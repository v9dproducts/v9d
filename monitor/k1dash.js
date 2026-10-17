// Printer dashboard for Creality's own firmware (K1 Max): live state, files and controls over
// the printer's WebSocket (port 9999), thumbnails and uploads over its web server (port 80).
// Returns the same shape as k2dash.view, so the app shows one dashboard for both.

const fs = require('fs');

const GCODES = '/usr/data/printer_data/gcodes/';
const HISTORY_MS = 15 * 60 * 1000;
const STATES = { 0: 'standby', 1: 'printing', 2: 'complete', 3: 'error', 4: 'cancelled', 5: 'paused' };
const FANS = { part: 0, chamber: 1, aux: 2 }; // M106 P<index>: model, case, auxiliary
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const round1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : null);
const base = (cfg) => `http://${cfg.ip}`;
const fileName = (f) => String(f || '').split('/').pop();

// Called by the watcher with the merged state (updates arrive several times a second).
function recordLive(p, raw) {
  p.live = raw;
  if (STATES[raw.state]) p.k1State = STATES[raw.state]; // in-between codes keep the last known state
  p.liveAt = Date.now();
  const hist = (p.tempHist ||= []);
  if (hist.length && Date.now() - hist[hist.length - 1][0] < 2500) return;
  hist.push([Date.now(), round1(num(raw.nozzleTemp)), round1(num(raw.bedTemp0)), round1(num(raw.boxTemp))]);
  while (hist.length && hist[0][0] < Date.now() - HISTORY_MS) hist.shift();
}

function filesFrom(list) {
  return (list || []).filter((f) => /\.gcode$/i.test(f.name)).map((f) => ({
    path: f.name,
    modified: (f.create_time || 0) * 1000,
    size: f.file_size,
    meta: {
      estimatedTime: f.timeCost || null,
      filamentGrams: String(f.filamentWeight || '').split(',').map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0) || null,
      layerHeight: f.layerHeight || null,
      thumbnail: f.thumbnail ? f.name.replace(/\.gcode$/i, '.png') : null,
    },
  }));
}

async function files(p) {
  const list = await p.k1.request({ reqGcodeFile: 1 }, 'retGcodeFileInfo2');
  p.fileCache = filesFrom(list);
  return p.fileCache.slice().sort((a, b) => b.modified - a.modified).slice(0, 30);
}

async function view(p, extra) {
  const r = p.live || {};
  const state = p.k1State || null;
  const file = fileName(r.printFileName);
  const meta = (p.fileCache || []).find((f) => f.path === file)?.meta || (file ? { thumbnail: file.replace(/\.gcode$/i, '.png') } : null);
  const err = r.err?.errcode ? (r.err.value || `Error code ${r.err.errcode}`) : null;
  const z = String(r.curPosition || '').match(/Z:([-\d.]+)/);
  return {
    id: p.cfg.id, name: p.cfg.name, model: p.cfg.model, type: p.cfg.type, ...extra,
    online: Date.now() - (p.liveAt || 0) < 20000,
    klippy: null, klippyMessage: null,
    caps: { chamberHeater: false, webLabel: 'Printer page' },
    job: {
      state, file: file || null, message: err,
      progress: (r.printProgress || 0) / 100, printDuration: r.printJobTime || 0, totalDuration: r.printJobTime || 0,
      timeLeft: state === 'printing' || state === 'paused' ? r.printLeftTime || null : null,
      filamentUsedMm: r.usedMaterialLength || 0,
      layer: r.layer ?? null, layerCount: r.TotalLayer || null,
      meta,
    },
    temps: {
      nozzle: { temp: num(r.nozzleTemp), target: num(r.targetNozzleTemp), power: null },
      bed: { temp: num(r.bedTemp0), target: num(r.targetBedTemp0), power: null },
      chamber: { temp: num(r.boxTemp), target: null, power: null },
    },
    tempHistory: p.tempHist || [],
    fans: { part: (r.modelFanPct ?? 0) / 100, aux: (r.auxiliaryFanPct ?? 0) / 100, chamber: (r.caseFanPct ?? 0) / 100 },
    light: r.lightSw ?? null,
    motion: {
      speed: state === 'printing' ? num(r.realTimeSpeed) : 0, speedFactor: (r.curFeedratePct ?? 100) / 100, flowFactor: (r.curFlowratePct ?? 100) / 100,
      z: z ? Number(z[1]) : null, homed: '',
    },
  };
}

// Thumbnails the printer made for its stored files (PNG named after the G-code file).
async function thumbnail(p, rel, res) {
  if (!/^[^/\\]+\.png$/i.test(rel) || rel.includes('..')) { res.writeHead(400); return res.end(); }
  const r = await fetch(`${base(p.cfg)}/downloads/humbnail/${encodeURIComponent(rel)}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
  res.end(Buffer.from(await r.arrayBuffer()));
}

// Validated controls. Returns a short confirmation message.
async function action(p, body, log) {
  const r = p.live || {}, st = p.k1State, a = body.action;
  const set = (params) => p.k1.send(params);
  const n = (v) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error('not a number'); return x; };
  switch (a) {
    case 'pause':
      if (st !== 'printing') throw new Error('Not printing');
      p.lastRemote = { action: 'pause', at: Date.now() };
      set({ pause: 1 }); return 'Pausing…';
    case 'resume':
      if (st !== 'paused') throw new Error('Not paused');
      p.lastRemote = { action: 'resume', at: Date.now() };
      set({ pause: 0 }); return 'Resuming…';
    case 'cancel':
      if (st !== 'printing' && st !== 'paused') throw new Error('Nothing to stop');
      p.lastRemote = { action: 'cancel', at: Date.now() };
      set({ stop: 1 }); return 'Stopping print…';
    case 'temp': {
      const t = Math.round(n(body.target));
      if (body.heater === 'nozzle') {
        const max = r.maxNozzleTemp || 300;
        if (t < 0 || t > max) throw new Error(`Allowed range 0–${max} °C`);
        set({ nozzleTempControl: t });
      } else if (body.heater === 'bed') {
        const max = r.maxBedTemp || 100;
        if (t < 0 || t > max) throw new Error(`Allowed range 0–${max} °C`);
        set({ bedTempControl: { num: 0, val: t } });
      } else throw new Error(`The ${p.cfg.name} has no chamber heater`);
      return t ? `Heating to ${t} °C` : 'Heater off';
    }
    case 'light':
      set({ lightSw: body.on ? 1 : 0 }); return body.on ? 'Light on' : 'Light off';
    case 'fan': {
      if (!(body.fan in FANS)) throw new Error('unknown fan');
      const pct = Math.max(0, Math.min(100, Math.round(n(body.percent))));
      set({ gcodeCmd: `M106 P${FANS[body.fan]} S${Math.round(pct * 2.55)}` }); return `Fan ${pct}%`;
    }
    case 'speed': {
      const pct = Math.round(n(body.percent));
      if (![50, 100, 130, 160].includes(pct)) throw new Error('unsupported speed');
      set({ gcodeCmd: `M220 S${pct}` }); return `Speed ${pct}%`;
    }
    case 'start': {
      if (body.plateClear !== true) throw new Error('Confirm the build plate is clear first');
      if (st === 'printing' || st === 'paused') throw new Error('Already printing');
      if (typeof body.file !== 'string' || /[/\\]|\.\./.test(body.file)) throw new Error('bad file');
      set({ opGcodeFile: `printprt:${GCODES}${body.file}` });
      log(`${p.cfg.name}: print started from V9D (${body.file})`);
      return 'Starting print…';
    }
    default: throw new Error('unknown action');
  }
}

// The K1 Max has no CFS: one spool.
async function cfs() { return { connected: false, slots: [] }; }

// Uploads G-code through the printer's web server, optionally starting it.
async function upload(p, file, name, opts = {}) {
  const st = p.k1State;
  if (opts.start) {
    if (opts.plateClear !== true) throw new Error('Confirm the build plate is clear first');
    if (st === 'printing' || st === 'paused') throw new Error('The printer is busy — sent without starting is still possible');
  }
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), name);
  const res = await fetch(`${base(p.cfg)}/upload/${encodeURIComponent(name)}`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.code && body.code !== 200)) throw new Error(body.message || `printer replied ${res.status}`);
  if (opts.start) { p.k1.send({ opGcodeFile: `printprt:${GCODES}${name}` }); return 'Sent — the print is starting'; }
  return 'Sent to the printer';
}

module.exports = { recordLive, view, files, thumbnail, action, cfs, upload };
