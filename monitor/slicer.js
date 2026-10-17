// Slicing on this PC with OrcaSlicer: upload an STL/3MF from the phone, slice it with V9D's
// choices (quality, infill, supports, which CFS slot each colour comes from), then send the
// G-code to the printer. Profiles come from OrcaSlicer's own Creality system profiles; we merge
// each profile's "inherits" chain ourselves, because the command line can't resolve it for
// profiles outside its install folder.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ORCA = process.env.ORCA_EXE || 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe';
const PROFILES = path.join(path.dirname(ORCA), 'resources', 'profiles', 'Creality');
const MAX_UPLOAD = 200 * 1024 * 1024;
const KEEP_DAYS = 7;
const SLOTS = ['A', 'B', 'C', 'D'];

// What V9D offers, per printer. Only the K2 Plus (Moonraker upload + CFS) for now.
const PRINTERS = {
  'k2-plus': {
    machine: 'Creality K2 Plus 0.4 nozzle',
    quality: {
      draft: { label: 'Draft · 0.24 mm', process: '0.24mm Draft @Creality K2 Plus 0.4 nozzle' },
      standard: { label: 'Standard · 0.20 mm', process: '0.20mm Standard @Creality K2 Plus 0.4 nozzle' },
      fine: { label: 'Fine · 0.16 mm', process: '0.16mm Optimal @Creality K2 Plus 0.4 nozzle' },
      extrafine: { label: 'Extra fine · 0.12 mm', process: '0.12mm Detail @Creality K2 Plus 0.4 nozzle' },
    },
    materials: {
      PLA: 'CR-PLA @K2 Plus-all',
      'PLA Matte': 'CR-PLA Matte @K2 Plus-all',
      'PLA Silk': 'CR-Silk @K2 Plus-all',
      PETG: 'CR-PETG @K2 Plus-all',
      ABS: 'CR-ABS @K2 Plus-all',
      TPU: 'CR-TPU @K2 Plus-all',
    },
  },
};

// ---------- OrcaSlicer profiles ----------
let index = null; // profile name -> file
function profileIndex() {
  if (index) return index;
  index = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.json')) {
        try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.name) index.set(j.name, f); } catch {}
      }
    }
  };
  for (const kind of ['machine', 'process', 'filament']) walk(path.join(PROFILES, kind));
  return index;
}
function flatten(name, depth = 0) {
  const file = profileIndex().get(name);
  if (!file || depth > 10) throw new Error(`OrcaSlicer profile not found: ${name}`);
  const own = JSON.parse(fs.readFileSync(file, 'utf8'));
  const merged = own.inherits ? { ...flatten(own.inherits, depth + 1), ...own } : own;
  delete merged.inherits;
  return merged;
}
function writeProfile(file, base, overrides) {
  const j = { ...flatten(base), ...overrides, from: 'User' };
  delete j.instantiation;
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return j;
}

