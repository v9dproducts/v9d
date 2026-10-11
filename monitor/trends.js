// Trend Radar: once a day at 06:00 UK time, Claude researches what 3D-printed products are
// selling (UK first, then worldwide), then turns that into print ideas checked against the
// printers' capabilities. Two calls:
//   1. research — web search, writes notes with source links
//   2. format   — turns the notes into fixed JSON for the app (structured outputs can't be
//                 combined with web-search citations in one call)

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const { hotDates } = require('./events');

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, search: 10 / 1000 }; // USD, Claude Opus 5.5

const PRINTERS = `- Creality K2 Plus: build volume 350 × 350 × 350 mm, enclosed and heated chamber, up to 4 colours/materials in one print when the CFS unit is used. PLA, PETG, ABS, ASA, TPU, PA/PC and carbon-fibre blends.
- Creality K1 Max: build volume 300 × 300 × 300 mm, enclosed, single colour. PLA, PETG, ABS, ASA, TPU (95A).
Both are fast CoreXY FDM printers with 0.4 mm nozzles by default.`;

const Idea = z.object({
  title: z.string(),
  description: z.string().describe('What it is and who buys it, 1–2 sentences'),
  forEvent: z.string().nullable().describe('Exact name of the hot date it targets, or null'),
  printer: z.enum(['K2 Plus', 'K1 Max', 'Either']),
  material: z.string(),
  colours: z.number().describe('Number of colours/materials in one print'),
  sizeMm: z.string().describe('Approximate size, e.g. "120 × 80 × 60 mm"'),
  estGrams: z.number().describe('Estimated filament per item in grams'),
  estHours: z.number().describe('Estimated print hours per item'),
  suggestedPrice: z.string().describe('Typical UK retail price range, e.g. "£12–18"'),
  demand: z.enum(['high', 'medium', 'low']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  designSource: z.string().describe('How to get the design: design it yourself, or a model with a licence that allows selling prints (say which licence to check)'),
  why: z.string().describe('Evidence or reasoning for demand'),
});

const Report = z.object({
  summary: z.string().describe('2–3 sentence overview of what is selling right now and what to focus on'),
  trending: z.array(z.object({
    name: z.string(),
    region: z.enum(['UK', 'Worldwide']),
    category: z.string(),
    why: z.string(),
    priceRange: z.string(),
    printable: z.boolean().describe('Can be made on these printers without non-printed parts that are hard to source'),
    printNotes: z.string(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  })),
  ideas: z.array(Idea),
});

const RESEARCH_SYSTEM = `You research the market for a small UK 3D printing business that sells through local adverts, Etsy, eBay, its own shop and craft markets. Their printers:
${PRINTERS}

Use web search to find what 3D-printed products are selling and trending right now. Prioritise UK evidence (Etsy UK, eBay UK, Amazon UK, UK social media and news), then worldwide trends that are likely to reach the UK. Prefer concrete signals — bestseller badges, sold counts, review counts, trending lists — over generic "top 10 ideas" articles, and note how recent each source is.

Write research notes, not a polished report: for each product or trend, what it is, the evidence, the typical price, and the source URL.`;

function londonParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

class Trends {
  constructor(dataDir, config, log) {
    this.file = path.join(dataDir, 'trends.json');
    this.config = config; this.log = log;
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.state = {}; }
    this.running = false;
    setInterval(() => this.tick(), 60 * 1000);
    setTimeout(() => this.tick(), 20 * 1000);
  }

  apiKey() { return this.config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || ''; }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  // Runs once per UK day, at or after 06:00 (catches up if the PC was off at 06:00).
  tick() {
    const now = londonParts();
    if (!this.apiKey() || this.running || now.hour < 6 || this.state.lastRunDay === now.day) return;
    this.run().catch(() => {});
  }

  async report() {
    return {
      hotDates: await hotDates(150),
      hasKey: !!this.apiKey(),
      running: this.running,
      updatedAt: this.state.updatedAt || null,
      error: this.state.error || null,
      research: this.state.result || null,
      cost: this.state.cost || null,
    };
  }

  async run() {
    if (this.running) throw new Error('already running');
    this.running = true;
    const day = londonParts().day;
    this.log('Trend Radar: research started');
    try {
      const client = new Anthropic({ apiKey: this.apiKey() });
      const dates = (await hotDates(90)).map((d) => `- ${d.date}: ${d.name} (list by ${d.listBy}; ${d.hint})`).join('\n');
      const previous = (this.state.result?.ideas || []).map((i) => i.title).join('; ');

      // 1. Research with web search
      const messages = [{
        role: 'user',
        content: `Today is ${day}. Research what 3D-printed products are selling well right now — UK first, then worldwide.

Upcoming dates the business could sell for:
${dates}

Also look for products tied to the nearest of these dates. Finish with notes on the 15–25 most promising products to make, with evidence and source URLs.`,
      }];
      let research, usage = { input: 0, output: 0, searches: 0 };
      for (let i = 0; i < 5; i++) {
        research = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          system: RESEARCH_SYSTEM,
          tools: [{
            type: 'web_search_20260209', name: 'web_search', max_uses: 10,
            user_location: { type: 'approximate', country: 'GB', timezone: 'Europe/London' },
          }],
          messages,
        });
        usage.input += research.usage.input_tokens + (research.usage.cache_read_input_tokens || 0);
        usage.output += research.usage.output_tokens;
        usage.searches += research.usage.server_tool_use?.web_search_requests || 0;
        if (research.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: research.content });
      }
      if (research.stop_reason === 'refusal') throw new Error('Claude declined the research request');
      const notes = research.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (!notes.trim()) throw new Error('research returned no notes');

      // 2. Turn the notes into structured data for the app
      const formatted = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium', format: zodOutputFormat(Report) },
        messages: [{
          role: 'user',
          content: `Turn these research notes into the report for the business's app.

Printers:
${PRINTERS}

Rules for ideas:
- Only include things that can be fully printed on these printers (or need only cheap, easy-to-buy extras like magnets or keyrings). Check the size fits the build volume.
- Nothing that infringes trademarks or copyright (no film/game/brand characters or logos) — they can't legally be sold.
- No food-contact or safety-critical claims.
- 12–20 ideas, the strongest first; include ideas for the nearest upcoming dates (use the exact date names from the list).
- Avoid repeating yesterday's ideas unless demand is clearly still strong: ${previous || 'none'}.
- Estimate grams and print hours per item realistically for these printers.

Upcoming dates:
${dates}

Research notes:
${notes}`,
        }],
      });
      usage.input += formatted.usage.input_tokens + (formatted.usage.cache_read_input_tokens || 0);
      usage.output += formatted.usage.output_tokens;
      if (formatted.stop_reason === 'refusal') throw new Error('Claude declined to format the report');
      if (formatted.stop_reason === 'max_tokens' || !formatted.parsed_output) throw new Error('report was cut off or invalid');

      const usd = usage.input * PRICE.input + usage.output * PRICE.output + usage.searches * PRICE.search;
      this.state = {
        lastRunDay: day, updatedAt: Date.now(), error: null,
        result: formatted.parsed_output,
        cost: { usd: Math.round(usd * 100) / 100, ...usage },
      };
      this.save();
      this.log(`Trend Radar: done — ${formatted.parsed_output.ideas.length} ideas, ${usage.searches} searches, ~$${usd.toFixed(2)}`);
    } catch (err) {
      let msg = err.message;
      if (err instanceof Anthropic.AuthenticationError) msg = 'The Anthropic API key was rejected — check it in monitor\\config.json';
      else if (err instanceof Anthropic.PermissionDeniedError) msg = 'The Anthropic account has no access — check billing/credits';
      else if (err instanceof Anthropic.RateLimitError) msg = 'Rate limited by the Anthropic API — will retry tomorrow';
      else if (err instanceof Anthropic.APIError) msg = `Anthropic API error ${err.status}: ${err.message}`;
      // Mark the day as attempted so a broken key doesn't retry every minute.
      this.state = { ...this.state, lastRunDay: day, error: msg };
      this.save();
      this.log(`Trend Radar failed: ${msg}`);
      throw err;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Trends };
