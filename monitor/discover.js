// Discover: browse popular / trending / newest models on Thingiverse through its official API
// (https://www.thingiverse.com/developers), check the licence, and download a model's STL/3MF
// straight into the slicer. The App Token stays on this PC (config.json "thingiverseToken").
// Thingiverse's API rules: no reselling or redistributing its content, and only do what the
// user asked for — so we fetch on request, cache briefly, and never republish files.

const API = 'https://api.thingiverse.com';
const LIST_TTL = 10 * 60 * 1000;
const THING_TTL = 24 * 3600 * 1000;
const PRINTABLE = /\.(stl|3mf)$/i;
const MAX_FILE = 200 * 1024 * 1024;
const BUDGET = 240; // Thingiverse allows 300 requests per 5 minutes; stay well under it
const DAILY = 800;  // Thingiverse's proposed free plan is about 1,000 calls a day; stay under it
const fs = require('fs');
const path = require('path');

// Licences that allow selling prints (no "Non-Commercial"). No-Derivatives still allows selling
// unmodified prints, so it counts, with a note.
function licenceInfo(name) {
  const l = String(name || '');
  if (!l) return { name: 'Unknown licence', sellable: null, note: 'Check the licence on Thingiverse before selling prints.' };
  if (/non.?commercial/i.test(l)) return { name: l, sellable: false, note: 'Personal use only — you can’t sell prints of this.' };
  if (/all rights reserved|standard digital file/i.test(l)) return { name: l, sellable: false, note: 'The designer keeps all rights — ask them before selling prints.' };
  if (/attribution|public domain|cc0|gnu|gpl|bsd|lgpl/i.test(l)) {
    return { name: l, sellable: true, note: /no derivatives/i.test(l) ? 'You can sell prints — credit the designer and don’t modify the model.'
      : /public domain|cc0/i.test(l) ? 'Free to use and sell.' : 'You can sell prints — credit the designer.' };
  }
  return { name: l, sellable: null, note: 'Check the licence on Thingiverse before selling prints.' };
}

class Discover {
  constructor(config, slicer, log, dataDir) {
    this.config = config;
    this.slicer = slicer;
    this.log = log;
    this.cache = new Map();
    // Request times over the last 24 hours, kept on disk so a restart doesn't reset the count.
    this.callsFile = dataDir ? path.join(dataDir, 'thingiverse-calls.json') : null;
    try { this.calls = JSON.parse(fs.readFileSync(this.callsFile, 'utf8')).filter((t) => t > Date.now() - 864e5); } catch { this.calls = []; }
  }

