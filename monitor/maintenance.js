// Maintenance tracker: recommended intervals per printer model, usage since each item was
// last serviced (print hours, filament kg, days), and "replace soon / due" notifications.
// State lives in data/maintenance.json.

const fs = require('fs');
const path = require('path');

const K1_GUIDE = 'https://store.creality.com/blogs/all/creality-k1-series-routine-maintenance-tips';
const K2_GUIDE = 'https://store.creality.com/uk/blogs/tutorial/creality-k2-plus-maintenance';

// interval: any of { hours (printing), kg (filament), days } — whichever comes first.
// source: 'creality' when the figure is Creality's, otherwise 'typical'.
const CATALOG = {
  'K1 Max': [
    { id: 'nozzle', name: 'Nozzle', kind: 'replace', interval: { hours: 500 }, source: 'creality', url: K1_GUIDE,
      how: 'Preheat the hotend, hold the heater block with a tool and swap the nozzle while hot.' },
    { id: 'lube', name: 'Lubricate rods, lead screws & bearings', kind: 'service', interval: { hours: 500 }, source: 'creality', url: K1_GUIDE,
      how: 'Thin layer of the supplied grease on the threaded rods, smooth rods and linear bearings. Never use liquid lubricants. Wipe the X-axis rod (graphite bushing) instead of greasing it.' },
    { id: 'selftest', name: 'Device self-test', kind: 'service', interval: { hours: 300 }, source: 'creality', url: K1_GUIDE,
      how: 'Run the full self-test from the printer screen so its compensation matches the current wear.' },
    { id: 'belts', name: 'Belt tension & frame screws', kind: 'service', interval: { hours: 500 }, source: 'typical', url: K1_GUIDE,
      how: 'Belts tight but not over-tensioned; re-tighten frame screws loosened by vibration. Creality says “periodically”.' },
    { id: 'fans', name: 'Clean fans & cooling', kind: 'service', interval: { days: 30 }, source: 'typical', url: K1_GUIDE,
      how: 'With the printer off, clear dust from the hotend, part-cooling and auxiliary fans. Creality says “regularly”.' },
    { id: 'plate', name: 'Build plate', kind: 'replace', interval: { hours: 1500 }, source: 'typical',
      how: 'Replace when the PEI surface is worn or scratched and prints stop sticking after cleaning. No official interval.' },
  ],
  'K2 Plus': [
    { id: 'nozzle', name: 'Nozzle', kind: 'replace', interval: { hours: 500 }, source: 'creality', url: K1_GUIDE,
      how: 'Creality’s figure for its K-series nozzles (no separate K2 Plus figure). Replace sooner if printing abrasive filaments.' },
    { id: 'lube', name: 'Lubricate Y/Z shafts & lead screws', kind: 'service', interval: { hours: 300, days: 90 }, source: 'creality', url: K2_GUIDE,
      how: 'Wipe with a lint-free cloth and grease. The manual says every 300 print hours; Creality’s guide says every 3 months (5 kg when printing ABS/ASA).' },
    { id: 'xrails', name: 'Clean & oil X-axis rails', kind: 'service', interval: { days: 30 }, source: 'creality', url: K2_GUIDE,
      how: 'Clean with a lint-free cloth and apply a thin layer of metal anti-rust oil.' },
    { id: 'filter', name: 'Air filter cartridge', kind: 'replace', interval: { hours: 300, days: 90 }, source: 'creality', url: K2_GUIDE,
      how: 'Open the air filter cover and swap the activated carbon cartridge.' },
    { id: 'cutter', name: 'Filament cutter blade', kind: 'replace', interval: { kg: 5 }, source: 'creality', url: K2_GUIDE,
      how: 'Inspect after every 5 rolls of standard filament (1 roll for reinforced filaments) and replace if dull.' },
    { id: 'shaping', name: 'Input shaping calibration', kind: 'service', interval: { days: 30 }, source: 'creality', url: K2_GUIDE,
      how: 'With no filament loaded: Settings › Device Detection › Input shaping. Also checks belt tension.' },
    { id: 'plate', name: 'Build plate', kind: 'replace', interval: { hours: 1500 }, source: 'typical',
      how: 'Replace when the surface is worn and prints stop sticking after cleaning. No official interval.' },
  ],
};

function catalogFor(cfg) {
  const key = Object.keys(CATALOG).find((k) => (cfg.model || cfg.name || '').includes(k));
  return CATALOG[key] || CATALOG['K1 Max'];
}

