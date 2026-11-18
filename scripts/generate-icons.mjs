// Generates public/icon-192.png and public/icon-512.png — a solid ink
// square with a lime 'R' wordmark. Pure Node stdlib (zlib + hand-rolled
// PNG encoder), no image dependencies. Run: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// PNG encoder (8-bit RGBA, no filter)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >> 1) : c >> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >> 1);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};

const encodePNG = (width, height, pixels) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixels[y * width + x];
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = a;
      offset += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, 9)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ---------------------------------------------------------------------------
// 'R' glyph — strokes defined on a unit square, drawn bold to read at a glance
// ---------------------------------------------------------------------------
const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
};

const inLetter = (u, v) => {
  // Vertical stem
  if (u >= 0.30 && u <= 0.47 && v >= 0.12 && v <= 0.88) return true;
  // Top bar
  if (u >= 0.30 && u <= 0.72 && v >= 0.12 && v <= 0.25) return true;
  // Bowl (the upper curved part of the R)
  const bx = u - 0.58, by = v - 0.44;
  if (bx * bx + by * by <= 0.185 * 0.185 && u >= 0.47 && v >= 0.18 && v <= 0.52) return true;
  // Diagonal leg
  if (distToSegment(u, v, 0.50, 0.52, 0.78, 0.86) <= 0.07) return true;
  return false;
};

const makeIcon = (size) => {
  const pixels = new Array(size * size);
  const INK = [11, 15, 12, 255];
  const LIME = [215, 247, 95, 255];
  const pad = Math.round(size * 0.09);
  const body = size - pad * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x - pad + 0.5) / body;
      const v = (y - pad + 0.5) / body;
      pixels[y * size + x] = inLetter(u, v) ? LIME : INK;
    }
  }
  return encodePNG(size, size, pixels);
};

mkdirSync(join(ROOT, 'public'), { recursive: true });
for (const size of [192, 512]) {
  const path = join(ROOT, 'public', `icon-${size}.png`);
  writeFileSync(path, makeIcon(size));
  console.log(`wrote ${path} (${size}x${size})`);
}