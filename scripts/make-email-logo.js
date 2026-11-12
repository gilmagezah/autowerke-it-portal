// Builds public/brand/autowerke-it-logo-email-plate.png: the dark email logo on a white rounded
// plate. Why: Gmail (and Outlook) dark mode ignore our dark-mode CSS, so the dark logo on a
// transparent background vanished on their dark background. Email apps never recolour images, so a
// plate baked into the PNG keeps the logo readable there, and on a white email it can't be seen.
// Run again only if the logo changes:  node scripts/make-email-logo.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PNG = require('png-js');

const BRAND = path.join(__dirname, '..', 'public', 'brand');
const SRC = path.join(BRAND, 'autowerke-it-logo-email.png'); // 600 x 91, dark artwork, transparent
const OUT = path.join(BRAND, 'autowerke-it-logo-email-plate.png');
const PAD_X = 24, PAD_Y = 18, RADIUS = 22; // source pixels (the logo shows at about 1/4 size)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const png = new PNG(fs.readFileSync(SRC));
png.decode((px) => {
  const W = png.width + PAD_X * 2, H = png.height + PAD_Y * 2;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // no filter
    for (let x = 0; x < W; x++) {
      // Plate coverage, with soft (anti-aliased) rounded corners
      const cx = Math.min(Math.max(x + 0.5, RADIUS), W - RADIUS), cy = Math.min(Math.max(y + 0.5, RADIUS), H - RADIUS);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const plate = Math.max(0, Math.min(1, RADIUS - d + 0.5));
      // Logo pixel composited over white
      let r = 255, g = 255, b = 255;
      const sx = x - PAD_X, sy = y - PAD_Y;
      if (sx >= 0 && sy >= 0 && sx < png.width && sy < png.height) {
        const i = (sy * png.width + sx) * 4, a = px[i + 3] / 255;
        r = Math.round(px[i] * a + 255 * (1 - a)); g = Math.round(px[i + 1] * a + 255 * (1 - a)); b = Math.round(px[i + 2] * a + 255 * (1 - a));
      }
      const o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(plate * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  fs.writeFileSync(OUT, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${W} x ${H}).`);
});
