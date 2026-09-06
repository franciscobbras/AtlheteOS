// @ts-check
/**
 * Parser dos SVGs do boneco (export do Figma) → entrada `ViewGeometry` de bodyMap.ts.
 *
 * Mecaniza o que se fez à mão para a vista `anterior`:
 *   1. lê public/body/<vista>.svg
 *   2. extrai o PNG de fundo EMBUTIDO (data:image/png;base64) → public/body/<vista>.png
 *      e confirma que as dimensões batem com o viewBox (senão o zoom desalinha)
 *   3. tira os pares id+d de cada <path id="…"> (as zonas)
 *   4. imprime a entrada ViewGeometry pronta a COLAR em src/lib/bodyMap.ts
 *
 * NÃO escreve no bodyMap nem sintetiza pais (ex.: o `esterno`, cujo pai foi a união
 * das duas subdivisões) — isso é decisão manual. Aqui é extração fiel: o que está
 * no SVG é o que sai. Paths sem id (ruído decorativo do Figma) são contados e
 * ignorados. A validação id→região viva continua a ser do PainMap (bodySvg.ts).
 *
 * Uso:
 *   node scripts/parse-boneco.mjs anterior            # vista (procura .svg no disco)
 *   node scripts/parse-boneco.mjs public/body/x.svg   # ou um caminho direto
 *   node scripts/parse-boneco.mjs anterior --no-png    # não (re)escrever o .png
 *
 * Não tem dependências: regex sobre o texto do SVG + Buffer para o base64.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const BODY_DIR = resolve(process.cwd(), 'public/body');

/** vista → grafias possíveis do ficheiro no disco (underscore E hífen — há divergência). */
function candidateFiles(view) {
  return [`${view}.svg`, `${view.replace(/_/g, '-')}.svg`];
}

/** Resolve o argumento (nome de vista OU caminho) para um .svg existente. */
function resolveSvg(arg) {
  // caminho direto?
  if (arg.endsWith('.svg')) {
    const p = resolve(process.cwd(), arg);
    if (existsSync(p)) return p;
    throw new Error(`Ficheiro não existe: ${p}`);
  }
  for (const name of candidateFiles(arg)) {
    const p = join(BODY_DIR, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`Nenhum SVG para a vista "${arg}" em ${BODY_DIR} (tentei ${candidateFiles(arg).join(', ')}).`);
}

/** Lê width/height do IHDR de um PNG (big-endian). */
function pngDims(buf) {
  // assinatura(8) + len(4) + "IHDR"(4) + width(4)@16 + height(4)@20
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * O Figma pinta o fundo por um <rect fill="url(#pattern…)"> que pode vir
 * ESPELHADO (ex.: a lateral esquerda: matrix(-1 0 0 1 …)). Os paths ficam em
 * coordenadas normais, logo o PNG extraído (cru, não espelhado) tem de ser
 * espelhado para alinhar. Devolve {h, v} = precisa de flip horizontal/vertical.
 */
function bgFlip(svg) {
  const rect = /<rect\b[^>]*\bfill="url\(#pattern[^"]*"[^>]*>/.exec(svg)?.[0]
    ?? /<rect\b[^>]*\btransform="[^"]*"[^>]*\bfill="url\(#pattern[^"]*"[^>]*>/.exec(svg)?.[0];
  const m = rect && /\btransform="matrix\(([^)]+)\)"/.exec(rect)?.[1];
  if (!m) return { h: false, v: false };
  const [a, , , d] = m.split(/[\s,]+/).map(Number);
  return { h: a < 0, v: d < 0 };
}

/** Normaliza um id do Figma → slug ASCII: decodifica &#NNN;, corrige o mojibake
 *  UTF-8-lido-como-latin1 (Ã§ → ç), tira acentos e espaços. */
function fixId(raw) {
  let s = raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  if (/[^\u0000-\u007F]/.test(s)) { try { s = Buffer.from(s, 'latin1').toString('utf8'); } catch { /* deixa como esta */ } }
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Extrai as zonas de um SVG. São zonas:
 *   • <path id="…" d="…">                     → a própria forma
 *   • <g id="…"> … </g> (grupo-folha)         → união dos <path> com fill hex lá
 *     dentro (o Figma exporta a forma + um contorno duplicado; fica só a forma).
 * Grupos-contentor (id não-slug, ex.: "Image") e grupos cujo slug já vem de um
 * <path> (ex.: pescoco_anterior, coberto por _esq/_dir) são ignorados.
 */
function extractPaths(svg) {
  const zones = [];
  const noId = [];
  for (const m of svg.matchAll(/<path\b([^>]*)>/g)) {
    const attrs = m[1];
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const d = /\bd="([^"]+)"/.exec(attrs)?.[1];
    if (!d) continue;            // um <path> sem d não é zona
    if (!id) { noId.push(d.length); continue; }
    zones.push({ id: fixId(id), d });
  }
  const pathRegions = new Set(zones.map((z) => z.id.replace(/_(dir|esq)$/, '')));
  let groups = 0;
  // grupos-folha = <g> sem <g> aninhado
  for (const m of svg.matchAll(/<g\b([^>]*)>((?:(?!<\/?g)[\s\S])*?)<\/g>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[1])?.[1];
    if (!id) continue;
    const slug = fixId(id);
    if (!/^[a-z0-9_]+$/.test(slug)) continue;                             // contentor (ex.: Image)
    if (pathRegions.has(slug.replace(/_(dir|esq)$/, ''))) continue;       // já coberto por <path>
    const fills = [...m[2].matchAll(/<path\b([^>]*)>/g)]
      .filter((p) => /\bfill="#[0-9A-Fa-f]{3,8}"/.test(p[1]))             // a forma, não o contorno
      .map((p) => /\bd="([^"]+)"/.exec(p[1])?.[1]).filter(Boolean);
    if (!fills.length) continue;
    zones.push({ id: slug, d: fills.join(' ') });                        // união se >1 (ex.: dedos)
    groups++;
  }
  return { zones, noIdCount: noId.length, groupCount: groups };
}

