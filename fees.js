// V9D — selling fees, profit and suggested prices per channel (UK rules, checked October 2026;
// they change occasionally, so they're kept together here). Shared by Products and Sales.
//
// Etsy UK: 6.5% transaction fee + 4% + £0.20 payment processing + $0.20 (~£0.15) listing fee per
//   sale; UK sellers are charged 20% VAT on Etsy's fees (VAT-registered sellers reclaim it).
// eBay UK: private sellers pay no selling fees on most UK sales (since 2024); business sellers
//   pay about 12.8% + £0.30 per order (varies a little by category).
// Local / markets: no fees.

const Fees = {
  CHANNELS: {
    etsy: { label: 'Etsy', pct: 0.105, fixed: 0.35, feeVat: true },
    ebay: { label: 'eBay', pct: 0, fixed: 0, feeVat: false, business: { pct: 0.128, fixed: 0.30, feeVat: true } },
    local: { label: 'Local / markets', pct: 0, fixed: 0, feeVat: false },
  },
  DEFAULTS: { ebayBusiness: false, vatRegistered: false, margin: 50, hourly: 1 },
  settings() { return { ...this.DEFAULTS, ...store.get('fees', {}) }; },
  set(s) { store.set('fees', { ...this.settings(), ...s }); },

  rule(channel, s = this.settings()) {
    const c = this.CHANNELS[channel];
    return channel === 'ebay' && s.ebayBusiness ? { ...c, ...c.business } : c;
  },
  // Fees the platform takes from a sale at this price (incl. VAT on fees unless reclaimed).
  fee(channel, price, s = this.settings()) {
    const r = this.rule(channel, s);
    const vat = r.feeVat && !s.vatRegistered ? 1.2 : 1;
    return (price * r.pct + (price > 0 ? r.fixed : 0)) * vat;
  },
  // What you keep from the price after VAT you owe (VAT-registered only).
  net(price, s = this.settings()) { return s.vatRegistered ? price / 1.2 : price; },
  profit(channel, price, unitCost, s = this.settings()) {
    const fee = this.fee(channel, price, s);
    const profit = this.net(price, s) - fee - unitCost;
    return { fee, profit, margin: price > 0 ? profit / price : 0 };
  },
  // Lowest "nice" price (x.49 / x.99) that reaches the target margin.
  suggest(channel, unitCost, margin = this.settings().margin / 100, s = this.settings()) {
    const r = this.rule(channel, s), m = r.feeVat && !s.vatRegistered ? 1.2 : 1, v = s.vatRegistered ? 1 / 1.2 : 1;
    const raw = (unitCost + r.fixed * m) / (v - r.pct * m - margin);
    if (!(raw > 0) || !Number.isFinite(raw)) return null;
    const nice = Math.ceil((raw + 0.01) * 2) / 2 - 0.01;
    return Math.max(0.99, Math.round(nice * 100) / 100);
  },
};

// Cost of one item: filament, electricity and printer time (wear, failed prints, your time; £/hour
// from Settings → Selling) for the whole print, shared by the items on the plate, plus packaging.
function unitCost(product, p = Prices.get(), hourly = Fees.settings().hourly) {
  const r = product.result || {};
  const watts = r.printer === 'k1-max' ? 235 : 215; // typical draw while printing (Usage & Costs)
  const filament = Prices.material(r.grams || 0, p);
  const power = Prices.energy(((r.seconds || 0) / 3600) * watts + 30, p);
  const time = ((r.seconds || 0) / 3600) * hourly;
  const units = Math.max(1, product.units || 1);
  return { filament: filament / units, power: power / units, time: time / units, packaging: product.packaging || 0, total: (filament + power + time) / units + (product.packaging || 0) };
}
