// V9D — Print a file: upload an STL/3MF, choose settings, slice it on the home PC with
// OrcaSlicer, then send it to the printer. Colours from a multi-colour 3MF are mapped onto
// the CFS slots (A–D). V9D's choices always replace the file's own print settings.

const PrintPage = {
  printer: 'k2-plus',
  job: null,       // upload/slice job from the monitor
  opts: null,      // qualities and materials the monitor offers
  cfs: null,       // what's loaded in the CFS
  poll: null,

  async render() {
    setHeader('Print a file', { back: true, backTo: '#/printers' });
    clearTimeout(this.poll);
    $('#view').innerHTML = '<p class="banner">Loading…</p>';
    const id = store.get('printJob', null);
    const [opts, cfs, job] = await Promise.all([
      Monitor.get(`/api/slice/options?printer=${this.printer}`).catch(() => null),
      Monitor.get(`/api/printer/${this.printer}/cfs`).catch(() => null),
      id ? Monitor.get(`/api/slice/${id}`).catch(() => null) : null,
    ]);
    if (currentRoute() !== 'printers/print') return;
    if (!opts) {
      $('#view').innerHTML = '<p class="banner warn">Can’t reach the V9D monitor, so files can’t be sliced right now. Check Tailscale is on.</p>';
      return;
    }
    if (!opts.available) {
      $('#view').innerHTML = '<p class="banner warn">OrcaSlicer isn’t installed on the home PC.</p>';
      return;
    }
    this.opts = opts;
    this.cfs = cfs;
    this.job = job;
    if (!job) store.set('printJob', null);
    this.draw();
    if (job && ['queued', 'slicing'].includes(job.state)) this.watch();
  },

  draw() {
    const v = $('#view');
    if (!this.job) {
      v.innerHTML = `
        <label class="pick">
          <input type="file" id="pickFile" hidden>
          <span class="pick-icon">${icon('upload', 34)}</span>
          <b>Choose an STL or 3MF file</b>
          <span class="muted">From Files, iCloud or your MakerWorld downloads · up to 200 MB</span>
        </label>
        <div id="upProgress"></div>
        <p class="hint">The home PC slices it with OrcaSlicer using the settings you choose here — a 3MF’s own print settings are replaced. Multi-colour 3MF files keep their colours; you pick which CFS slot each one prints from.</p>`;
      $('#pickFile').onchange = (e) => e.target.files[0] && this.upload(e.target.files[0]);
      return;
    }
    const j = this.job;
    const busy = ['queued', 'slicing'].includes(j.state);
    v.innerHTML = `
      <div class="panel print-file">
        <span class="hub-icon">${icon('printer', 24)}</span>
        <span class="w-col"><b>${esc(j.name)}</b><span class="muted">${j.ext.slice(1).toUpperCase()} · ${j.size < 1048576 ? `${Math.max(1, Math.round(j.size / 1024))} KB` : `${(j.size / 1048576).toFixed(1)} MB`}${j.plates > 1 ? ` · ${j.plates} plates` : ''} · for the K2 Plus</span></span>
        <button class="chip" id="newFile">Change</button>
      </div>
      ${this.settingsHtml(j)}
      <div id="result">${this.resultHtml(j)}</div>`;
    $('#newFile').onclick = () => { store.set('printJob', null); this.job = null; this.draw(); };
    this.bindSettings();
    this.bindResult();
    if (busy) v.querySelectorAll('.print-settings button, .print-settings input, .print-settings select').forEach((el) => { el.disabled = true; });
  },

  // ---------- Settings ----------
  defaults() {
    const j = this.job;
    const saved = store.get('printSettings', {});
    const s = j.settings || {};
    return {
      quality: s.quality || saved.quality || 'standard',
      infill: s.infill ?? saved.infill ?? 15,
      supports: s.supports ?? saved.supports ?? false,
      orient: s.orient ?? (j.ext === '.stl'),
      plate: s.plate || 1,
      colours: j.colours.map((c, i) => s.colours?.[i] || this.guessSlot(c)),
    };
  },

  loaded() { return (this.cfs?.slots || []).filter((x) => !x.empty); },
  // Closest loaded slot by colour, so a white model lands on the white filament.
  guessSlot(c) {
    const slots = this.loaded();
    if (!slots.length) return { slot: 'A', material: 'PLA', colour: c.colour };
    const rgb = (h) => [1, 3, 5].map((k) => parseInt(String(h || '#FFFFFF').slice(k, k + 2), 16) || 0);
    const dist = (a, b) => rgb(a).reduce((t, x, k) => t + (x - rgb(b)[k]) ** 2, 0);
    const best = slots.slice().sort((a, b) => dist(c.colour, a.colour) - dist(c.colour, b.colour))[0];
    return { slot: best.slot, material: this.materialFor(best.material), colour: best.colour || c.colour };
  },
  materialFor(m) {
    const list = this.opts.materials;
    if (!m) return 'PLA';
    const up = m.toUpperCase();
    return list.find((x) => x.toUpperCase() === up) || list.find((x) => up.startsWith(x.toUpperCase())) || 'PLA';
  },

  settingsHtml(j) {
    const s = this.defaults();
    this.settings = s;
    const slotInfo = (slot) => this.cfs?.slots?.find((x) => x.slot === slot);
    const used = j.colours.map((c, i) => ({ ...c, i })).filter((c) => c.used);
    return `
      <div class="print-settings">
        <h3 class="day">Quality</h3>
        <div class="seg q4">${this.opts.quality.map((q) => `<button data-q="${q.id}" class="${s.quality === q.id ? 'on' : ''}">${esc(q.label.split(' · ')[0])}<small>${esc(q.label.split(' · ')[1] || '')}</small></button>`).join('')}</div>

        <h3 class="day">Infill <span id="infillVal">${s.infill}%</span></h3>
        <div class="panel">
          <input type="range" id="infill" min="0" max="100" step="5" value="${s.infill}" class="slider">
          <div class="chips">${[10, 15, 25, 40, 100].map((x) => `<button class="chip ${s.infill === x ? 'on' : ''}" data-infill="${x}">${x}%</button>`).join('')}</div>
        </div>

        <div class="panel toggles">
          <label class="check"><input type="checkbox" id="supports" ${s.supports ? 'checked' : ''}><span>Supports <small class="muted">tree supports where needed</small></span></label>
          <label class="check"><input type="checkbox" id="orient" ${s.orient ? 'checked' : ''}><span>Auto-orient <small class="muted">turn the model to print best</small></span></label>
          ${j.plates > 1 ? `<label class="field plate-field"><span>Plate to print (this file has ${j.plates})</span>
            <select id="plate">${Array.from({ length: j.plates }, (_, k) => `<option value="${k + 1}" ${s.plate === k + 1 ? 'selected' : ''}>Plate ${k + 1}</option>`).join('')}</select></label>` : ''}
        </div>

        <h3 class="day">${used.length > 1 ? `Colours → CFS slots` : 'Filament'}</h3>
        ${this.cfs ? '' : '<p class="banner">Couldn’t read the CFS — choose slots yourself.</p>'}
        <div class="panel">
          ${used.map((c) => {
            const pick = s.colours[c.i];
            const info = slotInfo(pick.slot);
            return `
            <div class="colour-row" data-colour="${c.i}">
              ${used.length > 1 ? `<span class="swatch" style="background:${esc(c.colour)}" title="Colour in the file"></span><span class="arrow">→</span>` : ''}
              <div class="slot-pick">${['A', 'B', 'C', 'D'].map((x) => {
                const si = slotInfo(x);
                return `<button data-slot="${x}" class="${pick.slot === x ? 'on' : ''} ${si?.empty ? 'empty' : ''}">
                  <span class="swatch sm" style="background:${esc(si?.colour || 'transparent')}"></span>${x}</button>`;
              }).join('')}</div>
              <select class="mat">${this.opts.materials.map((m) => `<option ${pick.material === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
              ${info?.empty ? '<p class="slot-warn">Slot ' + pick.slot + ' is empty — load it before printing.</p>' : ''}
            </div>`;
          }).join('')}
        </div>
        <button class="btn primary block" id="doSlice">${j.state === 'sliced' ? 'Slice again' : 'Slice'}</button>
      </div>`;
  },

  bindSettings() {
    const s = this.settings, v = $('#view');
    const stale = () => {
      if (this.job.state === 'sliced') { $('#result').innerHTML = '<p class="banner">Settings changed — slice again to update the time and cost.</p>'; this.job.state = 'changed'; $('#doSlice').textContent = 'Slice again'; }
    };
    v.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
      s.quality = b.dataset.q; v.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b)); stale();
    });
    const setInfill = (x) => {
      s.infill = x; $('#infill').value = x; $('#infillVal').textContent = `${x}%`;
      v.querySelectorAll('[data-infill]').forEach((c) => c.classList.toggle('on', +c.dataset.infill === x)); stale();
    };
    $('#infill').oninput = (e) => setInfill(+e.target.value);
    v.querySelectorAll('[data-infill]').forEach((c) => c.onclick = () => setInfill(+c.dataset.infill));
    $('#supports').onchange = (e) => { s.supports = e.target.checked; stale(); };
    $('#orient').onchange = (e) => { s.orient = e.target.checked; stale(); };
    if ($('#plate')) $('#plate').onchange = (e) => { s.plate = +e.target.value; stale(); };
    v.querySelectorAll('.colour-row').forEach((row) => {
      const i = +row.dataset.colour;
      row.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => {
        const info = this.cfs?.slots?.find((x) => x.slot === b.dataset.slot);
        s.colours[i] = { slot: b.dataset.slot, material: info?.material ? this.materialFor(info.material) : s.colours[i].material, colour: info?.colour || this.job.colours[i].colour };
        this.job.settings = { ...s };
        const keep = this.job.state; this.draw(); if (keep === 'sliced') stale();
      });
      row.querySelector('.mat').onchange = (e) => { s.colours[i].material = e.target.value; stale(); };
    });
    $('#doSlice').onclick = () => this.slice();
  },

  async slice() {
    const s = { ...this.settings, printer: this.printer };
    store.set('printSettings', { quality: s.quality, infill: s.infill, supports: s.supports });
    $('#doSlice').disabled = true;
    try {
      this.job = await Monitor.post(`/api/slice/${this.job.id}/run`, s);
    } catch (e) {
      $('#doSlice').disabled = false;
      return toast(`Couldn’t start slicing: ${e.message}`, true);
    }
    this.draw();
    this.watch();
  },

  watch() {
    clearTimeout(this.poll);
    this.poll = setTimeout(async () => {
      if (currentRoute() !== 'printers/print' || !this.job) return;
      const j = await Monitor.get(`/api/slice/${this.job.id}`).catch(() => null);
      if (!j) return this.watch();
      const was = this.job.state;
      this.job = j;
      if (['queued', 'slicing'].includes(j.state)) { $('#result').innerHTML = this.resultHtml(j); return this.watch(); }
      if (was !== j.state) this.draw();
    }, 2000);
  },

  // ---------- Result ----------
  resultHtml(j) {
    if (j.state === 'queued') return '<div class="panel slicing"><span class="spinner"></span><b>Waiting for the slicer…</b></div>';
    if (j.state === 'slicing') {
      const secs = Math.round((Date.now() - (j.started || Date.now())) / 1000);
      return `<div class="panel slicing"><span class="spinner"></span><span class="w-col"><b>Slicing on the home PC…</b><span class="muted">${secs}s — big or multi-colour models can take a few minutes</span></span></div>`;
    }
    if (j.state === 'failed') return `<p class="banner warn">Slicing failed: ${esc(j.error || 'unknown error')}. Try other settings, or check the file opens in OrcaSlicer.</p>`;
    if (j.state !== 'sliced' || !j.result) return '';
    const r = j.result, p = Prices.get();
    const material = Prices.material(r.grams, p);
    const energy = Prices.energy((r.seconds || 0) / 3600 * 215 + 30, p); // K2 Plus typical draw + heat-up
    return `
      <h3 class="day">Ready to print</h3>
      <div class="panel result">
        <div class="result-top">
          <div><span class="w-big">${r.seconds ? fmt.hours(r.seconds) : '—'}</span><span class="muted">done about ${r.seconds ? finishTime(r.seconds) : '—'} if started now</span></div>
          <div class="result-cost"><span class="w-big">${fmt.money(material + energy)}</span><span class="muted">${fmt.money(material)} filament · ${fmt.money(energy)} power</span></div>
        </div>
        <div class="detail-grid">
          ${r.perColour.map((c) => `<span><span class="swatch sm" style="background:${esc(c.colour)}"></span> Slot ${c.slot} · ${esc(c.material)}</span><b>${c.grams} g</b>`).join('')}
          ${r.layers ? `<span>Layers</span><b>${r.layers}</b>` : ''}
        </div>
      </div>
      <div class="ctrl-row">
        <button class="btn" id="sendOnly">Send to printer</button>
        <button class="btn primary" id="printNow">Print now</button>
      </div>
      <p class="hint">“Send to printer” puts it in the printer’s files so you can start it later from the printer or V9D.</p>`;
  },

  bindResult() {
    if ($('#sendOnly')) $('#sendOnly').onclick = () => this.send(false);
    if ($('#printNow')) $('#printNow').onclick = () => {
      const r = this.job.result;
      const empty = r.perColour.filter((c) => this.cfs?.slots?.find((x) => x.slot === c.slot)?.empty);
      openSheet(`
        <h2>Print ${esc(this.job.name)}?</h2>
        <p class="note">About ${fmt.hours(r.seconds || 0)} · ${r.grams} g · slots ${[...new Set(r.perColour.map((c) => c.slot))].join(', ')}</p>
        ${empty.length ? `<p class="help-warn">Slot ${empty.map((c) => c.slot).join(', ')} looks empty. Load it first or the print will stop for filament.</p>` : ''}
        <label class="check"><input type="checkbox" id="plateClear"><span>The build plate is clear and the right filament is loaded</span></label>
        <p class="note">Starting a print onto a part that’s still on the plate can crash the nozzle into it.</p>
        <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="doStart" disabled>Start print</button></div>`);
      $('#cancelSheet').onclick = closeSheet;
      $('#plateClear').onchange = (e) => { $('#doStart').disabled = !e.target.checked; };
      $('#doStart').onclick = async () => { $('#doStart').disabled = true; if (await this.send(true)) { closeSheet(); location.hash = '#/printers'; } else $('#doStart').disabled = false; };
    };
  },

  async send(start) {
    const btns = ['#sendOnly', '#printNow'].map((s) => $(s)).filter(Boolean);
    btns.forEach((b) => { b.disabled = true; });
    try {
      // Large files can take a while to reach the printer.
      const res = await fetch(`${Monitor.base()}/api/slice/${this.job.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, plateClear: start }), signal: AbortSignal.timeout(150000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Monitor replied ${res.status}`);
      toast(body.message || 'Sent');
      return true;
    } catch (e) {
      toast(`Couldn’t send: ${e.message}`, true);
      return false;
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  },

  // ---------- Upload ----------
  upload(file) {
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!['.stl', '.3mf'].includes(ext)) return toast('Choose an STL or 3MF file', true);
    if (file.size > 200 * 1048576) return toast('That file is larger than 200 MB', true);
    const box = $('#upProgress');
    box.innerHTML = `<div class="panel"><b>Uploading ${esc(file.name)}…</b><div class="bar"><i id="upBar" style="width:0%"></i></div></div>`;
    $('#pickFile').disabled = true;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${Monitor.base()}/api/slice/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && $('#upBar')) $('#upBar').style.width = `${Math.round(e.loaded / e.total * 100)}%`; };
    const fail = (msg) => { box.innerHTML = `<p class="banner warn">${esc(msg)}</p>`; if ($('#pickFile')) $('#pickFile').disabled = false; };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200) return fail(body.error || `Upload failed (${xhr.status})`);
      this.job = body;
      store.set('printJob', body.id);
      this.draw();
    };
    xhr.onerror = () => fail('Upload failed — check Tailscale is on and try again.');
    xhr.send(file);
  },
};