class Maintenance {
  constructor(dataDir, usage, notify, log) {
    this.file = path.join(dataDir, 'maintenance.json');
    this.usage = usage; this.notify = notify; this.log = log;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.state = saved.state || {}; // printerId -> itemId -> { lastDone, notified }
    this.history = saved.history || []; // { printer, items, date, note, at }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ state: this.state, history: this.history }, null, 1));
    fs.renameSync(tmp, this.file);
  }

  // Usage of one item since it was last serviced.
  itemStatus(cfg, item) {
    const st = this.state[cfg.id]?.[item.id] || {};
    const jobs = this.usage.jobList().filter((j) => j.printer === cfg.id);
    const firstJob = jobs.length ? Math.min(...jobs.map((j) => j.start)) : Date.now();
    const since = st.lastDone || firstJob;
    const done = jobs.filter((j) => j.start >= since);
    const live = this.usage.currentSession(cfg.id);
    const used = {
      hours: done.reduce((a, j) => a + j.printSec, 0) / 3600 + (live && live.start >= since ? (Date.now() - live.start) / 3600000 : 0),
      kg: done.reduce((a, j) => a + j.grams, 0) / 1000,
      days: (Date.now() - since) / 864e5,
    };
    // The most worn-out measure decides.
    let worst = null;
    for (const [unit, limit] of Object.entries(item.interval)) {
      const frac = used[unit] / limit;
      if (!worst || frac > worst.frac) worst = { unit, limit, frac, left: limit - used[unit] };
    }
    const soonAt = { hours: Math.max(10, item.interval.hours * 0.1 || 0), kg: 0.5, days: item.interval.days >= 30 ? 7 : 1 };
    const status = worst.left <= 0 ? 'due' : worst.left <= soonAt[worst.unit] ? 'soon' : 'ok';
    return {
      ...item, used, since, logged: !!st.lastDone, status,
      percent: Math.min(100, Math.round(worst.frac * 100)), unit: worst.unit, left: worst.left, limit: worst.limit,
    };
  }

  report(printers) {
    const out = {};
    for (const [id, p] of printers) {
      out[id] = { name: p.cfg.name, items: catalogFor(p.cfg).map((it) => this.itemStatus(p.cfg, it)) };
    }
    return { printers: out, history: this.history.slice(-100).reverse() };
  }

  perform(cfg, itemIds, date, note) {
    const valid = new Set(catalogFor(cfg).map((i) => i.id));
    const items = itemIds.filter((i) => valid.has(i));
    if (!items.length) throw new Error('no valid items');
    const at = Math.min(Date.now(), Number(date) || Date.now());
    for (const i of items) (this.state[cfg.id] ||= {})[i] = { lastDone: at, notified: null };
    this.history.push({ printer: cfg.id, items, date: at, note: String(note || '').slice(0, 300), at: Date.now() });
    this.save();
    this.log(`${cfg.name}: maintenance logged (${items.join(', ')})`);
  }

  // Send each "soon" and "due" notice once per service cycle.
  check(printers) {
    let changed = false;
    for (const [, p] of printers) {
      for (const item of catalogFor(p.cfg)) {
        const s = this.itemStatus(p.cfg, item);
        const st = this.state[p.cfg.id]?.[item.id];
        if (!st?.lastDone) continue; // reminders start once the item has been logged
        if (s.status === 'ok' || st.notified === s.status || (st.notified === 'due' && s.status === 'soon')) continue;
        const left = describeLeft(s);
        if (s.status === 'soon') this.notify(`🔧 ${p.cfg.name}: ${item.name}`, `${item.kind === 'replace' ? 'Needs to be replaced' : 'Due'} soon — ${left}.`, `maint-${p.cfg.id}-${item.id}`);
        else this.notify(`🔧 ${p.cfg.name}: ${item.name}`, item.kind === 'replace'
          ? `Needs to be replaced now — ${describeLimit(s)} reached.`
          : `Due now — ${describeLimit(s)} since it was last done.`, `maint-${p.cfg.id}-${item.id}`);
        st.notified = s.status;
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

function describeLeft(s) {
  if (s.unit === 'hours') return `about ${Math.max(1, Math.round(s.left))} h of printing left`;
  if (s.unit === 'kg') return `about ${Math.max(0.1, s.left).toFixed(1)} kg of filament left`;
  return `${Math.max(1, Math.round(s.left))} day${Math.round(s.left) === 1 ? '' : 's'} left`;
}
function describeLimit(s) {
  return s.unit === 'hours' ? `${s.limit} print hours` : s.unit === 'kg' ? `${s.limit} kg of filament` : `${s.limit} days`;
}

module.exports = { Maintenance, CATALOG };
