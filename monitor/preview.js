// Preview pictures for G-code V9D slices: draws the extrusion moves (what will actually print,
// in the filament colours) from an angled view, like a slicer thumbnail, and embeds the PNGs
// in the G-code the way Creality Print does so the printers' screens and V9D show them.
// OrcaSlicer can't render thumbnails itself here: it runs without a display.

const zlib = require('zlib');

// Not part of the model, or hidden inside it (skipping infill also keeps big prints fast).
const SKIP = /prime tower|wipe tower|skirt|brim|custom|purge|sparse infill|internal solid infill|internal bridge/i;

// Extrusion segments from G-code lines, flat: x1,y1,z1,x2,y2,z2,tool,top per segment.
function segments(lines) {
  const segs = [];
  let x = 0, y = 0, z = 0, e = 0, relE = true, tool = 0, started = false, skip = false, top = false, tower = false;
  for (const raw of lines) {
    const line = raw.trimStart();
    if (line[0] === ';') {
      if (/^;\s*(LAYER_CHANGE|Z:|LAYER:)/.test(line)) started = true;
      // Colour changes purge onto the wipe tower; it isn't part of the model.
      if (/^;\s*(WIPE_TOWER_START|CP TOOLCHANGE START)/.test(line)) tower = true;
      if (/^;\s*(WIPE_TOWER_END|CP TOOLCHANGE END)/.test(line)) tower = false;
      const f = line.match(/^;\s*(?:FEATURE|TYPE):\s*(.*)/);
      if (f) { skip = SKIP.test(f[1]); top = /top|ironing/i.test(f[1]); }
      continue;
    }
    const c = line.split(';')[0];
    if (!c) continue;
    const cmd = c.match(/^([GMT])(\d+)/);
    if (!cmd) continue;
    if (cmd[1] === 'T') { tool = Number(cmd[2]); continue; }
    if (cmd[1] === 'M') { if (cmd[2] === '83') relE = true; else if (cmd[2] === '82') relE = false; continue; }
    const g = Number(cmd[2]);
    if (g === 92) { const m = c.match(/E(-?[\d.]+)/); if (m) e = Number(m[1]); continue; }
    if (g > 3) continue;
    const v = (k) => { const m = c.match(new RegExp(`${k}(-?[\\d.]+)`)); return m ? Number(m[1]) : null; };
    const nx = v('X') ?? x, ny = v('Y') ?? y, nz = v('Z') ?? z, ve = v('E');
    let de = 0;
    if (ve !== null) { de = relE ? ve : ve - e; if (!relE) e = ve; }
    // Extruding without moving (un-retract, priming) isn't a line of the model.
    if (started && !skip && !tower && de > 0 && (Math.abs(nx - x) > 0.01 || Math.abs(ny - y) > 0.01)) {
      if (g >= 2) { // arc: walk it in short straight pieces
        const i = v('I') ?? 0, j = v('J') ?? 0, cx = x + i, cy = y + j, r = Math.hypot(i, j);
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
        if (g === 2 && a1 >= a0) a1 -= 2 * Math.PI;
        if (g === 3 && a1 <= a0) a1 += 2 * Math.PI;
        const n = Math.max(2, Math.min(24, Math.ceil(Math.abs(a1 - a0) * r / 2)));
        let px = x, py = y;
        for (let k = 1; k <= n; k++) {
          const a = a0 + (a1 - a0) * k / n, qx = k === n ? nx : cx + r * Math.cos(a), qy = k === n ? ny : cy + r * Math.sin(a);
          segs.push(px, py, nz, qx, qy, nz, tool, top ? 1 : 0);
          px = qx; py = qy;
        }
      } else segs.push(x, y, z, nx, ny, nz, tool, top ? 1 : 0);
    }
    x = nx; y = ny; z = nz;
  }
  return segs;
}

const rgbOf = (hex) => { const h = String(hex || '#CCCCCC').replace('#', ''); return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) || 0); };

