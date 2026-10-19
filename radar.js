// V9D — Trend Radar: what's selling, upcoming hot dates and print ideas. The research runs on
// the V9D monitor every morning at 06:00 UK time (/api/trends).

// The API bills in US dollars; this approximate rate shows costs in pounds.
const USD_TO_GBP = 0.75;
const approxGBP = (gbp) => gbp < 0.995 ? `${Math.max(1, Math.round(gbp * 100))}p` : `£${gbp.toFixed(2)}`;

const RadarPage = {
  data: null,
  tab: 'ideas',
  filter: 'all',

  async render() {
    setHeader('Trend Radar', { back: true });
    this.tab = store.get('radarTab', 'ideas');
    $('#view').innerHTML = skeleton();
    const remembered = Monitor.cached('/api/trends');
    if (remembered?.research) { this.data = remembered; this.snapshot = null; this.draw(); }
    try {
      this.data = await Monitor.get('/api/trends');
    } catch (e) {
      // Monitor unreachable: still show the snapshot; hot dates need the monitor.
      this.data = { hotDates: [], hasKey: false, running: false, research: null, offline: e.message };
    }
    // No daily research yet: fall back to the one-off snapshot published with the app.
    this.snapshot = null;
    if (!this.data.research) {
      try {
        const snap = await (await fetch('trends-snapshot.json', { cache: 'no-store' })).json();
        this.snapshot = snap;
        this.data.research = snap;
      } catch {}
    }
    if (!this.data.research && this.tab !== 'dates') this.tab = 'dates';
    if (currentRoute() !== 'radar') return;
    this.draw();
    if (this.data.running) this.poll();
  },

  // While a run is in progress, check back until it finishes.
  poll() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (location.hash !== '#/radar') return;
      try { this.data = await Monitor.get('/api/trends'); } catch { return this.poll(); }
      this.draw();
      if (this.data.running) this.poll();
    }, 15000);
  },

  draw() {
    const d = this.data, r = d.research;
    const status = d.running ? 'Researching now — this takes a few minutes…'
      : this.snapshot ? `One-off snapshot · researched ${fmt.date(new Date(this.snapshot.date))}`
      : d.updatedAt ? `Updated ${fmt.date(d.updatedAt)} ${fmt.time(d.updatedAt)}${d.cost?.usd ? ` · cost ~${approxGBP(d.cost.usd * USD_TO_GBP)}` : ''} · next update 06:00 UK`
      : d.hasKey ? 'First update runs shortly.' : '';
    patch($('#view'), `
      ${d.offline ? `<p class="banner">${/404/.test(d.offline)
        ? 'Hot dates need the latest V9D monitor on the home PC — run the update there.'
        : 'Can’t reach the V9D monitor — check Tailscale is on.'} The snapshot below works anyway.</p>` : ''}
      ${this.snapshot ? `<p class="banner">📸 Showing a one-off research snapshot from ${fmt.date(new Date(this.snapshot.date))}. Automatic daily updates start once an Anthropic API key is added on the home PC.</p>`
        : !d.hasKey ? `<p class="banner">Hot dates work now. For trending products and print ideas, add an Anthropic API key on the home PC (the installer asks for it).</p>` : ''}
      ${d.error ? `<p class="banner warn">Last update failed: ${esc(d.error)}</p>` : ''}
      <div class="radar-status"><span class="muted">${esc(status)}</span>
        ${d.hasKey && !d.running ? '<button class="linkbtn" id="radarRefresh">Refresh now</button>' : ''}</div>
      ${r ? `<div class="hero"><div class="hero-label">Today’s focus</div><p class="radar-summary">${esc(r.summary)}</p></div>` : ''}
      <div class="seg">
        ${[['ideas', 'Print ideas'], ['dates', 'Hot dates'], ['trending', 'Trending']]
          .map(([k, l]) => `<button class="${this.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
      <div id="radarBody"></div>`);
    document.querySelectorAll('#view [data-tab]').forEach((b) => b.onclick = () => {
      this.tab = b.dataset.tab; store.set('radarTab', this.tab); this.draw();
    });
    const refresh = $('#radarRefresh');
    if (refresh) refresh.onclick = () => this.refresh();
    if (this.tab === 'dates') this.drawDates();
    else if (this.tab === 'trending') this.drawTrending();
    else this.drawIdeas();
  },

  // Cost of one run in pounds: the last run's actual cost if known, otherwise an estimate.
  runCost() {
    const usd = this.data.cost?.usd;
    return usd ? { gbp: usd * USD_TO_GBP, measured: true } : { gbp: 0.55, measured: false };
  },

  refresh() {
    const c = this.runCost();
    openSheet(`
      <h2>Refresh Trend Radar now?</h2>
      <p class="help-warn">💷 This uses your Anthropic API credit — about <b>${approxGBP(c.gbp)}</b> per run${c.measured ? ' (based on the last run)' : ' (estimate — the first run will show the real cost)'}.</p>
      <p class="note">It already updates automatically, so you only need this when something urgent comes up. It takes a few minutes.</p>
      <p class="note" id="refreshMsg"></p>
      <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="runNow">Run now · ~${approxGBP(c.gbp)}</button></div>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#runNow').onclick = async () => {
      $('#runNow').disabled = true;
      try {
        await Monitor.post('/api/trends/refresh', {});
        closeSheet();
        this.data.running = true; this.draw(); this.poll();
      } catch (e) {
        $('#refreshMsg').textContent = /429/.test(e.message) ? 'It was updated less than 30 minutes ago — try again later.'
          : /409/.test(e.message) ? 'It’s already running.' : `Couldn’t start: ${e.message}`;
        $('#runNow').disabled = false;
      }
    };
  },

  drawIdeas() {
    const r = this.data.research;
    if (!r) { $('#radarBody').innerHTML = `<div class="empty">${this.data.hasKey ? 'Ideas appear after the first morning update.' : 'Needs the Anthropic API key — see above.'}</div>`; return; }
    const events = [...new Set(r.ideas.map((i) => i.forEvent).filter(Boolean))];
    const p = Prices.get();
    const watts = { 'K2 Plus': 215, 'K1 Max': 235, Either: 225 };
    const ideas = r.ideas.filter((i) => this.filter === 'all' ? true
      : this.filter === 'K2 Plus' || this.filter === 'K1 Max' ? i.printer === this.filter || i.printer === 'Either'
      : i.forEvent === this.filter);
    $('#radarBody').innerHTML = `
      <div class="chips">${[['all', 'All'], ['K2 Plus', 'K2 Plus'], ['K1 Max', 'K1 Max'], ...events.map((e) => [e, e])]
        .map(([k, l]) => `<button class="chip ${this.filter === k ? 'on' : ''}" data-ifilter="${esc(k)}">${esc(l)}</button>`).join('')}</div>
      ${ideas.map((i) => {
        const cost = Prices.material(i.estGrams, p) + Prices.energy(i.estHours * watts[i.printer], p);
        return `
          <div class="idea">
            <div class="idea-top"><span class="idea-title">${esc(i.title)}</span><span class="tag-pill ${i.demand}">${esc(i.demand)} demand</span></div>
            ${i.forEvent ? `<div class="idea-event">📅 ${esc(i.forEvent)}</div>` : ''}
            <p class="idea-desc">${esc(i.description)}</p>
            <div class="idea-grid">
              <span>Printer</span><b>${esc(i.printer)}</b>
              <span>Material</span><b>${esc(i.material)}${i.colours > 1 ? ` · ${i.colours} colours` : ''}</b>
              <span>Size</span><b>${esc(i.sizeMm)}</b>
              <span>Per item</span><b>~${Math.round(i.estGrams)} g · ${fmt.hours(i.estHours * 3600)} · cost ~${fmt.money(cost)}</b>
              <span>Sells for</span><b>${esc(i.suggestedPrice)}</b>
              <span>Difficulty</span><b>${esc(i.difficulty)}</b>
            </div>
            <details><summary>Why & design source</summary><p class="muted">${esc(i.why)}</p><p class="muted">Design: ${esc(i.designSource)}</p></details>
          </div>`;
      }).join('') || '<div class="empty">No ideas for this filter.</div>'}
      <p class="hint">Ideas are researched by Claude each morning and checked against your printers’ size and materials. Cost uses your Usage & Costs prices. Always check a design’s licence allows selling prints.</p>`;
    document.querySelectorAll('[data-ifilter]').forEach((b) => b.onclick = () => { this.filter = b.dataset.ifilter; this.drawIdeas(); });
  },

  drawDates() {
    const ideas = this.data.research?.ideas || [];
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    let month = '', html = '';
    if (!this.data.hotDates.length) {
      $('#radarBody').innerHTML = `<div class="empty">${this.data.offline ? (/404/.test(this.data.offline) ? 'Hot dates appear once the V9D monitor on the home PC is updated.' : 'Hot dates come from the V9D monitor — turn on Tailscale and reopen this page.') : 'No upcoming dates.'}</div>`;
      return;
    }
    for (const e of this.data.hotDates) {
      const m = new Date(e.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      if (m !== month) { html += `<h3 class="day">${m}</h3>`; month = m; }
      const n = ideas.filter((i) => i.forEvent === e.name).length;
      const listBy = e.listBy < today ? `<span class="lb past">Listing window passed — local / last-minute sales only</span>`
        : e.listBy <= soon ? `<span class="lb now">List by ${fmt.date(e.listBy)} — this week!</span>`
        : `<span class="lb">List by ${fmt.date(e.listBy)}</span>`;
      html += `
        <div class="hotdate">
          <div class="hd-date"><b>${new Date(e.date).getDate()}</b><span>${new Date(e.date).toLocaleDateString('en-GB', { weekday: 'short' })}</span></div>
          <div class="hd-main">
            <div class="hd-name">${esc(e.name)}${e.approx ? ' <span class="muted">(approx.)</span>' : ''}</div>
            <div class="muted">${e.daysAway === 0 ? 'Today' : `in ${e.daysAway} days`} · ${esc(e.kind.replace('-', ' '))}</div>
            ${listBy}
            <div class="muted">${esc(e.hint)}</div>
            ${n ? `<button class="linkbtn" data-event="${esc(e.name)}">${n} print idea${n > 1 ? 's' : ''} →</button>` : ''}
          </div>
        </div>`;
    }
    $('#radarBody').innerHTML = html + '<p class="hint">“List by” leaves time to print, photograph and post before the day (about 4 weeks for gifting events, 8 for Christmas). Bank holidays from gov.uk; lunar festival dates are approximate.</p>';
    document.querySelectorAll('[data-event]').forEach((b) => b.onclick = () => {
      this.filter = b.dataset.event; this.tab = 'ideas'; store.set('radarTab', 'ideas'); this.draw();
    });
  },

  drawTrending() {
    const r = this.data.research;
    if (!r) { $('#radarBody').innerHTML = `<div class="empty">${this.data.hasKey ? 'Trending products appear after the first morning update.' : 'Needs the Anthropic API key — see above.'}</div>`; return; }
    const section = (region, label) => {
      const items = r.trending.filter((t) => t.region === region);
      if (!items.length) return '';
      return `<h3 class="day">${label}</h3>` + items.map((t) => `
        <div class="idea">
          <div class="idea-top"><span class="idea-title">${esc(t.name)}</span>
            <span class="tag-pill ${t.printable ? 'high' : 'low'}">${t.printable ? '✓ printable' : '✗ not printable'}</span></div>
          <div class="muted">${esc(t.category)} · ${esc(t.priceRange)}</div>
          <p class="idea-desc">${esc(t.why)}</p>
          <p class="muted">${esc(t.printNotes)}</p>
          <div class="sources">${t.sources.slice(0, 3).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>`).join('')}</div>
        </div>`).join('');
    };
    $('#radarBody').innerHTML = section('UK', '🇬🇧 United Kingdom') + section('Worldwide', '🌍 Worldwide') +
      `<p class="hint">Found by Claude’s web search each morning (Etsy, eBay, Amazon, social media and news), UK first. Sales figures from marketplaces are indications, not exact counts.</p>`;
  },
};
