// V9D — Maintenance page. Intervals, usage since last service and the maintenance log come
// from the V9D monitor (/api/maintenance), which also sends the reminder notifications.

const MaintPage = {
  data: null,
  printer: null,

  async render() {
    setHeader('Maintenance', { back: true });
    $('#view').innerHTML = skeleton();
    this.data = null;
    try {
      await Monitor.load('/api/maintenance', (data) => {
        if (currentRoute() !== 'maintenance') return;
        this.data = data;
        const ids = Object.keys(data.printers);
        this.printer = ids.includes(store.get('maintPrinter')) ? store.get('maintPrinter') : ids[0];
        this.draw();
      });
    } catch (e) {
      if (!this.data) $('#view').innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on. (${esc(e.message)})</p>`;
    }
  },

  draw() {
    const ids = Object.keys(this.data.printers);
    const pr = this.data.printers[this.printer];
    const order = { due: 0, soon: 1, ok: 2 };
    const items = [...pr.items].sort((a, b) => order[a.status] - order[b.status] || b.percent - a.percent);
    const names = Object.fromEntries(pr.items.map((i) => [i.id, i.name]));
    const unlogged = items.filter((i) => !i.logged).length;

    patch($('#view'), `
      <div class="chips">${ids.map((id) => `<button class="chip ${id === this.printer ? 'on' : ''}" data-mprinter="${esc(id)}">${esc(this.data.printers[id].name)}</button>`).join('')}</div>
      <button class="btn primary block" id="performBtn">Perform maintenance</button>
      ${unlogged ? `<p class="banner">${unlogged} item${unlogged > 1 ? 's have' : ' has'} no maintenance logged yet, so ${unlogged > 1 ? 'they count' : 'it counts'} from the first print the printer remembers. Log when you last did ${unlogged > 1 ? 'them' : 'it'} (you can pick a past date) to start reminders.</p>` : ''}
      ${items.map((i) => `
        <div class="maint ${i.status}" data-item="${esc(i.id)}" role="button" tabindex="0">
          <div class="maint-top">
            <span class="maint-name">${esc(i.name)}</span>
            <span class="maint-state ${i.status}">${STATUS_TEXT[i.status]}</span>
            ${helpFor(pr.name, i.id) ? `<button class="info-btn" data-help="${esc(i.id)}" aria-label="How to: ${esc(i.name)}">i</button>` : ''}
          </div>
          <div class="maint-bar"><i style="width:${i.percent}%"></i></div>
          <div class="muted">${esc(usedText(i))}</div>
          <div class="muted">${i.kind === 'replace' ? 'Replace' : 'Service'} · ${i.logged ? `last done ${fmt.date(i.since)}` : `not logged — counting from ${fmt.date(i.since)}`}</div>
        </div>`).join('')}
      <h3 class="day">Maintenance log</h3>
      ${this.data.history.filter((h) => h.printer === this.printer).map((h) => `
        <div class="job"><div class="job-main">
          <div class="job-name">${esc(h.items.map((x) => names[x] || x).join(', '))}</div>
          <div class="muted">${fmt.date(h.date)}${h.note ? ` · ${esc(h.note)}` : ''}</div>
        </div></div>`).join('') || '<p class="hint">Nothing logged yet.</p>'}
      <p class="hint">Intervals marked “Creality” come from Creality’s maintenance guides; others are typical figures. Print hours and filament come from the printer’s own history. You’ll get a notification when something is due soon and when it’s due.</p>`);

    document.querySelectorAll('[data-mprinter]').forEach((b) => b.onclick = () => {
      this.printer = b.dataset.mprinter; store.set('maintPrinter', this.printer); this.draw();
    });
    $('#performBtn').onclick = () => this.perform([]);
    document.querySelectorAll('[data-item]').forEach((b) => {
      const open = () => this.detail(pr.items.find((i) => i.id === b.dataset.item));
      b.onclick = open;
      b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    document.querySelectorAll('[data-help]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      this.help(pr.items.find((i) => i.id === b.dataset.help));
    });
  },

  detail(i) {
    const iv = Object.entries(i.interval).map(([u, v]) => `${v} ${UNIT[u]}`).join(' or ');
    openSheet(`
      <div class="cam-head"><h2>${esc(i.name)}</h2><button class="icon-btn" id="cancelSheet" aria-label="Close">✕</button></div>
      <p class="maint-state ${i.status}">${STATUS_TEXT[i.status]} — ${esc(usedText(i))}</p>
      <div class="panel">
        <div class="row-item"><span>Interval</span><span></span><b>Every ${esc(iv)}${Object.keys(i.interval).length > 1 ? ', whichever first' : ''}</b></div>
        <div class="row-item"><span>Since ${i.logged ? 'last done' : 'first record'}</span><span></span><b>${fmt.date(i.since)}</b></div>
        <div class="row-item"><span>Printed since</span><span></span><b>${Math.round(i.used.hours)} h · ${i.used.kg.toFixed(2)} kg</b></div>
      </div>
      <p class="note">${esc(i.how)}</p>
      <p class="note">${i.source === 'creality' ? `Interval from Creality${i.url ? ` — <a href="${esc(i.url)}" target="_blank" rel="noopener">maintenance guide</a>` : ''}.` : 'Typical interval — Creality doesn’t publish one for this.'}</p>
      ${helpFor(this.data.printers[this.printer].name, i.id) ? '<button class="btn block" id="howTo">How to do it — step by step</button>' : ''}
      <button class="btn primary block" id="doItem">Perform maintenance</button>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#doItem').onclick = () => this.perform([i.id]);
    const how = $('#howTo');
    if (how) how.onclick = () => this.help(i);
  },

  // Step-by-step guide (summarised from Creality) with their video and photo guide.
  help(i) {
    const h = helpFor(this.data.printers[this.printer].name, i.id);
    if (!h) return;
    const links = [['Photo guide on Creality Wiki', h.guide], ...(h.links || [])].filter(([, u]) => u);
    openSheet(`
      <div class="cam-head"><h2>${esc(i.name)}</h2><button class="icon-btn" id="cancelSheet" aria-label="Close">✕</button></div>
      <p class="note">${esc(h.intro)}</p>
      ${h.video ? `<div class="cam help-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(h.video)}?rel=0&playsinline=1" title="Creality video: ${esc(i.name)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>
        <p class="muted help-cap">Creality’s official video</p>` : ''}
      ${h.safety ? `<p class="help-warn">⚠️ ${esc(h.safety)}</p>` : ''}
      ${h.tools.length ? `<h3 class="help-h">You’ll need</h3><ul class="help-tools">${h.tools.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <h3 class="help-h">Steps</h3>
      <ol class="help-steps">${h.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="help-links">${links.map(([label, url]) => `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`).join('')}</div>
      <p class="muted">Summarised from Creality’s official guides — the linked pages have the photos for each step.</p>
      <button class="btn primary block" id="helpDone">Done — log this maintenance</button>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#helpDone').onclick = () => this.perform([i.id]);
  },

  perform(preselect) {
    const pr = this.data.printers[this.printer];
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    openSheet(`
      <h2>Perform maintenance · ${esc(pr.name)}</h2>
      <p class="note">Tick what you replaced or serviced. Its counter restarts from the date below.</p>
      <div class="checks">${pr.items.map((i) => `
        <label class="check"><input type="checkbox" value="${esc(i.id)}" ${preselect.includes(i.id) ? 'checked' : ''}>
          <span>${esc(i.name)}<small class="muted"> · ${i.kind === 'replace' ? 'replace' : 'service'}</small></span></label>`).join('')}</div>
      <label class="field"><span>Date done</span><input type="date" id="maintDate" value="${today}" max="${today}"></label>
      <label class="field"><span>Note (optional)</span><input id="maintNote" placeholder="e.g. 0.4 mm hardened steel nozzle"></label>
      <p class="note" id="maintMsg"></p>
      <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="saveMaint">Save</button></div>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#saveMaint').onclick = async () => {
      const items = [...document.querySelectorAll('.check input:checked')].map((c) => c.value);
      if (!items.length) { $('#maintMsg').textContent = 'Tick at least one item.'; return; }
      const d = $('#maintDate').value;
      // A past date is logged at midday that day; today means now.
      const date = d === today ? Date.now() : new Date(`${d}T12:00:00`).getTime();
      $('#saveMaint').disabled = true;
      try {
        this.data = await Monitor.post('/api/maintenance/perform', { printer: this.printer, items, date, note: $('#maintNote').value });
        closeSheet();
        this.draw();
      } catch (e) {
        $('#maintMsg').textContent = `Couldn’t save — can’t reach the V9D monitor. (${e.message})`;
        $('#saveMaint').disabled = false;
      }
    };
  },
};

const STATUS_TEXT = { ok: '✓ OK', soon: '⏳ Due soon', due: '⚠️ Due now' };
const UNIT = { hours: 'print hours', kg: 'kg of filament', days: 'days' };

function usedText(i) {
  const used = i.unit === 'hours' ? `${Math.round(i.used.hours)} of ${i.limit} print hours`
    : i.unit === 'kg' ? `${i.used.kg.toFixed(1)} of ${i.limit} kg`
    : `${Math.floor(i.used.days)} of ${i.limit} days`;
  const left = Math.abs(i.left);
  const amount = i.unit === 'hours' ? `${Math.round(left)} h` : i.unit === 'kg' ? `${left.toFixed(1)} kg` : `${Math.round(left)} days`;
  return `${used} · ${i.left > 0 ? `${amount} left` : `overdue by ${amount}`}`;
}
