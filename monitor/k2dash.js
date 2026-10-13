// Printer dashboard for Klipper/Moonraker printers (Creality K2 Plus): full live state,
// temperature history, files stored on the printer, and validated controls.
// Uses Moonraker's documented HTTP API: https://moonraker.readthedocs.io/en/latest/web_api/

const path = require('path');

const DASH_OBJECTS = [
  'print_stats', 'virtual_sdcard', 'display_status', 'webhooks', 'toolhead', 'gcode_move', 'motion_report',
  'extruder', 'heater_bed', 'heater_generic chamber_heater', 'temperature_sensor chamber_temp',
  'output_pin fan0', 'output_pin fan1', 'output_pin fan2', 'output_pin led',
];

const HISTORY_MS = 15 * 60 * 1000;
const LIMITS = { extruder: 300, heater_bed: 110, chamber_heater: 60 };
const FANS = { part: 0, chamber: 1, aux: 2 }; // M106 P<index> on Creality K2 firmware

const base = (cfg) => `http://${cfg.ip}:${cfg.moonrakerPort || 7125}`;

async function moon(cfg, pathAndQuery, opts = {}) {
  const res = await fetch(base(cfg) + pathAndQuery, { signal: AbortSignal.timeout(opts.timeout || 8000), method: opts.method || 'GET' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `printer replied ${res.status}`);
  return body.result;
}

// Called by the watcher with every status reading.
function recordLive(p, st) {
  p.live = st;
  p.liveAt = Date.now();
  const hist = (p.tempHist ||= []);
  hist.push([Date.now(),
    round1(st.extruder?.temperature), round1(st.heater_bed?.temperature),
    round1(st['temperature_sensor chamber_temp']?.temperature ?? st['heater_generic chamber_heater']?.temperature)]);
  while (hist.length && hist[0][0] < Date.now() - HISTORY_MS) hist.shift();
}
const round1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : null);

// File metadata (slicer estimate, filament, thumbnails), cached per file+modified time.
const metaCache = new Map();
async function metadata(cfg, filename) {
  if (!filename) return null;
  const key = cfg.id + ':' + filename;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.meta;
  let meta = null;
  try {
    const m = await moon(cfg, `/server/files/metadata?filename=${encodeURIComponent(filename)}`);
    const thumbs = (m.thumbnails || []).slice().sort((a, b) => b.width - a.width);
    const dir = path.posix.dirname(filename);
    meta = {
      estimatedTime: m.estimated_time || null,
      filamentGrams: m.filament_weight_total || null,
      filamentMm: m.filament_total || null,
      layerHeight: m.layer_height || null,
      objectHeight: m.object_height || null,
      slicer: m.slicer || null,
      thumbnail: thumbs[0] ? path.posix.join(dir === '.' ? '' : dir, thumbs[0].relative_path) : null,
    };
  } catch {}
  metaCache.set(key, { at: Date.now(), meta });
  return meta;
}

async function view(p, extra) {
  const st = p.live || {};
  const ps = st.print_stats || {}, sd = st.virtual_sdcard || {}, ds = st.display_status || {};
  const progress = sd.progress ?? ds.progress ?? 0;
  const meta = await metadata(p.cfg, ps.filename);
  // Time left: once printing is underway, extrapolate from actual progress; before that, use the slicer's estimate.
  let timeLeft = null;
  if (ps.state === 'printing' || ps.state === 'paused') {
    if (progress > 0.03) timeLeft = Math.max(0, ps.print_duration / progress - ps.print_duration);
    else if (meta?.estimatedTime) timeLeft = Math.max(0, meta.estimatedTime - (ps.print_duration || 0));
  }
  const pin = (name) => st[`output_pin ${name}`]?.value ?? null;
  return {
    id: p.cfg.id, name: p.cfg.name, model: p.cfg.model, type: p.cfg.type, ...extra,
    online: Date.now() - (p.liveAt || 0) < 20000,
    klippy: st.webhooks?.state || null, klippyMessage: st.webhooks?.state_message || null,
    job: {
      state: ps.state || null, file: ps.filename || null, message: ps.message || null,
      progress, printDuration: ps.print_duration || 0, totalDuration: ps.total_duration || 0,
      timeLeft, filamentUsedMm: ps.filament_used || 0,
      layer: sd.layer ?? ps.info?.current_layer ?? null, layerCount: sd.layer_count ?? ps.info?.total_layer ?? null,
      meta,
    },
    temps: {
      nozzle: { temp: st.extruder?.temperature ?? null, target: st.extruder?.target ?? null, power: st.extruder?.power ?? null },
      bed: { temp: st.heater_bed?.temperature ?? null, target: st.heater_bed?.target ?? null, power: st.heater_bed?.power ?? null },
      chamber: {
        temp: st['temperature_sensor chamber_temp']?.temperature ?? st['heater_generic chamber_heater']?.temperature ?? null,
        target: st['heater_generic chamber_heater']?.target ?? null, power: st['heater_generic chamber_heater']?.power ?? null,
      },
    },
    tempHistory: p.tempHist || [],
    fans: { part: pin('fan0'), aux: pin('fan2'), chamber: pin('fan1') },
    light: pin('led'),
    motion: {
      speed: st.motion_report?.live_velocity ?? null,
      speedFactor: st.gcode_move?.speed_factor ?? null,
      flowFactor: st.gcode_move?.extrude_factor ?? null,
      z: st.toolhead?.position?.[2] ?? null,
      homed: st.toolhead?.homed_axes || '',
    },
  };
}

