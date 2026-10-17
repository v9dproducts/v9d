// V9D — printer dashboard: swipe between printers; full live view and controls for the
// K2 Plus (Moonraker) and K1 Max (Creality firmware), simple view for any others. Data from the V9D monitor
// (/api/printer/<id>), which talks to the printers on the home network.

const Dash = {
  list: [],
  index: 0,
  data: {},
  timer: null,

  async render() {
    setHeader('Printers', {
      tabRoot: true,
      actions: `<button class="icon-btn" id="openAlerts" aria-label="Notifications">${Alerts.bellIcon()}</button>
                <button class="icon-btn" id="managePrinters" aria-label="Manage printers">${icon('sliders', 18)}</button>`,
    });
    $('#openAlerts').onclick = () => Alerts.open();
    $('#managePrinters').onclick = () => { location.hash = '#/printers/manage'; };

    this.list = await Printers.load();
    if (!this.list.length) {
      $('#view').innerHTML = '<div class="empty">No printers yet.<br><a href="#/printers/manage">Add one</a></div>';
      return;
    }
    this.index = Math.min(store.get('dashIndex', 0), this.list.length - 1);
    $('#view').innerHTML = `
      <div class="dash-nav">
        <button class="dash-arrow" id="dashPrev" aria-label="Previous printer">‹</button>
        <div class="dots">${this.list.map((p, i) => `<button class="dot" data-dot="${i}" aria-label="${esc(p.name)}"></button>`).join('')}</div>
        <button class="dash-arrow" id="dashNext" aria-label="Next printer">›</button>
      </div>
      <div class="pager" id="pager">
        ${this.list.map((p) => `
          <section class="dpage" data-page="${esc(p.id)}">
            <div class="dpage-head"><h2>${esc(p.name)}</h2><span class="status" data-state></span></div>
            <div class="cam dash-cam" data-cam></div>
            <div data-body><p class="banner">Loading…</p></div>
          </section>`).join('')}
      </div>`;

    const pager = $('#pager');
    requestAnimationFrame(() => { pager.scrollLeft = this.index * pager.clientWidth; this.select(this.index, true); });
    let t;
    pager.addEventListener('scroll', () => {
      clearTimeout(t);
      t = setTimeout(() => this.select(Math.round(pager.scrollLeft / pager.clientWidth)), 120);
    });
    const go = (i) => pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
    $('#dashPrev').onclick = () => go(Math.max(0, this.index - 1));
    $('#dashNext').onclick = () => go(Math.min(this.list.length - 1, this.index + 1));
    document.querySelectorAll('[data-dot]').forEach((d) => d.onclick = () => go(+d.dataset.dot));
  },

  select(i, force) {
    if (i === this.index && !force) return;
    this.index = i;
    store.set('dashIndex', i);
    document.querySelectorAll('[data-dot]').forEach((d) => d.classList.toggle('on', +d.dataset.dot === i));
    // Only the visible printer streams its camera (saves upload bandwidth at home).
    document.querySelectorAll('.dpage').forEach((pg, n) => {
      const cam = pg.querySelector('[data-cam]');
      const p = this.list[n];
      if (n === i && p.camera && !cam.firstChild) cam.innerHTML = `<iframe src="${esc(cameraUrl(p.id))}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
      if (n !== i) cam.innerHTML = '';
      cam.hidden = !p.camera;
    });
    this.refresh();
  },

  async refresh() {
    clearTimeout(this.timer);
    if (location.hash !== '#/printers') return;
    const p = this.list[this.index];
    if (!document.hidden) {
      try {
        this.data[p.id] = await Monitor.get(`/api/printer/${encodeURIComponent(p.id)}`);
        this.error = null;
      } catch (e) { this.error = e.message; }
      this.draw(p.id);
    }
    this.timer = setTimeout(() => this.refresh(), 3000);
  },

  draw(id) {
    const page = document.querySelector(`[data-page="${CSS.escape(id)}"]`);
    if (!page) return;
    const d = this.data[id], body = page.querySelector('[data-body]'), chip = page.querySelector('[data-state]');
    if (!d) {
      body.innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on.${this.error ? ` (${esc(this.error)})` : ''}</p>`;
      return;
    }
    const state = d.full ? jobState(d) : d.state;
    chip.className = 'status ' + state;
    chip.textContent = STATE_TEXT[state] || state;
    body.innerHTML = (this.error ? `<p class="banner warn">Connection lost — showing the last reading.</p>` : '') +
      (d.full ? fullView(d) : simpleView(d, this.list.find((p) => p.id === id)));
    bindDash(body, d);
  },
};

const STATE_TEXT = { printing: 'Printing', paused: 'Paused', complete: 'Finished', cancelled: 'Cancelled', error: 'Error', offline: 'Offline', idle: 'Idle', standby: 'Idle', connecting: 'Connecting…' };

function jobState(d) {
  if (!d.online) return 'offline';
  if (d.klippy && d.klippy !== 'ready') return 'error';
  const s = d.job.state;
  return s === 'standby' || !s ? 'idle' : s;
}

function cameraUrl(id) {
  const u = new URL(Monitor.base());
  u.port = '8443'; u.pathname = '/stream.html';
  u.search = new URLSearchParams({ src: id, mode: 'webrtc,mse,hls' });
  return u.href;
}
const thumbUrl = (id, rel) => `${Monitor.base()}/api/printer/${encodeURIComponent(id)}/thumb?path=${encodeURIComponent(rel)}`;
const deg = (t) => (t === null || t === undefined ? '—' : `${Math.round(t)}°`);
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

function finishTime(sec) {
  const t = new Date(Date.now() + sec * 1000);
  const sameDay = t.toDateString() === new Date().toDateString();
  return `${sameDay ? '' : t.toLocaleDateString('en-GB', { weekday: 'short' }) + ' '}${fmt.time(t)}`;
}

function fullView(d) {
  const j = d.job, st = jobState(d), active = st === 'printing' || st === 'paused';
  const prog = Math.round((j.progress || 0) * 100);
  const C = 2 * Math.PI * 52;
  const file = j.file ? fmt.file(j.file) : null;
  const grams = j.filamentUsedMm ? j.filamentUsedMm * Math.PI * 0.875 ** 2 / 1000 * 1.24 : 0;
  const hist = d.tempHistory || [];

  const problem = !d.online ? `<p class="banner warn">${esc(d.name)} isn’t responding. Check it’s switched on and connected.</p>`
    : d.klippy && d.klippy !== 'ready' ? `<p class="banner warn">Printer error: ${esc(d.klippyMessage || d.klippy)}</p>`
    : j.state === 'error' && j.message ? `<p class="banner warn">${esc(j.message)}</p>` : '';

  return `
    ${problem}
    <div class="job-card">
      <svg class="ring" viewBox="0 0 120 120" aria-label="${prog}% complete">
        <circle cx="60" cy="60" r="52" class="ring-bg"/>
        <circle cx="60" cy="60" r="52" class="ring-fg ${st}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (active || st === 'complete' ? j.progress : 0))}" transform="rotate(-90 60 60)"/>
        <text x="60" y="58" class="ring-pct">${active || st === 'complete' ? prog + '%' : '—'}</text>
        <text x="60" y="78" class="ring-sub">${active ? (j.layerCount ? `layer ${j.layer}/${j.layerCount}` : 'printing') : (STATE_TEXT[st] || '').toLowerCase()}</text>
      </svg>
      <div class="job-info">
        ${j.meta?.thumbnail && file ? `<img class="job-thumb" src="${esc(thumbUrl(d.id, j.meta.thumbnail))}" alt="" loading="lazy">` : ''}
        <div class="job-file">${file ? esc(file) : 'No print running'}</div>
        ${active && j.timeLeft !== null ? `<div class="job-left">${fmt.hours(j.timeLeft)} left</div><div class="muted">done at ${finishTime(j.timeLeft)}</div>` : ''}
        ${active || st === 'complete' ? `<div class="muted">${fmt.hours(j.printDuration)} printed${grams ? ` · ${Math.round(grams)} g used` : ''}</div>` : ''}
      </div>
    </div>

    <div class="ctrl-row">
      ${st === 'printing' ? '<button class="btn" data-act="pause">⏸ Pause</button>' : ''}
      ${st === 'paused' ? '<button class="btn primary" data-act="resume">▶ Resume</button>' : ''}
      ${active ? '<button class="btn danger-fill" data-act="stop">■ Stop</button>' : ''}
      ${!active ? `<a class="btn primary" href="#/printers/print" data-printfor="${esc(d.id)}">Print a file…</a>` : ''}
      <button class="btn ${d.light ? 'on' : ''}" data-act="light">${icon('bulb', 18)} ${d.light ? 'On' : 'Off'}</button>
    </div>

    <div class="temp-grid">
      ${tempTile('nozzle', 'Nozzle', d.temps.nozzle, hist.map((h) => [h[0], h[1]]))}
      ${tempTile('bed', 'Bed', d.temps.bed, hist.map((h) => [h[0], h[2]]))}
      ${tempTile('chamber', 'Chamber', d.temps.chamber, hist.map((h) => [h[0], h[3]]), d.caps?.chamberHeater === false)}
    </div>

    <h3 class="day">Fans</h3>
    <div class="fan-row">
      ${[['part', 'Part cooling'], ['aux', 'Auxiliary'], ['chamber', 'Chamber']].map(([k, l]) =>
        `<button class="fan" data-fan="${k}"><span>${l}</span><b>${pct(d.fans[k])}</b></button>`).join('')}
    </div>

    <h3 class="day">Speed</h3>
    <div class="seg speed">
      ${[[50, 'Silent'], [100, 'Normal'], [130, 'Sport'], [160, 'Ludicrous']].map(([v, l]) =>
        `<button data-speed="${v}" class="${Math.round((d.motion.speedFactor || 1) * 100) === v ? 'on' : ''}">${l}<small>${v}%</small></button>`).join('')}
    </div>

    <div class="panel detail-grid">
      <span>Toolhead speed</span><b>${d.motion.speed !== null ? Math.round(d.motion.speed) + ' mm/s' : '—'}</b>
      <span>Flow</span><b>${pct(d.motion.flowFactor)}</b>
      <span>Z height</span><b>${d.motion.z !== null ? d.motion.z.toFixed(2) + ' mm' : '—'}</b>
      <span>Power now</span><b>${d.power !== null ? Math.round(d.power) + ' W' : '—'}</b>
      <span>Energy today</span><b>${fmt.kwh(d.todayWh || 0)}</b>
      ${j.meta?.layerHeight ? `<span>Layer height</span><b>${j.meta.layerHeight} mm</b>` : ''}
    </div>

    <div class="ctrl-row">
      <button class="btn" data-act="files">Files on printer</button>
      <a class="btn" href="${esc(Printers.url(Dash.list.find((p) => p.id === d.id)))}" target="_blank" rel="noopener">${esc(d.caps?.webLabel || 'Fluidd')} ↗</a>
    </div>`;
}

// readOnly: a sensor with no heater behind it (the K1 Max chamber).
function tempTile(key, label, t, series, readOnly) {
  const heating = t.target > 0;
  return `
    <button class="temp" ${readOnly ? 'disabled' : `data-temp="${key}"`}>
      <span class="temp-label">${label}</span>
      <span class="temp-now">${deg(t.temp)}</span>
      <span class="temp-target ${heating ? 'hot' : ''}">${readOnly ? 'sensor' : heating ? `→ ${deg(t.target)}` : 'off'}</span>
      ${miniSpark(series)}
    </button>`;
}

// Small single-series temperature line (last 15 min).
function miniSpark(series) {
  const pts = series.filter((s) => s[1] !== null);
  if (pts.length < 2) return '<span class="mini-spark"></span>';
  const W = 100, H = 28, t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]), lo + 5);
  const xy = pts.map((p) => `${(((p[0] - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - 2 - ((p[1] - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg class="mini-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${xy}" vector-effect="non-scaling-stroke"/></svg>`;
}

