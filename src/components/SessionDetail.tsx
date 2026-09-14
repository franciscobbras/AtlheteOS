'use client';

/**
 * Detalhe de uma sessão de treino: a série de HR reconstruída, com os BLOCOS
 * sobrepostos (faixas verticais por aparelho) e as pausas visíveis como
 * intervalos sem cobertura de bloco. A leitura útil é o padrão de esforço por
 * aparelho e a recuperação entre blocos — não a linha sozinha.
 *
 * Clicar num bloco FOCA o HR nesse intervalo (a linha reescala para a janela do
 * bloco) e mostra os seus dados; o botão Editar permite corrigir aparelho, RPE,
 * tempos e apagar. Correção a frio → escreve direto nas tabelas (authenticated
 * tem UPDATE), sem passar pelas RPCs do registo ao vivo. Ao mexer nos tempos, a
 * fronteira partilhada com o bloco vizinho move junto (o tempo passa de um para
 * o outro), preservando as pausas internas.
 *
 * O HR chega já agregado do SQL (wearable.hr_series_bucketed) — centenas de
 * pontos, não os milhares de cru. Não se suaviza: mostra-se o que foi medido,
 * buracos incluídos. Logo após o treino ainda não foi ingerido (Air é
 * forward-only, de 3 em 3h) → estado explícito de "dados a chegar".
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getSession, listApparatus, listBlocks,
  updateBlockMeta, updateSegmentTime, deleteBlock, addBlock, updateSessionBounds, deleteSession,
  TrainingError, type SessionRow, type BlockRow, type Apparatus, type Segment,
} from '@/lib/training';
import { getSessionHrSeries, type HrSeries } from '@/lib/hr';
import SessionPains from './SessionPains';
import { listPainForSessions, listRegionLabels, type PainReport, type RegionLabelInfo } from '@/lib/pain';

const PALETTE = ['#4F8CFF', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#14B8A6', '#6366F1', '#EAB308', '#F43F5E'];

function fmtClock(ms: number, offsetSec: number): string {
  const d = new Date(ms + offsetSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

// ms UTC → valor de <input type="datetime-local"> no fuso do treino (offset).
function toLocalInput(utcMs: number, offsetSec: number): string {
  const d = new Date(utcMs + offsetSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
// valor do input (parede, no fuso do treino) → ms UTC.
function fromLocalInput(v: string, offsetSec: number): number {
  const [date, time] = v.split('T');
  const [Y, M, D] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, h, mi) - offsetSec * 1000;
}

// Segmento inicial (menor start) e final (maior end) de um bloco.
function firstSeg(segs: Segment[]): Segment | null {
  return segs.length ? segs.reduce((a, b) => (Date.parse(a.start_utc) <= Date.parse(b.start_utc) ? a : b)) : null;
}
function lastSeg(segs: Segment[], fallbackEndMs: number): Segment | null {
  return segs.length
    ? segs.reduce((a, b) => (endOf(a, fallbackEndMs) >= endOf(b, fallbackEndMs) ? a : b))
    : null;
}
function endOf(s: Segment, fallbackEndMs: number): number {
  return s.end_utc ? Date.parse(s.end_utc) : fallbackEndMs;
}

type BView = {
  id: string;
  apparatusId: string;
  name: string;
  color: string;
  rpe: number | null;
  status: 'active' | 'closed';
  startMs: number;
  endMs: number;
  workSec: number;
  segs: Segment[];
  spans: Array<[number, number]>;
};

export default function SessionDetail({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [apparatus, setApparatus] = useState<Apparatus[]>([]);
  const [rawBlocks, setRawBlocks] = useState<BlockRow[]>([]);
  const [hr, setHr] = useState<HrSeries | null>(null);
  const [pains, setPains] = useState<PainReport[]>([]);
  const [regions, setRegions] = useState<Map<string, RegionLabelInfo>>(new Map());
  const [nowMs] = useState(() => Date.now());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sessionEditOpen, setSessionEditOpen] = useState(false);
  const [confirmDelSession, setConfirmDelSession] = useState(false);
  const router = useRouter();

  const fromMs = session ? Date.parse(session.start_utc) : 0;
  const toMs = session ? (session.end_utc ? Date.parse(session.end_utc) : nowMs) : 0;
  const offset = session?.utc_offset_seconds ?? 0;

  // Cor por aparelho, estável pela ordem de primeira aparição nos blocos.
  const colorByApp = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of rawBlocks) if (!m.has(b.apparatus_id)) m.set(b.apparatus_id, PALETTE[m.size % PALETTE.length]);
    return m;
  }, [rawBlocks]);
  const nameByApp = useMemo(() => new Map(apparatus.map((a) => [a.id, a.name])), [apparatus]);

  const blockViews = useMemo<BView[]>(() => {
    const endFallback = toMs || nowMs;
    return rawBlocks.map((b) => {
      const spans = b.block_segments
        .map((seg) => [Date.parse(seg.start_utc), endOf(seg, endFallback)] as [number, number])
        .filter(([a, z]) => z > a);
      const startMs = spans.length ? Math.min(...spans.map((s) => s[0])) : Date.parse(b.created_at_utc);
      const endMs = spans.length ? Math.max(...spans.map((s) => s[1])) : startMs;
      const workSec = spans.reduce((acc, [a, z]) => acc + (z - a) / 1000, 0);
      return {
        id: b.id, apparatusId: b.apparatus_id,
        name: nameByApp.get(b.apparatus_id) ?? '—',
        color: colorByApp.get(b.apparatus_id) ?? PALETTE[0],
        rpe: b.rpe, status: b.status, startMs, endMs, workSec,
        segs: b.block_segments, spans,
      };
    }).sort((a, b) => a.startMs - b.startMs);
  }, [rawBlocks, nameByApp, colorByApp, toMs, nowMs]);

  const selected = useMemo(() => blockViews.find((b) => b.id === selectedId) ?? null, [blockViews, selectedId]);

  const loadCore = useCallback(async (opts: { withHr: boolean; syncEnvelope?: boolean }) => {
    const [s0, apps, bs] = await Promise.all([getSession(sessionId), listApparatus(), listBlocks(sessionId)]);
    if (!s0) { setError('Sessão não encontrada.'); return; }
    let s = s0;

    // Envelope da sessão: os limites gravados têm de conter os blocos. Se uma
    // edição empurrou um segmento para antes do início ou para além do fim da
    // sessão, expande-se (NUNCA encolhe — preserva pausas antes/depois).
    if (opts.syncEnvelope) {
      const segStarts: number[] = [], segEnds: number[] = [];
      for (const b of bs) for (const sg of b.block_segments) {
        segStarts.push(Date.parse(sg.start_utc));
        if (sg.end_utc) segEnds.push(Date.parse(sg.end_utc));
      }
      if (segStarts.length && segEnds.length) {
        const minStart = Math.min(...segStarts), maxEnd = Math.max(...segEnds);
        const patch: { start_utc?: string; end_utc?: string } = {};
        if (minStart < Date.parse(s.start_utc)) patch.start_utc = new Date(minStart).toISOString();
        if (s.end_utc && maxEnd > Date.parse(s.end_utc)) patch.end_utc = new Date(maxEnd).toISOString();
        if (Object.keys(patch).length) {
          await updateSessionBounds(sessionId, patch);
          s = { ...s, ...patch };
        }
      }
    }

    setSession(s);
    setApparatus(apps);
    setRawBlocks(bs);
    if (opts.withHr) {
      const endMs = s.end_utc ? Date.parse(s.end_utc) : nowMs;
      const series = await getSessionHrSeries(Date.parse(s.start_utc), endMs, {
        bucketSeconds: 30, sessionEndMs: endMs, nowMs,
      });
      setHr(series);
    }
  }, [sessionId, nowMs]);

  useEffect(() => {
    (async () => {
      try {
        const [pr, reg] = await Promise.all([listPainForSessions([sessionId]), listRegionLabels()]);
        setPains(pr); setRegions(reg);
        await loadCore({ withHr: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar a sessão.');
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, loadCore]);

  const reloadPains = useCallback(async () => {
    setPains(await listPainForSessions([sessionId]));
  }, [sessionId]);

  // Aplica a edição de um bloco (aparelho/RPE/tempos) e recarrega.
  const applyEdit = useCallback(async (bv: BView, changes: {
    apparatusId?: string; rpe?: number | null; newStartMs?: number; newEndMs?: number;
  }) => {
    setBusy(true); setActionError(null);
    try {
      const meta: { apparatusId?: string; rpe?: number | null } = {};
      if (changes.apparatusId && changes.apparatusId !== bv.apparatusId) meta.apparatusId = changes.apparatusId;
      if ('rpe' in changes && changes.rpe !== bv.rpe) meta.rpe = changes.rpe ?? null;
      if (Object.keys(meta).length) await updateBlockMeta(bv.id, meta);

      const idx = blockViews.findIndex((x) => x.id === bv.id);
      const prev = idx > 0 ? blockViews[idx - 1] : null;
      const next = idx >= 0 && idx < blockViews.length - 1 ? blockViews[idx + 1] : null;
      const endFallback = toMs || nowMs;

      if (changes.newStartMs != null && changes.newStartMs !== bv.startMs) {
        const iso = new Date(changes.newStartMs).toISOString();
        const f = firstSeg(bv.segs);
        if (f?.id) await updateSegmentTime(f.id, { start_utc: iso });
        if (prev) { const pl = lastSeg(prev.segs, endFallback); if (pl?.id) await updateSegmentTime(pl.id, { end_utc: iso }); }
      }
      if (changes.newEndMs != null && changes.newEndMs !== bv.endMs) {
        const iso = new Date(changes.newEndMs).toISOString();
        const l = lastSeg(bv.segs, endFallback);
        if (l?.id) await updateSegmentTime(l.id, { end_utc: iso });
        if (next) { const nf = firstSeg(next.segs); if (nf?.id) await updateSegmentTime(nf.id, { start_utc: iso }); }
      }

      await loadCore({ withHr: false, syncEnvelope: true });
    } catch (e) {
      setActionError(editErr(e));
    } finally { setBusy(false); }
  }, [blockViews, toMs, nowMs, loadCore]);

  const removeBlock = useCallback(async (bv: BView) => {
    setBusy(true); setActionError(null);
    try {
      await deleteBlock(bv.id);
      setSelectedId(null);
      await loadCore({ withHr: false });
    } catch (e) {
      setActionError(editErr(e));
    } finally { setBusy(false); }
  }, [loadCore]);

  // Editar os tempos da PRÓPRIA sessão (ex.: esqueci-me de fechar → encolher o
  // fim). Ao contrário do envelope automático, isto pode ENCOLHER — mas nunca
  // para dentro de um bloco (o editor limita ao 1º início / último fim).
  const saveSessionTimes = useCallback(async (startIso: string, endIso: string) => {
    setBusy(true); setActionError(null);
    try {
      await updateSessionBounds(sessionId, { start_utc: startIso, end_utc: endIso });
      setSessionEditOpen(false);
      await loadCore({ withHr: true }); // refetch HR para a nova janela
    } catch (e) {
      setActionError(editErr(e));
    } finally { setBusy(false); }
  }, [sessionId, loadCore]);

  const removeSession = useCallback(async () => {
    setBusy(true); setActionError(null);
    try {
      await deleteSession(sessionId);
      router.push('/training');
    } catch (e) {
      // Mensagens em inglês. TR041 = a sessão ainda tem blocos (só se apaga vazia
      // — camada de segurança); esvaziar é manual, não automático.
      const n = blockViews.length;
      let msg = 'Failed to delete session.';
      if (e instanceof TrainingError) {
        if (e.code === 'TR041') msg = `Can't delete: this session still has ${n} block${n === 1 ? '' : 's'}. Delete every block first — a session can only be deleted when empty.`;
        else if (e.code === 'TR042') msg = 'Session not found.';
        else if (e.code === 'TR043') msg = 'Not authenticated.';
        else if (e.message) msg = e.message;
      } else if (e instanceof Error) { msg = e.message; }
      setActionError(msg);
      setConfirmDelSession(false);
      setBusy(false);
    }
  }, [sessionId, router, blockViews]);

  const addNew = useCallback(async (c: { apparatusId: string; rpe: number | null; startMs: number; endMs: number }) => {
    setBusy(true); setActionError(null);
    try {
      await addBlock(sessionId, {
        apparatusId: c.apparatusId, rpe: c.rpe,
        startIso: new Date(c.startMs).toISOString(), endIso: new Date(c.endMs).toISOString(),
      });
      setAdding(false);
      await loadCore({ withHr: false, syncEnvelope: true });
    } catch (e) {
      setActionError(editErr(e));
    } finally { setBusy(false); }
  }, [sessionId, loadCore]);

  // Janela do gráfico: bloco selecionado (com folga) ou sessão inteira.
  const viewFrom = selected ? selected.startMs - (selected.endMs - selected.startMs) * 0.04 : fromMs;
  const viewTo = selected ? selected.endMs + (selected.endMs - selected.startMs) * 0.04 : toMs;

  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/training" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>← Training</Link>
        <h1 className="page-title" style={{ margin: 0 }}>
          {session ? `${new Date(fromMs + offset * 1000).toISOString().slice(0, 10)} · ${fmtClock(fromMs, offset)}` : 'Sessão'}
        </h1>
        {session && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSessionEditOpen((v) => !v)}>
              {sessionEditOpen ? 'Fechar' : 'Editar tempos'}
            </button>
            {!confirmDelSession ? (
              <button className="btn btn-sm" onClick={() => setConfirmDelSession(true)} disabled={busy}
                style={{ color: '#fff', background: '#EF4444', border: 'none', borderRadius: 6, padding: '3px 12px', fontWeight: 600 }}>
                Eliminar sessão
              </button>
            ) : (
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                <span style={{ color: 'var(--error)' }}>Eliminar tudo?</span>
                <button className="btn btn-sm" onClick={removeSession} disabled={busy}
                  style={{ background: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px' }}>
                  {busy ? '…' : 'Sim'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelSession(false)} disabled={busy}>Não</button>
              </span>
            )}
          </div>
        )}
      </div>

      {session && sessionEditOpen && (
        <SessionTimeEditor
          session={session}
          offset={offset}
          nowMs={nowMs}
          minSegStart={blockViews.length ? Math.min(...blockViews.flatMap((b) => b.spans.map((s) => s[0]))) : null}
          maxSegEnd={blockViews.length ? Math.max(...blockViews.flatMap((b) => b.spans.map((s) => s[1]))) : null}
          busy={busy}
          onSave={saveSessionTimes}
          onCancel={() => setSessionEditOpen(false)}
        />
      )}
      {actionError && <p className="message message-error" style={{ fontSize: 13 }}>{actionError}</p>}

      {loading && <div className="card" style={{ color: 'var(--muted)', fontSize: 14 }}>A carregar…</div>}
      {error && <div className="card" style={{ borderColor: 'rgba(239,68,68,0.35)', color: 'var(--error)', fontSize: 13 }}>{error}</div>}

      {session && hr && (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="section-label" style={{ margin: 0 }}>
              Frequência cardíaca{selected ? ` · ${selected.name}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {selected && (
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedId(null)}>ver treino todo</button>
              )}
              <SourceTag hr={hr} />
            </div>
          </div>

          <HrChart
            fromMs={viewFrom} toMs={viewTo} offset={offset} hr={hr}
            blocks={blockViews} selectedId={selectedId}
          />

          {selected && <BlockStats bv={selected} hr={hr} offset={offset} />}
        </div>
      )}

      {/* Lista de blocos — clicável (foca o HR) + editar */}
      {session && blockViews.length > 0 && (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="section-label" style={{ margin: 0 }}>Blocos</span>
            <button
              className="btn btn-sm"
              onClick={() => { setAdding((v) => !v); setSelectedId(null); }}
              style={{ color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '3px 12px', fontWeight: 600 }}
            >
              {adding ? 'Fechar' : '+ Adicionar bloco'}
            </button>
          </div>

          {adding && (
            <NewBlockForm
              apparatus={apparatus}
              offset={offset}
              defaultStartMs={blockViews.length ? blockViews[blockViews.length - 1].endMs : fromMs}
              sessionEndMs={toMs || nowMs}
              busy={busy}
              onSave={addNew}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Chips lado a lado: o próprio retângulo fica da cor do bloco (paleta),
              nome em cima e dados por baixo. Até 5 numa linha; a partir de 6, duas
              linhas equilibradas com o topo a levar o extra (6=3+3, 7=4+3, 8=4+4…).
              Nunca passa de 12 = 6×2. */}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: `repeat(${blockViews.length <= 5 ? blockViews.length : Math.ceil(blockViews.length / 2)}, minmax(0, 1fr))` }}>
            {blockViews.map((b) => {
              const on = selectedId === b.id;
              return (
                <div
                  key={b.id}
                  onClick={() => setSelectedId((s) => (s === b.id ? null : b.id))}
                  style={{
                    display: 'grid', gap: 4, padding: '8px 10px', cursor: 'pointer',
                    borderRadius: 'var(--radius)',
                    border: `1px solid ${on ? b.color : b.color + '66'}`,
                    background: on ? b.color + '33' : b.color + '1f',
                  }}
                >
                  <span style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                    <span>{fmtDur(b.workSec)}</span>
                    <span>{b.rpe != null ? `RPE ${b.rpe}` : '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ao selecionar um bloco, o editor abre já por baixo da grelha. */}
          {selected && (
            <BlockEditor
              key={selected.id}
              bv={selected}
              apparatus={apparatus}
              offset={offset}
              neighbours={neighboursOf(blockViews, selected.id)}
              busy={busy}
              onSave={(changes) => applyEdit(selected, changes)}
              onDelete={() => removeBlock(selected)}
              onCancel={() => setSelectedId(null)}
            />
          )}
        </div>
      )}

      {session && pains.length > 0 && (
        <div className="card"><SessionPains pains={pains} regions={regions} editable onChanged={reloadPains} /></div>
      )}
    </div>
  );
}

function neighboursOf(views: BView[], id: string): { prev: BView | null; next: BView | null } {
  const i = views.findIndex((b) => b.id === id);
  return { prev: i > 0 ? views[i - 1] : null, next: i >= 0 && i < views.length - 1 ? views[i + 1] : null };
}

function editErr(e: unknown): string {
  if (e instanceof TrainingError && e.code === '42501') {
    return 'Sem permissão para apagar (falta o grant DELETE). Aplica o SQL que te dei no Supabase e tenta de novo.';
  }
  return e instanceof Error ? e.message : 'Erro ao editar o bloco.';
}

/* ── Estatísticas do bloco selecionado ────────────────────────────────────── */
function BlockStats({ bv, hr, offset }: { bv: BView; hr: HrSeries; offset: number }) {
  const inWin = hr.status === 'ok' ? hr.points.filter((p) => p.t_ms >= bv.startMs && p.t_ms <= bv.endMs) : [];
  const bpms = inWin.map((p) => p.bpm);
  const avg = bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
  const lo = bpms.length ? Math.min(...bpms) : null;
  const hi = bpms.length ? Math.max(...bpms) : null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <Stat label="Início" value={fmtClock(bv.startMs, offset)} />
      <Stat label="Fim" value={fmtClock(bv.endMs, offset)} />
      <Stat label="Tempo" value={fmtDur(bv.workSec)} />
      <Stat label="RPE" value={bv.rpe != null ? String(bv.rpe) : '—'} />
      {avg != null && <Stat label="FC média" value={`${avg}`} />}
      {lo != null && hi != null && <Stat label="FC mín–máx" value={`${lo}–${hi}`} />}
      {bv.spans.length > 1 && <Stat label="Pausas" value={String(bv.spans.length - 1)} />}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', padding: '4px 10px', borderRadius: 999, background: 'var(--surface-active)', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

/* ── Editor dos tempos da SESSÃO ──────────────────────────────────────────── */
function SessionTimeEditor({
  session, offset, nowMs, minSegStart, maxSegEnd, busy, onSave, onCancel,
}: {
  session: SessionRow;
  offset: number;
  nowMs: number;
  minSegStart: number | null; // não pode começar DEPOIS do 1º bloco
  maxSegEnd: number | null;   // não pode acabar ANTES do último bloco
  busy: boolean;
  onSave: (startIso: string, endIso: string) => void;
  onCancel: () => void;
}) {
  const startMs0 = Date.parse(session.start_utc);
  const endMs0 = session.end_utc ? Date.parse(session.end_utc) : nowMs;
  const [startStr, setStartStr] = useState(toLocalInput(startMs0, offset));
  const [endStr, setEndStr] = useState(toLocalInput(endMs0, offset));

  function save() {
    let s = fromLocalInput(startStr, offset);
    let e = fromLocalInput(endStr, offset);
    if (minSegStart != null) s = Math.min(s, minSegStart); // contém o 1º bloco
    if (maxSegEnd != null) e = Math.max(e, maxSegEnd);      // contém o último bloco
    if (e <= s) return;
    onSave(new Date(s).toISOString(), new Date(e).toISOString());
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <p className="section-label" style={{ margin: 0 }}>Tempos da sessão</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Início
          <input type="datetime-local" className="input" value={startStr}
            max={minSegStart != null ? toLocalInput(minSegStart, offset) : undefined}
            onChange={(e) => setStartStr(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Fim
          <input type="datetime-local" className="input" value={endStr}
            min={maxSegEnd != null ? toLocalInput(maxSegEnd, offset) : undefined}
            onChange={(e) => setEndStr(e.target.value)} style={{ fontSize: 13 }} />
        </label>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
        Para corrigir um treino que ficou aberto de mais, encolhe o <strong>Fim</strong>. Os limites impedem cortar um bloco (início ≤ 1º bloco, fim ≥ último bloco).
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancelar</button>
      </div>
    </div>
  );
}

/* ── Editor de bloco ──────────────────────────────────────────────────────── */
function BlockEditor({
  bv, apparatus, offset, neighbours, busy, onSave, onDelete, onCancel,
}: {
  bv: BView;
  apparatus: Apparatus[];
  offset: number;
  neighbours: { prev: BView | null; next: BView | null };
  busy: boolean;
  onSave: (c: { apparatusId?: string; rpe?: number | null; newStartMs?: number; newEndMs?: number }) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [apparatusId, setApparatusId] = useState(bv.apparatusId);
  const [rpe, setRpe] = useState<number | null>(bv.rpe);
  const [startStr, setStartStr] = useState(toLocalInput(bv.startMs, offset));
  const [endStr, setEndStr] = useState(toLocalInput(bv.endMs, offset));
  const [confirmDel, setConfirmDel] = useState(false);

  // Limites dos tempos: a fronteira partilhada não pode invadir o próprio bloco
  // nem anular o vizinho. A borda EXTERNA é livre (1º bloco pode começar antes,
  // último pode acabar depois) — a sessão expande-se para conter (null = sem limite).
  const ownFirstEnd = bv.spans.length ? Math.min(...bv.spans.map((s) => s[1])) : bv.endMs;
  const ownLastStart = bv.spans.length ? Math.max(...bv.spans.map((s) => s[0])) : bv.startMs;
  const startMin = neighbours.prev ? neighbours.prev.startMs + 60000 : null;
  const startMax = ownFirstEnd - 60000;
  const endMin = ownLastStart + 60000;
  const endMax = neighbours.next ? neighbours.next.endMs - 60000 : null;

  function save() {
    const newStartMs = fromLocalInput(startStr, offset);
    const newEndMs = fromLocalInput(endStr, offset);
    onSave({
      apparatusId,
      rpe,
      newStartMs: clamp(newStartMs, startMin, startMax),
      newEndMs: clamp(newEndMs, endMin, endMax),
    });
  }

  return (
    <div style={{ display: 'grid', gap: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-hover)' }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        Bloco
        <select className="input" value={apparatusId} onChange={(e) => setApparatusId(e.target.value)} style={{ fontSize: 13.5 }}>
          {apparatus.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        RPE
        <select className="input" value={rpe ?? ''} onChange={(e) => setRpe(e.target.value === '' ? null : Number(e.target.value))} style={{ fontSize: 13.5 }}>
          <option value="">—</option>
          {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Início
          <input type="datetime-local" className="input" value={startStr}
            min={startMin != null ? toLocalInput(startMin, offset) : undefined} max={toLocalInput(startMax, offset)}
            onChange={(e) => setStartStr(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Fim
          <input type="datetime-local" className="input" value={endStr}
            min={toLocalInput(endMin, offset)} max={endMax != null ? toLocalInput(endMax, offset) : undefined}
            onChange={(e) => setEndStr(e.target.value)} style={{ fontSize: 13 }} />
        </label>
      </div>
      {(neighbours.prev || neighbours.next) && (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
          Ao mudar o {neighbours.prev ? 'início' : ''}{neighbours.prev && neighbours.next ? '/' : ''}{neighbours.next ? 'fim' : ''}, o bloco vizinho ajusta-se para não ficar buraco nem sobreposição.
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
        <span style={{ marginLeft: 'auto' }}>
          {bv.status === 'active' ? (
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Bloco a decorrer — termina-o antes de apagar.</span>
          ) : !confirmDel ? (
            <button
              className="btn btn-sm"
              onClick={() => setConfirmDel(true)}
              disabled={busy}
              style={{ color: '#fff', border: 'none', background: '#EF4444', borderRadius: 6, padding: '3px 12px', fontWeight: 600 }}
            >
              Apagar bloco
            </button>
          ) : (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <span style={{ color: 'var(--error)' }}>Apagar?</span>
              <button className="btn btn-sm" onClick={onDelete} disabled={busy} style={{ background: 'var(--error)', color: '#fff' }}>Sim</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(false)} disabled={busy}>Não</button>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/* ── Adicionar bloco novo ─────────────────────────────────────────────────── */
function NewBlockForm({
  apparatus, offset, defaultStartMs, sessionEndMs, busy, onSave, onCancel,
}: {
  apparatus: Apparatus[];
  offset: number;
  defaultStartMs: number;
  sessionEndMs: number;
  busy: boolean;
  onSave: (c: { apparatusId: string; rpe: number | null; startMs: number; endMs: number }) => void;
  onCancel: () => void;
}) {
  const start0 = defaultStartMs;
  const end0 = Math.min(sessionEndMs, start0 + 10 * 60000);
  const [apparatusId, setApparatusId] = useState(apparatus[0]?.id ?? '');
  const [rpe, setRpe] = useState<number | null>(null);
  const [startStr, setStartStr] = useState(toLocalInput(start0, offset));
  const [endStr, setEndStr] = useState(toLocalInput(end0 > start0 ? end0 : start0 + 60000, offset));

  function save() {
    const s = fromLocalInput(startStr, offset);
    const e = fromLocalInput(endStr, offset);
    if (e <= s) { return; }
    onSave({ apparatusId, rpe, startMs: s, endMs: e });
  }

  return (
    <div style={{ display: 'grid', gap: 12, padding: 12, border: '1px dashed var(--accent)', borderRadius: 'var(--radius)', background: 'var(--surface-hover)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 600 }}>Novo bloco</span>
      <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        Bloco
        <select className="input" value={apparatusId} onChange={(e) => setApparatusId(e.target.value)} style={{ fontSize: 13.5 }}>
          {apparatus.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        RPE
        <select className="input" value={rpe ?? ''} onChange={(e) => setRpe(e.target.value === '' ? null : Number(e.target.value))} style={{ fontSize: 13.5 }}>
          <option value="">—</option>
          {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Início
          <input type="datetime-local" className="input" value={startStr} onChange={(e) => setStartStr(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Fim
          <input type="datetime-local" className="input" value={endStr} onChange={(e) => setEndStr(e.target.value)} style={{ fontSize: 13 }} />
        </label>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
        O bloco é adicionado no intervalo indicado (por defeito a seguir ao último). Não ajusta os vizinhos — se sobrepuser, corrige os tempos depois.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !apparatusId}>{busy ? 'A adicionar…' : 'Adicionar'}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancelar</button>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number | null, hi: number | null): number {
  if (lo != null && hi != null && hi < lo) return v; // limites inválidos → não força
  let x = v;
  if (lo != null) x = Math.max(lo, x);
  if (hi != null) x = Math.min(hi, x);
  return x;
}

function SourceTag({ hr }: { hr: HrSeries }) {
  if (hr.status === 'ok') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--success)' }} />
        Fonte: {hr.source_label ?? 'Fitbit Air'}
      </span>
    );
  }
  return null;
}

/* ── O gráfico ────────────────────────────────────────────────────────────── */

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function HrChart({
  fromMs, toMs, offset, hr, blocks, selectedId,
}: {
  fromMs: number; toMs: number; offset: number; hr: HrSeries; blocks: BView[]; selectedId: string | null;
}) {
  const [ref, W] = useWidth();
  const H = 280;

  if (hr.status !== 'ok') {
    const msg =
      hr.status === 'arriving' ? { t: 'Dados de HR ainda a chegar', s: 'A Fitbit Air ingere de 3 em 3 horas (forward-only). Volta daqui a pouco.' } :
      hr.status === 'empty' ? { t: 'Sem dados de HR para esta sessão', s: 'Não há frequência cardíaca ingerida neste intervalo.' } :
      { t: 'Agregação de HR indisponível', s: 'A RPC wearable.hr_series_bucketed ainda não está aplicada na base.' };
    return (
      <div ref={ref} style={{ height: H, display: 'grid', placeItems: 'center', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', padding: 20 }}>
        <div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{msg.t}</p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--muted)', maxWidth: 320 }}>{msg.s}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {W > 0 && <HrChartSvg W={W} H={H} fromMs={fromMs} toMs={toMs} offset={offset} hr={hr} blocks={blocks} selectedId={selectedId} />}
    </div>
  );
}

function HrChartSvg({
  W, H, fromMs, toMs, offset, hr, blocks, selectedId,
}: {
  W: number; H: number; fromMs: number; toMs: number; offset: number; hr: HrSeries; blocks: BView[]; selectedId: string | null;
}) {
  const padL = 34, padR = 12, padT = 24, padB = 22;
  const innerW = Math.max(1, W - padL - padR);
  const innerH = Math.max(1, H - padT - padB);
  const span = Math.max(1, toMs - fromMs);
  const x = (t: number) => padL + ((t - fromMs) / span) * innerW;

  // Só os pontos dentro da janela visível (importa quando se foca um bloco).
  const pts = hr.points.filter((p) => p.t_ms >= fromMs && p.t_ms <= toMs);
  const bpms = (pts.length ? pts : hr.points).map((p) => p.bpm);
  const lo = Math.min(...bpms), hi = Math.max(...bpms);
  const yLo = Math.floor(lo - 5), yHi = Math.ceil(hi + 5);
  const yRange = Math.max(1, yHi - yLo);
  const y = (bpm: number) => padT + (1 - (bpm - yLo) / yRange) * innerH;

  const gapMs = hr.bucket_seconds * 1000 * 2.5;
  const segments: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0 && p.t_ms - pts[i - 1].t_ms > gapMs) { if (cur.length) segments.push(cur.join(' ')); cur = []; }
    cur.push(`${x(p.t_ms).toFixed(1)},${y(p.bpm).toFixed(1)}`);
  }
  if (cur.length) segments.push(cur.join(' '));

  const ticks = [fromMs, (fromMs + toMs) / 2, toMs];

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {blocks.flatMap((b) =>
        b.spans.map(([a, z], si) => {
          const xa = x(a), xz = x(z);
          const w = Math.max(1, xz - xa);
          const dim = selectedId != null && selectedId !== b.id;
          return (
            <g key={`${b.id}-${si}`}>
              <rect x={xa} y={padT} width={w} height={innerH} fill={b.color} opacity={dim ? 0.05 : selectedId === b.id ? 0.22 : 0.15} />
              <line x1={xa} y1={padT} x2={xa} y2={padT + innerH} stroke={b.color} strokeWidth={1} opacity={dim ? 0.15 : 0.4} />
            </g>
          );
        }),
      )}

      {[yLo, yHi].map((v) => (
        <g key={v}>
          <text x={padL - 6} y={y(v) + 3} fontSize={10} fill="var(--muted)" textAnchor="end">{v}</text>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
        </g>
      ))}

      {segments.map((p, i) => (
        <polyline key={i} points={p} fill="none" stroke="var(--text)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      ))}

      {ticks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>
          {fmtClock(t, offset)}
        </text>
      ))}
    </svg>
  );
}
