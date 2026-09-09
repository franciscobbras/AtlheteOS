'use client';

/**
 * Mini-cartão de peso para o dashboard: velocidade + sparkline da trend, compacto.
 * Clicar leva à tab /weight (detalhe). Sem juízo de valor — só o número.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadWeightTrend } from '@/lib/weight';
import { type WeightTrendResult } from '@/lib/metrics';

export default function WeightMiniCard() {
  const [res, setRes] = useState<WeightTrendResult | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    loadWeightTrend().then((r) => { setRes(r); setErr(false); }).catch(() => setErr(true));
  }, []);

  const vel = res?.velocity_kg_per_week ?? null;

  return (
    <Link
      href="/weight"
      className="card"
      style={{
        display: 'inline-flex', flexDirection: 'column', gap: 6,
        padding: '12px 16px', width: 'fit-content', minWidth: 200, textDecoration: 'none',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Peso</span>
        {res?.latest && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>{res.latest.kg.toFixed(1)}</strong>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}> kg</span>
          </span>
        )}
      </div>

      {err ? (
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Sem acesso à série.</span>
      ) : !res ? (
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>A carregar…</span>
      ) : res.status === 'forming' || vel == null ? (
        <div>
          <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>A formar-se</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{res.n_measurements}/14</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {vel > 0 ? '+' : ''}{vel.toFixed(2)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>kg/sem</span>
        </div>
      )}

      {res && res.trend.length >= 2 && <Sparkline res={res} />}
    </Link>
  );
}

function Sparkline({ res }: { res: WeightTrendResult }) {
  const W = 200, H = 34;
  const pts = res.trend;
  const t0 = Date.parse(`${pts[0].date}T00:00:00Z`);
  const t1 = Date.parse(`${pts[pts.length - 1].date}T00:00:00Z`);
  const span = Math.max(1, t1 - t0);
  const emas = pts.map((p) => p.ema);
  const lo = Math.min(...emas), hi = Math.max(...emas);
  const yr = Math.max(0.1, hi - lo);
  const x = (d: string) => ((Date.parse(`${d}T00:00:00Z`) - t0) / span) * (W - 2) + 1;
  const y = (v: number) => (H - 4) - ((v - lo) / yr) * (H - 8) + 2;
  const line = pts.map((p) => `${x(p.date).toFixed(1)},${y(p.ema).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }} preserveAspectRatio="none">
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