function simpleView(d, cfg) {
  const s = d.status || {};
  return `
    <div class="panel">
      <div class="title">${esc(STATE_TEXT[s.state] || s.state || 'Connecting…')}${s.state === 'printing' ? ` · ${s.progress}%` : ''}</div>
      ${s.file ? `<div class="muted">${esc(s.file)}</div>` : ''}
      ${s.timeLeft ? `<div class="muted">${fmt.hours(s.timeLeft)} left · done at ${finishTime(s.timeLeft)}</div>` : ''}
      ${d.power !== null ? `<div class="muted">${Math.round(d.power)} W now</div>` : ''}
    </div>
    <p class="hint">The full dashboard and controls for the ${esc(d.name)} are coming later. Until then use its own page:</p>
    <a class="btn block" href="${esc(Printers.url(cfg))}" target="_blank" rel="noopener">Open ${esc(d.name)} ↗</a>`;
}

// ---------- Controls ----------
async function sendAction(id, payload) {
  try {
    const r = await Monitor.post(`/api/printer/${encodeURIComponent(id)}/action`, payload);
    toast(r.message || 'Done');
    setTimeout(() => Dash.refresh(), 800);
    return true;
  } catch (e) {
    toast(/Monitor replied 400/.test(e.message) ? 'The printer refused that command' : `Couldn’t send: ${e.message}`, true);
    return false;
  }
}

