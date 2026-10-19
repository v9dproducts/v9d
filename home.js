// V9D — Home (widget board), Business hub and Settings. The home widgets pull live data
// from the V9D monitor; each widget degrades on its own if its data isn't available.

const HomePage = {
  async render() {
    setHeader('V9D', { tabRoot: true });
    const now = new Date();
    $('#view').innerHTML = `
      <div class="home-head">
        <div><span class="muted">${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>Dashboard</h1></div>
        <img class="home-logo" src="icons/logo-banner.png" alt="V9D — Think. Make. V9D.">
      </div>
      <div class="widgets" id="widgets">${skeleton('widgets')}</div>`;
    const list = await Printers.load();
    // Remembered data first (instant), then fresh data, then a quiet refresh every few seconds.
    const PATHS = ['/api/status', '/api/power', '/api/maintenance', '/api/trends'];
    const remembered = PATHS.map((p) => Monitor.cached(p));
    if (remembered[0]) this.draw(this.shape(remembered, list));
    clearTimeout(this.timer);
    const refresh = async () => {
      const fresh = await Promise.all(PATHS.map((p) => Monitor.get(p).catch(() => null)));
      if (currentRoute() !== '') return; // navigated away meanwhile
      if (!fresh[3]?.research && !this.snapshot) this.snapshot = await fetch('trends-snapshot.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      this.draw(this.shape(fresh, list));
      this.timer = setTimeout(refresh, 5000);
    };
    await refresh();
  },

  shape([status, power, maint, trends], list) {
    return { status, power, maint, trends, research: trends?.research || this.snapshot || null, list };
  },

  draw({ status, power, maint, trends, research, list }) {
    const p = Prices.get();
    const st = (id) => status?.printers?.[id];
    const active = (s) => s && (s.state === 'printing' || s.state === 'paused');
    const hero = list.find((x) => active(st(x.id))) || list[0];
    const others = list.filter((x) => x !== hero);
    const offline = !status;

    // Hero: the busy printer with its live camera, or the main printer at rest.
    let heroHtml = '';
    if (hero) {
      const s = st(hero.id) || {};
      const busy = active(s);
      const chip = busy ? `● ${s.state === 'paused' ? 'Paused' : 'Printing'} ${s.progress}%` : s.state ? (STATE_TEXT[s.state] || s.state) : 'Offline';
      heroHtml = `
        <a class="w w-hero" href="#/printers" data-printer="${esc(hero.id)}">
          <div class="w-cam">${busy && hero.camera ? `<iframe src="${esc(cameraUrl(hero.id))}" title="${esc(hero.name)} camera" allow="autoplay" tabindex="-1"></iframe>` : `<span class="w-cam-idle">${icon('printer', 44)}</span>`}
            <span class="w-chip ${busy ? 'busy' : ''}">${esc(chip)}</span></div>
          <div class="w-hero-body">
            <div class="w-hero-row"><b>${esc(busy && s.file ? s.file : hero.name)}</b>
              <span>${busy && s.timeLeft ? `done ${finishTime(s.timeLeft)}` : ''}</span></div>
            ${busy ? `<div class="w-bar"><i style="width:${s.progress}%"></i></div>` : `<div class="w-sub">${offline ? 'Can’t reach the monitor right now' : 'Ready for the next print'}</div>`}
          </div>
        </a>`;
    }

    const otherHtml = others.map((o) => {
      const s = st(o.id) || {};
      return `<a class="w" href="#/printers" data-printer="${esc(o.id)}"><span class="w-ico">${icon('printer', 26)}</span><b>${esc(o.name)}</b>
        <span class="w-sub">${s.state ? `${esc(STATE_TEXT[s.state] || s.state)}${active(s) ? ` · ${s.progress}%` : s.state === 'idle' || s.state === 'complete' ? ' · ready to print' : ''}` : '—'}</span></a>`;
    }).join('');

    const watts = power ? Object.values(power.printers).reduce((a, x) => a + (x.watts || 0), 0) : null;
    const todayWh = power ? Object.values(power.printers).reduce((a, x) => a + (x.todayWh || 0), 0) : 0;
    const powerHtml = `<a class="w" href="#/power"><span class="w-ico">${icon('bolt', 26)}</span>
      <span class="w-big" data-tween>${watts === null ? '—' : Math.round(watts) + ' W'}</span>
      <span class="w-sub">${watts === null ? 'Power' : `${fmt.money(Prices.energy(todayWh, p))} so far today`}</span></a>`;

    const items = maint ? Object.values(maint.printers).flatMap((pr) => pr.items.map((i) => ({ ...i, printer: pr.name }))) : [];
    const dueItems = items.filter((i) => i.status !== 'ok').sort((a, b) => (a.status === 'due' ? -1 : 1));
    const maintHtml = `<a class="w" href="#/maintenance"><span class="w-ico">${icon('wrench', 26)}</span>
      <b>${maint ? (dueItems.length ? `${dueItems.length} job${dueItems.length > 1 ? 's' : ''} due` : 'All up to date') : 'Maintenance'}</b>
      <span class="w-sub">${maint ? esc(dueItems.slice(0, 2).map((i) => i.name.split(' ')[0] === 'Clean' ? i.name.replace(/^Clean & (lubricate|oil) /, '') : i.name).join(', ')) || 'Nothing due' : '—'}</span>
      ${dueItems.length ? '<span class="w-dot"></span>' : ''}</a>`;

    const today = new Date().toISOString().slice(0, 10);
    const next = (trends?.hotDates || []).find((d) => d.listBy >= today);
    const days = next ? Math.round((new Date(next.listBy) - new Date(today)) / 864e5) : null;
    const dateHtml = `<a class="w" href="#/radar"><span class="w-ico">${icon('calendar', 26)}</span>
      <b>${next ? (days === 0 ? 'List today' : `${days} day${days > 1 ? 's' : ''}`) : 'Hot dates'}</b>
      <span class="w-sub">${next ? `to list ${esc(next.name.replace(/\s*\(.*\)$/, ''))} items` : '—'}</span></a>`;

    const ideas = research?.ideas || [];
    const idea = ideas.length ? ideas[Math.floor(Date.now() / 864e5) % ideas.length] : null;
    const ideaHtml = idea ? `<a class="w w-wide" href="#/radar"><span class="w-icon">${icon('bulb', 26)}</span>
      <span class="w-col"><span class="w-label">Idea of the day</span><b>${esc(idea.title)}</b>
      <span class="w-sub">Sells ${esc(idea.suggestedPrice.split(' (')[0])} · costs ~${fmt.money(Prices.material(idea.estGrams, p) + Prices.energy(idea.estHours * 225, p))}</span></span></a>` : '';

    if (!$('#widgets')) return;
    patch($('#widgets'), (offline ? '<p class="banner">Can’t reach the V9D monitor — showing what’s available. Check Tailscale is on.</p>' : '') +
      heroHtml + otherHtml + powerHtml + maintHtml + dateHtml + ideaHtml);

    // Tapping a printer widget opens the dashboard on that printer.
    document.querySelectorAll('[data-printer]').forEach((a) => a.onclick = () => {
      const i = list.findIndex((x) => x.id === a.dataset.printer);
      if (i >= 0) store.set('dashIndex', i);
    });
  },
};

const BusinessPage = {
  render() {
    setHeader('Business', { tabRoot: true });
    const tiles = [
      ['#/products', 'tag', 'Products', 'What you sell: print again, cost, price, profit'],
      ['#/usage', 'chart', 'Usage & Costs', 'Material and electricity per print'],
      ['#/power', 'bolt', 'Live Power', 'What the printers draw right now'],
      ['#/radar', 'trend', 'Trend Radar', 'What’s selling, hot dates, print ideas'],
      ['#/maintenance', 'wrench', 'Maintenance', 'Wear parts, service and how-to guides'],
    ];
    $('#view').innerHTML = `<div class="hub">${tiles.map(([href, e, t, s]) => `
      <a class="hub-row" href="${href}"><span class="hub-icon">${icon(e, 26)}</span>
        <span class="w-col"><b>${t}</b><span class="w-sub">${s}</span></span><span class="chev" aria-hidden="true">›</span></a>`).join('')}</div>`;
  },
};

const SettingsPage = {
  render() {
    setHeader('Settings', { tabRoot: true });
    const calc = priceCalculator(() => {});
    $('#view').innerHTML = `
      <h3 class="day">Notifications</h3>
      <button class="hub-row" id="setAlerts"><span class="hub-icon">${icon('bell', 26)}</span>
        <span class="w-col"><b>Notifications</b><span class="w-sub">Print alerts, maintenance reminders, tests</span></span><span class="chev" aria-hidden="true">›</span></button>
      <h3 class="day">Prices</h3>
      ${calc.html}
      <h3 class="day">Selling</h3>
      <div class="panel toggles">
        <label class="field"><span>Target margin for suggested prices: <b id="mVal">${Fees.settings().margin}%</b></span>
          <input type="range" id="sMargin" min="20" max="80" step="5" value="${Fees.settings().margin}" class="slider"></label>
        <label class="field"><span>Printer time, £ per hour <small class="muted">— wear, failed prints, your time; added to product costs</small></span>
          <input type="number" id="sHourly" inputmode="decimal" step="0.25" min="0" max="20" value="${Fees.settings().hourly}"></label>
        <label class="check"><input type="checkbox" id="sEbay" ${Fees.settings().ebayBusiness ? 'checked' : ''}><span>eBay business seller <small class="muted">about 12.8% + 30p per order; private sellers pay no fees on most UK sales</small></span></label>
        <label class="check"><input type="checkbox" id="sVat" ${Fees.settings().vatRegistered ? 'checked' : ''}><span>VAT registered <small class="muted">prices include 20% VAT you pay; VAT on platform fees is reclaimed</small></span></label>
      </div>
      <h3 class="day">Printers</h3>
      <a class="hub-row" href="#/printers/manage"><span class="hub-icon">${icon('printer', 26)}</span>
        <span class="w-col"><b>Manage printers</b><span class="w-sub">Add, edit, export or import printers</span></span><span class="chev" aria-hidden="true">›</span></a>`;
    calc.bind();
    $('#setAlerts').onclick = () => Alerts.open();
    $('#sMargin').oninput = (e) => { $('#mVal').textContent = `${e.target.value}%`; Fees.set({ margin: +e.target.value }); };
    $('#sEbay').onchange = (e) => Fees.set({ ebayBusiness: e.target.checked });
    $('#sHourly').oninput = (e) => { const v = Number(e.target.value); if (v >= 0 && v <= 20) Fees.set({ hourly: v }); };
    $('#sVat').onchange = (e) => Fees.set({ vatRegistered: e.target.checked });
  },
};