// Draws segments into an RGBA image (size x size), viewed from the front-left and above.
function render(segs, colours, size) {
  const S = size * 2; // draw at 2x, then average down for smooth edges
  const az = Math.PI / 4, el = Math.PI / 5.5; // from the front-left, about 33° above
  const n = segs.length / 8;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  const proj = (x, y, z) => {
    const rx = x * ca - y * sa, ry = x * sa + y * ca; // turn around Z
    return [rx, -(ry * se + z * ce), ry * ce - z * se]; // screen x, screen y (down), depth (far = bigger)
  };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const P = new Float64Array(n * 6);
  for (let k = 0; k < n; k++) {
    const q = k * 8, a = proj(segs[q], segs[q + 1], segs[q + 2]), b = proj(segs[q + 3], segs[q + 4], segs[q + 5]);
    P[k * 6] = a[0]; P[k * 6 + 1] = a[1]; P[k * 6 + 2] = a[2]; P[k * 6 + 3] = b[0]; P[k * 6 + 4] = b[1]; P[k * 6 + 5] = b[2];
    minX = Math.min(minX, a[0], b[0]); maxX = Math.max(maxX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
  }
  const scale = (S * 0.86) / Math.max(maxX - minX, maxY - minY, 1);
  const ox = (S - (maxX - minX) * scale) / 2 - minX * scale, oy = (S - (maxY - minY) * scale) / 2 - minY * scale;
  const zbuf = new Float32Array(S * S).fill(Infinity);
  const img = new Uint8ClampedArray(S * S * 4);
  const r = Math.max(1, Math.round(scale * 0.22)); // half line width in pixels (~0.45 mm lines)
  const pal = colours.map(rgbOf);
  const light = [Math.cos(az + 0.9), Math.sin(az + 0.9)];
  for (let k = 0; k < n; k++) {
    const s = segs.subarray(k * 8, k * 8 + 8);
    const x1 = P[k * 6] * scale + ox, y1 = P[k * 6 + 1] * scale + oy, d1 = P[k * 6 + 2];
    const x2 = P[k * 6 + 3] * scale + ox, y2 = P[k * 6 + 4] * scale + oy, d2 = P[k * 6 + 5];
    // Simple lighting: walls by which way they face, tops brightest.
    const dx = s[3] - s[0], dy = s[4] - s[1], len = Math.hypot(dx, dy) || 1;
    const facing = Math.abs((-dy / len) * light[0] + (dx / len) * light[1]);
    const shade = s[7] ? 1.0 : 0.5 + 0.42 * facing;
    const [cr, cg, cb] = pal[s[6]] || pal[0] || [200, 200, 200];
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    for (let t = 0; t <= steps; t++) {
      const f = t / steps, px = x1 + (x2 - x1) * f, py = y1 + (y2 - y1) * f, d = d1 + (d2 - d1) * f;
      for (let oy2 = -r; oy2 <= r; oy2++) {
        for (let ox2 = -r; ox2 <= r; ox2++) {
          const X = Math.round(px + ox2), Y = Math.round(py + oy2);
          if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
          const i = Y * S + X;
          if (d >= zbuf[i]) continue;
          zbuf[i] = d;
          img[i * 4] = cr * shade; img[i * 4 + 1] = cg * shade; img[i * 4 + 2] = cb * shade; img[i * 4 + 3] = 255;
        }
      }
    }
  }
  // Average 2x2 blocks down to the final size.
  const out = Buffer.alloc(size * size * 4);
  for (let Y = 0; Y < size; Y++) for (let X = 0; X < size; X++) {
    let rr = 0, gg = 0, bb = 0, aa = 0;
    for (const [u, w] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = ((Y * 2 + w) * S + X * 2 + u) * 4, al = img[i + 3];
      rr += img[i] * al; gg += img[i + 1] * al; bb += img[i + 2] * al; aa += al;
    }
    const o = (Y * size + X) * 4;
    if (aa) { out[o] = rr / aa; out[o + 1] = gg / aa; out[o + 2] = bb / aa; out[o + 3] = aa / 4; }
  }
  return out;
}

// Minimal PNG encoder (RGBA, 8-bit).
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// G-code comment block for one picture, as Creality Print writes it.
function block(pngBuf, size) {
  const b64 = pngBuf.toString('base64');
  const rows = b64.match(/.{1,78}/g) || [];
  return ['; THUMBNAIL_BLOCK_START', ';', `; thumbnail begin ${size}x${size} ${b64.length}`, ...rows.map((r) => `; ${r}`), '; thumbnail end', '; THUMBNAIL_BLOCK_END', ''];
}

// Returns { png300, lines } with the pictures inserted after the header block (or at the top).
function addPreview(lines, colours) {
  const segs = Float64Array.from(segments(lines));
  if (!segs.length) return null;
  const big = png(render(segs, colours, 300), 300);
  const small = png(render(segs, colours, 96), 96);
  const at = lines.findIndex((l) => l.startsWith('; HEADER_BLOCK_END'));
  const insert = [...block(small, 96), ...block(big, 300)];
  const out = lines.slice();
  out.splice(at >= 0 && at < 50 ? at + 1 : 0, 0, ...insert);
  return { png300: big, lines: out };
}

module.exports = { addPreview };
