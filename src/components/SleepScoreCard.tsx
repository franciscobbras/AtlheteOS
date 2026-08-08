'use client';

/**
 * Card compacto de Sleep Score (só o tamanho do gauge) + uma leitura mínima do
 * SRI (Sleep Regularity Index), que pertence a este cartão: no card só o valor
 * atual do SRI e a sua tendência; o detalhe completo do SRI vive no modal, que
 * abre ao clicar (junto da decomposição do score e do check-in).
 *
 * Lê o score DO DIA (metrics.daily_scores, sleep_score, wake-day de hoje) via
 * DayDataContext, e a série do SRI (metric_type='sri'). Só LÊ; cálculo em
 * src/lib/metrics.ts, materializado pela Edge Function / runner.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDayData, type DayScore, type DayCheckin } from '@/contexts/DayDataContext';

// 0–100 → cor (mesmos limiares do wellbeing).
function scoreColor(v: number): string {
  return v >= 67 ? '#22C55E' : v >= 34 ? '#F59E0B' : '#EF4444';
}
// 0–10 subjetivo → cor (maior = melhor).
function subColor(v: number): string {
  return v >= 7 ? '#22C55E' : v >= 4 ? '#F59E0B' : '#EF4444';
}
function arrow(points: number): string {
  return points >= 67 ? '▲' : points >= 34 ? '▬' : '▼';
}
// Tendência do SRI: sobe = verde, desce = vermelho, estável = neutro.
function trendColor(d: number): string {
  return d > 0.5 ? '#22C55E' : d < -0.5 ? '#EF4444' : 'var(--muted)';
}

// ── SRI (série) ───────────────────────────────────────────────────────────────
type SriDriver = { factor: string; impact: number; detail: string };
type SriCtx = { status: string; dias_validos: number; fracao_valida: number; pares_validos: number; pares_maximos: number; window_days: number };
type SriRow = { date: string; score: number | null; confidence: number | null; drivers: SriDriver[] | null; context: SriCtx | null };
type SriPub = SriRow & { score: number };

// Anel de progresso 3/4 de volta, igual ao gauge de wellbeing.
function ArcRing({ value, color, size = 128 }: { value: number; color: string; size?: number }) {
  const stroke = Math.max(5, Math.round(size / 16));
  const r = size / 2 - stroke - 4;
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const arcLen = 0.75 * C;
  const filled = Math.min(Math.max(value, 0) / 100, 1) * arcLen;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-active)"
        strokeWidth={stroke} strokeDasharray={`${arcLen.toFixed(1)} ${(C - arcLen).toFixed(1)}`}
        strokeLinecap="round" transform={`rotate(135, ${cx}, ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeDasharray={`${filled.toFixed(1)} ${(C - filled).toFixed(1)}`}
        strokeLinecap="round" transform={`rotate(135, ${cx}, ${cy})`} />
    </svg>
  );
}

function Sparkline({ data, w = 640, h = 70, color = '#22C55E' }: { data: number[]; w?: number; h?: number; color?: string }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - mn) / rng) * (h - 8)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: h }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function SleepScoreCard() {
  const { loading, score: row, checkin } = useDayData();
  const [sriRows, setSriRows] = useState<SriRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .schema('metrics').from('daily_scores')
        .select('date, score, confidence, drivers, context')
        .eq('metric_type', 'sri')
        .order('date', { ascending: true })
        .limit(60);
      setSriRows(error ? [] : ((data as SriRow[]) ?? []));
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const score = row && row.score != null ? Math.round(Number(row.score)) : null;
  const conf = row && row.confidence != null ? Math.round(Number(row.confidence) * 100) : null;
  const color = score != null ? scoreColor(score) : 'var(--muted)';
  const clickable = score != null;

  const sriPub: SriPub[] = (sriRows ?? []).filter((r): r is SriPub => r.score != null);
  const sriLatest = sriPub.length ? sriPub[sriPub.length - 1] : null;
  const refIdx = Math.max(0, sriPub.length - 8);
  const sriDelta = sriLatest && sriPub.length >= 2 ? sriLatest.score - sriPub[refIdx].score : null;

  return (
    <>
      <button
        onClick={() => clickable && setOpen(true)}
        disabled={!clickable}
        title={clickable ? 'Ver decomposição do score e SRI' : (loading ? undefined : 'Sem score de hoje ainda — o sono desta noite ainda não foi calculado')}
        className="card"
        style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '12px 16px 10px', width: 'fit-content', textAlign: 'center',
          cursor: clickable ? 'pointer' : 'default', background: 'var(--surface)',
        }}
      >
        <span style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
          Sleep Score
        </span>
        <div style={{ position: 'relative', width: 128, height: 128 }}>
          <ArcRing value={score ?? 0} color={color} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, color }}>
              {loading ? '·' : score != null ? score : '—'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>/ 100</span>
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          confidence — <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{conf != null ? `${conf}%` : '—'}</strong>
        </span>
        {/* SRI mínimo: valor + tendência (verde). Detalhe no modal. */}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          SRI{' '}
          {sriLatest != null ? (
            <>
              <strong style={{ color: '#22C55E', fontVariantNumeric: 'tabular-nums' }}>{sriLatest.score.toFixed(1)}</strong>
              {sriDelta != null && (
                <strong style={{ color: trendColor(sriDelta), marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {sriDelta > 0 ? '▲' : sriDelta < 0 ? '▼' : '▬'}{Math.abs(sriDelta).toFixed(1)}
                </strong>
              )}
            </>
          ) : '—'}
        </span>
      </button>

      {open && row && score != null && (
        <ScoreDetail
          row={row} score={score} conf={conf} color={color} checkin={checkin}
          sriPub={sriPub} sriLatest={sriLatest}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Modal de detalhe ────────────────────────────────────────────────────────
function ScoreDetail({
  row, score, conf, color, checkin, sriPub, sriLatest, onClose,
}: {
  row: DayScore; score: number; conf: number | null; color: string; checkin: DayCheckin | null;
  sriPub: SriPub[]; sriLatest: SriPub | null; onClose: () => void;
}) {
  const d = row.drivers;
  const ctx = row.context;

  const comps = d ? [
    { key: 'Fragmentação', raw: d.fragmentation.ratio != null ? `${(d.fragmentation.ratio * 100).toFixed(1)}%` : '—', sub: 'sono / período', points: d.fragmentation.points, weight: 23 },
    { key: 'Profundo (SWS)', raw: d.deep.frac != null ? `${(d.deep.frac * 100).toFixed(1)}%` : '—', sub: '% do TST', points: d.deep.points, weight: 44 },
    { key: 'REM', raw: d.rem.frac != null ? `${(d.rem.frac * 100).toFixed(1)}%` : '—', sub: '% do TST', points: d.rem.points, weight: 18 },
    { key: 'Latência', raw: d.latency.mins != null ? `${d.latency.mins} min` : '—', sub: 'até adormecer', points: d.latency.points, weight: 15 },
  ] : [];

  const subItems = [
    { label: 'Qualidade do sono', v: checkin?.sleep_perceived ?? null },
    { label: 'Recuperação', v: checkin?.recovery_feeling ?? null },
    { label: 'Energia', v: checkin?.mood_energy ?? null },
  ];

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)',
    backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  };
  const th: React.CSSProperties = { fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, textAlign: 'left', paddingBottom: 6 };
  const numCell: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const sctx = sriLatest?.context;

  return (
    <div role="dialog" aria-modal="true" style={overlay} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 720, maxHeight: '92dvh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
            <ArcRing value={score} color={color} size={88} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700, color }}>{score}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Sleep Score</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text)' }}>
              Noite de <strong>{row.date}</strong> · confidence <strong style={{ color: 'var(--text)' }}>{conf != null ? `${conf}%` : '—'}</strong>
              {row.config_version ? <span style={{ color: 'var(--muted)' }}> · {row.config_version}</span> : null}
            </p>
            {d && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                arquitetura <strong style={{ color: 'var(--text)' }}>{d.architecture ?? '—'}</strong> × duração <strong style={{ color: 'var(--text)' }}>{d.duration_factor.toFixed(2)}</strong> = <strong style={{ color }}>{score}</strong>
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, alignSelf: 'flex-start' }}>×</button>
        </div>

        {/* Dois painéis: objetivo | subjetivo */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16 }} className="ss-detail-grid">
          {/* Objetivo — componentes */}
          <div>
            <p className="section-label" style={{ marginTop: 0 }}>Componentes do score</p>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Componente</th>
                  <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Pontos</th>
                  <th style={{ ...th, textAlign: 'right' }}>Peso</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c) => {
                  const pts = c.points;
                  const col = pts != null ? scoreColor(pts) : 'var(--muted)';
                  return (
                    <tr key={c.key}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{c.key}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.sub}</div>
                      </td>
                      <td style={{ ...numCell, color: 'var(--text)' }}>{c.raw}</td>
                      <td style={{ ...numCell, fontWeight: 700, color: col, whiteSpace: 'nowrap' }}>
                        {pts != null ? <>{arrow(pts)} {Math.round(pts)}</> : '—'}
                      </td>
                      <td style={{ ...numCell, color: 'var(--muted)' }}>{c.weight}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {d && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                TST <strong style={{ color: 'var(--text)' }}>{d.tst_hours.toFixed(2)}h</strong>
                {ctx ? <> · período {(ctx.sleep_period_minutes / 60).toFixed(2)}h</> : null}
                {ctx && ctx.merged_blocks > 1 ? <> · {ctx.merged_blocks} blocos (WASO {ctx.inter_block_waso_mins}m)</> : null}
              </p>
            )}
            {ctx && ctx.flags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {ctx.flags.map((f) => (
                  <span key={f} className="badge" style={{ fontSize: 10 }}>{f}</span>
                ))}
              </div>
            )}
            <p style={{ margin: '10px 0 0', fontSize: 10, color: 'var(--muted)' }}>
              <span style={{ color: '#22C55E' }}>▲</span> puxa para cima · <span style={{ color: '#F59E0B' }}>▬</span> neutro · <span style={{ color: '#EF4444' }}>▼</span> puxa para baixo
            </p>
          </div>

          {/* Subjetivo — check-in */}
          <div>
            <p className="section-label" style={{ marginTop: 0 }}>O que sentiste</p>
            {checkin ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {subItems.map((s) => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.label}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: s.v != null ? subColor(s.v) : 'var(--muted)' }}>
                      {s.v != null ? `${s.v}` : '—'}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>/10</span>
                    </span>
                  </div>
                ))}
                {checkin.notes ? (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>Notas</div>
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{checkin.notes}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Sem check-in nesta manhã.</p>
            )}
          </div>
        </div>

        {/* Sleep Regularity (SRI) — série + detalhe */}
        {sriLatest && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <p className="section-label" style={{ margin: 0 }}>Sleep Regularity · SRI</p>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>−100 … 100 (valor cru)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, margin: '6px 0 10px' }}>
              <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: '#22C55E', fontVariantNumeric: 'tabular-nums' }}>{sriLatest.score.toFixed(1)}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>atual ({sriLatest.date})</span>
            </div>
            <Sparkline data={sriPub.map((r) => r.score)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
              <span>{sriPub[0].date} · min {Math.min(...sriPub.map((r) => r.score)).toFixed(1)}</span>
              <span>max {Math.max(...sriPub.map((r) => r.score)).toFixed(1)} · {sriPub[sriPub.length - 1].date}</span>
            </div>

            {sctx && (
              <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                dias válidos <strong style={{ color: 'var(--text)' }}>{sctx.dias_validos}/{sctx.window_days}</strong> ·
                pares <strong style={{ color: 'var(--text)' }}>{sctx.pares_validos}/{sctx.pares_maximos}</strong> ·
                confidence <strong style={{ color: 'var(--text)' }}>{sriLatest.confidence != null ? Math.round(sriLatest.confidence * 100) : '—'}%</strong>
              </p>
            )}
            {sriLatest.drivers && sriLatest.drivers.length > 0 && (
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                {sriLatest.drivers.map((dr) => (
                  <div key={dr.factor} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{dr.factor}</span>
                    <span style={{ color: 'var(--muted)' }}>{dr.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 620px) {
          .ss-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
