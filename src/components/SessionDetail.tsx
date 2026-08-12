'use client';

/**
 * Detalhe de uma sessão de treino: a série de HR reconstruída, com os BLOCOS
 * sobrepostos (faixas verticais por aparelho) e as pausas visíveis como
 * intervalos sem cobertura de bloco. A leitura útil é o padrão de esforço por
 * aparelho e a recuperação entre blocos — não a linha sozinha.
 *
 * O HR chega já agregado do SQL (wearable.hr_series_bucketed) — o cliente recebe
 * centenas de pontos, não os milhares de cru. Não se suaviza artificialmente: o
 * HR ótico da Air degrada em ginástica (contração de antebraço) e mostra-se o que
 * foi medido, buracos incluídos. Logo a seguir ao treino os pontos ainda não
 * foram ingeridos (Air é forward-only, de 3 em 3h) — nesse caso, estado explícito
 * de "dados a chegar", não um gráfico vazio.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSession, listApparatus, listBlocks, type SessionRow, type BlockRow, type Apparatus } from '@/lib/training';
import { getSessionHrSeries, type HrSeries } from '@/lib/hr';

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

type BlockView = { id: string; name: string; color: string; spans: Array<[number, number]> };

export default function SessionDetail({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [blocks, setBlocks] = useState<BlockView[]>([]);
  const [hr, setHr] = useState<HrSeries | null>(null);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      try {
        const [s, apps, bs] = await Promise.all([getSession(sessionId), listApparatus(), listBlocks(sessionId)]);
        if (!s) { setError('Sessão não encontrada.'); setLoading(false); return; }
        setSession(s);

        const fromMs = Date.parse(s.start_utc);
        const endMs = s.end_utc ? Date.parse(s.end_utc) : nowMs;

        // Cores por aparelho (primeira aparição). Spans = segmentos; um segmento
        // aberto é limitado pelo fim da sessão (ou agora).
        const colorByApp = new Map<string, string>();
        const nameByApp = new Map(apps.map((a: Apparatus) => [a.id, a.name]));
        const views: BlockView[] = (bs as BlockRow[]).map((b) => {
          if (!colorByApp.has(b.apparatus_id)) colorByApp.set(b.apparatus_id, PALETTE[colorByApp.size % PALETTE.length]);
          const spans = b.block_segments
            .map((seg) => [Date.parse(seg.start_utc), seg.end_utc ? Date.parse(seg.end_utc) : endMs] as [number, number])
            .filter(([a, z]) => z > a);
          return { id: b.id, name: nameByApp.get(b.apparatus_id) ?? '—', color: colorByApp.get(b.apparatus_id) as string, spans };
        });
        setBlocks(views);

        const series = await getSessionHrSeries(fromMs, endMs, {
          bucketSeconds: 30, sessionEndMs: endMs, nowMs,
        });
        setHr(series);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar a sessão.');
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, nowMs]);

  const fromMs = session ? Date.parse(session.start_utc) : 0;
  const toMs = session ? (session.end_utc ? Date.parse(session.end_utc) : nowMs) : 0;
  const offset = session?.utc_offset_seconds ?? 0;

  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/training" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>← Training</Link>
        <h1 className="page-title" style={{ margin: 0 }}>
          {session ? `${new Date(fromMs + offset * 1000).toISOString().slice(0, 10)} · ${fmtClock(fromMs, offset)}` : 'Sessão'}
        </h1>
      </div>

      {loading && <div className="card" style={{ color: 'var(--muted)', fontSize: 14 }}>A carregar…</div>}
      {error && <div className="card" style={{ borderColor: 'rgba(239,68,68,0.35)', color: 'var(--error)', fontSize: 13 }}>{error}</div>}

      {session && hr && (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="section-label" style={{ margin: 0 }}>Frequência cardíaca</span>
            <SourceTag hr={hr} />
          </div>

          <HrChart
            fromMs={fromMs}
            toMs={toMs}
            offset={offset}
            hr={hr}
            blocks={blocks}
          />

          {/* Legenda dos aparelhos */}
          {blocks.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              {dedupeLegend(blocks).map((b) => (
                <span key={b.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color }} />
                  {b.name}
                </span>
              ))}
            </div>
          )}

          {hr.status === 'ok' && (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
              {hr.points.length} pontos ({hr.bucket_seconds}s/bucket, de {hr.n_raw} amostras) · agregado no SQL
            </p>
          )}
        </div>
      )}
    </div>
  );
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

