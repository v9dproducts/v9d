// Usage log: energy per printer per day, energy per print session, and the print history
// (material + duration) imported from each printer. Stored in data/usage.json.

const fs = require('fs');
const path = require('path');
const { profileFor, materialFromFile, gramsFromMm } = require('./power');

const SAMPLE_WINDOW_MS = 15 * 60 * 1000; // live chart history kept in memory

class Usage {
  constructor(dataDir, log) {
    this.file = path.join(dataDir, 'usage.json');
    this.log = log;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.jobs = saved.jobs || {};         // id -> job
    this.sessions = saved.sessions || []; // measured energy per print: { printer, start, end, wh }
    this.days = saved.days || {};         // 'YYYY-MM-DD' -> { printerId: Wh }
    this.since = saved.since || Date.now();
    this.live = new Map();                // printerId -> { last, samples: [[t, W]], session }
    this.dirty = false;
    setInterval(() => this.save(), 60 * 1000);
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ since: this.since, jobs: this.jobs, sessions: this.sessions.slice(-2000), days: this.days }));
    fs.renameSync(tmp, this.file);
  }

  // Called on every power reading. Integrates watts over time into Wh.
  sample(id, watts, state) {
    const now = Date.now();
    let l = this.live.get(id);
    if (!l) { l = { last: now, samples: [], session: null }; this.live.set(id, l); }
    const dt = Math.min(now - l.last, 30000) / 3600000; // hours, capped across gaps
    l.last = now;
    const wh = watts * dt;
    const day = localDay(now);
    (this.days[day] ||= {})[id] = (this.days[day][id] || 0) + wh;

    const active = state === 'printing' || state === 'paused';
    if (!active) l.seenIdle = true;
    // A print already running when the monitor started is only partly measured.
    if (active && !l.session) l.session = { printer: id, start: now, wh: 0, partial: !l.seenIdle };
    if (l.session) l.session.wh += wh;
    if (!active && l.session) {
      this.sessions.push({ ...l.session, end: now });
      l.session = null;
      this.onSessionEnd?.(id);
    }

    l.samples.push([now, Math.round(watts)]);
    while (l.samples.length && l.samples[0][0] < now - SAMPLE_WINDOW_MS) l.samples.shift();
    this.dirty = true;
  }

  todayWh(id) { return this.days[localDay(Date.now())]?.[id] || 0; }
  samples(id) { return this.live.get(id)?.samples || []; }
  currentSession(id) { return this.live.get(id)?.session || null; }

  // Average wall power while printing, learned from measured sessions (falls back to profile).
  typicalPrintW(cfg) {
    const s = this.sessions.filter((x) => x.printer === cfg.id && x.end - x.start > 10 * 60 * 1000);
    const hours = s.reduce((a, x) => a + (x.end - x.start) / 3600000, 0);
    if (hours >= 1) return s.reduce((a, x) => a + x.wh, 0) / hours;
    return profileFor(cfg).typicalPrintW;
  }

  // Merge print history reported by a printer (normalised records) into the job log.
  mergeHistory(cfg, records) {
    let added = 0;
    for (const r of records) {
      const id = `${cfg.id}:${r.key}`;
      const material = materialFromFile(r.file);
      const slack = 15 * 60 * 1000;
      const session = this.sessions.find((s) => s.printer === cfg.id &&
        s.start >= r.start - slack && s.start <= r.end && s.end <= r.end + slack);
      const printH = (r.printSec || 0) / 3600;
      const pausedH = Math.max(0, ((r.totalSec || r.printSec || 0) - (r.printSec || 0)) / 3600);
      const prof = profileFor(cfg);
      const estWh = (prof.heatupWh || 0) + this.typicalPrintW(cfg) * printH + (prof.electronicsW + prof.holdW) / prof.psuEff * pausedH;
      // Partly measured print: add an estimate for the part before monitoring started.
      const missedWh = session?.partial ? (prof.heatupWh || 0) + this.typicalPrintW(cfg) * Math.max(0, session.start - r.start) / 3600000 : 0;
      if (!this.jobs[id]) added++;
      this.jobs[id] = {
        id, printer: cfg.id, file: r.file, material, status: r.status,
        start: r.start, end: r.end, printSec: Math.round(r.printSec || 0),
        filamentMm: Math.round(r.filamentMm || 0),
        grams: Math.round(gramsFromMm(r.filamentMm || 0, material) * 10) / 10,
        energyWh: Math.round(session ? session.wh + missedWh : estWh),
        energySource: session ? 'measured' : 'estimated',
      };
    }
    if (added) this.log(`${cfg.name}: imported ${added} print(s) from history`);
    this.dirty = true;
  }

  jobList() {
    return Object.values(this.jobs).sort((a, b) => b.start - a.start);
  }
}

function localDay(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- History readers (return normalised records) ----------
const MOON_STATUS = { completed: 'complete', cancelled: 'cancelled', error: 'error', klippy_shutdown: 'error', klippy_disconnect: 'error', interrupted: 'error', server_exit: 'error' };

async function moonrakerHistory(cfg) {
  const base = `http://${cfg.ip}:${cfg.moonrakerPort || 7125}`;
  const res = await fetch(`${base}/server/history/list?limit=200&order=desc`, { signal: AbortSignal.timeout(10000) });
  const jobs = (await res.json()).result.jobs || [];
  return jobs.filter((j) => j.status !== 'in_progress').map((j) => ({
    key: j.job_id,
    file: j.filename,
    status: MOON_STATUS[j.status] || j.status,
    start: Math.round(j.start_time * 1000),
    end: Math.round((j.end_time || j.start_time + j.total_duration) * 1000),
    printSec: j.print_duration,
    totalSec: j.total_duration,
    filamentMm: j.filament_used,
  }));
}

function crealityHistory(list) {
  return (list || []).map((h) => ({
    key: h.id,
    file: h.filename,
    status: h.printfinish === 1 ? 'complete' : 'cancelled',
    start: h.starttime * 1000,
    end: (h.starttime + h.usagetime) * 1000,
    printSec: h.usagetime,
    totalSec: h.usagetime,
    filamentMm: h.usagematerial,
  }));
}

module.exports = { Usage, moonrakerHistory, crealityHistory, localDay };
