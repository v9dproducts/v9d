// V9D — Maintenance page. Intervals, usage since last service and the maintenance log come
// from the V9D monitor (/api/maintenance), which also sends the reminder notifications.

const MaintPage = {
  data: null,
  printer: null,

  async render() {
    setHeader('Maintenance', { back: true });
    $('#view').innerHTML = `<p class="banner">Loading…</p>`;
    try {
      this.data = await Monitor.get('/api/maintenance');
    } catch (e) {
      $('#view').innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on. (${esc(e.message)})</p>`;
      return;
    }
    const ids = Object.keys(this.data.printers);
    this.printer = ids.includes(store.get('maintPrinter')) ? store.get('maintPrinter') : ids[0];
    this.draw();
  },

  draw() {
    const ids = Object.keys(this.data.printers);
    const pr = this.data.printers[this.printer];
    const order = { due: 0, soon: 1, ok: 2 };
    const items = [...pr.items].sort((a, b) => order[a.status] - order[b.status] || b.percent - a.percent);
    const names = Object.fromEntries(pr.items.map((i) => [i.id, i.name]));
    const unlogged = items.filter((i) => !i.logged).length;

    $('#view').innerHTML = `
      <div class="chips">${ids.map((id) => `<button class="chip ${id === this.printer ? 'on' : ''}" data-mprinter="${esc(id)}">${esc(this.data.printers[id].name)}</button>`).join('')}</div>
      <button class="btn primary block" id="performBtn">Perform maintenance</button>
      ${unlogged ? `<p class="banner">${unlogged} item${unlogged > 1 ? 's have' : ' has'} no maintenance logged yet, so ${unlogged > 1 ? 'they count' : 'it counts'} from the first print the printer remembers. Log when you last did ${unlogged > 1 ? 'them' : 'it'} (you can pick a past date) to start reminders.</p>` : ''}
      ${items.map((i) => `
        <button class="maint ${i.status}" data-item="${esc(i.id)}">
          <div class="maint-top">
            <span class="maint-name">${esc(i.name)}</span>
            <span class="maint-state ${i.status}">${STATUS_TEXT[i.status]}</span>
          </div>
          <div class="maint-bar"><i style="width:${i.percent}%"></i></div>
          <div class="muted">${esc(usedText(i))}</div>
          <div class="muted">${i.kind === 'replace' ? 'Replace' : 'Service'} · ${i.logged ? `last done ${fmt.date(i.since)}` : `not logged — counting from ${fmt.date(i.since)}`}</div>
        </button>`).join('')}
      <h3 class="day">Maintenance log</h3>
      ${this.data.history.filter((h) => h.printer === this.printer).map((h) => `
        <div class="job"><div class="job-main">
          <div class="job-name">${esc(h.items.map((x) => names[x] || x).join(', '))}</div>
          <div class="muted">${fmt.date(h.date)}${h.note ? ` · ${esc(h.note)}` : ''}</div>
        </div></div>`).join('') || '<p class="hint">Nothing logged yet.</p>'}
      <p class="hint">Intervals marked “Creality” come from Creality’s maintenance guides; others are typical figures. Print hours and filament come from the printer’s own history. You’ll get a notification when something is due soon and when it’s due.</p>`;

    document.querySelectorAll('[data-mprinter]').forEach((b) => b.onclick = () => {
      this.printer = b.dataset.mprinter; store.set('maintPrinter', this.printer); this.draw();
    });
    $('#performBtn').onclick = () => this.perform([]);
    document.querySelectorAll('[data-item]').forEach((b) => b.onclick = () => this.detail(pr.items.find((i) => i.id === b.dataset.item)));
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
      <button class="btn primary block" id="doItem">Perform maintenance</button>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#doItem').onclick = () => this.perform([i.id]);
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
