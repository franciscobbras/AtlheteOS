/**
 * Gera os ícones PWA do Nexus sem dependências externas (encoder PNG próprio).
 *   node scripts/gen-icons.mjs
 *
 * Desenho: fundo accent (#4F8CFF), "N" branco, full-bleed (sem transparência) —
 * serve para maskable (Android recorta em círculo; glifo dentro da zona segura),
 * para os ícones "any" e para o apple-touch (iOS exige opaco).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'public');
mkdirSync(OUT, { recursive: true });

const BG = [0x4f, 0x8c, 0xff];       // accent
const FG = [0xff, 0xff, 0xff];       // branco

// CRC32 (tabela)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// "N": barras verticais + diagonal top-left → bottom-right, dentro de uma caixa
// central (~46% do lado) que cabe na zona segura do maskable.
function isN(x, y, size) {
  const G = size * 0.46;
  const o = (size - G) / 2;
  const u = (x - o) / G, v = (y - o) / G;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const w = 0.22;
  return u < w || u > 1 - w || Math.abs(u - v) < 0.20;
}

function png(size) {
  // dados crus: cada scanline prefixada com filtro 0
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const c = isN(x, y, size) ? FG : BG;
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 = RGB (opaco, sem alpha)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const files = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [name, size] of files) {
  writeFileSync(resolve(OUT, name), png(size));
  console.log(`✓ ${name} (${size}×${size})`);
}
console.log('Ícones gerados em public/.');