function bindDash(body, d) {
  body.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'pause') sendAction(d.id, { action: 'pause' });
    else if (a === 'resume') sendAction(d.id, { action: 'resume' });
    else if (a === 'light') sendAction(d.id, { action: 'light', on: !d.light });
    else if (a === 'stop') confirmStop(d);
    else if (a === 'files') filesSheet(d);
  });
  body.querySelectorAll('[data-temp]').forEach((b) => b.onclick = () => tempSheet(d, b.dataset.temp));
  body.querySelectorAll('[data-printfor]').forEach((a) => a.onclick = () => store.set('printPrinter', a.dataset.printfor));
  body.querySelectorAll('[data-fan]').forEach((b) => b.onclick = () => fanSheet(d, b.dataset.fan));
  body.querySelectorAll('[data-speed]').forEach((b) => b.onclick = () => sendAction(d.id, { action: 'speed', percent: +b.dataset.speed }));
}

function confirmStop(d) {
  openSheet(`
    <h2>Stop the print?</h2>
    <p class="note">${esc(fmt.file(d.job.file))} will be cancelled. A stopped print can’t be resumed.</p>
    <div class="row"><button class="btn" id="cancelSheet">Keep printing</button><button class="btn danger-fill" id="doStop">Stop print</button></div>`);
  $('#cancelSheet').onclick = closeSheet;
  $('#doStop').onclick = async () => { $('#doStop').disabled = true; if (await sendAction(d.id, { action: 'cancel' })) closeSheet(); else $('#doStop').disabled = false; };
}