async function files(p) {
  const list = await moon(p.cfg, '/server/files/list?root=gcodes');
  const items = (Array.isArray(list) ? list : list.files || [])
    .filter((f) => /\.gcode$/i.test(f.path || f.filename))
    .sort((a, b) => b.modified - a.modified)
    .slice(0, 30);
  return Promise.all(items.map(async (f) => {
    const name = f.path || f.filename;
    return { path: name, modified: f.modified * 1000, size: f.size, meta: await metadata(p.cfg, name) };
  }));
}

// Streams a file from the printer (used for thumbnails). Only image files under gcodes/.
async function thumbnail(p, rel, res) {
  if (!/\.(png|jpe?g)$/i.test(rel) || rel.includes('..')) { res.writeHead(400); return res.end(); }
  const r = await fetch(`${base(p.cfg)}/server/files/gcodes/${rel.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/png', 'Cache-Control': 'max-age=86400' });
  res.end(Buffer.from(await r.arrayBuffer()));
}

const gcode = (cfg, script) => moon(cfg, `/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: 'POST', timeout: 30000 });

// Validated controls. Returns a short confirmation message.
async function action(p, body, log) {
  const cfg = p.cfg, a = body.action, st = p.live?.print_stats?.state;
  const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error('not a number'); return n; };
  switch (a) {
    case 'pause':
      if (st !== 'printing') throw new Error('Not printing');
      await moon(cfg, '/printer/print/pause', { method: 'POST' }); return 'Pausing…';
    case 'resume':
      if (st !== 'paused') throw new Error('Not paused');
      await moon(cfg, '/printer/print/resume', { method: 'POST' }); return 'Resuming…';
    case 'cancel':
      if (st !== 'printing' && st !== 'paused') throw new Error('Nothing to stop');
      await moon(cfg, '/printer/print/cancel', { method: 'POST' }); return 'Stopping print…';
    case 'temp': {
      const heater = { nozzle: 'extruder', bed: 'heater_bed', chamber: 'chamber_heater' }[body.heater];
      if (!heater) throw new Error('unknown heater');
      const t = Math.round(num(body.target));
      if (t < 0 || t > LIMITS[heater]) throw new Error(`Allowed range 0–${LIMITS[heater]} °C`);
      await gcode(cfg, `SET_HEATER_TEMPERATURE HEATER=${heater} TARGET=${t}`);
      return t ? `Heating to ${t} °C` : 'Heater off';
    }
    case 'light':
      await gcode(cfg, `SET_PIN PIN=led VALUE=${body.on ? 1 : 0}`); return body.on ? 'Light on' : 'Light off';
    case 'fan': {
      if (!(body.fan in FANS)) throw new Error('unknown fan');
      const pct = Math.max(0, Math.min(100, Math.round(num(body.percent))));
      await gcode(cfg, `M106 P${FANS[body.fan]} S${Math.round(pct * 2.55)}`); return `Fan ${pct}%`;
    }
    case 'speed': {
      const pct = Math.round(num(body.percent));
      if (![50, 100, 130, 160].includes(pct)) throw new Error('unsupported speed');
      await gcode(cfg, `M220 S${pct}`); return `Speed ${pct}%`;
    }
    case 'start': {
      if (body.plateClear !== true) throw new Error('Confirm the build plate is clear first');
      if (st === 'printing' || st === 'paused') throw new Error('Already printing');
      if (typeof body.file !== 'string' || body.file.includes('..')) throw new Error('bad file');
      await moon(cfg, `/printer/print/start?filename=${encodeURIComponent(body.file)}`, { method: 'POST', timeout: 20000 });
      log(`${cfg.name}: print started from V9D (${body.file})`);
      return 'Starting print…';
    }
    default: throw new Error('unknown action');
  }
}

module.exports = { DASH_OBJECTS, recordLive, view, files, thumbnail, action };
