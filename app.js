// V9D — tiny hash-routed PWA. Pages are listed in ROUTES; the tab bar groups them.

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
let backTarget = '#/';
// Tab roots have no back button; other pages go back to their tab (or backTo).
function setHeader(title, { back = false, backTo, tabRoot = false, actions = '' } = {}) {
  $('#title').textContent = title;
  $('#backBtn').hidden = tabRoot || !back;
  backTarget = backTo || `#/${TAB_ROOT[tabFor(currentRoute())]}`;
  $('#actions').innerHTML = actions;
  document.title = title === 'V9D' ? 'V9D' : `${title} · V9D`;
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Bottom sheet: slides up over a fading backdrop; swipe it down (or tap outside) to close.
let sheetTimer = null;
function openSheet(html) {
  const sheet = $('#sheet'), back = $('#sheetBackdrop');
  clearTimeout(sheetTimer);
  sheet.innerHTML = html;
  sheet.style.transform = '';
  const wasOpen = !sheet.hidden && sheet.classList.contains('show');
  sheet.hidden = false; back.hidden = false;
  if (!wasOpen) { sheet.classList.remove('show'); back.classList.remove('show'); void sheet.offsetHeight; }
  sheet.scrollTop = 0;
  sheet.classList.add('show'); back.classList.add('show');
}
function closeSheet() {
  const sheet = $('#sheet'), back = $('#sheetBackdrop');
  if (sheet.hidden) return;
  sheet.classList.remove('show'); back.classList.remove('show');
  sheet.style.transform = '';
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => {
    sheet.classList.remove('wide');
    sheet.hidden = true; back.hidden = true;
    sheet.innerHTML = '';
  }, reduceMotion() ? 0 : 280);
}
$('#sheetBackdrop').addEventListener('click', closeSheet);
(() => {
  const sheet = $('#sheet');
  let y0 = null, dy = 0, t0 = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0 || e.target.closest('input[type=range], select, textarea, iframe')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || sheet.scrollTop > 0) { sheet.classList.remove('dragging'); sheet.style.transform = ''; return; }
    e.preventDefault();
    sheet.classList.add('dragging');
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    sheet.classList.remove('dragging');
    const fast = dy / Math.max(1, Date.now() - t0) > 0.5;
    if (dy > 110 || (fast && dy > 30)) closeSheet(); else sheet.style.transform = '';
    y0 = null;
  });
})();
// iOS only shows :active press states when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

