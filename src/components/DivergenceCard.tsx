'use client';

/**
 * Divergência objetivo↔subjetivo (hoje: sono). Cartão para o dashboard, AO LADO
 * do Sleep Score. Mostra o MÓDULO (|divergência|) — o valor com sinal não diz
 * nada a quem olha de passagem. Ao carregar, abre o detalhe: o sinal em palavras,
 * os DOIS z-scores lado a lado (é isto que interessa, não a divergência isolada),
 * as médias/SD que entraram, e o plot da série (com sinal).
 *
 * Fonte: metrics.daily_scores, metric_type='divergence_sleep'. O cálculo vive em
 * src/lib/metrics.ts (getDivergence); aqui é só leitura + apresentação.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { localTodayYMD } from '@/components/CheckinForm';

type DivContext = {
  status: string;
  z_sub: number | null; z_obj: number | null;
  mu_sub: number | null; sd_sub: number | null;
  mu_obj: number | null; sd_obj: number | null;
  d_bruto: number | null; sd_diff: number | null;
  n_dias_baseline: number; n_dias_diferenca: number;
  janela_dias: number; limiar: number;
};
type DivRow = { date: string; score: number | null; confidence: number | null; context: DivContext | null };

// Cor pela magnitude vs limiar: acima do limiar destaca (âmbar/vermelho conforme
// o dobro); abaixo, neutro. Coerente com a paleta do resto.
function magColor(abs: number, limiar: number): string {
  if (abs >= limiar * 2) return '#EF4444';
  if (abs >= limiar) return '#F59E0B';
  return 'var(--text-secondary)';
}

export default function DivergenceCard() {
  const [rows, setRows] = useState<DivRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .schema('metrics').from('daily_scores')
        .select('date, score, confidence, context')
        .eq('metric_type', 'divergence_sleep')
        .order('date', { ascending: true })
        .limit(90);
      setRows(error ? [] : ((data as DivRow[]) ?? []));
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const today = localTodayYMD();
  const pub = (rows ?? []).filter((r): r is DivRow & { score: number } => r.score != null);
  const todayRow = (rows ?? []).find((r) => r.date === today) ?? null;
  // Mostra hoje se tiver valor; senão, o último dia com valor (não deixa o cartão vazio).
  const shown: DivRow | null = todayRow && todayRow.score != null ? todayRow : (pub.length ? pub[pub.length - 1] : todayRow);
  const score = shown && shown.score != null ? Number(shown.score) : null;
  const limiar = shown?.context?.limiar ?? 1.5;
  const abs = score != null ? Math.abs(score) : null;
  const color = abs != null ? magColor(abs, limiar) : 'var(--muted)';
  const clickable = score != null;
  const loading = rows === null;

  const signWord = score == null ? '' : score > 0 ? 'melhor' : score < 0 ? 'pior' : 'alinhado';
  const arrow = score == null ? '' : score > 0 ? '▲' : score < 0 ? '▼' : '▬';

  return (
    <>
      <button
        onClick={() => clickable && setOpen(true)}
        disabled={!clickable}
        title={clickable ? 'Ver z-scores, médias e a série de divergência' : (loading ? undefined : 'Sem divergência calculada (falta check-in ou baseline)')}
        className="card"
        style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '12px 16px 10px', width: 'fit-content', textAlign: 'center',
          cursor: clickable ? 'pointer' : 'default', background: 'var(--surface)',
        }}
      >
        <span style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
          Divergência
        </span>
        <div style={{ width: 128, height: 128, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color }}>
            {loading ? '·' : abs != null ? abs.toFixed(2) : '—'}
          </span>
          {score != null && (
            <span style={{ fontSize: 12, color, marginTop: 6 }}>
              {arrow} sente-se <strong>{signWord}</strong>
            </span>
          )}
          {score != null && (
            <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>limiar {limiar.toFixed(1)}</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {score == null ? 'sono' : shown!.date === today ? 'hoje · sono' : `${shown!.date} · sono`}
        </span>
      </button>

      {open && shown && score != null && (
        <DivergenceDetail row={shown} score={score} series={pub} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center',
  padding: 16, zIndex: 50,
};

function DivergenceDetail({
  row, score, series, onClose,
}: {
  row: DivRow; score: number; series: Array<DivRow & { score: number }>; onClose: () => void;
}) {
  const ctx = row.context;
  const abs = Math.abs(score);
  const limiar = ctx?.limiar ?? 1.5;
  const color = magColor(abs, limiar);
  const dispara = abs >= limiar;

  const signSentence = score > 0
    ? 'Sentes-te MELHOR do que os dados objetivos indicam.'
    : score < 0
      ? 'Sentes-te PIOR do que os dados objetivos indicam.'
      : 'A perceção está alinhada com os dados.';

  const zSub = ctx?.z_sub ?? null;
  const zObj = ctx?.z_obj ?? null;

  return (
    <div role="dialog" aria-modal="true" style={overlay} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 640, maxHeight: '92dvh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
          <div style={{ flexShrink: 0, textAlign: 'center' }}>
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color }}>{abs.toFixed(2)}</span>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>|divergência|</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Divergência · sono</p>
            <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--text)' }}>{signSentence}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: dispara ? color : 'var(--muted)' }}>
              {dispara ? `Acima do limiar (${limiar.toFixed(1)})` : `Abaixo do limiar (${limiar.toFixed(1)})`}
              {' · '}{row.date}
              {row.confidence != null ? ` · confidence ${Math.round(row.confidence * 100)}%` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Os DOIS z-scores lado a lado */}
        <p className="section-label" style={{ marginTop: 0 }}>Z-scores (desvio face ao baseline de {ctx?.janela_dias ?? 14} dias)</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <ZPanel label="Subjetivo (qualidade percebida)" z={zSub} mu={ctx?.mu_sub ?? null} sd={ctx?.sd_sub ?? null} scale="0-10" />
          <ZPanel label="Objetivo (sleep score)" z={zObj} mu={ctx?.mu_obj ?? null} sd={ctx?.sd_obj ?? null} scale="0-100" />
        </div>

        {/* Como se chegou ao número */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <Chip label="d bruto (z_sub − z_obj)" value={ctx?.d_bruto != null ? ctx.d_bruto.toFixed(2) : '—'} />
          <Chip label="sd_diff" value={ctx?.sd_diff != null ? ctx.sd_diff.toFixed(2) : '—'} />
          <Chip label="dias baseline" value={ctx ? String(ctx.n_dias_baseline) : '—'} />
          <Chip label="dias p/ sd_diff" value={ctx ? String(ctx.n_dias_diferenca) : '—'} />
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 11.5, color: 'var(--muted)' }}>
          divergência = d bruto ÷ max(sd_diff, piso) = <strong style={{ color: 'var(--text)' }}>{score.toFixed(2)}</strong>.
          O <em>d bruto</em> é guardado sem normalizar: uma divergência crónica normaliza-se e cala-se — é ele que permite ver a tendência de fundo.
        </p>

        {/* Série */}
        <p className="section-label" style={{ marginTop: 0 }}>Série (com sinal)</p>
        <DivergencePlot series={series} limiar={limiar} currentDate={row.date} />
      </div>
    </div>
  );
}

