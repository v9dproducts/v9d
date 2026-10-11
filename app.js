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
  $('#sheet').classList.remove('wide');
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

  // The printer's own control page: the custom web address if set, otherwise http://<ip>.
  url(p) {
    const addr = (p.url || p.ip).trim();
    return /^https?:\/\//i.test(addr) ? addr : `http://${addr}`;
  },

  async render() {
    const list = await this.load();
    setHeader('3D Printers', {
      back: true,
      actions: `<button class="icon-btn" id="openAlerts" aria-label="Notifications">${Alerts.bellIcon()}</button>
                <button class="icon-btn" id="addPrinter" aria-label="Add printer">+</button>`,
    });

    const view = $('#view');
    view.innerHTML = '<p class="banner" id="statusBanner" hidden></p>' + (list.length
      ? list.map((p) => `
          <div class="card">
            <div class="info" data-edit="${esc(p.id)}">
              <div class="title">${esc(p.name)}</div>
              <div class="meta">${esc(p.model || '—')}</div>
              <div class="ip">${esc(p.ip)}</div>
              <div class="status" data-status="${esc(p.id)}"></div>
            </div>
            <div class="actions">
              ${p.camera ? `<button class="btn" data-camera="${esc(p.id)}">Camera</button>` : ''}
              <a class="btn" href="${esc(this.url(p))}" target="_blank" rel="noopener">Open</a>
            </div>
          </div>`).join('')
      : `<div class="empty">No printers yet.<br>Tap + to add one.</div>`);

    view.insertAdjacentHTML('beforeend', `
      <div class="toolbar">
        <button class="btn" id="exportPrinters">Export list</button>
        <button class="btn" id="importPrinters">Import list</button>
      </div>
      <p class="hint">Tap a printer to edit it. “Open” goes to the printer’s own web page — that only works when your phone is on the same network as the printers.</p>`);

    $('#addPrinter').onclick = () => this.edit(null);
    $('#openAlerts').onclick = () => Alerts.open();
    view.querySelectorAll('[data-camera]').forEach((el) => {
      el.onclick = () => this.camera(list.find((p) => p.id === el.dataset.camera));
    });
    this.refreshStatus();
    view.querySelectorAll('[data-edit]').forEach((el) => {
      el.onclick = () => this.edit(list.find((p) => p.id === el.dataset.edit));
    });
    $('#exportPrinters').onclick = () => this.exportList(list);
    $('#importPrinters').onclick = () => this.importList();
  },

  // Live status from the V9D monitor (only reachable with Tailscale on).
  async refreshStatus() {
    clearTimeout(this.statusTimer);
    if (location.hash !== '#/printers') return;
    let data = null, error = '';
    try { data = await Monitor.get('/api/status'); } catch (e) { error = e.message; }
    // The monitor reports printers by the ids in printers.json; match by IP too, in case
    // the list on this device was edited and the ids changed.
    let seed = [];
    try { seed = JSON.parse(store.get('printersSeed', '[]')); } catch {}
    const list = store.get('printers', []);
    document.querySelectorAll('[data-status]').forEach((el) => {
      const mine = list.find((p) => p.id === el.dataset.status);
      const match = seed.find((p) => p.id === el.dataset.status) || seed.find((p) => mine && p.ip === mine.ip);
      const s = data?.printers?.[el.dataset.status] || (match && data?.printers?.[match.id]);
      el.className = 'status' + (s ? ' ' + s.state : '');
      el.textContent = s ? this.describe(s) : '';
    });
    const banner = $('#statusBanner');
    if (banner) {
      banner.hidden = !!data;
      banner.textContent = `Live status unavailable — can’t reach the V9D monitor. Check Tailscale is on. (${error || 'unknown error'})`;
    }
    this.statusTimer = setTimeout(() => this.refreshStatus(), 10000);
  },

  // Live camera, relayed by go2rtc on the home laptop (served on port 8443 over Tailscale).
  camera(p) {
    const src = new URL(Monitor.base());
    src.port = '8443';
    src.pathname = '/stream.html';
    src.search = new URLSearchParams({ src: p.id, mode: 'webrtc,mse,hls' });
    openSheet(`
      <div class="cam-head"><h2>${esc(p.name)} camera</h2><button class="icon-btn" id="cancelSheet" aria-label="Close">✕</button></div>
      <div class="cam"><iframe src="${esc(src.href)}" allow="autoplay; fullscreen" allowfullscreen></iframe></div>
      <p class="note">Needs Tailscale on. <a href="${esc(src.href)}" target="_blank" rel="noopener">Open full screen</a></p>`);
    $('#sheet').classList.add('wide');
    $('#cancelSheet').onclick = closeSheet;
  },

  describe(s) {
    const left = s.timeLeft ? ` · ${Math.round(s.timeLeft / 60)} min left` : '';
    switch (s.state) {
      case 'printing': return `Printing ${s.progress}%${left}`;
      case 'paused': return `Paused at ${s.progress}%`;
      case 'complete': return `Finished${s.file ? ' · ' + s.file : ''}`;
      case 'cancelled': return 'Cancelled';
      case 'error': return `Error${s.message ? ': ' + s.message : ''}`;
      case 'offline': return 'Offline';
      case 'idle': return 'Idle';
      default: return 'Connecting…';
    }
  },

  edit(p) {
    const isNew = !p;
    p = p || { id: crypto.randomUUID(), name: '', model: '', ip: '', url: '', notes: '' };
    openSheet(`
      <h2>${isNew ? 'Add printer' : 'Edit printer'}</h2>
      <form id="printerForm">
        <label class="field"><span>Name</span><input name="name" required value="${esc(p.name)}" placeholder="e.g. Bambu X1C – Office"></label>
        <label class="field"><span>Model</span><input name="model" value="${esc(p.model)}" placeholder="e.g. Bambu Lab X1 Carbon"></label>
        <label class="field"><span>IP address</span><input name="ip" required value="${esc(p.ip)}" placeholder="192.168.1.50" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label class="field"><span>Web page address (optional)</span><input name="url" value="${esc(p.url)}" placeholder="e.g. 192.168.1.67:4408 — leave empty to use the IP" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
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

// ---------- V9D monitor (runs on the home laptop, reached over Tailscale) ----------
const Monitor = {
  DEFAULT: 'https://niks.tail09fd44.ts.net',
  base() { return (store.get('monitorUrl', '') || this.DEFAULT).replace(/\/+$/, ''); },
  async get(path) {
    const res = await fetch(this.base() + path, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!res.ok) throw new Error(`Monitor replied ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(this.base() + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Monitor replied ${res.status}`);
    return res.json();
  },
};

// ---------- Push notifications ----------
const Alerts = {
  bellIcon() {
    return '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  },
  supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
  installed() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; },
  // The service worker can take a moment (or fail) to start; never wait on it forever.
  async registration() {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('The app is still starting — close and reopen V9D, then try again.')), 4000));
    return Promise.race([navigator.serviceWorker.ready, timeout]);
  },
  async subscription() {
    if (!this.supported()) return null;
    return (await this.registration()).pushManager.getSubscription();
  },

  async open() {
    const sub = await this.subscription().catch(() => null);
    let body;
    if (!this.supported() || (/iPhone|iPad/.test(navigator.userAgent) && !this.installed())) {
      body = `<p class="note">To get notifications on iPhone, V9D must be opened from your Home Screen: in Safari tap <b>Share → Add to Home Screen</b>, then open V9D from the icon.</p>`;
    } else if (sub) {
      body = `<p class="note ok">Notifications are <b>on</b> for this device. You'll be told when a print finishes, fails, is cancelled or paused, or a printer goes offline mid-print.</p>
        <div class="row"><button class="btn" id="alertTest">Send test</button><button class="btn danger" id="alertOff">Turn off</button></div>`;
    } else {
      body = `<p class="note">Get a notification when a print finishes, fails, is cancelled or paused, or a printer goes offline mid-print. Tailscale must be on the first time.</p>
        <button class="btn primary block" id="alertOn">Enable notifications</button>`;
    }
    openSheet(`
      <h2>Notifications</h2>
      ${body}
      <p class="note" id="alertMsg"></p>
      <label class="field"><span>Monitor address</span><input id="monitorUrl" value="${esc(store.get('monitorUrl', ''))}" placeholder="${esc(Monitor.DEFAULT)}" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <div class="row"><button type="button" class="btn" id="cancelSheet">Close</button></div>`);

    const msg = (t) => { $('#alertMsg').textContent = t; };
    $('#cancelSheet').onclick = () => { store.set('monitorUrl', $('#monitorUrl').value.trim()); closeSheet(); };
    $('#monitorUrl').onchange = (e) => store.set('monitorUrl', e.target.value.trim());

    const on = $('#alertOn');
    if (on) on.onclick = async () => {
      on.disabled = true; msg('Setting up…');
      try {
        if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications were not allowed. You can allow them in iPhone Settings → Notifications → V9D.');
        const { publicKey } = await Monitor.get('/api/push-key').catch(() => { throw new Error('Can’t reach the V9D monitor. Check Tailscale is on and the monitor is running.'); });
        const reg = await this.registration();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.keyBytes(publicKey) });
        await Monitor.post('/api/subscribe', { subscription: sub.toJSON() });
        this.open();
      } catch (e) { msg(e.message); on.disabled = false; }
    };
    const test = $('#alertTest');
    if (test) test.onclick = async () => {
      msg('Sending…');
      try { await Monitor.post('/api/test', { endpoint: sub.endpoint }); msg('Sent — it should arrive in a few seconds.'); }
      catch (e) { msg(/404/.test(e.message) ? 'The monitor doesn’t know this phone — turn notifications off and on again.' : 'Can’t reach the V9D monitor. Is Tailscale on?'); }
    };
    const off = $('#alertOff');
    if (off) off.onclick = async () => {
      await Monitor.post('/api/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
      this.open();
    };
  },

  keyBytes(base64url) {
    const b64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  },
};

// ---------- Module registry (add new functions here) ----------
const MODULES = [
  { route: 'printers', name: '3D Printers', glyph: '🖨️', sub: 'Network printers', render: () => Printers.render() },
  { route: 'usage', name: 'Usage & Costs', glyph: '💷', sub: 'Material & electricity', render: () => UsagePage.render() },
  { route: 'power', name: 'Live Power', glyph: '⚡', sub: 'Watts right now', render: () => PowerPage.render() },
  { route: 'maintenance', name: 'Maintenance', glyph: '🔧', sub: 'Parts & service', render: () => MaintPage.render() },
];

function renderHome() {
  setHeader('V9D');
  $('#view').innerHTML = `
    <div class="brand"><img src="icons/logo-banner.png" alt="V9D — Think. Make. V9D."></div>
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
