/**
 * Convenção de nomes entre o SVG do boneco e a tabela subjective.body_regions.
 *
 * A tabela NÃO tem zonas por lado: `peitoral_sup_medial` é UMA linha; o lado é o
 * campo `side` em pain_reports. Duplicar por lado seriam ~90 linhas a mais e
 * impediria perguntar "quantas vezes me doeu esta zona, seja qual for o lado?"
 * sem somar duas categorias.
 *
 * Mas no SVG dois paths não podem partilhar id. Convenção (GEOMETRIA, não dados):
 *
 *   peitoral_sup_medial_esq  → { region_id: 'peitoral_sup_medial', side: 'esquerda' }
 *   peitoral_sup_medial_dir  → { region_id: 'peitoral_sup_medial', side: 'direita'  }
 *   lombar_media             → { region_id: 'lombar_media',        side: 'central'  }
 *
 * O parser tira o sufixo _esq/_dir, usa o resto como region_id, e o sufixo dá o
 * side. Sem sufixo = central. Vale para as QUATRO vistas — nas laterais o lado
 * vem da própria vista, mas os ids seguem a mesma regra (um path na vista lateral
 * esquerda chama-se _esq).
 *
 * Validação de arranque: todo o id de path (sem sufixo) tem de corresponder a uma
 * linha ATIVA de body_regions. Os que não corresponderem são TYPO (não zona
 * nova) — sinaliza-se. As zonas da tabela sem path caem na lista "outras".
 */

import type { Side } from '@/lib/pain';

// As quatro vistas do boneco. Distinto do campo `view` da tabela
// (anterior/posterior/ambos) — este é conceito de renderização.
export type BonecoView = 'anterior' | 'posterior' | 'lateral_esq' | 'lateral_dir';
export const BONECO_VIEWS: BonecoView[] = ['anterior', 'posterior', 'lateral_esq', 'lateral_dir'];

// Ficheiros esperados em /public/body/ (um por vista). Sinalizado ao utilizador
// para os exports do Figma seguirem estes nomes.
export const VIEW_FILE: Record<BonecoView, string> = {
  anterior: 'anterior.svg',
  posterior: 'posterior.svg',
  lateral_esq: 'lateral-esq.svg',
  lateral_dir: 'lateral-dir.svg',
};

const SIDE_SUFFIX: Record<string, Side> = { _esq: 'esquerda', _dir: 'direita' };

/** id de path → region_id + side. Sem sufixo _esq/_dir = central. */
export function parsePathId(pathId: string): { region_id: string; side: Side } {
  for (const suf of Object.keys(SIDE_SUFFIX)) {
    if (pathId.endsWith(suf)) return { region_id: pathId.slice(0, -suf.length), side: SIDE_SUFFIX[suf] };
  }
  return { region_id: pathId, side: 'central' };
}

/** Extrai os ids dos shapes (<path>/<polygon>) de um SVG. Regex — serve em Node e browser. */
export function extractPathIds(svgText: string): string[] {
  const ids: string[] = [];
  const re = /<(?:path|polygon)\b[^>]*\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svgText)) !== null) ids.push(m[1]);
  return ids;
}

export type ParsedPath = { pathId: string; region_id: string; side: Side; view: BonecoView };
export type BodyValidation = {
  valid: ParsedPath[];
  /** ids de path cujo region_id (sem sufixo) NÃO existe ativo na tabela — typos. */
  unknownPaths: { pathId: string; region_id: string; view: BonecoView }[];
  /** region_ids ativos que aparecem em algum path (têm geometria). */
  mappedRegionIds: Set<string>;
  /** region_ids ativos SEM path em vista nenhuma → lista "outras". */
  outras: string[];
  /** region_ids da tabela que colidem com a convenção (terminam em _esq/_dir). */
  suffixCollisions: string[];
};

/**
 * Cruza os paths de todas as vistas com as regiões ativas da tabela.
 * `pathsByView`: ids de path extraídos de cada SVG (vistas sem SVG → omitidas).
 */
export function validateBodyPaths(
  pathsByView: Partial<Record<BonecoView, string[]>>,
  activeRegionIds: string[],
): BodyValidation {
  const active = new Set(activeRegionIds);
  const valid: ParsedPath[] = [];
  const unknownPaths: BodyValidation['unknownPaths'] = [];
  const mappedRegionIds = new Set<string>();

  for (const view of BONECO_VIEWS) {
    for (const pathId of pathsByView[view] ?? []) {
      const { region_id, side } = parsePathId(pathId);
      if (active.has(region_id)) {
        valid.push({ pathId, region_id, side, view });
        mappedRegionIds.add(region_id);
      } else {
        unknownPaths.push({ pathId, region_id, view });
      }
    }
  }

  const outras = activeRegionIds.filter((id) => !mappedRegionIds.has(id));
  // Um region_id que termine em _esq/_dir partiria o parser (o sufixo comer-lhe-ia
  // o fim). Nenhuma linha da tabela deve ter esse feitio.
  const suffixCollisions = activeRegionIds.filter((id) => id.endsWith('_esq') || id.endsWith('_dir'));

  return { valid, unknownPaths, mappedRegionIds, outras, suffixCollisions };
}

/** Carrega o SVG de uma vista de /public/body/. null se ainda não existir (vista cai toda em "outras"). */
export async function loadViewSvg(view: BonecoView): Promise<{ text: string; pathIds: string[] } | null> {
  try {
    const res = await fetch(`/body/${VIEW_FILE[view]}`);
    if (!res.ok) return null;
    const text = await res.text();
    return { text, pathIds: extractPathIds(text) };
  } catch {
    return null;
  }
}
