// "Hot dates": UK holidays and gifting/sales events, with a "list it by" date that leaves
// time to design, print, photograph and post before the event.

const DAY = 864e5;

// Easter Sunday (anonymous Gregorian algorithm).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (dt, n) => new Date(dt.getTime() + n * DAY);
// nth weekday of a month (weekday 0=Sun); n = -1 for the last one
function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = utc(y, m, 1);
    return addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = utc(y, m + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

// Lunar/religious dates (approximate — may shift by a day with moon sightings).
const LUNAR = {
  'Chinese New Year': { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13' },
  'Eid al-Fitr': { 2026: '03-20', 2027: '03-10', 2028: '02-27', 2029: '02-15' },
  'Diwali': { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05' },
  'Hanukkah': { 2026: '12-05', 2027: '12-25', 2028: '12-13', 2029: '12-02' },
};

// lead: days before the event to have listings live. kind: gifting | seasonal | sales | awareness
function eventsForYear(y) {
  const e = easter(y);
  const blackFriday = addDays(nthWeekday(y, 11, 4, 4), 1);
  const list = [
    { name: 'Burns Night', date: utc(y, 1, 25), lead: 14, kind: 'seasonal', hint: 'Scottish-themed décor, tartan, thistle items' },
    { name: "Valentine's Day", date: utc(y, 2, 14), lead: 28, kind: 'gifting', hint: 'Personalised gifts, hearts, couple name plaques, flower vases' },
    { name: 'Pancake Day', date: addDays(e, -47), lead: 10, kind: 'seasonal', hint: 'Kitchen gadgets, pancake moulds' },
    { name: "St Patrick's Day", date: utc(y, 3, 17), lead: 14, kind: 'seasonal', hint: 'Shamrock décor, party items' },
    { name: "Mother's Day (UK)", date: addDays(e, -21), lead: 28, kind: 'gifting', hint: 'Personalised planters, jewellery dishes, flower vases, name signs' },
    { name: 'Easter', date: e, lead: 28, kind: 'seasonal', hint: 'Egg holders, bunny décor, egg-hunt tokens, basket fillers' },
    { name: "St George's Day", date: utc(y, 4, 23), lead: 10, kind: 'seasonal', hint: 'English flag / dragon themed items' },
    { name: 'Star Wars Day', date: utc(y, 5, 4), lead: 21, kind: 'seasonal', hint: 'Generic sci-fi / space themes (avoid trademarked designs)' },
    { name: 'Pride Month', date: utc(y, 6, 1), lead: 28, kind: 'awareness', hint: 'Rainbow keyrings, pins, desk décor' },
    { name: "Father's Day (UK)", date: nthWeekday(y, 6, 0, 3), lead: 28, kind: 'gifting', hint: 'Desk organisers, BBQ tools, cable tidies, car accessories, personalised keyrings' },
    { name: 'Graduation season', date: utc(y, 7, 1), lead: 28, kind: 'gifting', hint: 'Personalised name plaques, cap toppers, photo frames' },
    { name: 'End of school year (teacher gifts)', date: utc(y, 7, 20), lead: 28, kind: 'gifting', hint: 'Personalised teacher gifts, pen holders, bookmarks' },
    { name: 'Back to school', date: utc(y, 9, 3), lead: 28, kind: 'seasonal', hint: 'Desk organisers, name tags, pencil cases, locker items' },
    { name: 'Grandparents Day (UK)', date: nthWeekday(y, 10, 0, 1), lead: 21, kind: 'gifting', hint: 'Personalised frames, plaques' },
    { name: 'Halloween', date: utc(y, 10, 31), lead: 35, kind: 'seasonal', hint: 'Lithophane lanterns, skulls, pumpkins, spooky décor, costume props' },
    { name: 'Bonfire Night', date: utc(y, 11, 5), lead: 14, kind: 'seasonal', hint: 'Lantern / glow items' },
    { name: "Singles' Day (11.11)", date: utc(y, 11, 11), lead: 14, kind: 'sales', hint: 'Online sale event — discount bundles' },
    { name: 'Remembrance Sunday', date: nthWeekday(y, 11, 0, 2), lead: 14, kind: 'awareness', hint: 'Poppy pins and wreath items' },
    { name: 'Black Friday', date: blackFriday, lead: 21, kind: 'sales', hint: 'Bundle deals, best-sellers at a discount' },
    { name: 'Cyber Monday', date: addDays(blackFriday, 3), lead: 21, kind: 'sales', hint: 'Online-only discounts' },
    { name: 'Small Business Saturday (UK)', date: nthWeekday(y, 12, 6, 1), lead: 14, kind: 'sales', hint: 'Promote handmade / local' },
    { name: 'Christmas', date: utc(y, 12, 25), lead: 56, kind: 'gifting', hint: 'Ornaments, personalised baubles, advent items, stocking fillers, lithophanes. UK last posting ~18–20 Dec' },
    { name: "New Year's Eve", date: utc(y, 12, 31), lead: 14, kind: 'seasonal', hint: 'Party props, year signs' },
  ];
  for (const [name, years] of Object.entries(LUNAR)) {
    if (!years[y]) continue;
    const [m, d] = years[y].split('-').map(Number);
    const hints = {
      'Chinese New Year': 'Zodiac-animal figures, red lanterns, decorations',
      'Eid al-Fitr': 'Crescent/star décor, gift boxes, lanterns',
      'Diwali': 'Diya / tealight holders, rangoli stencils, lanterns',
      'Hanukkah': 'Menorah, dreidels, Star of David décor',
    };
    list.push({ name, date: utc(y, m, d), lead: 28, kind: 'seasonal', hint: hints[name], approx: true });
  }
  return list;
}

// Official UK bank holidays (England & Wales) from gov.uk; cached in memory for a day.
let bankCache = { at: 0, events: [] };
async function bankHolidays() {
  if (Date.now() - bankCache.at < DAY) return bankCache.events;
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json', { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    bankCache = {
      at: Date.now(),
      events: data['england-and-wales'].events.map((x) => ({
        name: `${x.title} (bank holiday)`, date: new Date(`${x.date}T00:00:00Z`), lead: 7, kind: 'bank-holiday',
        hint: 'Long weekend — more browsing and local market traffic',
      })),
    };
  } catch {}
  return bankCache.events;
}

async function hotDates(daysAhead = 150) {
  const now = new Date(), y = now.getUTCFullYear();
  const today = utc(y, now.getUTCMonth() + 1, now.getUTCDate());
  const all = [...eventsForYear(y), ...eventsForYear(y + 1), ...(await bankHolidays())];
  const seen = new Set();
  return all
    .filter((ev) => ev.date >= today && ev.date <= addDays(today, daysAhead))
    .filter((ev) => { const k = ev.name + ev.date.toISOString(); if (seen.has(k)) return false; seen.add(k); return true; })
    // a bank holiday on the same day as a named event (e.g. Christmas Day) adds nothing
    .filter((ev, _, arr) => ev.kind !== 'bank-holiday' || !arr.some((o) => o.kind !== 'bank-holiday' && +o.date === +ev.date))
    .sort((a, b) => a.date - b.date)
    .map((ev) => ({
      name: ev.name, kind: ev.kind, hint: ev.hint, approx: !!ev.approx,
      date: ev.date.toISOString().slice(0, 10),
      listBy: addDays(ev.date, -ev.lead).toISOString().slice(0, 10),
      daysAway: Math.round((ev.date - today) / DAY),
    }));
}

module.exports = { hotDates };
