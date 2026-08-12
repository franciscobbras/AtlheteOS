import { supabase } from '@/lib/supabaseClient';

/**
 * Cliente do registo de treino ao vivo.
 *
 * TODAS as escritas passam pelas RPCs atómicas do schema `training`
 * (start_session, open_block, pause_block, resume_block, close_block,
 * end_session). NUNCA se faz insert/update direto nas tabelas — as RPCs
 * agrupam pares de escritas que só fazem sentido juntos (ex.: bloco +
 * primeiro segmento). As leituras (apparatus, blocks/segments) são SELECTs
 * normais: `authenticated` tem SELECT nas tabelas.
 *
 * Os erros das RPCs trazem um código TR*** no campo `code` — distinguem-se
 * SEMPRE pelo código, nunca por parsing da mensagem.
 */

// `training` não está nos tipos gerados; o cliente é destipado (any-ish), por
// isso .schema('training').rpc/from aceitam strings — igual ao uso de
// .schema('metrics') no resto da app.
const tr = () => supabase.schema('training');

export type TrainingErrorCode =
  | 'TR001' // sessão já aberta
  | 'TR010' // sessão inexistente
  | 'TR011' // sessão já fechada
  | 'TR012' // bloco ativo já existe
  | 'TR013' // aparelho inválido
  | 'TR014' // bloco inexistente / já fechado
  | 'TR020' // sem segmento aberto (já em pausa)
  | 'TR021' // bloco não está em pausa
  | 'TR030' // RPE em falta
  | 'TR040'; // bloco por fechar ao terminar a sessão

export class TrainingError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'TrainingError';
    this.code = code;
  }
}

function raise(error: { message?: string; code?: string } | null): void {
  if (error) throw new TrainingError(error.message ?? 'Erro de treino', error.code ?? null);
}

// Zona horária (não relógio) — o servidor carimba os timestamps com o seu
// próprio now(); só o offset é que ele não sabe. UTC+1 → 3600.
function localOffsetSeconds(): number {
  return -new Date().getTimezoneOffset() * 60;
}

// ── Escritas (RPCs) ─────────────────────────────────────────────────────────

/** Abre uma sessão. TR001 se já houver uma aberta. Devolve o session_id. */
export async function startSession(): Promise<string> {
  const { data, error } = await tr().rpc('start_session', {
    p_utc_offset_seconds: localOffsetSeconds(),
  });
  raise(error);
  return data as string;
}

/** Cria bloco + primeiro segmento atomicamente. TR010/TR011/TR012/TR013. */
export async function openBlock(
  sessionId: string,
  apparatusId: string,
): Promise<{ block_id: string; segment_id: string }> {
  const { data, error } = await tr().rpc('open_block', {
    p_session_id: sessionId,
    p_apparatus_id: apparatusId,
  });
  raise(error);
  // returns table(...) → array de linhas
  const rows = (data ?? []) as { block_id: string; segment_id: string }[];
  return rows[0];
}

/** Pausa: fecha o segmento aberto; o BLOCO continua active. TR020 se já em pausa. */
export async function pauseBlock(blockId: string): Promise<void> {
  const { error } = await tr().rpc('pause_block', { p_block_id: blockId });
  raise(error);
}

/** Retoma: abre segmento novo no mesmo bloco. TR014/TR021. */
export async function resumeBlock(blockId: string): Promise<void> {
  const { error } = await tr().rpc('resume_block', { p_block_id: blockId });
  raise(error);
}

/** Fecha o segmento (se houver) + grava o RPE. RPE obrigatório (TR030). TR014. */
export async function closeBlock(
  blockId: string,
  rpe: number,
  opts?: { feeling?: number | null; notes?: string | null; extra?: Record<string, unknown> | null },
): Promise<void> {
  const { error } = await tr().rpc('close_block', {
    p_block_id: blockId,
    p_rpe: rpe,
    p_feeling: opts?.feeling ?? null,
    p_notes: opts?.notes ?? null,
    p_extra: opts?.extra ?? null,
  });
  raise(error);
}

/** Termina a sessão. TR040 se ainda houver um bloco por fechar. */
export async function endSession(
  sessionId: string,
  opts?: { overallFeeling?: number | null; notes?: string | null; extra?: Record<string, unknown> | null },
): Promise<void> {
  const { error } = await tr().rpc('end_session', {
    p_session_id: sessionId,
    p_overall_feeling: opts?.overallFeeling ?? null,
    p_notes: opts?.notes ?? null,
    p_extra: opts?.extra ?? null,
  });
  raise(error);
}

// ── Leituras ────────────────────────────────────────────────────────────────

export type OpenSession = { session_id: string; start_utc: string; n_blocos: number };

