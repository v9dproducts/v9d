// V9D — Discover: trending and popular models from Thingiverse (official API, through the home
// PC, which holds the token). Shows each model's licence — "Only models I can sell" hides
// non-commercial ones — and "Print this" downloads the STL/3MF on the home PC and opens it in
// Print a file, remembering where it came from for the product.

const DiscoverPage = {
  items: [],
  page: 1,

  opts() { return { sort: 'trending', sellable: true, q: '', ...store.get('discover', {}) }; },
  // Which Trend Radar idea / hot date the search came from (kept for 2 hours).
  context() { const c = store.get('discoverContext', null); return c && Date.now() - c.at < 2 * 3600 * 1000 ? c : null; },
  setOpts(o) { store.set('discover', { ...this.opts(), ...o }); },

  // Draws the model browser into Trend Radar's "Models" tab.
  mount(box) {
    const o = this.opts();
    box.innerHTML = `
      ${this.context() ? `<p class="banner ctx">${icon('trend', 16)} For ${esc(this.context().occasion || this.context().idea)}${this.context().occasion && this.context().idea ? ` — ${esc(this.context().idea)}` : ''}<button class="linkbtn" id="ctxClear">✕</button></p>` : ''}
      <div class="disc-search"><input id="dq" type="search" placeholder="Search Thingiverse — e.g. cable clip, planter" value="${esc(o.q)}" enterkeyhint="search"></div>
      <div class="seg disc-sort">${[['trending', 'This week'], ['popular', 'All time'], ['makes', 'Most made'], ['newest', 'Newest']]
        .map(([k, l]) => `<button data-sort="${k}" class="${o.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="check disc-sell"><input type="checkbox" id="dsell" ${o.sellable ? 'checked' : ''}><span>Only models I can sell prints of <small class="muted">hides “non-commercial” licences</small></span></label>
      <div id="dlist">${skeleton()}</div>`;
    let t;
    $('#dq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { this.setOpts({ q: e.target.value }); this.load(true); }, 500); };
    $('#dq').onkeydown = (e) => { if (e.key === 'Enter') { e.target.blur(); clearTimeout(t); this.setOpts({ q: e.target.value }); this.load(true); } };
    document.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => {
      document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
      this.setOpts({ sort: b.dataset.sort }); this.load(true);
    });
    $('#dsell').onchange = (e) => { this.setOpts({ sellable: e.target.checked }); this.load(true); };
    if ($('#ctxClear')) $('#ctxClear').onclick = () => { store.set('discoverContext', null); $('#ctxClear').parentElement.remove(); };
    this.load(true);
  },

  query(page) {
    const o = this.opts();
    return `/api/discover?${new URLSearchParams({ sort: o.sort, q: o.q, sellable: o.sellable ? '1' : '0', page: String(page) })}`;
  },

  async load(reset) {
    if (reset) { this.page = 1; this.items = []; }
    const path = this.query(this.page);
    const box = $('#dlist');
    const show = (d) => {
      if (!$('#dlist')) return; // left the Models tab meanwhile
      if (!d.available) { $('#dlist').innerHTML = this.setupHtml(); return; }
      if (this.page === 1) this.items = d.items; else this.items = [...this.items, ...d.items.filter((x) => !this.items.some((y) => y.id === x.id))];
      this.draw(d.items.length >= 20 || (this.opts().sellable && d.items.length > 0));
    };
    try { await Monitor.load(path, show); }
    catch (e) { if (!this.items.length && box) box.innerHTML = `<p class="banner warn">${esc(/502/.test(e.message) ? 'Thingiverse didn’t answer — try again in a moment.' : `Can’t reach the V9D monitor. (${e.message})`)}</p>`; }
  },

  draw(more) {
    patch($('#dlist'), this.items.length ? `
      <div class="disc-grid">${this.items.map((x) => `
        <a class="disc-card" href="#/discover/${x.id}" data-key="${x.id}">
          <span class="disc-img"><img src="${esc(x.thumbnail || '')}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
          <b>${esc(x.name)}</b>
          <span class="muted">${x.creator ? `by ${esc(x.creator)}` : ''}</span>
          <span class="disc-meta"><span>♥ ${x.likes >= 1000 ? (x.likes / 1000).toFixed(1) + 'k' : x.likes}</span>${licenceBadge(x.licence)}</span>
        </a>`).join('')}</div>
      ${more ? '<button class="btn block" id="dmore">Load more</button>' : ''}
      <p class="hint">Models from Thingiverse. Check each model’s licence before selling prints — V9D shows it, but the designer’s page is the final word.</p>`
      : `<div class="empty">Nothing found${this.opts().sellable ? ' with a licence that allows selling prints — try turning that filter off' : ''}.</div>`);
    if ($('#dmore')) $('#dmore').onclick = () => { this.page += 1; $('#dmore').disabled = true; this.load(false); };
  },

  setupHtml() {
    return `
      <div class="panel setup">
        <h3>Connect Thingiverse</h3>
        <p class="note">Discover uses Thingiverse’s official API. To switch it on:</p>
        <ol class="note">
          <li>Sign in at <b>thingiverse.com/developers</b> → <b>Developer Console</b> → create an app (you accept their API terms there).</li>
          <li>Copy the app’s <b>App Token</b> — keep it private, don’t send it to anyone.</li>
          <li>On the home PC, add it to <b>V9D\\monitor\\config.json</b> as <code>"thingiverseToken"</code>.</li>
        </ol>
      </div>`;
  },

  // ---------- One model ----------
  async detail(id) {
    setHeader('Model', { back: true, backTo: '#/radar' });
    $('#view').innerHTML = skeleton();
    let t;
    try { t = await Monitor.get(`/api/discover/thing/${id}`); }
    catch (e) { $('#view').innerHTML = `<p class="banner warn">Couldn’t load this model. (${esc(e.message)})</p>`; return; }
    if (currentRoute() !== `discover/${id}`) return;
    const l = t.licence || {};
    const printable = t.files.filter((f) => f.printable);
    $('#view').innerHTML = `
      <div class="disc-pics">${t.pictures.map((p) => `<img src="${esc(p)}" alt="" referrerpolicy="no-referrer">`).join('')}</div>
      <h2 class="disc-title">${esc(t.name)}</h2>
      <p class="muted disc-by">${t.creator ? `by ${esc(t.creator)} · ` : ''}♥ ${t.likes} · ${t.makes} made${t.ai ? ' · AI-generated' : ''}</p>
      <div class="lic ${l.sellable ? 'ok' : l.sellable === false ? 'no' : 'maybe'}">
        <b>${l.sellable ? '✓ You can sell prints' : l.sellable === false ? '✕ Personal use only' : '? Check the licence'}</b>
        <span>${esc(l.name || '')}</span><span class="muted">${esc(l.note || '')}</span>
      </div>
      <h3 class="day">Files</h3>
      <div class="panel">${t.files.map((f) => `
        <div class="row-item disc-file ${f.printable ? '' : 'off'}">
          <span>${esc(f.name)}</span><span class="muted">${(f.size / 1048576).toFixed(1)} MB</span>
          ${f.printable ? `<button class="btn primary" data-file="${f.id}">Print this</button>` : '<span class="muted">not printable</span>'}
        </div>`).join('') || '<p class="muted">No files.</p>'}</div>
      ${printable.length ? '' : '<p class="hint">This model has no STL or 3MF files V9D can slice.</p>'}
      ${t.description ? `<h3 class="day">About</h3><p class="disc-desc">${esc(t.description.replace(/<[^>]*>/g, ''))}</p>` : ''}
      <a class="btn block" href="${esc(t.url)}" target="_blank" rel="noopener">Open on Thingiverse ↗</a>`;
    document.querySelectorAll('[data-file]').forEach((b) => b.onclick = async () => {
      if (l.sellable === false && !confirm('This model is for personal use only — prints can’t be sold. Print it anyway (for yourself)?')) return;
      document.querySelectorAll('[data-file]').forEach((x) => { x.disabled = true; });
      b.textContent = 'Downloading…';
      try {
        const ctx = this.context() || {};
        const job = await Monitor.post(`/api/discover/thing/${t.id}/print`, { file: b.dataset.file, occasion: ctx.occasion || null, idea: ctx.idea || null });
        store.set('printJob', job.id);
        location.hash = '#/printers/print';
      } catch (e) {
        toast(`Couldn’t get the file: ${e.message}`, true);
        document.querySelectorAll('[data-file]').forEach((x) => { x.disabled = false; x.textContent = 'Print this'; });
      }
    });
  },
};

function licenceBadge(l) {
  if (!l) return '<span class="lb-badge maybe">licence ?</span>';
  return l.sellable ? '<span class="lb-badge ok">sell OK</span>' : l.sellable === false ? '<span class="lb-badge no">personal</span>' : '<span class="lb-badge maybe">check</span>';
}

// Where a sliced file or product came from: site, designer, licence.
function sourceHtml(src) {
  if (!src) return '';
  return `<span class="src">From <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.site)}</a>${src.creator ? ` · by ${esc(src.creator)}` : ''} · ${esc(src.licence || 'licence unknown')} ${licenceBadge({ sellable: src.sellable })}${src.occasion ? `<br>📅 For ${esc(src.occasion)}` : ''}</span>`;
}

// ---------- Settings → Storage (home PC drive) ----------
const StoragePage = {
  async render() {
    setHeader('Home PC storage', { back: true, backTo: '#/settings' });
    $('#view').innerHTML = skeleton();
    try { await Monitor.load('/api/storage', (d) => { if (currentRoute() === 'storage') this.draw(d); }); }
    catch (e) { if (!$('#view .panel')) $('#view').innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on. (${esc(e.message)})</p>`; }
  },

  draw(d) {
    const gb = (b) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    const used = d.disk ? d.disk.total - d.disk.free : 0, pct = d.disk ? Math.round((used / d.disk.total) * 100) : 0;
    patch($('#view'), `
      ${d.disk ? `<div class="hero"><div class="hero-label">Free space</div><div class="hero-num">${gb(d.disk.free)}</div>
        <div class="bar ${pct > 90 ? 'full' : ''}"><i style="width:${pct}%"></i></div><div class="muted">${gb(used)} used of ${gb(d.disk.total)}</div></div>` : ''}
      <h3 class="day">Used by V9D</h3>
      <div class="panel">${d.parts.map((p) => `<div class="row-item"><span>${esc(p.label)}<small class="muted"> · ${esc(p.note)}</small></span><span></span><b>${gb(p.bytes)}</b></div>`).join('')}</div>
      <button class="btn primary block" id="cleanNow">Clean up now</button>
      <p class="hint">Runs by itself every night at 03:30${d.last ? ` — last run ${fmt.date(d.last.at)} ${fmt.time(d.last.at)}, freed ${gb(d.last.freed)}` : ''}. “Clean up now” also clears slices older than a day. You’ll get a notification if free space drops below 5 GB.</p>`);
    $('#cleanNow').onclick = async () => {
      $('#cleanNow').disabled = true;
      try { const r = await Monitor.post('/api/storage/clean', {}); toast(`Freed ${gb(r.last.freed)}`); this.draw(r); }
      catch (e) { toast(`Couldn’t clean up: ${e.message}`, true); $('#cleanNow').disabled = false; }
    };
  },
};

// Opening Discover from the hub or Print a file starts a fresh search, not tied to an idea.
document.addEventListener('click', (e) => {
  if (e.target.closest('a[href="#/discover"]')) { store.set('discoverContext', null); DiscoverPage.setOpts({ q: '' }); }
});
// Old #/discover links open Trend Radar's Models tab.
function showModelsTab() { store.set('radarTab', 'models'); location.replace('#/radar'); }
