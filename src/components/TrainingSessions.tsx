'use client';

/**
 * Secção Training: hub do registo de treino.
 *
 * No topo, o botão de iniciar/retomar (o mesmo do dashboard). Por baixo, o
 * histórico de sessões guardadas em training.sessions — cada uma com a data, a
 * duração, os aparelhos com o respetivo tempo e RPE, a sensação geral e a carga
 * (sRPE = Σ rpe × minutos). Só LÊ; as escritas vivem no ecrã ao vivo (/train).
 *
 * Aqui mostrar métricas é correto — é uma revisão POSTERIOR. A regra de "nada de
 * métricas no ecrã" é só durante o treino, para não ancorar o RPE.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import TrainingEntry from './TrainingEntry';
import {
  listApparatus, listSessions, listBlocksForSessions,
  type Apparatus, type SessionRow, type BlockWithSession, type Segment,
} from '@/lib/training';

// Data/hora no fuso em que o treino foi feito (usa o offset guardado, não o do
// viewer): desloca-se o instante e leem-se os campos em UTC para não re-aplicar.
function fmtLocal(utc: string, offsetSec: number): string {
  const d = new Date(Date.parse(utc) + offsetSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
// Igual ao ecrã ao vivo: mostra segundos (m:ss), horas só quando passa a hora.
// Antes só mostrava h/min e arredondava para baixo — blocos de segundos viravam
// "0min", o que fazia parecer que todo o tempo se tinha perdido.
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

// Segundos de trabalho de um bloco. Um segmento sem end_utc é limitado pelo fim
// da sessão (ou pelo agora, se ainda decorrer) em vez de ser ignorado.
function blockSeconds(segs: Segment[], fallbackEndMs: number): number {
  let s = 0;
  for (const seg of segs) {
    const end = seg.end_utc ? Date.parse(seg.end_utc) : fallbackEndMs;
    s += Math.max(0, (end - Date.parse(seg.start_utc)) / 1000);
  }
  return s;
}

export default function TrainingSessions() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [blocks, setBlocks] = useState<BlockWithSession[]>([]);
  const [apparatus, setApparatus] = useState<Apparatus[]>([]);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      try {
        const [apps, sess] = await Promise.all([listApparatus(), listSessions()]);
        setApparatus(apps);
        setSessions(sess);
        const blk = await listBlocksForSessions(sess.map((s) => s.id));
        setBlocks(blk);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar sessões.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nameOf = useMemo(() => {
    const map = new Map(apparatus.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [apparatus]);

  const blocksBySession = useMemo(() => {
    const m = new Map<string, BlockWithSession[]>();
    for (const b of blocks) {
      const arr = m.get(b.session_id) ?? [];
      arr.push(b);
      m.set(b.session_id, arr);
    }
    return m;
  }, [blocks]);

  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Training</h1>
      </div>

      <TrainingEntry />

      {error && (
        <div className="card" style={{ borderColor: 'rgba(239,68,68,0.35)', color: 'var(--error)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ color: 'var(--muted)', fontSize: 14 }}>A carregar sessões…</div>
      ) : sessions.length === 0 ? (
        <div className="card" style={{ color: 'var(--muted)', fontSize: 14 }}>Ainda não há sessões registadas.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              blocks={blocksBySession.get(s.id) ?? []}
              nameOf={nameOf}
              nowMs={nowMs}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session, blocks, nameOf, nowMs,
}: {
  session: SessionRow;
  blocks: BlockWithSession[];
  nameOf: (id: string) => string;
  nowMs: number;
}) {
  const open = session.end_utc === null;
  const fallbackEndMs = open ? nowMs : Date.parse(session.end_utc as string);
  const durSec = (fallbackEndMs - Date.parse(session.start_utc)) / 1000;

  // Por bloco: tempo de trabalho (soma dos segmentos) e RPE.
  const rows = blocks.map((b) => {
    const sec = blockSeconds(b.block_segments, fallbackEndMs);
    return { id: b.id, name: nameOf(b.apparatus_id), sec, rpe: b.rpe };
  });
  const activeSec = rows.reduce((a, r) => a + r.sec, 0);
  // sRPE da sessão = Σ (rpe × minutos) dos blocos com RPE.
  const load = rows.reduce((a, r) => a + (r.rpe != null ? r.rpe * (r.sec / 60) : 0), 0);

  const pain = session.extra && (session.extra as Record<string, unknown>).pain === true;
  const painLoc = pain ? String((session.extra as Record<string, unknown>).pain_location ?? '') : '';

  return (
    <Link href={`/training/${session.id}`} className="card card-hover" style={{ display: 'grid', gap: 12, textDecoration: 'none' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          {fmtLocal(session.start_utc, session.utc_offset_seconds)}
        </span>
        <span style={{ fontSize: 13, color: open ? 'var(--success)' : 'var(--text-secondary)', fontWeight: 600 }}>
          {open ? '● em curso' : fmtDur(durSec)}
        </span>
      </div>

      {/* Aparelhos */}
      {rows.length > 0 ? (
        <div style={{ display: 'grid', gap: 2 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5 }}>
              <span style={{ color: 'var(--text)' }}>{r.name}</span>
              <span style={{ display: 'flex', gap: 14, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                <span>{fmtDur(r.sec)}</span>
                <span style={{ minWidth: 52, textAlign: 'right' }}>{r.rpe != null ? `RPE ${r.rpe}` : '—'}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Sem blocos.</span>
      )}

      {/* Resumo */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <Chip label="Ativo" value={fmtDur(activeSec)} />
        {load > 0 && <Chip label="Carga (sRPE)" value={String(Math.round(load))} />}
        {session.overall_feeling != null && <Chip label="Sensação" value={`${session.overall_feeling}/10`} />}
        {pain && <Chip label="Dor" value={painLoc || 'sim'} tone="warn" />}
      </div>

      {session.notes && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{session.notes}</p>
      )}
    </Link>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <span
      style={{
        display: 'inline-flex', gap: 6, alignItems: 'baseline',
        padding: '4px 10px', borderRadius: 999,
        background: tone === 'warn' ? 'rgba(245,158,11,0.12)' : 'var(--surface-active)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: tone === 'warn' ? 'var(--warning)' : 'var(--text)', fontWeight: 600 }}>{value}</span>
    </span>
  );
}
