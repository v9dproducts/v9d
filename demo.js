// V9D — demo mode. Open the app with ?demo (…/v9d/?demo) to use realistic sample data instead
// of the V9D monitor: two printers (one printing), files with pictures, power, usage,
// maintenance, hot dates and slicing. Nothing is sent anywhere. ?live switches back.
// Used for design work and screenshots; the real app never loads any of this data.

const Demo = {
  active: (() => {
    const q = new URLSearchParams(location.search);
    try {
      if (q.has('demo')) sessionStorage.setItem('v9d:demo', '1');
      if (q.has('live')) sessionStorage.removeItem('v9d:demo');
      return sessionStorage.getItem('v9d:demo') === '1';
    } catch { return q.has('demo'); }
  })(),
  t0: Date.now(),
  jobs: {},
  nextJob: 1,

  // Live state of the two printers; temperatures drift towards their targets.
  printers: {
    'k2-plus': {
      state: 'printing', file: 'Christmas name bauble_V9D.gcode', thumb: 'benchy.png',
      startedAt: Date.now() - 47 * 60000, totalSec: 2 * 3600 + 10 * 60, pausedAt: null, layers: 212,
      temps: { nozzle: [219.6, 220], bed: [60.2, 60], chamber: [38.4, 40] },
      fans: { part: 0.6, aux: 0.3, chamber: 0.2 }, light: 1, speed: 1,
    },
    'k1-max': {
      state: 'complete', file: 'Skadis pen holder.gcode', thumb: 'stand.png',
      startedAt: Date.now() - 3 * 3600000, totalSec: 3681, pausedAt: null, layers: 140,
      temps: { nozzle: [27.5, 0], bed: [24.1, 0], chamber: [19, null] },
      fans: { part: 0, aux: 0, chamber: 0 }, light: 1, speed: 1,
    },
  },

  img(rel) { return `icons/demo/${String(rel).replace(/^demo\//, '')}`; },

  // ---------- Requests ----------
  async get(path) {
    await this.wait();
    this.tick();
    const u = new URL(path, 'http://x'), p = u.pathname;
    const pm = p.match(/^\/api\/printer\/([\w-]+)(\/\w+)?$/);
    if (pm) {
      if (!this.printers[pm[1]]) throw new Error('Monitor replied 404');
      if (!pm[2]) return this.view(pm[1]);
      if (pm[2] === '/files') return { files: this.files(pm[1]) };
      if (pm[2] === '/cfs') return pm[1] === 'k2-plus' ? this.cfs() : { connected: false, slots: [] };
    }
    const sm = p.match(/^\/api\/slice\/(demo\d+)$/);
    if (sm) { const j = this.jobs[sm[1]]; if (!j) throw new Error('Monitor replied 404'); return { ...j }; }
    switch (p) {
      case '/api/status': return this.status();
      case '/api/power': return this.power();
      case '/api/usage': return this.usage();
      case '/api/maintenance': return this.maintenance();
      case '/api/trends': return this.trends();
      case '/api/slice/options': return this.options(u.searchParams.get('printer'));
      case '/api/push-key': throw new Error('Notifications aren’t available in demo mode');
    }
    throw new Error('Monitor replied 404');
  },

  async post(path, body = {}) {
    await this.wait();
    this.tick();
    const pm = path.match(/^\/api\/printer\/([\w-]+)\/action$/);
    if (pm) return { ok: true, message: this.action(pm[1], body) };
    const sm = path.match(/^\/api\/slice\/(demo\d+)\/(run|send)$/);
    if (sm) {
      const j = this.jobs[sm[1]];
      if (!j) throw new Error('Monitor replied 404');
      if (sm[2] === 'run') return this.slice(j, body);
      if (!j.result) throw new Error('Monitor replied 400');
      if (body.start) this.startPrint(j.settings.printer, j.result.file, j.result.seconds, j.ext === '.3mf' ? 'blocks.png' : 'block.png');
      return { ok: true, message: body.start ? 'Sent — the print is starting' : 'Sent to the printer' };
    }
    if (path === '/api/maintenance/perform') return this.maintenance();
    throw new Error('Monitor replied 404');
  },

  // Upload with a progress callback, like the real XHR upload.
  upload(file, onProgress) {
    return new Promise((resolve) => {
      let f = 0;
      const step = () => {
        f = Math.min(1, f + 0.18);
        onProgress(f);
        if (f < 1) return setTimeout(step, 120);
        const ext = (file.name.match(/\.[^.]+$/) || ['.stl'])[0].toLowerCase();
        const id = `demo${this.nextJob++}`;
        const colours = ext === '.3mf'
          ? [{ colour: '#E5484D', type: 'PLA', used: true }, { colour: '#2B6CB0', type: 'PLA', used: true }]
          : [{ colour: '#FFFFFF', type: '', used: true }];
        this.jobs[id] = { id, name: file.name.replace(/\.[^.]+$/, ''), ext, size: file.size, created: Date.now(), state: 'uploaded', colours, plates: 1 };
        resolve({ ...this.jobs[id] });
      };
      setTimeout(step, 150);
    });
  },

  wait() { return new Promise((r) => setTimeout(r, 120 + Math.random() * 160)); },

  // ---------- Simulation ----------
  tick() {
    const now = Date.now();
    for (const pr of Object.values(this.printers)) {
      for (const t of Object.values(pr.temps)) {
        const target = t[1] || (t === pr.temps.chamber ? 19 : 22);
        t[0] += (target - t[0]) * 0.25 + (Math.random() - 0.5) * (t[1] ? 0.6 : 0.2);
      }
      if (pr.state === 'printing' && this.elapsed(pr, now) >= pr.totalSec) {
        pr.state = 'complete';
        pr.temps.nozzle[1] = 0; pr.temps.bed[1] = 0;
      }
    }
  },
  elapsed(pr, now = Date.now()) { return Math.max(0, ((pr.pausedAt || now) - pr.startedAt) / 1000); },
  progress(pr) { return pr.state === 'idle' ? 0 : pr.state === 'complete' ? 1 : Math.min(0.999, this.elapsed(pr) / pr.totalSec); },

  startPrint(id, file, seconds, thumb) {
    const pr = this.printers[id];
    Object.assign(pr, { state: 'printing', file, thumb, startedAt: Date.now(), totalSec: seconds || 1800, pausedAt: null, layers: 120 });
    pr.temps.nozzle[1] = 220; pr.temps.bed[1] = 60;
    pr.fans.part = 0.6;
  },

  action(id, b) {
    const pr = this.printers[id];
    switch (b.action) {
      case 'pause': pr.state = 'paused'; pr.pausedAt = Date.now(); pr.temps.nozzle[1] = 140; return 'Pausing…';
      case 'resume':
        pr.startedAt += Date.now() - pr.pausedAt; pr.pausedAt = null; pr.state = 'printing'; pr.temps.nozzle[1] = 220;
        return id === 'k2-plus' ? 'Resuming — the nozzle reheats first, this can take a couple of minutes' : 'Resuming…';
      case 'cancel': pr.state = 'cancelled'; pr.pausedAt = Date.now(); pr.temps.nozzle[1] = 0; pr.temps.bed[1] = 0; return 'Stopping print…';
      case 'light': pr.light = b.on ? 1 : 0; return b.on ? 'Light on' : 'Light off';
      case 'fan': pr.fans[b.fan] = b.percent / 100; return `Fan ${b.percent}%`;
      case 'speed': pr.speed = b.percent / 100; return `Speed ${b.percent}%`;
      case 'temp':
        if (b.heater === 'chamber' && id === 'k1-max') throw new Error('Monitor replied 400');
        pr.temps[b.heater][1] = b.target; return b.target ? `Heating to ${b.target} °C` : 'Heater off';
      case 'start': this.startPrint(id, b.file, 2400, 'stand.png'); return 'Starting print…';
    }
    throw new Error('Monitor replied 400');
  },

  // ---------- Responses (same shapes as the monitor) ----------
  view(id) {
    const pr = this.printers[id], k2 = id === 'k2-plus';
    const prog = this.progress(pr), active = pr.state === 'printing' || pr.state === 'paused';
    const hist = [], now = Date.now();
    for (let k = 359; k >= 0; k--) {
      const t = now - k * 2500, w = Math.sin(k / 9) * 0.5;
      const val = (x, base) => (x[1] ? x[1] + w : base + (x[0] - base) * Math.exp(-k / 120));
      hist.push([t, val(pr.temps.nozzle, 22), val(pr.temps.bed, 22), pr.temps.chamber[0] + w * 0.3]);
    }
    const temp = (x) => ({ temp: Math.round(x[0] * 10) / 10, target: x[1], power: x[1] ? 0.35 : 0 });
    return {
      id, name: k2 ? 'K2 Plus' : 'K1 Max', model: k2 ? 'Creality K2 Plus' : 'Creality K1 Max', type: k2 ? 'moonraker' : 'creality',
      power: this.watts(id), todayWh: k2 ? 1840 : 610, state: pr.state, full: true, online: true,
      klippy: k2 ? 'ready' : null, klippyMessage: null,
      ...(k2 ? {} : { caps: { chamberHeater: false, webLabel: 'Printer page' } }),
      job: {
        state: pr.state === 'idle' ? 'standby' : pr.state, file: pr.file, message: null, progress: prog,
        printDuration: Math.round(this.elapsed(pr)), totalDuration: Math.round(this.elapsed(pr)),
        timeLeft: active ? Math.round(pr.totalSec - this.elapsed(pr)) : null,
        filamentUsedMm: Math.round(prog * 9000), layer: Math.max(1, Math.round(prog * pr.layers)), layerCount: pr.layers,
        meta: { thumbnail: `demo/${pr.thumb}`, estimatedTime: pr.totalSec, filamentGrams: 27, layerHeight: 0.2 },
      },
      temps: { nozzle: temp(pr.temps.nozzle), bed: temp(pr.temps.bed), chamber: { ...temp(pr.temps.chamber), target: k2 ? pr.temps.chamber[1] : null } },
      tempHistory: hist,
      fans: { ...pr.fans }, light: pr.light,
      motion: { speed: pr.state === 'printing' ? 180 + Math.round(Math.random() * 90) : 0, speedFactor: pr.speed, flowFactor: 1, z: Math.round(prog * 42 * 100) / 100, homed: 'xyz' },
    };
  },

  files(id) {
    const day = 864e5, k2 = id === 'k2-plus';
    const list = k2
      ? [['Christmas name bauble_V9D.gcode', 'benchy.png', 7800, 27], ['Two colour coasters_V9D.gcode', 'blocks.png', 3880, 8.2],
        ['Podstavec stare BMW.gcode', 'stand.png', 1977, 18.2], ['Cable tidy block.gcode', 'block.png', 712, 7.9],
        ['Speed boat.gcode', 'benchy.png', 1915, 10.9]]
      : [['Skadis pen holder.gcode', 'stand.png', 3681, 19.3], ['Bottle holder.gcode', 'block.png', 7161, 89.6],
        ['Large tape holder.gcode', 'stand.png', 5640, 34], ['Benchy.gcode', 'benchy.png', 2700, 12.5]];
    return list.map(([path, img, t, g], i) => ({ path, modified: Date.now() - (i * 1.6 + 0.3) * day, size: 400000 + i * 90000, meta: { estimatedTime: t, filamentGrams: g, thumbnail: `demo/${img}` } }));
  },

  cfs() {
    return { connected: true, slots: [
      { slot: 'A', empty: false, material: 'PLA', colour: '#FFFFFF' },
      { slot: 'B', empty: false, material: 'PLA', colour: '#1C1C1C' },
      { slot: 'C', empty: false, material: 'PLA', colour: '#E5484D' },
      { slot: 'D', empty: true, material: null, colour: null },
    ] };
  },

  status() {
    const out = {};
    for (const [id, pr] of Object.entries(this.printers)) {
      out[id] = { state: pr.state, message: '', file: pr.file.replace(/_V9D\.gcode$|\.gcode$/, ''), progress: Math.round(this.progress(pr) * 100),
        printTime: Math.round(this.elapsed(pr)), timeLeft: pr.state === 'printing' ? Math.round(pr.totalSec - this.elapsed(pr)) : 0 };
    }
    return { printers: out };
  },

  watts(id) {
    const pr = this.printers[id];
    if (pr.state === 'printing') return (id === 'k2-plus' ? 205 : 228) + Math.round(Math.random() * 40);
    return id === 'k2-plus' ? 21 : 14;
  },

  power() {
    const out = {}, now = Date.now();
    for (const [id, pr] of Object.entries(this.printers)) {
      const w = this.watts(id), printing = pr.state === 'printing';
      const samples = [];
      for (let k = 179; k >= 0; k--) samples.push([now - k * 5000, Math.round(printing ? w + Math.sin(k / 5) * 35 + (k % 7 === 0 ? 120 : 0) : w + Math.sin(k / 8))]);
      const bed = printing ? Math.round(w * 0.55) : 0, hot = printing ? Math.round(w * 0.18) : 0;
      out[id] = {
        name: id === 'k2-plus' ? 'K2 Plus' : 'K1 Max', state: pr.state, watts: w,
        parts: { bed, hotend: hot, chamber: id === 'k2-plus' && printing ? 18 : 0, fans: printing ? 9 : 2, motion: printing ? 14 : 0, electronics: id === 'k2-plus' ? 18 : 12 },
        inputs: { bed: { temp: pr.temps.bed[0], target: pr.temps.bed[1] }, hotend: { temp: pr.temps.nozzle[0], target: pr.temps.nozzle[1] }, ...(id === 'k2-plus' ? { chamber: { temp: pr.temps.chamber[0], target: pr.temps.chamber[1] } } : {}), method: id === 'k2-plus' ? 'heater duty' : 'from temperatures' },
        todayWh: id === 'k2-plus' ? 1840 : 610, sessionWh: printing ? 172 : 0, samples,
      };
    }
    return { printers: out, time: now };
  },

  usage() {
    if (this._usage) return this._usage;
    const names = ['Christmas name bauble', 'Skadis pen holder', 'Bottle holder', 'Cable tidy', 'Large tape holder', 'Two colour coasters', 'Phone stand', 'Keyring set', 'Articulated dragon', 'Plant pot'];
    const jobs = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let d = 34; d >= 1; d--) {
      const n = rnd() < 0.3 ? 0 : rnd() < 0.6 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const printer = rnd() < 0.55 ? 'k2-plus' : 'k1-max';
        const printSec = Math.round(1500 + rnd() * 14000), grams = Math.round((printSec / 3600) * (14 + rnd() * 12) * 10) / 10;
        const start = Date.now() - d * 864e5 + (9 + k * 6 + rnd() * 3) * 3600000;
        jobs.push({ printer, file: `${names[Math.floor(rnd() * names.length)]}.gcode`, start, end: start + printSec * 1000, printSec, totalSec: printSec,
          grams, energyWh: Math.round((printSec / 3600) * (printer === 'k2-plus' ? 215 : 235) + 30), energySource: 'measured',
          material: rnd() < 0.85 ? 'PLA' : 'PETG', status: rnd() < 0.9 ? 'complete' : 'cancelled' });
      }
    }
    jobs.sort((a, b) => b.start - a.start);
    this._usage = { jobs, days: [], since: jobs[jobs.length - 1].start, printers: {
      'k2-plus': { name: 'K2 Plus', typicalPrintW: 215, standbyW: 20.5 },
      'k1-max': { name: 'K1 Max', typicalPrintW: 235, standbyW: 13.6 },
    } };
    return this._usage;
  },

  maintenance() {
    const ago = (d) => Date.now() - d * 864e5;
    const item = (id, name, unit, limit, used, opts = {}) => {
      const pct = Math.min(100, Math.round((used / limit) * 100));
      return { id, name, unit, limit, kind: opts.kind || 'service', interval: { [unit === 'days' ? 'days' : unit]: limit },
        used: { hours: unit === 'hours' ? used : used * 3, kg: unit === 'kg' ? used : used / 60, days: unit === 'days' ? used : 20 },
        left: limit - used, percent: pct, status: pct >= 100 ? 'due' : pct >= 85 ? 'soon' : 'ok', logged: opts.logged !== false,
        since: ago(opts.since || 40), source: opts.source || 'creality', url: '', how: opts.how || 'Follow the step-by-step guide.' };
    };
    return {
      printers: {
        'k2-plus': { name: 'K2 Plus', items: [
          item('rails', 'Clean & lubricate rails', 'days', 7, 8, { since: 8 }),
          item('nozzle', 'Nozzle', 'hours', 500, 431, { kind: 'replace', since: 70 }),
          item('filter', 'Air filter', 'hours', 300, 120, { kind: 'replace' }),
          item('cutter', 'Filament cutter', 'kg', 5, 2.1, { kind: 'replace' }),
          item('lube', 'Lubricate lead screws', 'hours', 300, 96),
          item('plate', 'Build plate', 'hours', 1500, 640, { kind: 'replace', source: 'typical' }),
        ] },
        'k1-max': { name: 'K1 Max', items: [
          item('belts', 'Check belt tension', 'hours', 500, 280, { source: 'typical' }),
          item('nozzle', 'Nozzle', 'hours', 500, 150, { kind: 'replace' }),
          item('lube', 'Lubricate rods', 'hours', 500, 470),
          item('fans', 'Clean fans', 'days', 30, 12, { source: 'typical' }),
        ] },
      },
      history: [
        { printer: 'k2-plus', items: ['rails'], date: ago(8), note: 'Wiped and re-greased' },
        { printer: 'k1-max', items: ['nozzle'], date: ago(31), note: '' },
      ],
    };
  },

  async trends() {
    const research = await fetch('trends-snapshot.json').then((r) => r.json()).catch(() => null);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = (d) => d.toISOString().slice(0, 10);
    const y = today.getFullYear();
    const ev = [
      [`${y}-10-31`, 'Halloween', 'seasonal', 28, 'Spooky decor, pumpkin lanterns'],
      [`${y}-11-05`, 'Bonfire Night', 'seasonal', 21, 'Party and garden decor'],
      [`${y}-11-27`, 'Black Friday', 'shopping', 21, 'Bundle best sellers'],
      [`${y}-12-25`, 'Christmas Day', 'gifting', 56, 'Personalised ornaments and gifts'],
      [`${y + 1}-02-06`, 'Lunar New Year', 'cultural', 28, 'Year of the Goat decor'],
      [`${y + 1}-02-14`, 'Valentine’s Day', 'gifting', 28, 'Personalised gifts for couples'],
      [`${y + 1}-03-07`, 'Mother’s Day (UK)', 'gifting', 28, 'Planters, jewellery holders'],
    ];
    const hotDates = ev.map(([date, name, kind, lead, hint]) => {
      const d = new Date(date), lb = new Date(d - lead * 864e5);
      return { date, name, kind, hint, listBy: iso(lb), daysAway: Math.round((d - today) / 864e5) };
    }).filter((e) => e.daysAway >= 0);
    return { research: research && { ...research, snapshot: false }, hotDates, hasKey: true, running: false, updatedAt: Date.now() - 3 * 3600000, cost: { usd: 0.38 } };
  },

  options(printer) {
    const quality = [{ id: 'draft', label: 'Draft · 0.24 mm' }, { id: 'standard', label: 'Standard · 0.20 mm' }, { id: 'fine', label: 'Fine · 0.16 mm' }, { id: 'extrafine', label: 'Extra fine · 0.12 mm' }];
    if (printer === 'k2-plus') return { available: true, cfs: true, quality, materials: ['PLA', 'PLA Matte', 'PLA Silk', 'PETG', 'ABS', 'TPU'] };
    if (printer === 'k1-max') return { available: true, cfs: false, quality, materials: ['PLA', 'PLA High Speed', 'PLA Matte', 'PLA Silk', 'PETG', 'ABS', 'ASA', 'TPU'] };
    throw new Error('Monitor replied 404');
  },

  slice(j, s) {
    j.state = 'slicing'; j.started = Date.now(); j.settings = s; j.result = null;
    setTimeout(() => {
      const lh = { draft: 0.24, standard: 0.2, fine: 0.16, extrafine: 0.12 }[s.quality] || 0.2;
      const grams = Math.round((j.ext === '.3mf' ? 8.2 : 12) * (0.8 + s.infill / 60) * 10) / 10;
      const seconds = Math.round((j.ext === '.3mf' ? 3881 : 1915) * (0.2 / lh) * (0.85 + s.infill / 100));
      const cols = s.colours.filter((c, i) => j.colours[i]?.used);
      j.result = {
        file: `${j.name}_V9D.gcode`, preview: true, seconds, layers: Math.round(16 / lh), grams,
        perColour: cols.map((c, i) => ({ slot: s.printer === 'k2-plus' ? c.slot : null, material: c.material, colour: c.colour, grams: Math.round((grams / cols.length) * (i ? 1.2 : 0.8) * 10) / 10 })),
      };
      j.state = 'sliced';
    }, 2600);
    return { ...j };
  },

  preview(id) { return this.img(this.jobs[id]?.ext === '.3mf' ? 'blocks.png' : 'block.png'); },
};
