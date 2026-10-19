// V9D — Products: things you sell. Each keeps its model, slice settings, sliced file and
// preview from "Print a file", plus your prices, packaging, listings and notes. From here:
// Print again in one tap, see cost per item and profit per channel, get a suggested price.

const PRINTER_NAMES = { 'k2-plus': 'K2 Plus', 'k1-max': 'K1 Max' };
const QUALITY_NAMES = { draft: 'Draft 0.24 mm', standard: 'Standard 0.20 mm', fine: 'Fine 0.16 mm', extrafine: 'Extra fine 0.12 mm' };
const productImg = (p) => Monitor.img(`/api/products/${p.id}/preview?t=${p.updated}`, p.demoImg || '');

const ProductsPage = {
  list: null,

  async render() {
    setHeader('Products', { back: true, actions: `<a class="icon-btn" href="#/printers/print" aria-label="New product">${icon('plus', 18)}</a>` });
    this.list = null;
    $('#view').innerHTML = skeleton();
    try {
      await Monitor.load('/api/products', (d) => { if (currentRoute() === 'products') { this.list = d.products; this.draw(); } });
    } catch (e) {
      if (!this.list) $('#view').innerHTML = `<p class="banner">Can’t reach the V9D monitor — check Tailscale is on. (${esc(e.message)})</p>`;
    }
  },

  draw() {
    const p = Prices.get(), fs = Fees.settings();
    if (!this.list.length) {
      patch($('#view'), `
        <div class="empty">
          <span class="pick-icon">${icon('tag', 40)}</span>
          <p><b>No products yet</b></p>
          <p>Slice a model in <b>Print a file</b>, then tap <b>Save as product</b>. Next time it’s one tap to print again — with its cost, price and profit worked out.</p>
          <a class="btn primary" href="#/printers/print">Print a file…</a>
        </div>`);
      return;
    }
    patch($('#view'), `
      <div class="prod-list">${this.list.map((x) => {
        const c = unitCost(x, p).total;
        const best = Object.entries(x.prices || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
        const pr = best ? Fees.profit(best[0], best[1], c, fs) : null;
        return `
        <a class="prod" href="#/products/${esc(x.id)}" data-key="${esc(x.id)}">
          <img src="${esc(productImg(x))}" alt="" loading="lazy">
          <span class="w-col">
            <b>${esc(x.name)}</b>
            <span class="muted">${fmt.money(c)} each${x.units > 1 ? ` · ${x.units} per print` : ''} · ${esc(PRINTER_NAMES[x.result?.printer] || '')}</span>
            ${pr ? `<span class="muted">${esc(Fees.CHANNELS[best[0]].label)} ${fmt.money(best[1])} → <b class="${pr.profit >= 0 ? 'pos' : 'neg'}">${fmt.money(Math.abs(pr.profit))} ${pr.profit >= 0 ? 'profit' : 'loss'}</b> (${Math.round(pr.margin * 100)}%)</span>`
              : `<span class="muted">No price yet · min. ${fmt.money(Fees.suggest('etsy', c, undefined, fs) || 0)} on Etsy for ${fs.margin}%</span>`}
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </a>`;
      }).join('')}</div>
      <p class="hint">Costs use your prices in Settings (filament ${fmt.money(p.fil)}/kg, electricity ${p.elec}p/kWh). Profit is after platform fees${fs.vatRegistered ? ' and VAT' : ''}.</p>`);
  },

  // ---------- One product ----------
  async detail(id) {
    setHeader('Product', { back: true, backTo: '#/products' });
    this.product = null;
    $('#view').innerHTML = skeleton();
    const path = `/api/products/${id}`;
    try {
      this.product = await Monitor.get(path);
    } catch (e) {
      $('#view').innerHTML = `<p class="banner">${/404/.test(e.message) ? 'This product no longer exists.' : `Can’t reach the V9D monitor. (${esc(e.message)})`}</p>`;
      return;
    }
    if (currentRoute() !== `products/${id}`) return;
    this.drawDetail();
  },

  drawDetail() {
    const x = this.product, p = Prices.get(), fs = Fees.settings(), r = x.result || {}, s = x.settings || {};
    const c = unitCost(x, p);
    const printer = PRINTER_NAMES[r.printer] || r.printer;
    $('#view').innerHTML = `
      <div class="prod-hero">
        <img src="${esc(productImg(x))}" alt="">
        <div class="prod-title"><input id="pName" value="${esc(x.name)}" aria-label="Product name" maxlength="80"><span class="muted" id="saved"></span></div>
        <span class="muted">${x.printed ? `Printed ${x.printed} time${x.printed > 1 ? 's' : ''} · last ${fmt.date(x.lastPrinted)}` : 'Not printed from V9D yet'}</span>
      </div>

      <div class="ctrl-row">
        <button class="btn primary" id="printAgain">${icon('printer', 18)} Print again</button>
        <button class="btn" id="sendOnly">Send to printer</button>
      </div>
      <p class="hint print-meta">${esc(printer)} · about ${fmt.hours(r.seconds || 0)} · done ${finishTime(r.seconds || 0)} if started now · ${r.grams || 0} g</p>

      <h3 class="day">Cost per item</h3>
      <div class="panel detail-grid">
        <span>Items per print</span><b><input class="num" id="pUnits" type="number" inputmode="numeric" min="1" max="500" value="${x.units || 1}"></b>
        <span>Filament</span><b>${fmt.money(c.filament)}</b>
        <span>Electricity</span><b>${fmt.money(c.power)}</b>
        <span>Printer time <small>${fmt.money(fs.hourly)}/h</small></span><b>${fmt.money(c.time)}</b>
        <span>Packaging</span><b>£<input class="num" id="pPack" type="number" inputmode="decimal" step="0.05" min="0" value="${(x.packaging || 0).toFixed(2)}"></b>
        <span class="tot">Total</span><b class="tot" id="pCost">${fmt.money(c.total)}</b>
      </div>

      <h3 class="day">Prices & profit</h3>
      <div class="panel" id="pricing">${this.pricingHtml()}</div>
      <p class="hint">Profit is after platform fees and all costs above. “Min.” is the lowest price that keeps a ${fs.margin}% margin — similar items often sell for more (see Trend Radar). Change the target, printer time rate, eBay seller type and VAT in Settings → Selling.</p>

      <h3 class="day">Print settings</h3>
      <div class="panel detail-grid">
        <span>Printer</span><b>${esc(printer)}</b>
        <span>Quality</span><b>${esc(QUALITY_NAMES[s.quality] || s.quality || '')}</b>
        <span>Infill</span><b>${s.infill ?? '—'}%</b>
        <span>Supports</span><b>${s.supports ? 'Tree' : 'Off'}</b>
        <span>Filament</span><b>${(r.perColour || []).map((k) => `<span class="swatch sm" style="background:${esc(k.colour)}"></span> ${k.slot ? `${k.slot} · ` : ''}${esc(k.material)}`).join('<br>') || '—'}</b>
      </div>
      <button class="btn block" id="changeSettings">Change settings or printer…</button>

      <h3 class="day">Listings</h3>
      <div class="panel" id="listings">${this.listingsHtml()}</div>

      <h3 class="day">Notes</h3>
      <textarea id="pNotes" class="notes" rows="3" placeholder="Colours customers ask for, packing tips…">${esc(x.notes || '')}</textarea>

      <button class="btn danger block" id="deleteProduct">Delete product</button>`;
    this.bindDetail();
  },

  pricingHtml() {
    const x = this.product, c = unitCost(x).total, fs = Fees.settings();
    return Object.entries(Fees.CHANNELS).map(([ch, info]) => {
      const price = x.prices?.[ch];
      const pr = price > 0 ? Fees.profit(ch, price, c, fs) : null;
      const sug = Fees.suggest(ch, c, undefined, fs);
      return `
        <div class="price-row" data-ch="${ch}">
          <span class="price-ch">${esc(info.label)}${ch === 'ebay' ? `<small>${fs.ebayBusiness ? 'business seller' : 'private seller'}</small>` : ''}</span>
          <label class="price-in">£<input type="number" inputmode="decimal" step="0.01" min="0" placeholder="—" value="${price > 0 ? price.toFixed(2) : ''}" data-price="${ch}" aria-label="${esc(info.label)} price"></label>
          <span class="price-out">${pr ? `<b class="${pr.profit >= 0 ? 'pos' : 'neg'}">${pr.profit >= 0 ? '' : '−'}${fmt.money(Math.abs(pr.profit))}</b><small>${Math.round(pr.margin * 100)}% · fees ${fmt.money(pr.fee)}</small>` : '<small>not sold here</small>'}</span>
          ${sug && !(price >= sug) ? `<button class="chip ${price > 0 ? 'warn' : ''}" data-suggest="${ch}" data-v="${sug}">${price > 0 ? 'Below' : 'Min.'} ${fmt.money(sug)} for ${fs.margin}% — use it</button>` : ''}
        </div>`;
    }).join('');
  },

  listingsHtml() {
    const l = this.product.listings || [];
    const names = { etsy: 'Etsy', ebay: 'eBay', shop: 'Own shop', other: 'Link' };
    return (l.map((x, i) => `<div class="row-item"><span>${esc(names[x.channel])}</span><a class="muted" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 40))}…</a><button class="linkbtn" data-unlist="${i}">Remove</button></div>`).join('')
      || '<p class="muted">No listing links yet.</p>') + '<button class="linkbtn" id="addListing">+ Add a listing link</button>';
  },

  // Saves edits as you type (short pause), then refreshes the numbers.
  save(fields) {
    Object.assign(this.product, fields, fields.prices ? { prices: { ...this.product.prices, ...fields.prices } } : {});
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        this.product = await Monitor.post(`/api/products/${this.product.id}`, fields);
        if ($('#saved')) { $('#saved').textContent = 'Saved'; setTimeout(() => { if ($('#saved')) $('#saved').textContent = ''; }, 1500); }
      } catch (e) { toast(`Couldn’t save: ${e.message}`, true); }
    }, 500);
  },

  refreshNumbers() {
    $('#pCost').textContent = fmt.money(unitCost(this.product).total);
    patch($('#pricing'), this.pricingHtml());
    this.bindPricing();
  },

  bindPricing() {
    document.querySelectorAll('[data-price]').forEach((inp) => inp.oninput = () => {
      const v = inp.value === '' ? null : Number(inp.value);
      this.save({ prices: { [inp.dataset.price]: v } });
      clearTimeout(this.calcTimer);
      this.calcTimer = setTimeout(() => this.refreshNumbers(), 400);
    });
    document.querySelectorAll('[data-suggest]').forEach((b) => b.onclick = () => {
      this.save({ prices: { [b.dataset.suggest]: Number(b.dataset.v) } });
      this.refreshNumbers();
    });
  },

  bindDetail() {
    const x = this.product;
    $('#pName').oninput = (e) => { if (e.target.value.trim()) this.save({ name: e.target.value }); };
    $('#pUnits').oninput = (e) => { const v = Math.max(1, Math.round(Number(e.target.value) || 1)); this.save({ units: v }); this.refreshNumbers(); };
    $('#pPack').oninput = (e) => { this.save({ packaging: Math.max(0, Number(e.target.value) || 0) }); this.refreshNumbers(); };
    $('#pNotes').oninput = (e) => this.save({ notes: e.target.value });
    this.bindPricing();
    this.bindListings();
    $('#printAgain').onclick = () => this.printSheet();
    $('#sendOnly').onclick = () => this.print(false);
    $('#changeSettings').onclick = async () => {
      try {
        const job = await Monitor.post(`/api/products/${x.id}/settings`, {});
        store.set('printJob', job.id);
        store.set('printPrinter', x.result?.printer);
        location.hash = '#/printers/print';
      } catch (e) { toast(`Couldn’t open the settings: ${e.message}`, true); }
    };
    $('#deleteProduct').onclick = () => {
      openSheet(`<h2>Delete ${esc(x.name)}?</h2><p class="note">Its saved file, picture and prices are removed. Files already on the printers stay.</p>
        <div class="row"><button class="btn" id="cancelSheet">Keep</button><button class="btn danger-fill" id="doDelete">Delete</button></div>`);
      $('#cancelSheet').onclick = closeSheet;
      $('#doDelete').onclick = async () => {
        try { await Monitor.post(`/api/products/${x.id}/delete`, {}); closeSheet(); toast('Product deleted'); location.hash = '#/products'; }
        catch (e) { toast(`Couldn’t delete: ${e.message}`, true); }
      };
    };
  },

  bindListings() {
    document.querySelectorAll('[data-unlist]').forEach((b) => b.onclick = () => {
      const l = this.product.listings.filter((_, i) => i !== +b.dataset.unlist);
      this.save({ listings: l }); this.product.listings = l;
      patch($('#listings'), this.listingsHtml()); this.bindListings();
    });
    $('#addListing').onclick = () => {
      openSheet(`<h2>Add a listing link</h2>
        <label class="field"><span>Where</span><select id="lCh"><option value="etsy">Etsy</option><option value="ebay">eBay</option><option value="shop">Own shop</option><option value="other">Other</option></select></label>
        <label class="field"><span>Link (https://…)</span><input id="lUrl" type="url" inputmode="url" placeholder="https://www.etsy.com/uk/listing/…"></label>
        <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="doAdd">Add</button></div>`);
      $('#cancelSheet').onclick = closeSheet;
      $('#doAdd').onclick = () => {
        const url = $('#lUrl').value.trim();
        if (!/^https:\/\/\S+\.\S+/.test(url)) return toast('Paste the full link, starting with https://', true);
        const l = [...(this.product.listings || []), { channel: $('#lCh').value, url }];
        this.save({ listings: l }); this.product.listings = l;
        closeSheet(); patch($('#listings'), this.listingsHtml()); this.bindListings();
      };
    };
  },

  async printSheet() {
    const x = this.product, r = x.result || {};
    const cfs = r.printer === 'k2-plus' ? await Monitor.get(`/api/printer/${r.printer}/cfs`).catch(() => null) : null;
    const status = await Monitor.get(`/api/printer/${r.printer}`).catch(() => null);
    const busy = status && ['printing', 'paused'].includes(status.job?.state);
    const empty = (r.perColour || []).filter((k) => k.slot && cfs?.slots?.find((sl) => sl.slot === k.slot)?.empty);
    openSheet(`
      <h2>Print ${esc(x.name)}?</h2>
      <img class="start-thumb" src="${esc(productImg(x))}" alt="">
      <p class="note">On the ${esc(PRINTER_NAMES[r.printer] || r.printer)} · about ${fmt.hours(r.seconds || 0)} · done ${finishTime(r.seconds || 0)} · ${r.grams} g${x.units > 1 ? ` · ${x.units} items` : ''}</p>
      ${busy ? `<p class="help-warn">The ${esc(PRINTER_NAMES[r.printer])} is busy — “Send to printer” instead, or change the printer in the settings.</p>` : ''}
      ${empty.length ? `<p class="help-warn">Slot ${empty.map((k) => k.slot).join(', ')} looks empty. Load it first or the print will stop for filament.</p>` : ''}
      <label class="check"><input type="checkbox" id="plateClear" ${busy ? 'disabled' : ''}><span>The build plate is clear and the right filament is loaded</span></label>
      <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="doStart" disabled>Start print</button></div>`);
    $('#cancelSheet').onclick = closeSheet;
    $('#plateClear').onchange = (e) => { $('#doStart').disabled = !e.target.checked; };
    $('#doStart').onclick = async () => { $('#doStart').disabled = true; if (await this.print(true)) { closeSheet(); store.set('dashIndex', Math.max(0, (await Printers.load()).findIndex((pp) => pp.id === r.printer))); location.hash = '#/printers'; } else $('#doStart').disabled = false; };
  },

  async print(start) {
    try {
      const res = await Monitor.post(`/api/products/${this.product.id}/print`, { start, plateClear: start });
      if (res.product) this.product = res.product;
      toast(res.message || 'Sent');
      return true;
    } catch (e) {
      toast(/400/.test(e.message) ? 'The printer refused it — check it’s on and not busy' : `Couldn’t send: ${e.message}`, true);
      return false;
    }
  },
};