const TEMP_PRESETS = {
  nozzle: { label: 'Nozzle', max: 300, presets: [['Off', 0], ['PLA', 220], ['PETG', 250], ['ABS/ASA', 260]] },
  bed: { label: 'Bed', max: 110, maxK1: 100, presets: [['Off', 0], ['PLA', 60], ['PETG', 80], ['ABS/ASA', 100]] },
  chamber: { label: 'Chamber', max: 60, presets: [['Off', 0], ['40°', 40], ['50°', 50], ['60°', 60]] },
};

function tempSheet(d, key) {
  const base = TEMP_PRESETS[key], t = d.temps[key], active = ['printing', 'paused'].includes(jobState(d));
  const cfg = { ...base, max: d.type === 'creality' && base.maxK1 ? base.maxK1 : base.max };
  openSheet(`
    <h2>${cfg.label} temperature</h2>
    <p class="note">Now ${deg(t.temp)} · target ${t.target ? deg(t.target) : 'off'}</p>
    ${active ? '<p class="help-warn">⚠️ A print is running — changing temperatures affects it.</p>' : ''}
    <div class="chips">${cfg.presets.map(([l, v]) => `<button class="chip" data-preset="${v}">${l}${v ? ` · ${v}°` : ''}</button>`).join('')}</div>
    <label class="field"><span>Target (°C, 0–${cfg.max})</span><input id="tempVal" type="number" inputmode="numeric" min="0" max="${cfg.max}" value="${Math.round(t.target || 0)}"></label>
    <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="setTemp">Set</button></div>`);
  $('#cancelSheet').onclick = closeSheet;
  document.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { $('#tempVal').value = b.dataset.preset; });
  $('#setTemp').onclick = async () => {
    const v = Number($('#tempVal').value);
    if (!(v >= 0 && v <= cfg.max)) return toast(`Enter 0–${cfg.max} °C`, true);
    if (await sendAction(d.id, { action: 'temp', heater: key, target: v })) closeSheet();
  };
}

