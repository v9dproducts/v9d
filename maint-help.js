// Step-by-step maintenance guides, summarised from Creality's official wiki and guides.
// Photos and videos stay on Creality's pages: each guide links to the official page and,
// where Creality has one, embeds their YouTube tutorial.
// Keyed by printer model (matched against the printer's model) then item id.

const WIKI = 'https://wiki.creality.com/en';

const MAINT_HELP = {
  'K2 Plus': {
    nozzle: {
      intro: 'The K2 Plus nozzle has the heat break built in and a hardened-steel tip. It only fits the K2 Plus (0.4, 0.6 or 0.8 mm). A spare 0.4 mm nozzle came with the printer.',
      tools: ['Straight socket wrench and bent socket wrench (K2 Plus toolbox)', 'Thermal grease', 'New K2 Plus nozzle'],
      safety: 'The nozzle is changed hot (about 220 °C). Only touch it with the tools.',
      steps: [
        'On the screen: Prepare › Z-axis homing, then move Z down in 30 mm steps until the bed is in the middle or lower, to make room.',
        'Filament › Retract, and wait until the filament has fully unloaded.',
        'Axis movement: bring the nozzle to the centre, then heat the hotend to your filament’s temperature (220 °C for PLA).',
        'Unscrew the old nozzle with the straight socket wrench. If it won’t move, crack it loose with the bent socket wrench first.',
        'Spread thermal grease evenly over the tube of the new nozzle.',
        'Screw the new nozzle in with the straight socket wrench and tighten it properly.',
        'Filament › Extrude, and check the filament comes out smoothly.',
        'Prepare › Calibration: tick Input Shaping and Auto Leveling, then Start Detecting and wait for it to finish.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/replace-nozzle`,
      video: '90LyYXmH_Vo',
    },
    rails: {
      intro: 'Keeps the X-axis rail and the two Z lead screws running smoothly. Creality: weekly with frequent use, every two weeks otherwise.',
      tools: ['Lint-free cloth', 'WD-40 Specialist Silicone (genuine; safe for the belts)', 'Screwdriver from the K2 Plus toolbox', '2 × lead screw cleaning tool (printable — download on the Creality page)'],
      steps: [
        'X rail: power the printer off. Wipe old oil and debris off the whole X-axis rail and check the rail screws are tight.',
        'Shake the silicone spray well and spray the full length of the rail. Leave it about 5 minutes, then slide the hotend back and forth by hand to spread it.',
        'Z lead screws: power on, home Z, then lower the bed all the way to the bottom.',
        'Unscrew the covers at the top of both lead screws and fit one cleaning tool at the bottom of each screw.',
        'Press “Z-axis ⇡”. The tools ride up with the bed and collect the black residue. Stop before the top so they don’t hit the auxiliary fan duct, then take them off.',
        'Repeat if residue remains, then wipe both ends of the screws with the cloth.',
        'Spray silicone along the full length of both screws and refit the covers while it soaks in (about 5 minutes).',
        'Home Z and move the bed up and down a few times to spread the lubricant.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/clean-x-axis-guide-rail`,
      links: [['Z lead screw guide (photos)', `${WIKI}/k2-flagship-series/k2-plus/clean-z-axis-lead-screw`]],
    },
    lube: {
      intro: 'The Y and Z optical shafts are greased at the factory. Re-grease every 3 months, or every 5 days if you print a lot of ABS/ASA.',
      tools: ['Lint-free cloth', 'Grease (from the toolbox)'],
      steps: [
        'Power the printer off.',
        'Wipe the Y-axis and Z-axis optical shafts clean with the cloth.',
        'Apply a thin layer of grease along each shaft.',
        'Power on, home all axes and move them through their full travel to spread the grease.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/maintenance-tips`,
      video: 'jPEQ3dxhWY4',
    },
    filter: {
      intro: 'The activated-carbon cartridge filters fumes and particles. Replace monthly with frequent printing, or every 3 months at about 8 hours a day.',
      tools: ['New K2 Plus air filter cartridge'],
      steps: [
        'Open the air filter cover plates on both sides of the printer.',
        'Pull out the old cartridge.',
        'Slide in the new cartridge and close the covers.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/maintenance-tips`,
      video: 'jPEQ3dxhWY4',
    },
    cutter: {
      intro: 'The cutter snips filament during colour changes and dulls over time. Check it every 5 rolls of PLA/ABS/PETG/PC, or after 1 roll of fibre-reinforced filament.',
      tools: ['Thin L hex wrench or nozzle cleaning needle', 'New cutter'],
      steps: [
        'Move the hotend to the centre so there’s room on its left side.',
        'Pull the hotend cover off diagonally upwards — it’s held by magnets, no screws.',
        'Reach in from the left of the extruder gear with the L wrench or needle until it touches the cutter.',
        'Hook the cutter and pull it out to the left.',
        'Push the new cutter into place with the grooved side of the cutter holder facing up.',
        'Refit the hotend cover.',
        'Make sure no filament is in the extruder, then run Input Shaping to calibrate the cutter position.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/replace-cutter`,
      video: 'c0EKlBXRflk',
    },
    shaping: {
      intro: 'Input shaping on the K2 Plus also re-tensions the belts and calibrates the cutter position. Run it monthly.',
      tools: [],
      safety: 'Unload all filament first — loaded filament throws off the cutter calibration.',
      steps: [
        'Unload the filament so the extruder is empty.',
        'On the screen: Settings › Detection options › tick “Input Shaping”.',
        'Tap “Start detecting” and wait until it finishes.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/maintenance-tips`,
      video: 'jPEQ3dxhWY4',
    },
    plate: {
      intro: 'Creality has no fixed lifetime for the build plate. Replace it when the surface is worn or scratched and prints won’t stick even after a proper clean.',
      tools: ['Warm water and dish soap, or isopropyl alcohol', 'Lint-free cloth', 'New K2 Plus build plate (when replacing)'],
      steps: [
        'Take the plate off the bed and wash it with warm water and a little dish soap (or wipe with isopropyl alcohol).',
        'Dry it fully and avoid touching the print surface with your fingers.',
        'If adhesion is still poor, check the plate side matches the filament, then replace the plate.',
        'After fitting a new plate, run Auto Leveling.',
      ],
      guide: `${WIKI}/k2-flagship-series/k2-plus/non-stick-platform`,
    },
  },

  'K1 Max': {
    nozzle: {
      intro: 'Current K1 Max hotends use an integrated nozzle, changed hot with the toolkit wrench. Older K1 Max units have a different nozzle — see the second guide if yours doesn’t match.',
      tools: ['Toolkit wrench and socket', 'Hex key from the toolkit', 'Needle-nose pliers', 'New K1-series nozzle'],
      safety: 'The nozzle is changed hot (220 °C). Never touch it or turn it by hand.',
      steps: [
        'Heat the nozzle to 220 °C. Press the pneumatic connector to pull out the PTFE tube, switch the extruder to unlocked and pull the filament out.',
        'Turn the printer off and let the nozzle cool.',
        'Remove the screws on both sides of the extruder cover.',
        'Take off the nozzle cover and unplug the model fan connector.',
        'Pull off the silicone sock. If it sticks, heat to 220 °C and use pliers — not fingers.',
        'With the nozzle at 220 °C, hold it steady with the toolkit wrench and loosen it with the socket.',
        'Screw the new nozzle in with the socket and tighten it.',
        'Load filament, lock the extruder clamp and extrude to check it flows normally.',
        'Turn off, let it cool, then refit the silicone sock, the fan connector and the cover screws.',
      ],
      guide: `${WIKI}/k1-flagship-series/replace-nozzle`,
      links: [['Older K1 Max nozzle (removes the LiDAR)', `${WIKI}/k1-flagship-series/k1-max/nozzle-replacement-old-version`]],
    },
    lube: {
      intro: 'Creality: every 500 print hours. The X axis runs on a graphite-copper bushing, so only a very thin layer belongs on the XY rods.',
      tools: ['The grease supplied with the printer', 'Lint-free cloth'],
      safety: 'Never use liquid lubricants or oil sprays on the K1 Max rods.',
      steps: [
        'Power the printer off.',
        'Wipe the threaded rods (Z lead screws), smooth rods and linear bearings clean.',
        'Apply a thin layer of grease to the threaded rods, smooth rods and linear bearings.',
        'On the X-axis rod, wipe off graphite dust and leave only a very thin film.',
        'Power on, home and move every axis through its full travel to spread the grease.',
      ],
      guide: `${WIKI}/k1-flagship-series/k1-max/quick-start-guide/users-manual`,
      links: [['Creality K1 maintenance tips', 'https://store.creality.com/blogs/all/creality-k1-series-routine-maintenance-tips']],
    },
    selftest: {
      intro: 'Wear on the belts, rods and nozzle slowly changes how the printer behaves. Re-running the self-test every 300 print hours updates its compensation.',
      tools: [],
      steps: [
        'Clear the bed and make sure nothing is in the way of the toolhead.',
        'Open the self-test (self-inspection) on the printer’s touchscreen — section 5.4 of the user manual.',
        'Select all the tests and start it. It takes several minutes; don’t open the door or touch the printer meanwhile.',
      ],
      guide: `${WIKI}/k1-flagship-series/k1-max/quick-start-guide/users-manual`,
    },
    belts: {
      intro: 'The XY belts are spring-tensioned. Both belts should have the same tension — about 5.5–6.5 N when pressed together.',
      tools: ['2.0 mm hex key (toolkit)'],
      steps: [
        'Look over the X and Y drive parts for wear or damage.',
        'If the M3×12 transport screws are still fitted on either side, remove them.',
        'Loosen the four M3×16 countersunk screws on both sides so the springs pull the belts fully tight.',
        'Tighten the four M3×16 screws again.',
        'Check both belts feel equally tight.',
        'Go round the frame and re-tighten any screws loosened by vibration, then run the self-test.',
      ],
      guide: `${WIKI}/k1-flagship-series/k1-series-general-documents/xy-axis-belt-tension`,
      links: [['Z-axis belt tension', `${WIKI}/k1-flagship-series/k1-series-general-documents/z-axis-belt-tension`]],
    },
    fans: {
      intro: 'Dust on the fans reduces cooling and can cause heat creep and clogs.',
      tools: ['Soft brush or compressed air'],
      safety: 'Turn the printer off and unplug it first.',
      steps: [
        'Turn the printer off and unplug it.',
        'Brush or blow dust out of the hotend fan, the part-cooling fan, the large side auxiliary fan and the rear chamber fan.',
        'Spin each fan gently by hand — it should turn freely and quietly.',
      ],
      guide: `${WIKI}/k1-flagship-series/k1-max/quick-start-guide/users-manual`,
    },
    plate: {
      intro: 'The K1 Max has a flexible PEI plate. There’s no fixed lifetime — replace it when it’s worn or scratched and prints won’t stick after cleaning.',
      tools: ['Warm water and dish soap, or isopropyl alcohol', 'Lint-free cloth', 'New K1 Max build plate (when replacing)'],
      steps: [
        'Lift the flexible plate off the magnetic bed.',
        'Wash it with warm water and a little dish soap (or wipe with isopropyl alcohol) and dry it fully.',
        'Avoid touching the print surface with your fingers.',
        'If prints still won’t stick, replace the plate, then run auto-levelling.',
      ],
      guide: `${WIKI}/k1-flagship-series/k1-max/quick-start-guide/users-manual`,
    },
  },
};

function helpFor(printerName, itemId) {
  const key = Object.keys(MAINT_HELP).find((k) => (printerName || '').includes(k));
  return key ? MAINT_HELP[key][itemId] : null;
}