// "Save as product" / "Update product" from a sliced job (used by Print a file).
function saveProductSheet(job) {
  const p = Prices.get();
  const cost = unitCost({ result: { ...job.result, printer: job.settings?.printer }, units: 1 }, p).total;
  openSheet(`
    <h2>Save as product</h2>
    <p class="note">Keeps this file, its settings and picture, so you can print it again in one tap and track its price and profit.</p>
    <label class="field"><span>Name</span><input id="spName" value="${esc(job.name)}" maxlength="80"></label>
    <label class="field"><span>Items per print (how many on the plate)</span><input id="spUnits" type="number" inputmode="numeric" min="1" value="1"></label>
    <label class="field"><span>Etsy price, £ (optional — suggested ${fmt.money(Fees.suggest('etsy', cost) || 0)})</span><input id="spPrice" type="number" inputmode="decimal" step="0.01" min="0" placeholder="—"></label>
    <div class="row"><button class="btn" id="cancelSheet">Cancel</button><button class="btn primary" id="doSave">Save product</button></div>`);
  $('#cancelSheet').onclick = closeSheet;
  $('#doSave').onclick = async () => {
    $('#doSave').disabled = true;
    try {
      const price = $('#spPrice').value === '' ? null : Number($('#spPrice').value);
      const prod = await Monitor.post('/api/products', { fromJob: job.id, name: $('#spName').value, units: $('#spUnits').value, prices: price ? { etsy: price } : {} });
      job.productId = prod.id;
      closeSheet(); toast('Saved to Products');
      location.hash = `#/products/${prod.id}`;
    } catch (e) { $('#doSave').disabled = false; toast(`Couldn’t save: ${e.message}`, true); }
  };
}