// ---------- 3MF (zip) reading ----------
function unzip(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a valid 3MF file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (wanted(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      out[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Colours and plates in a 3MF. MakerWorld/Bambu/Orca projects list their filaments in
// project_settings.config; objects pick one by number, painted models use several.
function inspect3mf(file) {
  const files = unzip(fs.readFileSync(file), (n) => /^Metadata\/(project_settings|model_settings)\.config$/.test(n) || /^3D\/.*\.model$/.test(n));
  let colours = [];
  try {
    const ps = JSON.parse(files['Metadata/project_settings.config'].toString('utf8'));
    colours = (ps.filament_colour || []).map((c, i) => ({ colour: c, type: ps.filament_type?.[i] || '' }));
  } catch {}
  const ms = files['Metadata/model_settings.config']?.toString('utf8') || '';
  const plates = Math.max(1, (ms.match(/<plate>/g) || []).length);
  const painted = Object.entries(files).some(([n, b]) => n.endsWith('.model') && b.includes('paint_color'));
  const used = new Set([...ms.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => Number(m[1]) - 1));
  if (!colours.length) colours = [{ colour: '#FFFFFF', type: '' }];
  colours = colours.map((c, i) => ({ ...c, used: painted || used.has(i) || (i === 0 && used.size === 0) }));
  return { colours, plates };
}

// ---------- Jobs ----------
class Slicer {
  constructor(dataDir, log) {
    this.dir = path.join(dataDir, 'slicer');
    this.log = log;
    this.jobs = new Map();
    this.queue = Promise.resolve();
    fs.mkdirSync(this.dir, { recursive: true });
    for (const id of fs.readdirSync(this.dir)) {
      try { this.jobs.set(id, JSON.parse(fs.readFileSync(path.join(this.dir, id, 'job.json'), 'utf8'))); } catch {}
    }
    this.cleanup();
    setInterval(() => this.cleanup(), 24 * 3600 * 1000);
  }

  available() { return fs.existsSync(ORCA); }

  options(printerId) {
    const p = PRINTERS[printerId];
    if (!p) return null;
    return {
      quality: Object.entries(p.quality).map(([id, q]) => ({ id, label: q.label })),
      materials: Object.keys(p.materials),
    };
  }

  save(job) {
    fs.writeFileSync(path.join(this.dir, job.id, 'job.json'), JSON.stringify(job, null, 2));
    this.jobs.set(job.id, job);
  }
  get(id) { return this.jobs.get(id) || null; }
  public(job) { return { ...job, result: job.result && { ...job.result, gcode: undefined } }; }

  // Streams an upload to disk. name = original file name (.stl or .3mf).
  upload(req, name) {
    return new Promise((resolve, reject) => {
      const ext = path.extname(name || '').toLowerCase();
      if (!['.stl', '.3mf'].includes(ext)) return reject(new Error('Only STL and 3MF files'));
      const id = crypto.randomBytes(6).toString('hex');
      const dir = path.join(this.dir, id);
      fs.mkdirSync(dir, { recursive: true });
      const model = path.join(dir, 'model' + ext);
      const out = fs.createWriteStream(model);
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rmSync(dir, { recursive: true, force: true }); reject(new Error('File is larger than 200 MB')); }
      });
      req.pipe(out);
      out.on('finish', () => {
        try {
          const info = ext === '.3mf' ? inspect3mf(model) : { colours: [{ colour: '#FFFFFF', type: '', used: true }], plates: 1 };
          const job = { id, name: path.basename(name, ext), ext, size, created: Date.now(), state: 'uploaded', ...info };
          this.save(job);
          this.log(`Slicer: received ${name} (${Math.round(size / 1024)} KB)`);
          resolve(job);
        } catch (err) { fs.rmSync(dir, { recursive: true, force: true }); reject(err); }
      });
      out.on('error', reject);
    });
  }

  // settings: { printer, quality, infill, supports, orient, plate, colours: [{ slot, material, colour }] }
  run(job, settings) {
    const p = PRINTERS[settings.printer];
    if (!p) throw new Error('This printer can’t slice from V9D yet');
    const quality = p.quality[settings.quality];
    if (!quality) throw new Error('Unknown quality');
    const infill = Math.round(Number(settings.infill));
    if (!(infill >= 0 && infill <= 100)) throw new Error('Infill must be 0–100%');
    const plate = Math.round(Number(settings.plate) || 1);
    if (plate < 1 || plate > job.plates) throw new Error('No such plate');
    const colours = job.colours.map((c, i) => settings.colours?.[i] || { slot: 'A', material: 'PLA', colour: c.colour });
    for (const c of colours) {
      if (!SLOTS.includes(c.slot)) throw new Error('Unknown CFS slot');
      if (!p.materials[c.material]) throw new Error(`Unknown material ${c.material}`);
    }
    if (job.state === 'slicing') throw new Error('Already slicing');
    job.state = 'queued';
    job.settings = { ...settings, infill, plate, colours };
    job.error = null; job.result = null;
    this.save(job);
    this.queue = this.queue.then(() => this.slice(job, p, quality)).catch(() => {});
    return job;
  }

  async slice(job, p, quality) {
    const dir = path.join(this.dir, job.id);
    const outDir = path.join(dir, 'out');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    job.state = 'slicing'; job.started = Date.now(); this.save(job);
    const s = job.settings;
    try {
      const machine = path.join(dir, 'machine.json');
      const proc = path.join(dir, 'process.json');
      writeProfile(machine, p.machine, { name: 'V9D machine' });
      writeProfile(proc, quality.process, {
        name: 'V9D process', compatible_printers: [], compatible_printers_condition: '',
        sparse_infill_density: `${s.infill}%`,
        enable_support: s.supports ? '1' : '0', support_type: 'tree(auto)',
      });
      // One filament per model colour (keeps the model's colour numbers); each uses its slot's material.
      const densities = [];
      const filaments = s.colours.map((c, i) => {
        const f = path.join(dir, `filament${i + 1}.json`);
        const j = writeProfile(f, p.materials[c.material], {
          name: `V9D ${c.material} ${i + 1}`, compatible_printers: [], compatible_printers_condition: '',
          filament_colour: [c.colour || '#FFFFFF'],
        });
        densities.push(Number([].concat(j.filament_density)[0]) || 1.24);
        return f;
      });
      const isStl = job.ext === '.stl';
      const args = ['--load-settings', `${machine};${proc}`, '--load-filaments', filaments.join(';'),
        '--slice', String(isStl ? 0 : s.plate), '--outputdir', outDir];
      if (isStl || s.orient) args.push('--arrange', '1');
      if (s.orient) args.push('--orient', '1');
      args.push(path.join(dir, 'model' + job.ext));
      const code = await runOrca(args, path.join(dir, 'orca.log'));
      const produced = fs.readdirSync(outDir).filter((f) => f.endsWith('.gcode'));
      if (!produced.length) throw new Error(`OrcaSlicer couldn’t slice this file (code ${code})`);
      const gcodeFile = path.join(outDir, produced.find((f) => f === `plate_${s.plate}.gcode`) || produced[0]);
      job.result = this.finish(job, gcodeFile, densities);
      job.state = 'sliced';
      this.log(`Slicer: ${job.name} sliced in ${Math.round((Date.now() - job.started) / 1000)} s`);
    } catch (err) {
      job.state = 'failed'; job.error = err.message;
      this.log(`Slicer: ${job.name} failed (${err.message})`);
    }
    this.save(job);
  }

  // Maps the model's colour numbers onto CFS slots (T0..T3 = slots A..D) and reads the summary.
  finish(job, gcodeFile, densities) {
    const slotOf = job.settings.colours.map((c) => SLOTS.indexOf(c.slot));
    const lines = fs.readFileSync(gcodeFile, 'utf8').split('\n');
    const header = {};
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].match(/^T(\d+)(\s.*)?$/);
      if (t && slotOf[t[1]] !== undefined) lines[i] = `T${slotOf[t[1]]}${t[2] || ''}`;
      const h = lines[i].match(/^; (estimated printing time \(normal mode\)|filament used \[mm\]|total layer number|total layers count) ?[=:] ?(.*)$/);
      if (h) header[h[1]] = h[2].trim();
    }
    const name = (job.name.replace(/[^\w .()-]+/g, '').trim() || 'print').slice(0, 60) + '_V9D.gcode';
    const out = path.join(path.dirname(gcodeFile), name);
    fs.writeFileSync(out, lines.join('\n'));
    const mm = (header['filament used [mm]'] || '').split(',').map(Number);
    const area = Math.PI * 0.875 * 0.875; // 1.75 mm filament, mm²
    const perColour = job.settings.colours.map((c, i) => ({
      slot: c.slot, material: c.material, colour: c.colour,
      grams: Math.round(((mm[i] || 0) * area / 1000) * densities[i] * 10) / 10,
    })).filter((x) => x.grams > 0);
    return {
      file: name, gcode: out,
      seconds: parseDuration(header['estimated printing time (normal mode)']),
      layers: Number(header['total layer number'] || header['total layers count']) || null,
      grams: Math.round(perColour.reduce((a, x) => a + x.grams, 0) * 10) / 10,
      perColour,
    };
  }

  cleanup() {
    for (const [id, job] of this.jobs) {
      if (Date.now() - job.created > KEEP_DAYS * 864e5) {
        fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
        this.jobs.delete(id);
      }
    }
  }
}

function runOrca(args, logFile) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(logFile, 'w');
    const child = spawn(ORCA, args, { windowsHide: true, stdio: ['ignore', log, log] });
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.on('error', (err) => { clearTimeout(timer); fs.closeSync(log); reject(err); });
    child.on('exit', (code) => { clearTimeout(timer); fs.closeSync(log); resolve(code); });
  });
}

function parseDuration(s) {
  if (!s) return null;
  let t = 0;
  for (const [, n, u] of s.matchAll(/(\d+)\s*([dhms])/g)) t += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[u];
  return t || null;
}

module.exports = { Slicer, SLOTS };
