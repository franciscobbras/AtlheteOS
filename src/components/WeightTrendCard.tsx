'use client';

/**
 * Trend weight + velocidade. A linha de TREND é o que interessa (o peso diário
 * oscila 1-2 kg); os pontos crus aparecem por baixo, discretos, para se ver a
 * dispersão. Velocidade em kg/semana em destaque numérico. SEM juízo de valor,
 * sem zonas coloridas, sem metas — só o número.
 *
 * A trend é derivada (getWeightTrend), calculada na leitura; nunca guardada.
 */

import { useCallback, useEffect, useState } from 'react';
import { loadWeightTrend } from '@/lib/weight';
import { type WeightTrendResult } from '@/lib/metrics';

export default function WeightTrendCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [res, setRes] = useState<WeightTrendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRes(await loadWeightTrend()); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erro a carregar peso.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const vel = res?.velocity_kg_per_week ?? null;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p className="section-label" style={{ margin: 0 }}>Peso — trend</p>
        {res?.latest && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            último {res.latest.kg.toFixed(1)} kg · trend {res.latest.ema.toFixed(1)} kg
          </span>
        )}
      </div>

      {loading && <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>A carregar…</p>}
      {err && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '10px 0 0' }}>
          Sem acesso à série de peso ({err}). {err.includes('PGRST106') ? 'Falta expor o schema body à API.' : ''}
        </p>
      )}

      {!loading && !err && res && (
        <>
          {/* Velocidade — destaque numérico, sem juízo */}
          <div style={{ margin: '12px 0 6px' }}>
            {res.status === 'forming' || vel == null ? (
              <div>
                <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>Velocidade a formar-se</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
                  {res.n_measurements}/{14} medições · a velocidade em kg/semana só aparece com histórico suficiente
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {vel > 0 ? '+' : ''}{vel.toFixed(2)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>kg / semana</span>
              </div>
            )}
          </div>

          {res.trend.length >= 2 ? (
            <WeightChart res={res} />
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>
              {res.trend.length === 0 ? 'Sem pesagens ainda.' : 'Só uma pesagem — a trend precisa de mais pontos.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function WeightChart({ res }: { res: WeightTrendResult }) {
  const W = 640, H = 200, padL = 34, padR = 12, padT = 12, padB = 20;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const pts = res.trend;

  const t0 = Date.parse(`${pts[0].date}T00:00:00Z`);
  const t1 = Date.parse(`${pts[pts.length - 1].date}T00:00:00Z`);
  const span = Math.max(1, t1 - t0);
  const tx = (ymd: string) => padL + ((Date.parse(`${ymd}T00:00:00Z`) - t0) / span) * innerW;

  const kgs = pts.map((p) => p.kg).concat(pts.map((p) => p.ema));
  const lo = Math.min(...kgs), hi = Math.max(...kgs);
  const pad = Math.max(0.3, (hi - lo) * 0.1);
  const yLo = lo - pad, yHi = hi + pad;
  const yr = Math.max(0.1, yHi - yLo);
  const y = (kg: number) => padT + (1 - (kg - yLo) / yr) * innerH;

  const trendLine = pts.map((p) => `${tx(p.date).toFixed(1)},${y(p.ema).toFixed(1)}`).join(' ');

  // 3 marcas no eixo Y (baixo, meio, topo).
  const yTicks = [yLo + yr * 0, yLo + yr * 0.5, yLo + yr * 1].map((v) => +v.toFixed(1));

  return (
    <div style={{ width: '100%', overflowX: 'auto', marginTop: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
            <text x={padL - 5} y={y(v) + 3} fontSize={9} fill="var(--muted)" textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}

        {/* Pontos CRUS — discretos, por baixo */}
        {pts.map((p) => (
          <circle key={`r-${p.date}`} cx={tx(p.date)} cy={y(p.kg)} r={1.8} fill="var(--muted)" opacity={0.5} />
        ))}

        {/* Linha de TREND — em destaque */}
        <polyline points={trendLine} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />

        {/* eixo X: primeiro e último dia */}
        <text x={padL} y={H - 5} fontSize={9} fill="var(--muted)" textAnchor="start">{pts[0].date.slice(5)}</text>
        <text x={W - padR} y={H - 5} fontSize={9} fill="var(--muted)" textAnchor="end">{pts[pts.length - 1].date.slice(5)}</text>
      </svg>
    </div>
  );
}
