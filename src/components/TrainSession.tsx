'use client';

/**
 * Ecrã de registo de treino AO VIVO.
 *
 * Regra crítica de desenho: DURANTE o treino mostra-se APENAS tempo — tempo da
 * sessão e tempo por aparelho. Nada de FC, carga, readiness, comparações ou
 * qualquer indicador avaliativo. O RPE é a métrica primária do training load, e
 * ver dados objetivos antes de o registar ancora a resposta (mesmo motivo do
 * check-in matinal ser cego). Não acrescentar indicadores por iniciativa própria.
 *
 * Fluxo: iniciar → escolher aparelho (open_block) → ECRÃ PRINCIPAL → próximo
 * bloco (RPE → escolher) / pausa↔retoma / terminar sessão (RPE se houver bloco
 * aberto → fim). Toda a escrita passa pelas RPCs (ver src/lib/training.ts).
 *
 * Retoma: ao montar, get_open_session — se houver sessão em curso vai direto ao
 * estado certo (principal se houver bloco ativo, senão escolher aparelho). Cobre
 * o telemóvel reiniciar ou a app fechar a meio.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  startSession, openBlock, pauseBlock, resumeBlock, closeBlock, endSession,
  getOpenSession, getOpenBlock, listApparatus, listBlocks,
  closedSeconds, openSegmentStartMs,
  TrainingError, type Apparatus, type BlockRow,
} from '@/lib/training';

type Phase = 'loading' | 'idle' | 'choose' | 'main';

// mm:ss, ou h:mm:ss quando passa a hora.
function fmt(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Bloco a fechar via popup de RPE. `thenEnd` = veio do "terminar sessão", por
// isso a seguir ao RPE abre-se o popup de fim de sessão em vez de ir escolher.
type PendingClose = { blockId: string; apparatusName: string; thenEnd: boolean };

export default function TrainSession() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartMs, setSessionStartMs] = useState<number>(0);
  const [apparatus, setApparatus] = useState<Apparatus[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [endOpen, setEndOpen] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map(apparatus.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [apparatus]);

  const activeBlock = useMemo(() => blocks.find((b) => b.status === 'active') ?? null, [blocks]);
  const activePaused = useMemo(
    () => (activeBlock ? openSegmentStartMs(activeBlock.block_segments) === null : false),
    [activeBlock],
  );

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof TrainingError ? e.message : e instanceof Error ? e.message : 'Erro inesperado.';
    setError(msg);
  }, []);

  // Recarrega os blocos+segmentos da sessão (fonte de verdade das durações).
  const refreshBlocks = useCallback(async (sid: string) => {
    const rows = await listBlocks(sid);
    setBlocks(rows);
    return rows;
  }, []);

  // ── Arranque: retoma sessão aberta se existir ──────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [apps, open] = await Promise.all([listApparatus(), getOpenSession()]);
        setApparatus(apps);
        if (!open) { setPhase('idle'); return; }
        setSessionId(open.session_id);
        setSessionStartMs(Date.parse(open.start_utc));
        const rows = await listBlocks(open.session_id);
        setBlocks(rows);
        const hasActive = rows.some((b) => b.status === 'active');
        setPhase(hasActive ? 'main' : 'choose');
      } catch (e) {
        fail(e);
        setPhase('idle');
      }
    })();
  }, [fail]);

  // ── Relógio: corre enquanto a sessão está aberta (principal + escolha) ─────
  useEffect(() => {
    if (phase !== 'main' && phase !== 'choose') return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ── Ações ──────────────────────────────────────────────────────────────────
  const doStart = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const sid = await startSession();
      setSessionId(sid);
      setSessionStartMs(Date.now());
      setBlocks([]);
      setPhase('choose');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [fail]);

  const doChoose = useCallback(async (apparatusId: string) => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      await openBlock(sessionId, apparatusId);
      await refreshBlocks(sessionId);
      setPhase('main');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [sessionId, refreshBlocks, fail]);

  const doPauseResume = useCallback(async () => {
    if (!activeBlock) return;
    setBusy(true); setError(null);
    try {
      if (activePaused) await resumeBlock(activeBlock.id);
      else await pauseBlock(activeBlock.id);
      if (sessionId) await refreshBlocks(sessionId);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [activeBlock, activePaused, sessionId, refreshBlocks, fail]);

  // "próximo bloco": pede o RPE do bloco atual, depois vai escolher aparelho.
  const askNextBlock = useCallback(() => {
    if (!activeBlock) return;
    setPendingClose({ blockId: activeBlock.id, apparatusName: nameOf(activeBlock.apparatus_id), thenEnd: false });
  }, [activeBlock, nameOf]);

  // "terminar sessão": se houver bloco aberto pede o RPE primeiro; senão vai
  // direto ao popup de fim. Verificação autoritária via get_open_block.
  const askEnd = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      const open = await getOpenBlock(sessionId);
      if (open) setPendingClose({ blockId: open.block_id, apparatusName: open.apparatus_name, thenEnd: true });
      else setEndOpen(true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [sessionId, fail]);

  // Submissão do popup de RPE (um toque).
  const submitRpe = useCallback(async (rpe: number) => {
    const pc = pendingClose;
    if (!pc || !sessionId) return;
    setBusy(true); setError(null);
    try {
      await closeBlock(pc.blockId, rpe);
      await refreshBlocks(sessionId);
      setPendingClose(null);
      if (pc.thenEnd) setEndOpen(true);
      else setPhase('choose');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [pendingClose, sessionId, refreshBlocks, fail]);

  // Submissão do popup de fim de sessão.
  const submitEnd = useCallback(async (payload: {
    overallFeeling: number; pain: boolean; painLocation: string; notes: string;
  }) => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      const extra: Record<string, unknown> = { pain: payload.pain };
      if (payload.pain && payload.painLocation.trim()) extra.pain_location = payload.painLocation.trim();
      await endSession(sessionId, {
        overallFeeling: payload.overallFeeling,
        notes: payload.notes.trim() || null,
        extra,
      });
      // Sessão fechada → volta ao estado inicial (pronto para outra).
      setEndOpen(false);
      setSessionId(null);
      setBlocks([]);
      setPhase('idle');
    } catch (e) {
      // Corrida rara: bloco reaberto entretanto. TR040 → pedir o RPE em falta.
      if (e instanceof TrainingError && e.code === 'TR040') {
        setEndOpen(false);
        try {
          const open = await getOpenBlock(sessionId);
          if (open) setPendingClose({ blockId: open.block_id, apparatusName: open.apparatus_name, thenEnd: true });
        } catch (e2) { fail(e2); }
      } else {
        fail(e);
      }
    } finally { setBusy(false); }
  }, [sessionId, fail]);

  // ── Durações por bloco (para a lista) ──────────────────────────────────────
  const blockRows = useMemo(() => {
    return blocks.map((b) => {
      const closed = closedSeconds(b.block_segments);
      const openStart = b.status === 'active' ? openSegmentStartMs(b.block_segments) : null;
      const running = openStart !== null;
      const total = running ? closed + (nowMs - (openStart as number)) / 1000 : closed;
      return {
        id: b.id,
        name: nameOf(b.apparatus_id),
        seconds: total,
        active: b.status === 'active',
        running,
      };
    });
  }, [blocks, nowMs, nameOf]);

  const sessionSeconds = sessionStartMs ? (nowMs - sessionStartMs) / 1000 : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Treino</h1>
      </div>

      {error && (
        <div
          className="card"
          style={{ borderColor: 'rgba(239,68,68,0.35)', color: 'var(--error)', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}
        >
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>fechar</button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="card" style={{ color: 'var(--muted)', fontSize: 14 }}>A carregar…</div>
      )}

      {phase === 'idle' && (
        <div className="card" style={{ display: 'grid', gap: 16, placeItems: 'center', padding: '40px 20px' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center' }}>
            Sem treino em curso.
          </p>
          <button className="btn btn-primary btn-lg" style={{ minWidth: 220 }} onClick={doStart} disabled={busy}>
            Iniciar treino
          </button>
        </div>
      )}

      {phase === 'choose' && (
        <ChooseApparatus
          apparatus={apparatus}
          sessionSeconds={sessionSeconds}
          busy={busy}
          onPick={doChoose}
        />
      )}

      {phase === 'main' && (
        <MainScreen
          sessionSeconds={sessionSeconds}
          blocks={blockRows}
          paused={activePaused}
          busy={busy}
          onNext={askNextBlock}
          onPauseResume={doPauseResume}
          onEnd={askEnd}
        />
      )}

      {pendingClose && (
        <RpePopup
          apparatusName={pendingClose.apparatusName}
          busy={busy}
          onPick={submitRpe}
          onCancel={() => setPendingClose(null)}
        />
      )}

      {endOpen && (
        <EndSessionPopup busy={busy} onSubmit={submitEnd} onCancel={() => setEndOpen(false)} />
      )}
    </div>
  );
}

/* ── Ecrã: escolher aparelho ─────────────────────────────────────────────── */
function ChooseApparatus({
  apparatus, sessionSeconds, busy, onPick,
}: {
  apparatus: Apparatus[]; sessionSeconds: number; busy: boolean; onPick: (id: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="section-label" style={{ margin: 0 }}>Sessão</span>
        <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
          {fmt(sessionSeconds)}
        </span>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <span className="section-label" style={{ margin: 0 }}>Escolhe o aparelho</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {apparatus.map((a) => (
            <button
              key={a.id}
              className="btn btn-secondary"
              style={{ height: 60, fontSize: 15, justifyContent: 'center' }}
              disabled={busy}
              onClick={() => onPick(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Ecrã principal ──────────────────────────────────────────────────────── */
function MainScreen({
  sessionSeconds, blocks, paused, busy, onNext, onPauseResume, onEnd,
}: {
  sessionSeconds: number;
  blocks: { id: string; name: string; seconds: number; active: boolean; running: boolean }[];
  paused: boolean; busy: boolean;
  onNext: () => void; onPauseResume: () => void; onEnd: () => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Cronómetro da sessão */}
      <div className="card" style={{ display: 'grid', gap: 4, placeItems: 'center', padding: '22px 20px' }}>
        <span className="section-label" style={{ margin: 0 }}>Tempo de sessão</span>
        <span style={{ fontSize: 44, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', lineHeight: 1.1 }}>
          {fmt(sessionSeconds)}
        </span>
      </div>

      {/* Aparelhos + duração (inclui o atual) */}
      <div className="card" style={{ display: 'grid', gap: 2 }}>
        <span className="section-label" style={{ margin: '0 0 6px' }}>Aparelhos</span>
        {blocks.map((b) => (
          <div
            key={b.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 12px', borderRadius: 'var(--radius-sm)',
              background: b.active ? 'var(--surface-active)' : 'transparent',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, color: 'var(--text)' }}>
              {b.name}
              {b.active && (
                <span style={{ fontSize: 11, fontWeight: 600, color: b.running ? 'var(--success)' : 'var(--warning)' }}>
                  {b.running ? '● em curso' : '❚❚ em pausa'}
                </span>
              )}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
              {fmt(b.seconds)}
            </span>
          </div>
        ))}
      </div>

      {/* Botões de ação — alvos grandes para usar a meio do treino */}
      <div style={{ display: 'grid', gap: 10 }}>
        <button className="btn btn-primary btn-lg" style={{ height: 52 }} disabled={busy} onClick={onNext}>
          Próximo bloco
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button className="btn btn-secondary btn-lg" style={{ height: 52 }} disabled={busy} onClick={onPauseResume}>
            {paused ? 'Retomar' : 'Pausa'}
          </button>
          <button className="btn btn-danger btn-lg" style={{ height: 52 }} disabled={busy} onClick={onEnd}>
            Terminar sessão
          </button>
        </div>
      </div>

      {/* Espaço reservado v2 — sem funcionalidade (plano planeado vs. executado) */}
      <div className="card" style={{ opacity: 0.4, pointerEvents: 'none', display: 'grid', gap: 8 }}>
        <span className="section-label" style={{ margin: 0 }}>Plano da sessão</span>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}>
          <span>Planeado vs. executado</span>
          <span>em breve</span>
        </div>
        <button className="btn btn-secondary btn-sm" disabled style={{ justifySelf: 'start' }}>Abrir plano</button>
      </div>
    </div>
  );
}

/* ── Popup: RPE (0–10 Borg CR-10), um toque ──────────────────────────────── */
function RpePopup({
  apparatusName, busy, onPick, onCancel,
}: {
  apparatusName: string; busy: boolean; onPick: (rpe: number) => void; onCancel: () => void;
}) {
  return (
    <Overlay onBackdrop={busy ? undefined : onCancel}>
      <div className="card" style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 14 }}>
        <div>
          <p className="section-label" style={{ margin: 0 }}>Esforço — {apparatusName}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
            RPE (0–10). Toca no valor.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 4 }}>
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              className="btn btn-secondary"
              style={{ height: 46, padding: 0, fontSize: 15, fontWeight: 700, touchAction: 'manipulation' }}
              disabled={busy}
              onClick={() => onPick(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'center' }} disabled={busy} onClick={onCancel}>
          cancelar
        </button>
      </div>
    </Overlay>
  );
}

/* ── Popup: fim de sessão ────────────────────────────────────────────────── */
function EndSessionPopup({
  busy, onSubmit, onCancel,
}: {
  busy: boolean;
  onSubmit: (p: { overallFeeling: number; pain: boolean; painLocation: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const [feeling, setFeeling] = useState<number | null>(null);
  const [pain, setPain] = useState<boolean>(false);
  const [painLocation, setPainLocation] = useState('');
  const [notes, setNotes] = useState('');

  const canSubmit = feeling !== null && !busy;

  return (
    <Overlay onBackdrop={busy ? undefined : onCancel}>
      <div className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '92dvh', overflowY: 'auto', display: 'grid', gap: 16 }}>
        <p className="section-label" style={{ margin: 0 }}>Fim de sessão</p>

        <div style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Sensação geral (0–10)</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 4 }}>
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                className="btn"
                style={{
                  height: 42, padding: 0, fontSize: 14, fontWeight: 700, touchAction: 'manipulation',
                  background: feeling === n ? 'var(--accent)' : 'var(--surface-hover)',
                  color: feeling === n ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
                onClick={() => setFeeling(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Dor?</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              className="btn"
              style={{ height: 42, background: !pain ? 'var(--accent)' : 'var(--surface-hover)', color: !pain ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => { setPain(false); setPainLocation(''); }}
            >
              Não
            </button>
            <button
              className="btn"
              style={{ height: 42, background: pain ? 'var(--accent)' : 'var(--surface-hover)', color: pain ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => setPain(true)}
            >
              Sim
            </button>
          </div>
          {pain && (
            <input
              className="input"
              placeholder="Onde?"
              value={painLocation}
              onChange={(e) => setPainLocation(e.target.value)}
            />
          )}
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Notas (opcional)</span>
          <textarea
            className="input"
            rows={3}
            style={{ resize: 'vertical' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <button className="btn btn-ghost btn-lg" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary btn-lg"
            disabled={!canSubmit}
            onClick={() => feeling !== null && onSubmit({ overallFeeling: feeling, pain, painLocation, notes })}
          >
            Terminar sessão
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ── Overlay base (mesma linguagem do gate do check-in) ──────────────────── */
function Overlay({ children, onBackdrop }: { children: React.ReactNode; onBackdrop?: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onBackdrop ? (e) => { if (e.target === e.currentTarget) onBackdrop(); } : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
    >
      {children}
    </div>
  );
}