function fanSheet(d, key) {
  const now = Math.round((d.fans[key] || 0) * 100);
  const label = { part: 'Part cooling fan', aux: 'Auxiliary fan', chamber: 'Chamber fan' }[key];
  openSheet(`
    <h2>${label}</h2>
    <p class="note">Now ${now}%</p>
    <input type="range" id="fanVal" min="0" max="100" step="5" value="${now}" class="slider">
    <div class="chips">${[0, 50, 100].map((v) => `<button class="chip" data-fpreset="${v}">${v}%</button>`).join('')}</div>
    <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="setFan">Set ${now}%</button></div>`);
  const sync = () => { $('#setFan').textContent = `Set ${$('#fanVal').value}%`; };
  $('#fanVal').oninput = sync;
  $('#cancelSheet').onclick = closeSheet;
  document.querySelectorAll('[data-fpreset]').forEach((b) => b.onclick = () => { $('#fanVal').value = b.dataset.fpreset; sync(); });
  $('#setFan').onclick = async () => { if (await sendAction(d.id, { action: 'fan', fan: key, percent: +$('#fanVal').value })) closeSheet(); };
}

async function filesSheet(d) {
  openSheet(`<div class="cam-head"><h2>Files on ${esc(d.name)}</h2><button class="icon-btn" id="cancelSheet" aria-label="Close">✕</button></div><div id="fileList"><p class="banner">Loading…</p></div>`);
  $('#cancelSheet').onclick = closeSheet;
  let files;
  try { files = (await Monitor.get(`/api/printer/${encodeURIComponent(d.id)}/files`)).files; }
  catch (e) { $('#fileList').innerHTML = `<p class="banner">Couldn’t load files. (${esc(e.message)})</p>`; return; }
  const p = Prices.get();
  $('#fileList').innerHTML = files.map((f, i) => `
    <button class="file" data-file="${i}">
      ${f.meta?.thumbnail ? `<img src="${esc(thumbUrl(d.id, f.meta.thumbnail))}" alt="" loading="lazy">` : '<span class="file-noimg">🧊</span>'}
      <span class="file-main"><span class="file-name">${esc(fmt.file(f.path))}</span>
        <span class="muted">${f.meta?.estimatedTime ? fmt.hours(f.meta.estimatedTime) : ''}${f.meta?.filamentGrams ? ` · ${Math.round(f.meta.filamentGrams)} g · ~${fmt.money(Prices.material(f.meta.filamentGrams, p))}` : ''}</span>
        <span class="muted">${fmt.date(f.modified)}</span></span>
    </button>`).join('') || '<div class="empty">No files on the printer.</div>';
  document.querySelectorAll('[data-file]').forEach((b) => b.onclick = () => startSheet(d, files[+b.dataset.file]));
}

function startSheet(d, f) {
  const busy = ['printing', 'paused'].includes(jobState(d));
  openSheet(`
    <h2>Print ${esc(fmt.file(f.path))}?</h2>
    ${f.meta?.thumbnail ? `<img class="start-thumb" src="${esc(thumbUrl(d.id, f.meta.thumbnail))}" alt="">` : ''}
    <p class="note">${f.meta?.estimatedTime ? `About ${fmt.hours(f.meta.estimatedTime)}` : ''}${f.meta?.filamentGrams ? ` · ${Math.round(f.meta.filamentGrams)} g` : ''}${f.meta?.layerHeight ? ` · ${f.meta.layerHeight} mm layers` : ''}</p>
    ${busy ? '<p class="help-warn">The printer is busy — wait for the current print to finish.</p>' : `
    <label class="check"><input type="checkbox" id="plateClear"><span>The build plate is clear and the right filament is loaded</span></label>
    <p class="note">Starting a print onto a part that’s still on the plate can crash the nozzle into it.</p>`}
    <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="doStart" disabled>Start print</button></div>`);
  $('#cancelSheet').onclick = closeSheet;
  const box = $('#plateClear');
  if (box) box.onchange = () => { $('#doStart').disabled = !box.checked; };
  $('#doStart').onclick = async () => {
    $('#doStart').disabled = true;
    if (await sendAction(d.id, { action: 'start', file: f.path, plateClear: true })) closeSheet();
    else $('#doStart').disabled = false;
  };
}

function toast(text, isError) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = text;
  t.className = isError ? 'show err' : 'show';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = ''; }, 2600);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && location.hash === '#/printers') Dash.refresh(); });
