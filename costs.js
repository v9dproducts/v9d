// V9D — Usage & Costs and Live Power pages. Data comes from the V9D monitor (/api/usage,
// /api/power); prices are local settings so different filaments/tariffs can be tried.

const Prices = {
  DEFAULTS: { elec: 24.122, fil: 10.96 }, // p/kWh, £/kg
  get() {
    const p = store.get('prices', {});
    return {
      elec: Number.isFinite(p.elec) ? p.elec : this.DEFAULTS.elec,
      fil: Number.isFinite(p.fil) ? p.fil : this.DEFAULTS.fil,
    };
  },
  set(p) { store.set('prices', p); },
  // £ for a print / period
  material(grams, p = this.get()) { return grams * p.fil / 1000; },
  energy(wh, p = this.get()) { return (wh / 1000) * p.elec / 100; },
};

const fmt = {
  money(gbp) { return gbp >= 0.995 || gbp === 0 ? `£${gbp.toFixed(2)}` : `${(gbp * 100).toFixed(1)}p`; },
  kwh(wh) { return wh >= 10000 ? `${(wh / 1000).toFixed(1)} kWh` : `${(wh / 1000).toFixed(2)} kWh`; },
  grams(g) { return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`; },
  hours(sec) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  },
  date(t) { return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); },
  time(t) { return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); },
  file(f) {
    return String(f || '').split('/').pop().replace(/\.gcode$/i, '').replace(/^obj_\d+_/, '').replace(/\.(stl|3mf|obj|step)_.*$/i, '') || 'Untitled';
  },
};

// Price inputs shared by both pages. onChange re-renders the numbers.
function priceCalculator(onChange) {
  const p = Prices.get();
  const html = `
    <div class="calc">
      <label class="field"><span>Electricity (p/kWh)</span>
        <input id="priceElec" type="number" inputmode="decimal" step="0.001" min="0" value="${p.elec}"></label>
      <label class="field"><span>Filament (£/kg)</span>
        <input id="priceFil" type="number" inputmode="decimal" step="0.01" min="0" value="${p.fil}"></label>
      <div class="calc-foot"><span id="perGram">= ${(p.fil / 10).toFixed(3)}p/g</span>
        <button class="linkbtn" id="priceReset" type="button">Reset to my prices</button></div>
    </div>`;
  const bind = () => {
    const read = () => {
      const elec = parseFloat($('#priceElec').value), fil = parseFloat($('#priceFil').value);
      if (!(elec >= 0) || !(fil >= 0)) return;
      Prices.set({ elec, fil });
      $('#perGram').textContent = `= ${(fil / 10).toFixed(3)}p/g`;
      onChange();
    };
    $('#priceElec').oninput = read;
    $('#priceFil').oninput = read;
    $('#priceReset').onclick = () => {
      $('#priceElec').value = Prices.DEFAULTS.elec;
      $('#priceFil').value = Prices.DEFAULTS.fil;
      read();
    };
  };
  return { html, bind };
}

// ---------- Usage & Costs ----------
const UsagePage = {
  data: null,
  period: '30d',
  printer: 'all',

  async render() {
    setHeader('Usage & Costs', { back: true });
    this.period = store.get('usagePeriod', '30d');
    this.printer = store.get('usagePrinter', 'all');
    const calc = priceCalculator(() => this.renderResults());
    $('#view').innerHTML = `
      ${calc.html}
      <div class="chips" id="periodChips">
        ${[['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['all', 'All time']]
          .map(([k, l]) => `<button class="chip" data-period="${k}">${l}</button>`).join('')}
      </div>
      <div class="chips" id="printerChips"></div>
      <div id="usageResults"><p class="banner">Loading…</p></div>`;
    calc.bind();
    $('#periodChips').onclick = (e) => {
      const b = e.target.closest('[data-period]');
      if (!b) return;
      this.period = b.dataset.period; store.set('usagePeriod', this.period); this.renderResults();
    };
    try {
      this.data = await Monitor.get('/api/usage');
    } catch (e) {
      $('#usageResults').innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on. (${esc(e.message)})</p>`;
      return;
    }
    const printers = Object.entries(this.data.printers);
    $('#printerChips').innerHTML = [['all', 'All printers'], ...printers.map(([id, p]) => [id, p.name])]
      .map(([k, l]) => `<button class="chip" data-printer="${esc(k)}">${esc(l)}</button>`).join('');
    $('#printerChips').onclick = (e) => {
      const b = e.target.closest('[data-printer]');
      if (!b) return;
      this.printer = b.dataset.printer; store.set('usagePrinter', this.printer); this.renderResults();
    };
    this.renderResults();
  },

  range() {
    const now = new Date();
    if (this.period === '7d') return now - 7 * 864e5;
    if (this.period === '30d') return now - 30 * 864e5;
    if (this.period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return 0;
  },

  // Energy while switched on but not printing: idle hours in the period × standby watts.
  // Idle time and energy for one printer in the period: { wh, hours, busyHours }.
  // busyHours = time inside prints (including pauses), so busy + idle = the whole period.
  standby(id, from) {
    const mine = this.data.jobs.filter((j) => j.printer === id);
    if (!mine.length) return { wh: 0, hours: 0, busyHours: 0 };
    // A fixed period counts in full (the printers are on 24/7); "All time" starts at the
    // first recorded print.
    const start = from || Math.min(...mine.map((j) => j.start)), end = Date.now();
    const busy = mine.reduce((a, j) => a + Math.max(0, Math.min(j.end, end) - Math.max(j.start, start)), 0);
    const idleH = Math.max(0, end - start - busy) / 3600000;
    return { wh: idleH * (this.data.printers[id]?.standbyW || 0), hours: idleH, busyHours: busy / 3600000 };
  },

  renderResults() {
    document.querySelectorAll('[data-period]').forEach((b) => b.classList.toggle('on', b.dataset.period === this.period));
    document.querySelectorAll('[data-printer]').forEach((b) => b.classList.toggle('on', b.dataset.printer === this.printer));
    if (!this.data) return;
    const p = Prices.get(), from = this.range(), names = this.data.printers;
    const jobs = this.data.jobs.filter((j) => j.start >= from && (this.printer === 'all' || j.printer === this.printer));

    const sum = (f) => jobs.reduce((a, j) => a + f(j), 0);
    const grams = sum((j) => j.grams), printWh = sum((j) => j.energyWh), secs = sum((j) => j.printSec);
    const ids = this.printer === 'all' ? Object.keys(names) : [this.printer];
    const standby = Object.fromEntries(ids.map((id) => [id, this.standby(id, from)]));
    const standbyWh = Object.values(standby).reduce((a, b) => a + b.wh, 0);
    const wh = printWh + standbyWh;

    // Electricity per printer: printing vs idle, then both combined.
    const rows = ids.map((id) => {
      const js = jobs.filter((j) => j.printer === id);
      const run = { wh: js.reduce((a, j) => a + j.energyWh, 0), hours: standby[id].busyHours };
      return { name: names[id].name, run, idle: standby[id] };
    });
    if (rows.length > 1) {
      const add = (k) => ({ wh: rows.reduce((a, r) => a + r[k].wh, 0), hours: rows.reduce((a, r) => a + r[k].hours, 0) });
      rows.push({ name: 'Both printers', run: add('run'), idle: add('idle'), combined: true });
    }
    const cell = (x) => `<span class="eb-cell"><b>${fmt.money(Prices.energy(x.wh, p))}</b><small>${fmt.kwh(x.wh)}</small><small>${Math.round(x.hours)} h</small></span>`;
    const breakdown = `
      <div class="panel eb">
        <div class="eb-title">Electricity — printing vs idle</div>
        <div class="eb-grid">
          <span></span><span class="eb-head">Printing</span><span class="eb-head">Idle</span><span class="eb-head">Total</span>
          ${rows.map((r) => `
            <span class="eb-name ${r.combined ? 'eb-sum' : ''}">${esc(r.name)}</span>
            ${cell(r.run)}${cell(r.idle)}${cell({ wh: r.run.wh + r.idle.wh, hours: r.run.hours + r.idle.hours })}`).join('')}
        </div>
      </div>`;
    const matCost = Prices.material(grams, p), elecCost = Prices.energy(wh, p);
    const estimated = jobs.filter((j) => j.energySource === 'estimated').length;

    const perPrinter = this.printer === 'all' ? ids.map((id) => {
      const js = jobs.filter((j) => j.printer === id);
      const g = js.reduce((a, j) => a + j.grams, 0), e = js.reduce((a, j) => a + j.energyWh, 0) + standby[id].wh;
      return `<div class="row-item"><span>${esc(names[id].name)}</span>
        <span class="muted">${js.length} prints · ${fmt.grams(g)} · ${fmt.kwh(e)}</span>
        <b>${fmt.money(Prices.material(g, p) + Prices.energy(e, p))}</b></div>`;
    }).join('') : '';
    const standbyNote = ids.map((id) => `${esc(names[id].name)} ${names[id].standbyW} W`).join(', ');

    // Group print list by day
    let lastDay = '', list = '';
    for (const j of jobs) {
      const day = fmt.date(j.start);
      if (day !== lastDay) { list += `<h3 class="day">${day}</h3>`; lastDay = day; }
      const cost = Prices.material(j.grams, p) + Prices.energy(j.energyWh, p);
      const status = j.status === 'complete' ? '' : ` · <span class="tag ${esc(j.status)}">${esc(j.status)}</span>`;
      list += `
        <div class="job">
          <div class="job-main">
            <div class="job-name">${esc(fmt.file(j.file))}</div>
            <div class="muted">${esc(names[j.printer]?.name || j.printer)} · ${fmt.time(j.start)} · ${fmt.hours(j.printSec)} · ${esc(j.material)}${status}</div>
            <div class="muted">${fmt.grams(j.grams)} (${fmt.money(Prices.material(j.grams, p))}) · ${fmt.kwh(j.energyWh)}${j.energySource === 'estimated' ? '*' : ''} (${fmt.money(Prices.energy(j.energyWh, p))})</div>
          </div>
          <div class="job-cost">${fmt.money(cost)}</div>
        </div>`;
    }

    $('#usageResults').innerHTML = `
      <div class="hero"><div class="hero-label">Total cost</div><div class="hero-num">${fmt.money(matCost + elecCost)}</div>
        <div class="muted">${jobs.length} prints · ${fmt.hours(secs)} printing</div></div>
      <div class="tiles2">
        <div class="stat"><div class="stat-label">Material</div><div class="stat-num">${fmt.money(matCost)}</div><div class="muted">${fmt.grams(grams)}</div></div>
        <div class="stat"><div class="stat-label">Electricity</div><div class="stat-num">${fmt.money(elecCost)}</div><div class="muted">${fmt.kwh(wh)}</div></div>
      </div>
      ${breakdown}
      ${perPrinter ? `<div class="panel"><div class="eb-title">Total per printer — material + electricity</div>${perPrinter}</div>` : ''}
      ${list || '<div class="empty">No prints in this period.</div>'}
      <p class="hint">Material is reported by the printers (1.75 mm filament, weight from the material’s density). Electricity is estimated from the heaters’ power — see Live Power. Standby assumes the printers are on 24/7, idling at ${standbyNote} when not printing${this.period === 'all' ? ', counted from each printer’s first recorded print' : ''}.${estimated ? ` * Prints from before monitoring started are estimated from print time.` : ''}</p>`;
  },
};

// ---------- Live Power ----------
const STATE_LABEL = { printing: 'Printing', paused: 'Paused', complete: 'Finished', cancelled: 'Cancelled', error: 'Error', offline: 'Offline', idle: 'Idle' };

const PowerPage = {
  timer: null,
  hover: {},

  render() {
    setHeader('Live Power', { back: true });
    const calc = priceCalculator(() => this.draw());
    $('#view').innerHTML = `<div id="powerTotal"></div><div id="powerCards"><p class="banner">Loading…</p></div>
      <details class="calc-wrap"><summary>Prices</summary>${calc.html}</details>
      <p class="hint">Power is estimated, not metered. The K2 Plus reports how hard each heater is working; the K1 Max’s heaters are estimated from its temperatures. Rated heater power: beds 800 W, hotends 100 W (K2 Plus) / 60 W (K1 Max).</p>`;
    calc.bind();
    this.refresh();
  },

  async refresh() {
    clearTimeout(this.timer);
    if (location.hash !== '#/power') return;
    try {
      this.data = await Monitor.get('/api/power');
      this.error = '';
    } catch (e) { this.error = e.message; }
    this.draw();
    this.timer = setTimeout(() => this.refresh(), 3000);
  },

  draw() {
    if (this.error && !this.data) {
      $('#powerCards').innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on. (${esc(this.error)})</p>`;
      return;
    }
    if (!this.data) return;
    const p = Prices.get();
    const entries = Object.entries(this.data.printers);
    const totalW = entries.reduce((a, [, x]) => a + (x.watts || 0), 0);
    const todayWh = entries.reduce((a, [, x]) => a + x.todayWh, 0);
    $('#powerTotal').innerHTML = `
      <div class="hero"><div class="hero-label">All printers now</div>
        <div class="hero-num">${Math.round(totalW)} W</div>
        <div class="muted">${fmt.money(Prices.energy(totalW, p))} per hour · today ${fmt.kwh(todayWh)} (${fmt.money(Prices.energy(todayWh, p))})</div></div>
      ${this.error ? `<p class="banner">Connection lost — showing last reading. (${esc(this.error)})</p>` : ''}`;

    $('#powerCards').innerHTML = entries.map(([id, x]) => {
      const parts = x.parts || {};
      const rows = [['Bed', parts.bed], ['Hotend', parts.hotend], ['Chamber heater', parts.chamber], ['Fans', parts.fans], ['Motors', parts.motion], ['Electronics', parts.electronics]]
        .filter(([label, v]) => v !== undefined && (v > 0 || label !== 'Chamber heater' || id === 'k2-plus'));
      const max = Math.max(1, ...rows.map(([, v]) => v || 0));
      const inp = x.inputs || {};
      const t = (o, label) => o && o.temp !== undefined ? `${label} ${Math.round(o.temp)}${o.target ? '/' + Math.round(o.target) : ''}°C` : '';
      return `
        <div class="panel power">
          <div class="power-head">
            <div><div class="title">${esc(x.name)}</div><div class="status ${esc(x.state)}">${esc(STATE_LABEL[x.state] || 'Connecting…')}</div></div>
            <div class="power-num">${x.watts === null ? '—' : Math.round(x.watts) + ' W'}</div>
          </div>
          <div class="muted">${x.watts === null ? 'No reading' : fmt.money(Prices.energy(x.watts, p)) + ' per hour'}
            · today ${fmt.kwh(x.todayWh)} (${fmt.money(Prices.energy(x.todayWh, p))})
            ${x.sessionWh ? ` · this print ${fmt.kwh(x.sessionWh)} (${fmt.money(Prices.energy(x.sessionWh, p))})` : ''}</div>
          ${sparkline(id, x.samples)}
          <div class="bars">${rows.map(([label, v]) => `
            <div class="bar-row"><span>${label}</span>
              <span class="bar"><i style="width:${((v || 0) / max * 100).toFixed(1)}%"></i></span>
              <b>${Math.round(v || 0)} W</b></div>`).join('')}</div>
          <div class="muted temps">${[t(inp.bed, 'Bed'), t(inp.hotend, 'Hotend'), t(inp.chamber, 'Chamber')].filter(Boolean).join(' · ')}${inp.method ? ` — ${esc(inp.method)}` : ''}</div>
        </div>`;
    }).join('');
    bindSparklines();
  },
};

// Single-series line of the last 15 minutes, with a hover/touch readout.
function sparkline(id, samples) {
  if (!samples || samples.length < 2) return '<div class="spark empty-spark">Collecting readings…</div>';
  const W = 600, H = 90, t0 = samples[0][0], t1 = samples[samples.length - 1][0];
  const max = Math.max(50, ...samples.map((s) => s[1])) * 1.1;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (w) => H - (w / max) * H;
  const pts = samples.map((s) => `${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ');
  return `
    <div class="spark" data-spark="${esc(id)}" data-samples='${JSON.stringify(samples)}' data-max="${max}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Power over the last 15 minutes">
        <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" class="spark-base"/>
        <polygon points="0,${H} ${pts} ${W},${H}" class="spark-area"/>
        <polyline points="${pts}" class="spark-line" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="spark-cursor" hidden></div><div class="spark-tip" hidden></div>
      <div class="spark-axis"><span>${Math.round((t1 - t0) / 60000)} min ago</span><span>peak ${Math.round(Math.max(...samples.map((s) => s[1])))} W</span><span>now</span></div>
    </div>`;
}

function bindSparklines() {
  document.querySelectorAll('[data-spark]').forEach((el) => {
    const samples = JSON.parse(el.dataset.samples), max = +el.dataset.max;
    const svg = el.querySelector('svg'), cur = el.querySelector('.spark-cursor'), tip = el.querySelector('.spark-tip');
    const t0 = samples[0][0], t1 = samples[samples.length - 1][0];
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const target = t0 + fx * (t1 - t0);
      const s = samples.reduce((a, b) => (Math.abs(b[0] - target) < Math.abs(a[0] - target) ? b : a));
      const px = ((s[0] - t0) / Math.max(1, t1 - t0)) * r.width;
      cur.hidden = tip.hidden = false;
      cur.style.left = `${px}px`;
      cur.style.top = `${(1 - s[1] / max) * r.height}px`;
      tip.textContent = `${s[1]} W · ${new Date(s[0]).toLocaleTimeString('en-GB')}`;
      tip.style.left = `${Math.min(Math.max(px, 50), r.width - 50)}px`;
    };
    el.onpointermove = move;
    el.onpointerdown = move;
    el.onpointerleave = () => { cur.hidden = tip.hidden = true; };
  });
}
