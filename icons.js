// V9D line icons (24×24, drawn with the current text colour). Style D: white line icons on
// dark glass, with a short orange underline added by CSS where a button wants one.

const ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5 M5 9v12h14V9 M10 21v-6h4v6',
  printer: 'M7 9V3h10v6 M7 17H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-3 M7 13h10v8H7z',
  chart: 'M3 21h18 M6 17v-5 M12 17V6 M18 17v-8',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  upload: 'M12 15V3 M7 8l5-5 5 5 M4 15v5h16v-5',
  sliders: 'M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z',
  calendar: 'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4',
  plus: 'M12 5v14 M5 12h14',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 7.5h.01',
};

function icon(name, size = 24) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name] || ''}"/></svg>`;
}
