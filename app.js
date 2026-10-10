// V9D — tiny hash-routed PWA. Each "function" is a module in MODULES.

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('v9d:' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('v9d:' + key, JSON.stringify(value)); } catch {}
  },
};

// ---------- UI helpers ----------
function setHeader(title, { back = false, actions = '' } = {}) {
  $('#title').textContent = title;
  $('#backBtn').hidden = !back;
  $('#actions').innerHTML = actions;
  document.title = title === 'V9D' ? 'V9D' : `${title} · V9D`;
}

function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').hidden = false;
  $('#sheetBackdrop').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
  $('#sheet').innerHTML = '';
}
$('#sheetBackdrop').addEventListener('click', closeSheet);
$('#backBtn').addEventListener('click', () => { location.hash = '#/'; });

// ---------- Printers module ----------
const Printers = {
  async load() {
    let list = store.get('printers', null);
    // Use printers.json until the list is edited on this device, so updates to it reach every phone.
    const unedited = !list
      || JSON.stringify(list) === store.get('printersSeed', null)
      || (list.length === 1 && list[0].id === 'example-1'); // placeholder from the first version
    if (unedited) {
      try {
        const seed = await (await fetch('printers.json', { cache: 'no-store' })).json();
        list = seed;
        store.set('printers', list);
        store.set('printersSeed', JSON.stringify(seed));
      } catch { list = list || []; }
    }
    return list;
  },
  save(list) { store.set('printers', list); },

  url(p) {
    const ip = p.ip.trim();
    return /^https?:\/\//i.test(ip) ? ip : `http://${ip}`;
  },

  async render() {
    const list = await this.load();
    setHeader('3D Printers', {
      back: true,
      actions: `<button class="icon-btn" id="addPrinter" aria-label="Add printer">+</button>`,
    });

    const view = $('#view');
    view.innerHTML = list.length
      ? list.map((p) => `
          <div class="card">
            <div class="info" data-edit="${esc(p.id)}">
              <div class="title">${esc(p.name)}</div>
              <div class="meta">${esc(p.model || '—')}</div>
              <div class="ip">${esc(p.ip)}</div>
            </div>
            <a class="btn" href="${esc(this.url(p))}" target="_blank" rel="noopener">Open</a>
          </div>`).join('')
      : `<div class="empty">No printers yet.<br>Tap + to add one.</div>`;

    view.insertAdjacentHTML('beforeend', `
      <div class="toolbar">
        <button class="btn" id="exportPrinters">Export list</button>
        <button class="btn" id="importPrinters">Import list</button>
      </div>
      <p class="hint">Tap a printer to edit it. “Open” goes to the printer’s own web page — that only works when your phone is on the same network as the printers.</p>`);

    $('#addPrinter').onclick = () => this.edit(null);
    view.querySelectorAll('[data-edit]').forEach((el) => {
      el.onclick = () => this.edit(list.find((p) => p.id === el.dataset.edit));
    });
    $('#exportPrinters').onclick = () => this.exportList(list);
    $('#importPrinters').onclick = () => this.importList();
  },

  edit(p) {
    const isNew = !p;
    p = p || { id: crypto.randomUUID(), name: '', model: '', ip: '', notes: '' };
    openSheet(`
      <h2>${isNew ? 'Add printer' : 'Edit printer'}</h2>
      <form id="printerForm">
        <label class="field"><span>Name</span><input name="name" required value="${esc(p.name)}" placeholder="e.g. Bambu X1C – Office"></label>
        <label class="field"><span>Model</span><input name="model" value="${esc(p.model)}" placeholder="e.g. Bambu Lab X1 Carbon"></label>
        <label class="field"><span>IP address</span><input name="ip" required value="${esc(p.ip)}" placeholder="192.168.1.50" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(p.notes)}</textarea></label>
        <div class="row">
          <button type="button" class="btn" id="cancelSheet">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
        ${isNew ? '' : '<button type="button" class="btn danger block" id="deletePrinter">Delete printer</button>'}
      </form>`);

    $('#cancelSheet').onclick = closeSheet;
    $('#printerForm').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const list = await this.load();
      const updated = { ...p, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.trim()])) };
      const i = list.findIndex((x) => x.id === p.id);
      if (i >= 0) list[i] = updated; else list.push(updated);
      this.save(list);
      closeSheet();
      this.render();
    };
    const del = $('#deletePrinter');
    if (del) del.onclick = async () => {
      if (!confirm(`Delete “${p.name}”?`)) return;
      this.save((await this.load()).filter((x) => x.id !== p.id));
      closeSheet();
      this.render();
    };
  },

  async exportList(list) {
    const text = JSON.stringify(list, null, 2);
    const file = new File([text], 'printers.json', { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'V9D printers' }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(text); alert('Printer list copied to clipboard.'); }
    catch { prompt('Copy your printer list:', text); }
  },

  importList() {
    openSheet(`
      <h2>Import printers</h2>
      <label class="field"><span>Paste the exported JSON</span><textarea id="importText" rows="8" spellcheck="false"></textarea></label>
      <div class="row">
        <button type="button" class="btn" id="cancelSheet">Cancel</button>
        <button type="button" class="btn primary" id="doImport">Replace list</button>
      </div>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#doImport').onclick = () => {
      try {
        const list = JSON.parse($('#importText').value);
        if (!Array.isArray(list) || !list.every((p) => p.name && p.ip)) throw new Error();
        this.save(list.map((p) => ({ id: p.id || crypto.randomUUID(), model: '', notes: '', ...p })));
        closeSheet();
        this.render();
      } catch {
        alert('That doesn’t look like a valid printer list.');
      }
    };
  },
};

// ---------- Module registry (add new functions here) ----------
const MODULES = [
  { route: 'printers', name: '3D Printers', glyph: '🖨️', sub: 'Network printers', render: () => Printers.render() },
];

function renderHome() {
  setHeader('V9D');
  $('#view').innerHTML = `
    <div class="tiles">
      ${MODULES.map((m) => `
        <a class="tile" href="#/${m.route}">
          <span class="glyph">${m.glyph}</span>
          <span class="name">${esc(m.name)}</span>
          <span class="sub">${esc(m.sub)}</span>
        </a>`).join('')}
      <div class="tile soon"><span class="glyph">＋</span><span class="name">More soon</span></div>
    </div>`;
}

function route() {
  closeSheet();
  const name = location.hash.replace(/^#\/?/, '');
  const mod = MODULES.find((m) => m.route === name);
  mod ? mod.render() : renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
