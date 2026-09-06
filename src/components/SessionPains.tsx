'use client';

/**
 * Dores registadas numa sessão de treino — revisão POSTERIOR (o boneco grava
 * pain_reports com o session_id do treino; aqui lê-se de volta por sessão).
 *
 * Só apresentação: recebe as dores já lidas e o mapa de rótulos. A cor segue a
 * intensidade (verde→amarelo→vermelho), igual ao boneco. `compact` corta a nota
 * (para o cartão do histórico); o detalhe mostra-a.
 */

import { type PainReport, type RegionLabelInfo, type Side, painLabel } from '@/lib/pain';

const SIDE_LABEL: Record<Side, string> = { esquerda: 'Esq.', direita: 'Dir.', central: '' };

function intensityColor(v: number): string {
  return v >= 7 ? '#EF4444' : v >= 4 ? '#F59E0B' : '#22C55E';
}

export default function SessionPains({
  pains, regions, compact, divided,
}: {
  pains: PainReport[];
  regions: Map<string, RegionLabelInfo>;
  compact?: boolean;
  /** separador por cima (para o cartão do histórico, que já tem conteúdo antes). */
  divided?: boolean;
}) {
  if (!pains.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6, ...(divided ? { borderTop: '1px solid var(--border)', paddingTop: 10 } : null) }}>
      <span className="section-label" style={{ margin: 0 }}>Dores registadas</span>
      <div style={{ display: 'grid', gap: compact ? 4 : 8 }}>
        {pains.map((p) => {
          const side = SIDE_LABEL[p.side];
          const c = intensityColor(p.intensity);
          return (
            <div key={p.id} style={{ display: 'grid', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c, flex: '0 0 auto' }} />
                <span style={{ color: 'var(--text)' }}>
                  {painLabel(regions, p.region_id)}{side ? ` · ${side}` : ''}
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>
                  {p.intensity}
                </span>
              </div>
              {!compact && p.description && (
                <span style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 16 }}>{p.description}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
