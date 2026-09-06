import { supabase } from '@/lib/supabaseClient';

/**
 * Mapa de dor: leitura das regiões e escrita dos registos.
 *
 * As regiões (subjective.body_regions) vêm TODAS da tabela (active=true,
 * ordenadas por sort_order) — nada de lista hardcoded; a geometria (posição no
 * boneco) é que vive à parte, em bodyMap.ts.
 *
 * UMA LINHA POR ZONA em subjective.pain_reports. Uma submissão com 5 zonas = 5
 * linhas com o MESMO reported_at_utc: consegue-se com um único insert em lote —
 * o default now() é a hora da transação, constante dentro do statement, logo
 * todas as linhas partilham o carimbo do servidor (o relógio do telemóvel não é
 * fonte de verdade). Só o utc_offset_seconds vem do cliente (é zona horária).
 *
 * authenticated tem SELECT em body_regions e INSERT em pain_reports — escrita
 * direta, sem RPC.
 */

// A coluna `view` foi largada na migração 20260821 (a geometria vive em
// bodyMap.ts, não na base) — a tabela guarda só a taxonomia.
export type BodyRegion = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

export async function listBodyRegions(): Promise<BodyRegion[]> {
  const { data, error } = await supabase
    .schema('subjective')
    .from('body_regions')
    .select('id, name, parent_id, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BodyRegion[];
}

export type Side = 'esquerda' | 'direita' | 'central';

/** Uma zona a registar. region_id do PAI = "dor generalizada" nessa região. */
export type PainZone = {
  region_id: string;
  side: Side;
  intensity: number; // 0-10
  description: string | null;
};

export async function insertPainReports(sessionId: string | null, zones: PainZone[]): Promise<number> {
  if (!zones.length) return 0;
  const offset = -new Date().getTimezoneOffset() * 60; // zona horária, não relógio
  const payload = zones.map((z) => ({
    session_id: sessionId,
    region_id: z.region_id,
    side: z.side,
    intensity: z.intensity,
    description: z.description && z.description.trim() ? z.description.trim() : null,
    utc_offset_seconds: offset,
    // reported_at_utc omitido de propósito → default now() do servidor, igual
    // para todas as linhas deste único insert.
  }));
  const { error } = await supabase.schema('subjective').from('pain_reports').insert(payload);
  if (error) throw error;
  return payload.length;
}

// ── Leitura das dores por sessão (revisão posterior no Training) ──────────────

/** Uma dor já registada (linha de pain_reports). */
export type PainReport = {
  id: string;
  session_id: string | null;
  region_id: string;
  side: Side;
  intensity: number;
  description: string | null;
  reported_at_utc: string;
};

/** Dores de várias sessões numa só query (evita N+1 no histórico de treino). */
export async function listPainForSessions(sessionIds: string[]): Promise<PainReport[]> {
  if (!sessionIds.length) return [];
  const { data, error } = await supabase
    .schema('subjective')
    .from('pain_reports')
    .select('id, session_id, region_id, side, intensity, description, reported_at_utc')
    .in('session_id', sessionIds)
    .order('reported_at_utc', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PainReport[];
}

// Para rótulos usam-se TODAS as regiões (não só active=true): uma dor antiga pode
// apontar a uma região entretanto desativada e continua a merecer nome legível.
export type RegionLabelInfo = { id: string; name: string; parent_id: string | null };

/** Mapa id→{name,parent_id} de todas as regiões, para traduzir region_id em rótulo. */
export async function listRegionLabels(): Promise<Map<string, RegionLabelInfo>> {
  const { data, error } = await supabase
    .schema('subjective')
    .from('body_regions')
    .select('id, name, parent_id');
  if (error) throw error;
  const m = new Map<string, RegionLabelInfo>();
  for (const r of (data ?? []) as RegionLabelInfo[]) m.set(r.id, r);
  return m;
}

/** Rótulo de uma zona: filho → "Pai aspeto" (ex.: "Bíceps proximal"); pai → o nome.
 *  Alguns nomes de filho já trazem o do pai ("Bíceps proximal", "Tornozelo
 *  anterior") — nesse caso usa-se o nome do filho tal e qual, para não sair
 *  "Bíceps bíceps proximal". */
export function painLabel(regions: Map<string, RegionLabelInfo>, region_id: string): string {
  const r = regions.get(region_id);
  if (!r) return region_id;
  if (!r.parent_id) return r.name;
  const pn = regions.get(r.parent_id)?.name ?? r.parent_id;
  if (r.name.toLowerCase().startsWith(pn.toLowerCase())) return r.name;
  return `${pn} ${r.name.toLowerCase()}`;
}