/** `d` com aspas escapadas para caber numa string TS entre plicas. */
const esc = (d) => d.replace(/'/g, "\\'");

function main() {
  const args = process.argv.slice(2);
  const writePng = !args.includes('--no-png');
  const arg = args.find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('Uso: node scripts/parse-boneco.mjs <vista|caminho.svg> [--no-png]');
    process.exit(1);
  }

  const svgPath = resolveSvg(arg);
  const view = basename(svgPath).replace(/\.svg$/, '').replace(/-/g, '_');
  const svg = readFileSync(svgPath, 'utf8');
  console.error(`\n▸ ${svgPath}`);

  // viewBox (cai para width/height se faltar).
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  let viewBox = /\bviewBox="([^"]+)"/.exec(root)?.[1];
  const w = /\bwidth="([^"]+)"/.exec(root)?.[1];
  const h = /\bheight="([^"]+)"/.exec(root)?.[1];
  if (!viewBox && w && h) viewBox = `0 0 ${w} ${h}`;
  if (!viewBox) throw new Error('Sem viewBox nem width/height no <svg> raiz.');
  const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);

  // PNG de fundo embutido.
  let background = `/body/${view}.svg`; // fallback: sem PNG embutido, aponta ao próprio SVG
  const b64 = /xlink:href="data:image\/png;base64,([^"]+)"/.exec(svg)?.[1]
    ?? /\bhref="data:image\/png;base64,([^"]+)"/.exec(svg)?.[1];
  if (b64) {
    const buf = Buffer.from(b64, 'base64');
    const { w: pw, h: ph } = pngDims(buf);
    const pngPath = join(dirname(svgPath), `${view}.png`);
    const flip = bgFlip(svg);
    if (writePng) {
      writeFileSync(pngPath, buf);
      console.error(`  PNG → ${pngPath} (${pw}×${ph}, ${buf.length} bytes)`);
      // Fundo espelhado no Figma → espelha o PNG para bater com os paths (que
      // ficam em coords normais). sips é do macOS; sem ele, avisa e segue.
      const flips = [flip.h && 'horizontal', flip.v && 'vertical'].filter(Boolean);
      for (const dir of flips) {
        try {
          execFileSync('sips', ['-f', dir, pngPath, '--out', pngPath], { stdio: 'ignore' });
          console.error(`  ↔ PNG espelhado (${dir}) — o rect do fundo vinha com matrix invertida.`);
        } catch {
          console.error(`  ⚠ fundo pede flip ${dir} mas o sips falhou — espelha o ${view}.png à mão.`);
        }
      }
    } else {
      console.error(`  PNG embutido: ${pw}×${ph} (não escrito, --no-png)` + ((flip.h || flip.v) ? `  [fundo pede flip ${[flip.h && 'H', flip.v && 'V'].filter(Boolean).join('+')}]` : ''));
    }
    if (pw !== vbW || ph !== vbH) console.error(`  ⚠ dimensões do PNG (${pw}×${ph}) ≠ viewBox (${vbW}×${vbH}) — o zoom vai desalinhar.`);
    background = `/body/${view}.png`;
  } else {
    console.error('  (sem PNG embutido — background aponta ao próprio .svg)');
  }

  const { zones, noIdCount, groupCount } = extractPaths(svg);
  console.error(`  zonas: ${zones.length} (${zones.length - groupCount} <path> + ${groupCount} <g>)  ·  <path> sem id ignorados: ${noIdCount}`);
  console.error(`  ids: ${zones.map((z) => z.id).join(', ') || '(nenhum)'}\n`);

  // Entrada ViewGeometry pronta a colar. Vai para stdout (o resto é stderr).
  const lines = zones.map((z) => `      { id: '${z.id}', d: '${esc(z.d)}' },`);
  console.log(`  ${view}: {`);
  console.log(`    viewBox: '${viewBox}',`);
  console.log(`    background: '${background}',`);
  console.log(`    paths: [`);
  console.log(lines.join('\n'));
  console.log(`    ],`);
  console.log(`  },`);
}

main();