// Updates el to match html, touching only what changed: no flashing, pictures and the camera
// don't reload, taps aren't lost. Numbers inside [data-tween] glide to their new value.
function patch(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}
function patchChildren(a, b) {
  const old = [...a.childNodes], next = [...b.childNodes];
  next.forEach((y, i) => {
    const x = old[i];
    if (!x) a.appendChild(y);
    else if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.dataset?.key ?? '') !== (y.dataset?.key ?? '')) a.replaceChild(y, x);
    else if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) setText(x, y.nodeValue); }
    else {
      for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
      for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
      if (x.tagName !== 'IFRAME' && x !== document.activeElement) patchChildren(x, y);
    }
  });
  for (let i = next.length; i < old.length; i++) old[i].remove();
}
function setText(node, text) {
  const num = /^(-?\d+(?:\.\d+)?)(.*)$/s;
  const a = num.exec(node.nodeValue.trim()), b = num.exec(text.trim());
  if (!node.parentElement?.closest('[data-tween]') || !a || !b || a[2] !== b[2] || reduceMotion()) { node.nodeValue = text; return; }
  const from = +a[1], to = +b[1], dec = (b[1].split('.')[1] || '').length, start = performance.now();
  const id = (node.tween = (node.tween || 0) + 1);
  const step = (t) => {
    if (node.tween !== id) return;
    const f = Math.min(1, (t - start) / 450), e = 1 - (1 - f) ** 3;
    node.nodeValue = (from + (to - from) * e).toFixed(dec) + b[2];
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Shimmering placeholders shown the first time a page loads (later visits use the last data).
function skeleton(kind = 'list') {
  const block = (h, w = '100%') => `<div class="sk" style="height:${h}px;width:${w}"></div>`;
  if (kind === 'dash') return `${block(150)}<div class="sk-row">${block(46)}${block(46)}</div><div class="sk-row">${block(92)}${block(92)}${block(92)}</div>${block(120)}`;
  if (kind === 'widgets') return `${block(190)}<div class="sk-row">${block(110)}${block(110)}</div><div class="sk-row">${block(110)}${block(110)}</div>`;
  return `${block(88)}${block(64)}${block(64)}${block(64)}`;
}
$('#backBtn').addEventListener('click', () => { location.hash = backTarget; });

// ---------- Printers module ----------
const Printers = {
  async load() {
    let list = store.get('printers', null);
    // Use printers.json until the list is edited on this device, so updates to it reach every phone.
    const unedited = !list
      || JSON.stringify(list) === store.get('printersSeed', null)
      || (list.length === 1 && list[0].id === 'example-1'); // placeholder from the first version
    if (unedited) {
      const refresh = fetch('printers.json', { cache: 'no-store' }).then((r) => r.json()).then((seed) => {
        store.set('printers', seed);
        store.set('printersSeed', JSON.stringify(seed));
        return seed;
      });
      // Already have it: use it now and pick up changes in the background for next time.
      if (list) refresh.catch(() => {});
      else { try { list = await refresh; } catch { list = []; } }
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
    setHeader('Manage printers', {
      back: true,
      backTo: '#/printers',
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
    if (location.hash !== '#/printers/manage') return;
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
  DEFAULT: 'https://v9d.tail09fd44.ts.net',
  // When the app is opened from the monitor itself (the Tailscale address, or locally on the
  // home PC), talk to that same address — desktop browsers block the cross-site route.
  servedByMonitor() { return location.hostname.endsWith('.ts.net') || location.port === '8787'; },
  base() { return this.servedByMonitor() ? location.origin : this.DEFAULT; },
  async get(path) {
    let data;
    if (Demo.active) data = await Demo.get(path);
    else {
      const res = await fetch(this.base() + path, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!res.ok) throw new Error(`Monitor replied ${res.status}`);
      data = await res.json();
    }
    this.remember(path, data);
    return data;
  },
  // Last good reply per address, so pages show something instantly and then refresh quietly.
  memo: new Map(),
  KEEP: /^\/api\/(status|power|usage|maintenance|trends|printer\/[\w-]+(\/files)?)$/,
  cacheKey(path) { return `cache:${Demo.active ? 'demo:' : ''}${path}`; },
  cached(path) {
    if (!this.memo.has(path)) { const v = store.get(this.cacheKey(path), null); if (v) this.memo.set(path, v); }
    return this.memo.get(path) || null;
  },
  remember(path, data) {
    this.memo.set(path, data);
    if (this.KEEP.test(path)) store.set(this.cacheKey(path), data);
  },
  // show(data) runs with the remembered reply straight away (if any), then with the fresh one.
  async load(path, show) {
    const c = this.cached(path);
    if (c) show(c, false);
    const fresh = await this.get(path);
    show(fresh, true);
    return fresh;
  },
  // Pictures served by the monitor (demo mode uses bundled ones).
  img(path, demoRel) { return Demo.active ? Demo.img(demoRel) : this.base() + path; },
  async post(path, body) {
    if (Demo.active) return Demo.post(path, body);
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
    if (Demo.active) {
      openSheet(`<h2>Notifications</h2><p class="note">Notifications work in the real app — demo mode only shows sample data.</p><div class="row"><button class="btn" id="cancelSheet">Close</button></div>`);
      $('#cancelSheet').onclick = closeSheet;
      return;
    }
    const sub = await this.subscription().catch(() => null);
    let body;
    if (!this.supported() || (/iPhone|iPad/.test(navigator.userAgent) && !this.installed())) {
      body = `<p class="note">To get notifications on iPhone, V9D must be opened from your Home Screen: in Safari tap <b>Share → Add to Home Screen</b>, then open V9D from the icon.</p>`;
    } else if (sub) {
      body = `<p class="note ok">Notifications are <b>on</b> for this device. You'll be told when a print finishes, fails, is cancelled or paused, or a printer goes offline mid-print.</p>
        <div class="row"><button class="btn" id="alertTest">Send test</button><button class="btn danger" id="alertOff">Turn off</button></div>
        <p class="note">Preview every kind of alert, worded exactly like the real ones:</p>
        <div class="row"><button class="btn" id="alertTestMaint">Maintenance alerts</button><button class="btn" id="alertTestPrints">Print alerts</button></div>`;
    } else {
      body = `<p class="note">Get a notification when a print finishes, fails, is cancelled or paused, or a printer goes offline mid-print. Tailscale must be on the first time.</p>
        <button class="btn primary block" id="alertOn">Enable notifications</button>`;
    }
    openSheet(`
      <h2>Notifications</h2>
      ${body}
      <p class="note" id="alertMsg"></p>
      <div class="row"><button type="button" class="btn" id="cancelSheet">Close</button></div>`);

    const msg = (t) => { $('#alertMsg').textContent = t; };
    $('#cancelSheet').onclick = closeSheet;

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
    const sendTest = async (kind) => {
      msg('Sending…');
      try {
        const r = await Monitor.post('/api/test', { endpoint: sub.endpoint, kind });
        msg(r.sent > 1 ? `Sent ${r.sent} sample notifications — they’ll arrive over the next few seconds.` : 'Sent — it should arrive in a few seconds.');
      } catch (e) {
        msg(/404/.test(e.message) ? 'The monitor doesn’t know this phone — turn notifications off and on again.' : 'Can’t reach the V9D monitor. Is Tailscale on?');
      }
    };
    for (const [id, kind] of [['#alertTest', 'basic'], ['#alertTestMaint', 'maintenance'], ['#alertTestPrints', 'prints']]) {
      const b = $(id);
      if (b) b.onclick = () => sendTest(kind);
    }
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
// The monitor address is no longer user-editable; drop any address saved by older versions.
try { localStorage.removeItem('v9d:monitorUrl'); } catch {}

// Tab bar icons
document.querySelectorAll('#tabbar [data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, 22); });

// Every page, by route. The tab bar groups them; Business holds the money/planning tools.
const ROUTES = {
  '': () => HomePage.render(),
  printers: () => Dash.render(),
  'printers/manage': () => Printers.render(),
  'printers/print': () => PrintPage.render(),
  business: () => BusinessPage.render(),
  usage: () => UsagePage.render(),
  power: () => PowerPage.render(),
  radar: () => RadarPage.render(),
  maintenance: () => MaintPage.render(),
  products: () => ProductsPage.render(),
  settings: () => SettingsPage.render(),
};
const TAB_ROOT = { home: '', printers: 'printers', business: 'business', settings: 'settings' };
const currentRoute = () => location.hash.replace(/^#\/?/, '');
// Pages with an id in the address, e.g. #/products/<id>.
const ROUTE_PATTERNS = [[/^products\/(\w+)$/, (m) => ProductsPage.detail(m[1])]];
function routeFor(r) {
  if (ROUTES[r]) return ROUTES[r];
  for (const [re, fn] of ROUTE_PATTERNS) { const m = r.match(re); if (m) return () => fn(m); }
  return null;
}
function tabFor(r) {
  if (r.startsWith('printers')) return 'printers';
  if (['business', 'usage', 'power', 'radar', 'maintenance', 'products'].includes(r.split('/')[0])) return 'business';
  if (r === 'settings') return 'settings';
  return 'home';
}

// Navigation: pages slide like a native app (deeper pages in from the right, back out to the
// right, tabs cross-fade), the tab highlight glides, and going back restores the scroll position.
const scrollMemory = {};
let lastInput = 0; // the user's own scrolling wins over restoring
for (const ev of ['touchmove', 'wheel']) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true });
let lastRoute = null;
const depth = (r) => (TAB_ROOT[tabFor(r)] === r ? 0 : r.split('/').length);

function moveTabPill(animate) {
  const on = $('#tabbar a.on'), pill = $('#tabPill');
  if (!on || !pill) return;
  pill.classList.toggle('still', !animate);
  pill.style.width = `${on.offsetWidth}px`;
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}

function route() {
  closeSheet();
  const r = routeFor(currentRoute()) ? currentRoute() : '';
  const from = lastRoute;
  if (from !== null) scrollMemory[from] = window.scrollY;
  const dir = from === null ? 'none' : tabFor(from) !== tabFor(r) ? 'tab' : depth(r) > depth(from) ? 'forward' : depth(r) < depth(from) ? 'back' : 'tab';
  lastRoute = r;

  const show = () => {
    const tab = tabFor(r);
    document.body.classList.toggle('is-home', r === '');
    document.querySelectorAll('#tabbar [data-tab]').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    moveTabPill(dir !== 'none');
    const done = Promise.resolve(routeFor(r)()).catch(() => {});
    window.scrollTo(0, 0);
    // Going back: return to where you were once the page has filled in (it may draw a moment later).
    const target = dir === 'back' ? scrollMemory[r] || 0 : 0, at = Date.now();
    if (target) [0, 60, 160, 320, 600, 1000].forEach((ms) => setTimeout(() => {
      if (lastRoute === r && lastInput < at && Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target);
    }, ms));
    // Let the page draw (from remembered data it's immediate) before the transition snapshot.
    return Promise.race([done, new Promise((res) => setTimeout(res, 160))]);
  };

  document.documentElement.dataset.nav = dir;
  if (dir === 'none' || reduceMotion()) return show();
  if (document.startViewTransition && document.visibilityState === 'visible') {
    // Tapping quickly skips the previous transition, and a transition can be refused (e.g. the
    // app is in the background): the page must still change, so show it ourselves if needed.
    let ran = false;
    const once = () => { if (ran) return undefined; ran = true; return show(); };
    const t = document.startViewTransition(once);
    t.updateCallbackDone.catch(() => once());
    t.ready.catch(() => {});
    t.finished.catch(() => {});
    setTimeout(() => { if (lastRoute === r) once(); }, 400);
    return;
  }
  show();
  const v = $('#view');
  v.classList.remove('enter-forward', 'enter-back', 'enter-tab');
  void v.offsetWidth;
  v.classList.add(`enter-${dir}`);
}

// Splash: show the logo briefly once per app launch, then fade into the app.
(() => {
  const splash = $('#splash');
  if (!splash) return;
  let seen = false;
  try { seen = sessionStorage.getItem('v9d:splash') === '1'; sessionStorage.setItem('v9d:splash', '1'); } catch {}
  if (seen) { splash.remove(); return; }
  setTimeout(() => { splash.classList.add('hide'); setTimeout(() => splash.remove(), 500); }, 1100);
})();

window.addEventListener('hashchange', route);
window.addEventListener('resize', () => moveTabPill(false));
if (Demo.active) document.body.classList.add('demo');
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