/** Sessão aberta (0 ou 1). Chamada ao abrir a app para retomar o estado. */
export async function getOpenSession(): Promise<OpenSession | null> {
  const { data, error } = await tr().rpc('get_open_session');
  raise(error);
  const rows = (data ?? []) as OpenSession[];
  if (!rows.length) return null;
  return { ...rows[0], n_blocos: Number(rows[0].n_blocos) };
}

export type OpenBlock = {
  block_id: string;
  apparatus_id: string;
  apparatus_name: string;
  started_utc: string;
  em_pausa: boolean;
  minutos_feitos: number;
};

/** Bloco ativo da sessão (0 ou 1). A UI usa isto ANTES de end_session. */
export async function getOpenBlock(sessionId: string): Promise<OpenBlock | null> {
  const { data, error } = await tr().rpc('get_open_block', { p_session_id: sessionId });
  raise(error);
  const rows = (data ?? []) as OpenBlock[];
  return rows.length ? rows[0] : null;
}

export type Apparatus = { id: string; name: string; sort_order: number };

/** Aparelhos ativos, ordenados por sort_order (NÃO alfabética). */
export async function listApparatus(): Promise<Apparatus[]> {
  const { data, error } = await tr()
    .from('apparatus')
    .select('id, name, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  raise(error);
  return (data ?? []) as Apparatus[];
}

export type SessionRow = {
  id: string;
  start_utc: string;
  end_utc: string | null;
  utc_offset_seconds: number;
  overall_feeling: number | null;
  session_load: number | null;
  notes: string | null;
  extra: Record<string, unknown> | null;
};

/** Sessões, mais recente primeiro (histórico da secção Training). */
export async function listSessions(limit = 50): Promise<SessionRow[]> {
  const { data, error } = await tr()
    .from('sessions')
    .select('id, start_utc, end_utc, utc_offset_seconds, overall_feeling, session_load, notes, extra')
    .order('start_utc', { ascending: false })
    .limit(limit);
  raise(error);
  return (data ?? []) as SessionRow[];
}

/** Uma sessão pelo id (para o ecrã de detalhe). */
export async function getSession(id: string): Promise<SessionRow | null> {
  const { data, error } = await tr()
    .from('sessions')
    .select('id, start_utc, end_utc, utc_offset_seconds, overall_feeling, session_load, notes, extra')
    .eq('id', id)
    .maybeSingle();
  raise(error);
  return (data as SessionRow) ?? null;
}

export type Segment = { start_utc: string; end_utc: string | null };
export type BlockRow = {
  id: string;
  apparatus_id: string;
  status: 'active' | 'closed';
  rpe: number | null;
  created_at_utc: string;
  block_segments: Segment[];
};
export type BlockWithSession = BlockRow & { session_id: string };

/** Blocos+segmentos de várias sessões numa só query (evita N+1 no histórico). */
export async function listBlocksForSessions(sessionIds: string[]): Promise<BlockWithSession[]> {
  if (!sessionIds.length) return [];
  const { data, error } = await tr()
    .from('training_blocks')
    .select('id, session_id, apparatus_id, status, rpe, created_at_utc, block_segments(start_utc, end_utc)')
    .in('session_id', sessionIds)
    .order('created_at_utc', { ascending: true });
  raise(error);
  return (data ?? []) as BlockWithSession[];
}

/**
 * Blocos da sessão com os segmentos embebidos, por ordem cronológica. O nome
 * do aparelho resolve-se do lado do cliente (mapa de apparatus_id → name), em
 * vez de embeber `apparatus`, para não depender do embedding cross-tabela.
 */
export async function listBlocks(sessionId: string): Promise<BlockRow[]> {
  const { data, error } = await tr()
    .from('training_blocks')
    .select('id, apparatus_id, status, rpe, created_at_utc, block_segments(start_utc, end_utc)')
    .eq('session_id', sessionId)
    .order('created_at_utc', { ascending: true });
  raise(error);
  return (data ?? []) as BlockRow[];
}

// ── Derivações puras de tempo (o servidor carimba; o cliente só soma) ─────────

/** Segundos já fechados de um bloco = soma dos segmentos com end_utc. */
export function closedSeconds(segs: Segment[]): number {
  let s = 0;
  for (const seg of segs) {
    if (seg.end_utc) s += (Date.parse(seg.end_utc) - Date.parse(seg.start_utc)) / 1000;
  }
  return s;
}

/** Início (ms epoch) do segmento aberto de um bloco, ou null se em pausa/fechado. */
export function openSegmentStartMs(segs: Segment[]): number | null {
  const open = segs.find((s) => !s.end_utc);
  return open ? Date.parse(open.start_utc) : null;
}
