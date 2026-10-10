// Power-draw estimates for printers without an energy meter.
//
// Heaters dominate a printer's draw, so the model is built around them:
//  - Klipper/Moonraker printers (K2 Plus) report each heater's PWM duty (0–1) directly,
//    so heater watts = rated watts × duty. This is the accurate case.
//  - Creality K1 firmware only reports temperatures. While a heater is below target it is
//    at full power (PID saturates); once holding, its power is the heat it loses, which is
//    proportional to (temperature − chamber temperature). The loss rates were calibrated
//    from the K2 Plus's measured duty and scaled by bed area.
// DC loads (hotend, fans, motors, electronics) go through the PSU, so they are divided by
// its efficiency to get wall power; the mains (AC) beds are counted directly.
//
// Rated wattages: Creality spec pages (K2 Plus bed 800 W AC, hotend 100 W; K1 Max bed
// 800 W AC). K1 Max hotend (60 W) and K2 Plus chamber heater (300 W) are not published
// and are best estimates. Any value can be overridden per printer with a "power" object
// in printers.json.

const PROFILES = {
  'K2 Plus': {
    bedW: 800, hotendW: 100, chamberW: 300,
    electronicsW: 18,   // mainboard, screen, camera, LEDs, CFS idle
    motionW: 35,        // steppers + drivers while printing
    holdW: 6,           // steppers holding position when idle
    fansW: { part: 8, aux: 15, exhaust: 6, hotend: 3, chamber: 4 },
    psuEff: 0.88,
    typicalPrintW: 190, // used to estimate prints from before monitoring started
  },
  'K1 Max': {
    bedW: 800, hotendW: 60,
    electronicsW: 12,
    motionW: 30,
    holdW: 5,
    fansW: { part: 6, aux: 12, case: 4, hotend: 3 },
    psuEff: 0.88,
    bedLossWPerK: 5.2,      // K2 Plus measured ~7 W/K, scaled to the K1 Max's smaller bed
    hotendLossWPerK: 0.17,  // from K2 Plus hotend duty at 220 °C
    meltWPerMm3s: 0.45,     // heating + melting PLA, per mm³/s of flow
    typicalPrintW: 175,
  },
};

function profileFor(cfg) {
  const key = Object.keys(PROFILES).find((k) => (cfg.model || cfg.name || '').includes(k));
  const base = PROFILES[key] || PROFILES['K1 Max'];
  return { ...base, ...(cfg.power || {}), fansW: { ...base.fansW, ...(cfg.power?.fansW || {}) } };
}

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const round = (x) => Math.round(x * 10) / 10;

function finish(prof, parts, inputs) {
  // parts are in device watts; convert DC parts to wall watts
  const wall = {
    bed: parts.bed,
    hotend: parts.hotend / prof.psuEff,
    chamber: (parts.chamber || 0), // PTC chamber heater runs from mains
    fans: parts.fans / prof.psuEff,
    motion: parts.motion / prof.psuEff,
    electronics: parts.electronics / prof.psuEff,
  };
  const watts = Object.values(wall).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(wall)) wall[k] = round(wall[k]);
  return { watts: round(watts), parts: wall, inputs };
}

// Moonraker query objects needed by estimateMoonraker().
const MOONRAKER_OBJECTS = [
  'heater_bed', 'extruder', 'heater_generic chamber_heater',
  'output_pin fan0', 'output_pin fan1', 'output_pin fan2',
  'heater_fan hotend_fan', 'heater_fan chamber_fan', 'temperature_sensor chamber_temp',
];

function estimateMoonraker(cfg, st, printing) {
  const prof = profileFor(cfg);
  const bed = st.heater_bed || {}, ext = st.extruder || {}, ch = st['heater_generic chamber_heater'] || {};
  const f = prof.fansW;
  const fans = clamp01(st['output_pin fan0']?.value) * f.part
    + clamp01(st['output_pin fan2']?.value) * f.aux
    + clamp01(st['output_pin fan1']?.value) * f.exhaust
    + clamp01(st['heater_fan hotend_fan']?.speed) * f.hotend
    + clamp01(st['heater_fan chamber_fan']?.speed) * f.chamber;
  return finish(prof, {
    bed: clamp01(bed.power) * prof.bedW,
    hotend: clamp01(ext.power) * prof.hotendW,
    chamber: clamp01(ch.power) * (prof.chamberW || 0),
    fans,
    motion: printing ? prof.motionW : prof.holdW,
    electronics: prof.electronicsW,
  }, {
    bed: { temp: bed.temperature, target: bed.target, duty: bed.power },
    hotend: { temp: ext.temperature, target: ext.target, duty: ext.power },
    chamber: { temp: st['temperature_sensor chamber_temp']?.temperature ?? ch.temperature, target: ch.target, duty: ch.power },
    method: 'heater duty reported by printer',
  });
}

function heldDuty(temp, target, ambient, ratedW, lossWPerK, extraW = 0) {
  if (!target || target <= 0) return 0;
  if (temp < target - 1.5) return 1; // still heating up: full power
  return clamp01((lossWPerK * Math.max(0, temp - ambient) + extraW) / ratedW);
}

function estimateCreality(cfg, raw, printing) {
  const prof = profileFor(cfg);
  const num = (x) => Number.parseFloat(x) || 0;
  const bedT = num(raw.bedTemp0), bedTarget = num(raw.targetBedTemp0);
  const hotT = num(raw.nozzleTemp), hotTarget = num(raw.targetNozzleTemp);
  const ambient = num(raw.boxTemp) || 25;
  const flow = printing ? num(raw.realTimeFlow) : 0;
  const bedDuty = heldDuty(bedT, bedTarget, ambient, prof.bedW, prof.bedLossWPerK);
  const hotDuty = heldDuty(hotT, hotTarget, ambient, prof.hotendW, prof.hotendLossWPerK, prof.meltWPerMm3s * flow);
  const f = prof.fansW;
  const fans = clamp01(num(raw.modelFanPct) / 100) * f.part
    + clamp01(num(raw.auxiliaryFanPct) / 100) * f.aux
    + clamp01(num(raw.caseFanPct) / 100) * f.case
    + (hotT > 50 ? f.hotend : 0);
  return finish(prof, {
    bed: bedDuty * prof.bedW,
    hotend: hotDuty * prof.hotendW,
    fans,
    motion: printing ? prof.motionW : prof.holdW,
    electronics: prof.electronicsW,
  }, {
    bed: { temp: bedT, target: bedTarget, duty: bedDuty },
    hotend: { temp: hotT, target: hotTarget, duty: hotDuty },
    chamber: { temp: ambient },
    method: 'estimated from temperatures',
  });
}

// Filament: 1.75 mm diameter; density by material (g/cm³).
const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2, HIPS: 1.04, PVA: 1.23 };
function materialFromFile(file) {
  const m = String(file || '').toUpperCase().match(/(?:^|[_\-. ])(PLA|PETG|ABS|ASA|TPU|PA\d*|PC|HIPS|PVA)(?=[_\-. ]|$)/);
  return m ? m[1].replace(/^PA\d+$/, 'PA') : 'PLA';
}
function gramsFromMm(mm, material) {
  const areaMm2 = Math.PI * (1.75 / 2) ** 2;
  return (mm * areaMm2 / 1000) * (DENSITY[material] || DENSITY.PLA);
}

module.exports = { PROFILES, profileFor, MOONRAKER_OBJECTS, estimateMoonraker, estimateCreality, materialFromFile, gramsFromMm };
