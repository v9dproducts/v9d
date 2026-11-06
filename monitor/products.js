// Products: things you sell, each with its model file, slice settings, sliced G-code, preview
// picture and your prices. Made from a slice ("Save as product"); "Print again" sends the
// saved G-code straight to the printer. Prices and fees are worked out in the app.
//
// data/products/products.json            list of products
// data/products/<id>/model.stl|.3mf      the model, for re-slicing with other settings
// data/products/<id>/print.gcode          last slice (with its preview picture embedded)
// data/products/<id>/preview.png          picture shown in the app
//
// Thingiverse's API terms only allow temporary copies of its models, deleted once unused for 30
// days. So a product made from a Thingiverse model keeps its files only while it's in use: after
// TV_KEEP_DAYS without printing or re-slicing, the model, G-code and picture are removed (prices,
// settings, listings and the link stay) and "Download & slice again" fetches the file fresh.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TV_KEEP_DAYS = 28; // a little under Thingiverse's 30 days, as housekeeping runs nightly
const fromThingiverse = (p) => p.source?.site === 'Thingiverse';

const EDITABLE = {
  name: (v) => String(v || '').trim().slice(0, 80) || null,
  units: (v) => Math.max(1, Math.min(500, Math.round(Number(v) || 1))),
  packaging: (v) => Math.max(0, Math.min(100, Number(v) || 0)),
  prices: (v) => Object.fromEntries(Object.entries(v || {}).filter(([k]) => ['etsy', 'ebay', 'local'].includes(k))
    .map(([k, x]) => [k, x === null || x === '' ? null : Math.max(0, Math.min(10000, Number(x) || 0))])),
  listings: (v) => (Array.isArray(v) ? v : []).slice(0, 10).map((l) => ({
    channel: ['etsy', 'ebay', 'shop', 'other'].includes(l.channel) ? l.channel : 'other',
    url: /^https:\/\//.test(l.url || '') ? String(l.url).slice(0, 500) : '',
  })).filter((l) => l.url),
  notes: (v) => String(v || '').slice(0, 2000),
  tags: (v) => (Array.isArray(v) ? v : []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10),
};

class Products {
  constructor(dataDir, slicer, log) {
    this.dir = path.join(dataDir, 'products');
    this.file = path.join(this.dir, 'products.json');
    this.slicer = slicer;
    this.log = log;
    fs.mkdirSync(this.dir, { recursive: true });
    try { this.list = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.list = []; }
  }

  save() { fs.writeFileSync(this.file, JSON.stringify(this.list, null, 2)); }
  get(id) { return this.list.find((p) => p.id === id) || null; }
  folder(p) { return path.join(this.dir, p.id); }
  preview(p) { const f = path.join(this.folder(p), 'preview.png'); return fs.existsSync(f) ? f : null; }
  all() { return this.list.slice().sort((a, b) => (b.lastPrinted || b.updated) - (a.lastPrinted || a.updated)); }

  // Copies the sliced job's model, G-code and picture into the product.
  takeJob(p, job) {
    if (job.state !== 'sliced' || !job.result?.gcode) throw new Error('Slice the file first');
    const dir = this.folder(p);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^model\./.test(f)) fs.rmSync(path.join(dir, f));
    fs.copyFileSync(this.slicer.modelPath(job), path.join(dir, 'model' + job.ext));
    fs.copyFileSync(job.result.gcode, path.join(dir, 'print.gcode'));
    const png = path.join(path.dirname(job.result.gcode), 'preview.png');
    if (fs.existsSync(png)) fs.copyFileSync(png, path.join(dir, 'preview.png'));
    const { gcode, ...result } = job.result;
    Object.assign(p, {
      ext: job.ext, colours: job.colours, plates: job.plates,
      settings: job.settings, result: { ...result, printer: job.settings.printer },
      source: job.source || p.source || null,
      updated: Date.now(), usedAt: Date.now(), filesRemoved: null,
    });
  }

  create(job, fields = {}) {
    const p = { id: crypto.randomBytes(6).toString('hex'), created: Date.now(), name: job.name, units: 1, packaging: 0, prices: {}, listings: [], notes: '', tags: [], printed: 0, lastPrinted: null };
    this.takeJob(p, job);
    this.edit(p, fields, false);
    this.list.push(p);
    this.save();
    this.log(`Products: added ${p.name}`);
    return p;
  }

  edit(p, fields, save = true) {
    for (const [k, clean] of Object.entries(EDITABLE)) {
      if (!(k in fields)) continue;
      const v = clean(fields[k]);
      if (k === 'name' && !v) continue;
      p[k] = k === 'prices' ? { ...p.prices, ...v } : v;
    }
    p.updated = Date.now();
    if (save) this.save();
    return p;
  }

  updateFromJob(p, job) { this.takeJob(p, job); this.save(); return p; }

  remove(p) {
    this.list = this.list.filter((x) => x !== p);
    fs.rmSync(this.folder(p), { recursive: true, force: true });
    this.save();
    this.log(`Products: removed ${p.name}`);
  }

  // A slice job with the product's model and settings, for changing settings or printer.
  toJob(p) {
    if (p.filesRemoved) throw new Error('This model’s file was removed — download it again first');
    p.usedAt = Date.now(); this.save();
    return this.slicer.fromFile(path.join(this.folder(p), 'model' + p.ext), p, p.id);
  }

  gcodeFile(p) {
    if (p.filesRemoved) throw new Error('This model’s files were removed after 30 days unused (Thingiverse’s rules) — tap “Download & slice again”');
    return path.join(this.folder(p), 'print.gcode');
  }

  // Thingiverse's rules: when a design is deleted or taken down, remove it within 24 hours.
  // Drops the stored files and the Thingiverse picture; your name, prices and notes stay.
  takenDown(p) {
    const dir = this.folder(p);
    let files = [];
    try { files = fs.readdirSync(dir); } catch {}
    for (const f of files) if (/^(model\.|print\.gcode$|preview\.png$)/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    p.filesRemoved = p.filesRemoved || Date.now();
    p.source = { ...p.source, thumbnail: null, takenDown: Date.now() };
    this.save();
    this.log(`Products: ${p.name} was removed from Thingiverse — deleted its files`);
  }

  // Removes the stored copies of Thingiverse models not printed or re-sliced for TV_KEEP_DAYS.
  // Returns bytes freed.
  expireThingiverse() {
    let freed = 0, changed = false;
    const limit = Date.now() - TV_KEEP_DAYS * 864e5;
    for (const p of this.list) {
      if (!fromThingiverse(p) || p.filesRemoved) continue;
      if (Math.max(p.usedAt || 0, p.lastPrinted || 0, p.created || 0) > limit) continue;
      const dir = this.folder(p);
      let files = [];
      try { files = fs.readdirSync(dir); } catch {}
      for (const f of files) {
        if (!/^(model\.|print\.gcode$|preview\.png$)/.test(f)) continue;
        try { freed += fs.statSync(path.join(dir, f)).size; fs.rmSync(path.join(dir, f), { force: true }); } catch {}
      }
      p.filesRemoved = Date.now();
      changed = true;
      this.log(`Products: removed the Thingiverse files of ${p.name} (unused for ${TV_KEEP_DAYS} days)`);
    }
    if (changed) this.save();
    return freed;
  }
  fileName(p) { return (p.name.replace(/[^\w .()-]+/g, '').trim() || 'print').slice(0, 60) + '_V9D.gcode'; }

  printed(p) { p.printed = (p.printed || 0) + 1; p.lastPrinted = p.usedAt = Date.now(); this.save(); }
}

module.exports = { Products, TV_KEEP_DAYS, fromThingiverse };
