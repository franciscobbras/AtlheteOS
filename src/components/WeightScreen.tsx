'use client';

/**
 * Tab Weight — o gráfico da trend em grande + histórico das pesagens (cru vs
 * trend). O input do peso continua no pop-up do check-in matinal; aqui é revisão.
 */

import { useEffect, useState } from 'react';
import WeightTrendCard from './WeightTrendCard';
import { loadWeightTrend } from '@/lib/weight';
import { type WeightTrendResult } from '@/lib/metrics';

export default function WeightScreen() {
  const [res, setRes] = useState<WeightTrendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadWeightTrend().then((r) => { setRes(r); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : 'erro'));
  }, []);

  // Histórico do mais recente para o mais antigo, com Δ face à trend.
  const hist = res ? [...res.trend].reverse() : [];

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Weight</h1>
        <p className="page-subtitle">Trend e velocidade em kg/semana. O peso diário oscila; a linha é o que interessa.</p>
      </div>

      <WeightTrendCard />

      <div className="card">
        <p className="section-label" style={{ marginTop: 0 }}>Histórico</p>
        {err && <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>Sem acesso à série ({err}).</p>}
        {!err && res && hist.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem pesagens ainda.</p>}
        {hist.length > 0 && (
          <div className="table-wrap">
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Data</th>
                  <th style={{ ...th, textAlign: 'right' }}>Peso</th>
                  <th style={{ ...th, textAlign: 'right' }}>Trend</th>
                  <th style={{ ...th, textAlign: 'right' }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((p) => {
                  const delta = p.kg - p.ema;
                  return (
                    <tr key={p.date}>
                      <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.date}</td>
                      <td style={num}>{p.kg.toFixed(1)}</td>
                      <td style={{ ...num, color: 'var(--muted)' }}>{p.ema.toFixed(1)}</td>
                      <td style={{ ...num, color: Math.abs(delta) < 0.05 ? 'var(--muted)' : delta > 0 ? '#F59E0B' : '#22C55E' }}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, textAlign: 'left', paddingBottom: 6 };
const num: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' };