function ZPanel({ label, z, mu, sd, scale }: { label: string; z: number | null; mu: number | null; sd: number | null; scale: string }) {
  const col = z == null ? 'var(--muted)' : z > 0 ? '#22C55E' : z < 0 ? '#EF4444' : 'var(--text)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: col, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {z == null ? '—' : (z > 0 ? '+' : '') + z.toFixed(2)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
        μ {mu != null ? mu.toFixed(1) : '—'} · sd {sd != null ? sd.toFixed(2) : '—'} <span style={{ opacity: 0.7 }}>({scale})</span>
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', padding: '4px 10px', borderRadius: 999, background: 'var(--surface-active)', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

// Plot simples da série com sinal: linha zero, ±limiar tracejado, pontos coloridos
// por sinal (verde = melhor que os dados, vermelho = pior), o dia atual realçado.
function DivergencePlot({ series, limiar, currentDate }: { series: Array<DivRow & { score: number }>; limiar: number; currentDate: string }) {
  if (series.length < 2) return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Série curta — poucos dias com valor.</p>;
  const W = 600, H = 180, padL = 30, padR = 10, padT = 12, padB = 20;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = series.map((s) => s.score);
  const maxAbs = Math.max(limiar * 1.2, ...vals.map((v) => Math.abs(v)));
  const yLo = -maxAbs, yHi = maxAbs;
  const x = (i: number) => padL + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => padT + (1 - (v - yLo) / (yHi - yLo)) * innerH;

  const line = series.map((s, i) => `${x(i).toFixed(1)},${y(s.score).toFixed(1)}`).join(' ');

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* limiar ± e zero */}
        {[limiar, -limiar].map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--warning)" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
            <text x={padL - 4} y={y(t) + 3} fontSize={9} fill="var(--muted)" textAnchor="end">{t > 0 ? '+' : ''}{t.toFixed(1)}</text>
          </g>
        ))}
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        <text x={padL - 4} y={y(0) + 3} fontSize={9} fill="var(--muted)" textAnchor="end">0</text>

        <polyline points={line} fill="none" stroke="var(--text)" strokeWidth={1.4} opacity={0.55} strokeLinejoin="round" />
        {series.map((s, i) => {
          const cur = s.date === currentDate;
          const col = s.score > 0 ? '#22C55E' : s.score < 0 ? '#EF4444' : 'var(--muted)';
          return <circle key={s.date} cx={x(i)} cy={y(s.score)} r={cur ? 4 : 2.4} fill={col} stroke={cur ? 'var(--text)' : 'none'} strokeWidth={cur ? 1.5 : 0} />;
        })}

        {/* eixo x: primeiro e último dia */}
        <text x={padL} y={H - 6} fontSize={9} fill="var(--muted)" textAnchor="start">{series[0].date.slice(5)}</text>
        <text x={W - padR} y={H - 6} fontSize={9} fill="var(--muted)" textAnchor="end">{series[series.length - 1].date.slice(5)}</text>
      </svg>
    </div>
  );
}