  // Counts requests so V9D stays under Thingiverse's limits: 240 per 5 minutes and 800 a day.
  // `reserve` keeps calls back for the nightly takedown check.
  spend(reserve = 0) {
    const now = Date.now();
    this.calls = this.calls.filter((t) => t > now - 864e5);
    if (this.calls.filter((t) => t > now - 5 * 60 * 1000).length >= BUDGET) throw new Error('Thingiverse request limit reached — try again in a few minutes');
    if (this.calls.length >= DAILY - reserve) throw new Error('V9D has used today’s Thingiverse allowance — try again tomorrow');
    this.calls.push(now);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { if (this.callsFile) fs.writeFileSync(this.callsFile, JSON.stringify(this.calls)); } catch {} }, 2000);
  }
  usage() { const day = this.calls.filter((t) => t > Date.now() - 864e5).length; return { today: day, limit: DAILY }; }

  token() { return this.config.thingiverseToken || process.env.THINGIVERSE_TOKEN || ''; }
  available() { return !!this.token(); }

  // reserve: browsing leaves 50 calls a day for the nightly takedown check.
  async api(path, ttl = LIST_TTL, reserve = 50) {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    if (!this.token()) throw new Error('No Thingiverse token on the home PC yet');
    this.spend(reserve);
    const res = await fetch(API + path, { headers: { Authorization: `Bearer ${this.token()}` }, signal: AbortSignal.timeout(15000) });
    // Thingiverse's Cloudflare bot check sometimes answers API calls with a "Just a moment…" page.
    // That's on their side (not the token) and V9D doesn't try to get around it.
    if (res.headers.get('cf-mitigated') === 'challenge' || /text\/html/i.test(res.headers.get('content-type') || '')) {
      throw new Error('Thingiverse’s bot protection is blocking API requests right now — not a problem with your token. Try again later.');
    }
    if (res.status === 401 || res.status === 403) throw new Error('Thingiverse refused the token — check it in config.json');
    if (res.status === 404 || res.status === 410) throw Object.assign(new Error('This model is no longer on Thingiverse'), { status: res.status });
    if (res.status === 429) throw new Error('Thingiverse says too many requests — try again in a few minutes');
    if (!res.ok) throw Object.assign(new Error(`Thingiverse replied ${res.status}`), { status: res.status });
    const data = await res.json();
    this.cache.set(path, { at: Date.now(), data });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
    return data;
  }

  summary(t) {
    return {
      id: t.id, name: t.name, thumbnail: t.thumbnail || t.default_image?.url || null,
      creator: t.creator?.name || null, likes: t.like_count || 0, makes: t.make_count || 0, downloads: t.download_count || 0,
      licence: t.license ? licenceInfo(t.license) : null, ai: !!t.is_ai, url: t.public_url || `https://www.thingiverse.com/thing:${t.id}`,
    };
  }

  // sort: popular | trending (popular, posted in the last 7 days) | newest | makes
  // limit: how many to fetch (Trend Radar's strips ask for 8, Discover for 30).
  async list({ q = '', sort = 'trending', sellable = false, page = 1, limit = 30 } = {}) {
    const params = new URLSearchParams({ type: 'things', per_page: String(Math.max(1, Math.min(30, limit | 0 || 30))), page: String(Math.max(1, Math.min(20, page | 0))) });
    params.set('sort', sort === 'newest' ? 'newest' : sort === 'makes' ? 'makes' : 'popular');
    if (sort === 'trending') params.set('posted_after', 'now-7d');
    const term = String(q).trim().slice(0, 80);
    const data = await this.api(`/search/${term ? encodeURIComponent(term) + '/' : ''}?${params}`);
    let items = (data.hits || data || []).filter((t) => !t.is_nsfw).map((t) => this.summary(t));
    if (sellable) {
      // The search results may leave the licence out; look it up per model (cached for a day).
      await Promise.all(items.filter((i) => !i.licence).slice(0, 12).map(async (i) => {
        try { const t = await this.api(`/things/${i.id}`, THING_TTL); i.licence = licenceInfo(t.license); } catch {}
      }));
      items = items.filter((i) => i.licence?.sellable);
    }
    return { total: data.total || items.length, items };
  }

  async thing(id) {
    id = String(id).replace(/\D/g, '');
    const [t, files, images] = await Promise.all([
      this.api(`/things/${id}`, THING_TTL),
      this.api(`/things/${id}/files`, THING_TTL),
      this.api(`/things/${id}/images`, THING_TTL).catch(() => []),
    ]);
    const pictures = (images || []).slice(0, 6).map((im) => {
      const sizes = im.sizes || [];
      const big = sizes.find((s) => s.type === 'display' && s.size === 'large') || sizes.find((s) => s.size === 'large') || sizes[0];
      return big?.url || null;
    }).filter(Boolean);
    return {
      ...this.summary(t),
      licence: licenceInfo(t.license),
      description: String(t.description || '').slice(0, 1200),
      pictures: pictures.length ? pictures : [t.thumbnail].filter(Boolean),
      files: (files || []).map((f) => ({ id: f.id, name: f.name, size: f.size, printable: PRINTABLE.test(f.name || ''), thumbnail: f.thumbnail || null })),
    };
  }

  // Downloads one STL/3MF into a new slice job. Nothing else is ever downloaded or opened.
  // extra: { occasion, idea } when it came from Trend Radar, kept with the product;
  // { fileName } finds the file by name when its id isn't known.
  async toJob(thingId, fileId, extra = {}) {
    const t = await this.thing(thingId);
    const f = t.files.find((x) => String(x.id) === String(fileId)) || (extra.fileName ? t.files.find((x) => x.name === extra.fileName) : null);
    if (!f) throw new Error('That file isn’t part of this model');
    if (!f.printable) throw new Error('Only STL and 3MF files can be sliced');
    if (f.size > MAX_FILE) throw new Error('File is larger than 200 MB');
    this.spend(50);
    const res = await fetch(`${API}/files/${f.id}/download`, { headers: { Authorization: `Bearer ${this.token()}` }, redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Thingiverse replied ${res.status} for the download`);
    if (Number(res.headers.get('content-length')) > MAX_FILE) throw new Error('File is larger than 200 MB');
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = f.name.match(PRINTABLE)[0].toLowerCase();
    const name = `${t.name}${t.files.filter((x) => x.printable).length > 1 ? ` – ${f.name.replace(PRINTABLE, '')}` : ''}`.slice(0, 80);
    return this.slicer.fromBuffer(buf, name, ext, {
      site: 'Thingiverse', id: t.id, url: t.url, file: f.name, fileId: f.id, thumbnail: t.thumbnail, creator: t.creator, licence: t.licence.name, sellable: t.licence.sellable,
      occasion: String(extra.occasion || '').slice(0, 60) || null, idea: String(extra.idea || '').slice(0, 120) || null,
    });
  }

  // Is this model still on Thingiverse? true / false, or null when it couldn't be checked
  // (offline, bot check, limit) — then nothing is removed. Uses the reserved part of the allowance.
  async stillListed(id) {
    try {
      const t = await this.api(`/things/${String(id).replace(/\D/g, '')}`, 0, 0);
      return !(t?.is_deleted || t?.is_banned || t?.moderation_status === 'removed');
    } catch (e) { return e.status === 404 || e.status === 410 ? false : null; }
  }
}

module.exports = { Discover, licenceInfo };
