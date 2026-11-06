// Housekeeping: keeps the home PC's drive from filling up. Every night at 03:30 (and on
// "Clean up now" in the app):
//   - slice jobs (uploads, downloads, G-code) older than 7 days are removed — products keep
//     their own copies;
//   - extracted K2 Plus thumbnails older than 60 days are removed;
//   - folders listed in config.json "cleanFolders" (e.g. Downloads) lose files older than N days;
//   - logs over 5 MB are rotated (the start-up scripts move them aside on restart, so the monitor
//     restarts itself — only when no printer is printing — and the camera relay is restarted);
//   - a notification warns when less than 5 GB is free.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LOG_LIMIT = 5 * 1024 * 1024;
const LOW_DISK = 5 * 1024 ** 3;

function sizeOf(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((a, f) => a + sizeOf(path.join(p, f)), 0);
  } catch { return 0; }
}

// Removes entries in dir whose last change is older than `days`. Returns bytes freed.
function prune(dir, days, keep = () => false) {
  let freed = 0;
  const limit = Date.now() - days * 864e5;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return 0; }
  for (const f of entries) {
    const p = path.join(dir, f);
    try {
      if (keep(f) || fs.statSync(p).mtimeMs > limit) continue;
      const s = sizeOf(p);
      fs.rmSync(p, { recursive: true, force: true });
      freed += s;
    } catch {}
  }
  return freed;
}

class Housekeeping {
  constructor(dataDir, config, { slicer, printers, notify, log }) {
    this.data = dataDir;
    this.config = config;
    this.slicer = slicer;
    this.printers = printers;
    this.notify = notify;
    this.log = log;
    this.last = null;
    this.warnedAt = 0;
    setInterval(() => this.tick(), 60 * 60 * 1000);
    setTimeout(() => this.tick(), 60 * 1000);
  }

  folders() { return (this.config.cleanFolders || []).filter((f) => f && f.path && f.days > 0); }
  logs() {
    return [
      { label: 'Monitor log', file: path.join(this.data, 'monitor.log') },
      { label: 'Camera relay log', file: path.join(__dirname, 'go2rtc', 'go2rtc.log') },
    ];
  }

  disk() {
    try {
      const s = fs.statfsSync(this.data);
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch { return null; }
  }

  report() {
    const parts = [
      { id: 'slicer', label: 'Slices and downloads', note: 'removed after 7 days', bytes: sizeOf(path.join(this.data, 'slicer')) },
      { id: 'products', label: 'Products', note: 'kept until you delete them', bytes: sizeOf(path.join(this.data, 'products')) },
      { id: 'thumbs', label: 'Printer file pictures', note: 'removed after 60 days', bytes: sizeOf(path.join(this.data, 'thumbs')) },
      { id: 'logs', label: 'Logs', note: 'trimmed above 5 MB', bytes: this.logs().reduce((a, l) => a + sizeOf(l.file) + sizeOf(l.file.replace(/\.log$/, '.old.log')), 0) },
      ...this.folders().map((f, i) => ({ id: `folder${i}`, label: path.basename(f.path), note: `files older than ${f.days} days removed`, bytes: sizeOf(f.path) })),
    ];
    return { disk: this.disk(), parts, last: this.last };
  }

  busy() { return [...this.printers.values()].some((p) => ['printing', 'paused'].includes(p.status?.state)); }

  // Nightly at 03:30, plus the low-space warning every hour.
  tick() {
    const now = new Date();
    if (now.getHours() === 3 && (!this.last || Date.now() - this.last.at > 20 * 3600 * 1000)) this.run();
    const d = this.disk();
    if (d && d.free < LOW_DISK && Date.now() - this.warnedAt > 24 * 3600 * 1000) {
      this.warnedAt = Date.now();
      this.notify('⚠️ Home PC storage low', `${(d.free / 1024 ** 3).toFixed(1)} GB free — open V9D → Settings → Storage`, 'storage');
    }
  }

  run({ deep = false } = {}) {
    let freed = 0;
    // "Clean up now" also clears today's leftover slices (older than a day); nightly keeps a week.
    freed += prune(path.join(this.data, 'slicer'), deep ? 1 : 7, (id) => this.slicer.get(id)?.state === 'slicing' || this.slicer.get(id)?.state === 'queued');
    this.slicer.forgetMissing();
    freed += prune(path.join(this.data, 'thumbs'), 60);
    for (const f of this.folders()) freed += prune(f.path, f.days);

    // Logs: the start-up scripts move a big log aside when they (re)start the program.
    const [mon, cam] = this.logs();
    if (sizeOf(cam.file) > LOG_LIMIT) execFile('taskkill', ['/IM', 'go2rtc.exe', '/F'], () => {});
    const restart = sizeOf(mon.file) > LOG_LIMIT && !this.busy();

    this.last = { at: Date.now(), freed };
    this.log(`Housekeeping: freed ${(freed / 1024 ** 2).toFixed(1)} MB${restart ? ', restarting to rotate the log' : ''}`);
    if (restart) setTimeout(() => process.emit('SIGTERM'), 2000); // saves usage, then exits; the runner restarts it
    return this.report();
  }
}

module.exports = { Housekeeping };