function dedupeLegend(blocks: BlockView[]): { name: string; color: string }[] {
  const seen = new Map<string, string>();
  for (const b of blocks) if (!seen.has(b.name)) seen.set(b.name, b.color);
  return [...seen.entries()].map(([name, color]) => ({ name, color }));
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
  fromMs, toMs, offset, hr, blocks,
}: {
  fromMs: number; toMs: number; offset: number; hr: HrSeries; blocks: BlockView[];
}) {
  const [ref, W] = useWidth();
  const H = 280;

  // Estados sem gráfico: mensagem explícita, nunca linha vazia/partida.
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
      {W > 0 && <HrChartSvg W={W} H={H} fromMs={fromMs} toMs={toMs} offset={offset} hr={hr} blocks={blocks} />}
    </div>
  );
}

function HrChartSvg({
  W, H, fromMs, toMs, offset, hr, blocks,
}: {
  W: number; H: number; fromMs: number; toMs: number; offset: number; hr: HrSeries; blocks: BlockView[];
}) {
  const padL = 34, padR = 12, padT = 24, padB = 22;
  const innerW = Math.max(1, W - padL - padR);
  const innerH = Math.max(1, H - padT - padB);
  const span = Math.max(1, toMs - fromMs);

  const x = (t: number) => padL + ((t - fromMs) / span) * innerW;

  const bpms = hr.points.map((p) => p.bpm);
  const lo = Math.min(...bpms), hi = Math.max(...bpms);
  const yLo = Math.floor(lo - 5), yHi = Math.ceil(hi + 5);
  const yRange = Math.max(1, yHi - yLo);
  const y = (bpm: number) => padT + (1 - (bpm - yLo) / yRange) * innerH;

  // Quebra a linha em buracos: buckets afastados > 2× a resolução = dados em
  // falta, não se interpola por cima.
  const gapMs = hr.bucket_seconds * 1000 * 2.5;
  const segments: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < hr.points.length; i++) {
    const p = hr.points[i];
    if (i > 0 && p.t_ms - hr.points[i - 1].t_ms > gapMs) {
      if (cur.length) segments.push(cur.join(' '));
      cur = [];
    }
    cur.push(`${x(p.t_ms).toFixed(1)},${y(p.bpm).toFixed(1)}`);
  }
  if (cur.length) segments.push(cur.join(' '));

  // Marcas de tempo: início, meio, fim.
  const ticks = [fromMs, (fromMs + toMs) / 2, toMs];

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {/* Faixas de bloco (por segmento) — atrás da linha. Pausas = sem faixa. */}
      {blocks.flatMap((b) =>
        b.spans.map(([a, z], si) => {
          const xa = x(a), xz = x(z);
          const w = Math.max(1, xz - xa);
          return (
            <g key={`${b.id}-${si}`}>
              <rect x={xa} y={padT} width={w} height={innerH} fill={b.color} opacity={0.15} />
              {si === 0 && w > 26 && (
                <text x={xa + 3} y={padT + 11} fontSize={10} fill={b.color} style={{ fontWeight: 600 }}>
                  {b.name}
                </text>
              )}
              {/* marca fina no arranque do segmento */}
              <line x1={xa} y1={padT} x2={xa} y2={padT + innerH} stroke={b.color} strokeWidth={1} opacity={0.4} />
            </g>
          );
        }),
      )}

      {/* Eixo Y: min/max bpm */}
      {[yLo, yHi].map((v) => (
        <g key={v}>
          <text x={padL - 6} y={y(v) + 3} fontSize={10} fill="var(--muted)" textAnchor="end">{v}</text>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
        </g>
      ))}

      {/* Linha de HR — sem suavização, quebrada nos buracos */}
      {segments.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke="var(--text)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      ))}

      {/* Eixo X: início/meio/fim */}
      {ticks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>
          {fmtClock(t, offset)}
        </text>
      ))}
    </svg>
  );
}
