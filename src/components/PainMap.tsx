'use client';

/**
 * Boneco de dor — INLINE (sem botão "Registar dor"): aparece diretamente no
 * check-in e no fim de treino. Se não se tocar em nada, não se grava nada.
 *
 * Quatro vistas (anterior/posterior/lateral esq/lateral dir), corpo em posição
 * anatómica de referência. A silhueta é uma imagem de fundo decorativa; as zonas
 * são os paths de bodyMap.ts desenhados por cima.
 *
 * Segundo passo VISUAL, não uma lista: toco na região → amplia (o viewBox salta
 * para a bounding box da região) → toco na PARTE onde dói. O slug resolve-se pela
 * posição; nunca se lê "proximal medial". O lado vem do sítio onde toco (sufixo
 * _esq/_dir do path); sem sufixo = central. Uma regra só, em qualquer vista.
 *
 * "Dor generalizada" = registar no próprio pai. Multi-seleção dentro da região;
 * acumulam-se zonas de várias regiões antes de guardar. Uma linha por zona;
 * intensidade propaga como default, ajustável por zona; description por zona.
 *
 * As regiões da tabela SEM path simplesmente não aparecem (só se regista o que
 * está desenhado). Paths cujo id (sem sufixo) não exista ativo na tabela são
 * TYPO — sinalizados na consola, não renderizados.
 *
 * Grava as suas próprias linhas (independente do submit do host).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { listBodyRegions, insertPainReports, type BodyRegion, type Side, type PainZone } from '@/lib/pain';
import { parsePathId, validateBodyPaths, BONECO_VIEWS, type BonecoView } from '@/lib/bodySvg';
import { BODY_GEOMETRY, parseViewBox } from '@/lib/bodyMap';

const VIEW_LABEL: Record<BonecoView, string> = {
  anterior: 'Frente', posterior: 'Costas', lateral_esq: 'Lado E', lateral_dir: 'Lado D',
};
const SIDE_LABEL: Record<Side, string> = { esquerda: 'Esq.', direita: 'Dir.', central: 'Centro' };

function intensityColor(v: number): string {
  return v >= 7 ? '#EF4444' : v >= 4 ? '#F59E0B' : '#22C55E';
}

// Uma zona escolhida no zoom, pronta a gravar.
type Draft = { region_id: string; side: Side; intensity: number; description: string };
// Região ampliada (após tocar num pai no boneco).
type Zoom = { region_id: string; side: Side; viewBox: string };

export default function PainMap({
  sessionId, onSaved,
}: {
  sessionId: string | null;
  onSaved?: (n: number) => void;
}) {
  const [regions, setRegions] = useState<BodyRegion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BonecoView>('anterior');
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [defIntensity, setDefIntensity] = useState(5);
  const [leaf, setLeaf] = useState<{ region_id: string; side: Side; label: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTotal, setSavedTotal] = useState(0);

  useEffect(() => {
    listBodyRegions().then(setRegions).catch((e) => setError(e instanceof Error ? e.message : 'Erro a carregar regiões.'));
  }, []);

  const regionById = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);
  const parentNameOf = (region_id: string): string => {
    const r = regionById.get(region_id);
    if (!r) return region_id;
    return r.parent_id ? (regionById.get(r.parent_id)?.name ?? r.parent_id) : r.name;
  };
  // Rótulo de uma zona registável diretamente (folha). Filho → "Pai aspeto"
  // (ex.: "Ombro anterior"); pai isolado → o próprio nome (ex.: "Virilha").
  const labelOf = (region_id: string): string => {
    const r = regionById.get(region_id);
    if (!r) return region_id;
    if (!r.parent_id) return r.name;
    const pn = regionById.get(r.parent_id)?.name ?? r.parent_id;
    return `${pn} ${r.name.toLowerCase()}`;
  };

  // Validação ao arranque: paths cruzados com as regiões ativas.
  const validation = useMemo(() => {
    if (!regions) return null;
    const pathsByView = Object.fromEntries(BONECO_VIEWS.map((v) => [v, BODY_GEOMETRY[v].paths.map((p) => p.id)]));
    return validateBodyPaths(pathsByView, regions.map((r) => r.id));
  }, [regions]);
  useEffect(() => {
    if (!validation) return;
    if (validation.unknownPaths.length) console.warn('[PainMap] paths sem região ativa (typo, não zona nova):', validation.unknownPaths);
    if (validation.suffixCollisions.length) console.warn('[PainMap] region_ids que colidem com _esq/_dir:', validation.suffixCollisions);
  }, [validation]);

  // Paths da vista atual, já parseados e cruzados com a tabela.
  const viewPaths = useMemo(() => {
    return BODY_GEOMETRY[view].paths
      .map((p) => ({ ...p, ...parsePathId(p.id) }))
      .filter((p) => regionById.has(p.region_id)); // ignora typos
  }, [view, regionById]);

  // Cada path pertence a uma UNIDADE = família (região-pai) + lado. Ex.: bíceps
  // proximal_dir e distal_dir são a mesma unidade "biceps|direita". No nível 1 a
  // unidade destaca-se INTEIRA ao passar o rato (não um filho isolado) e o clique
  // faz zoom para escolher a parte. É drill se a unidade tiver ≥2 filhos
  // desenhados nesta vista (peitoral, bíceps, quadríceps, esterno, cabeça); com
  // 0 ou 1 filho é folha e regista-se logo (virilha, ombro_anterior, …).
  const drawnRegionIds = useMemo(() => new Set(viewPaths.map((p) => p.region_id)), [viewPaths]);
  const drawnChildCount = (region_id: string, side: Side) =>
    viewPaths.filter((p) => {
      const r = regionById.get(p.region_id);
      return r?.parent_id === region_id && (p.side === side || p.side === 'central');
    }).length;

  // Nível 1: tudo o que está desenhado, menos filhos cujo pai também tem path
  // (esses ficam para o zoom do pai — ex.: peitoral). Cada path ganha a sua
  // unidade (groupKey), a região-alvo do drill (unitRegion) e o flag drill.
  const l1Paths = viewPaths
    .filter((p) => {
      const parentId = regionById.get(p.region_id)?.parent_id;
      return !(parentId && drawnRegionIds.has(parentId));
    })
    .map((p) => {
      const unitRegion = regionById.get(p.region_id)?.parent_id ?? p.region_id; // pai p/ filhos; self p/ pais
      return { ...p, unitRegion, groupKey: `${unitRegion}|${p.side}`, drill: drawnChildCount(unitRegion, p.side) >= 2 };
    });


  const zoomChildPaths = zoom
    ? viewPaths.filter((p) => {
        const r = regionById.get(p.region_id);
        return r?.parent_id === zoom.region_id && (p.side === zoom.side || p.side === 'central');
      })
    : [];

  // Um único passo: os editores gravam DIRETO (sem lista intermédia nem 2º botão).
  async function saveZones(zones: PainZone[]) {
    if (!zones.length) return;
    setSaving(true); setError(null);
    try {
      const n = await insertPainReports(sessionId, zones);
      setSavedTotal((t) => t + n);
      onSaved?.(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setSaving(false);
    }
  }

  if (error && !regions) return <div style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>;
  if (!regions) return <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>A carregar boneco…</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p className="section-label" style={{ margin: 0 }}>Dor — toca onde dói</p>
        <div style={{ display: 'inline-flex', gap: 4, background: 'var(--surface-hover)', borderRadius: 999, padding: 3 }}>
          {BONECO_VIEWS.map((v) => (
            <button key={v} onClick={() => { setView(v); setZoom(null); }} className="btn btn-sm"
              style={{ borderRadius: 999, padding: '0 10px', background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? '#fff' : 'var(--text-secondary)' }}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Boneco / zoom */}
      {!zoom ? (
        <Boneco
          view={view}
          paths={l1Paths.map((p) => ({ id: p.id, d: p.d, region_id: p.region_id, side: p.side, unitRegion: p.unitRegion, groupKey: p.groupKey, drill: p.drill }))}
          selectedIds={new Set()}
          onTap={(p, bbox) => {
            if (p.drill) setZoom({ region_id: p.unitRegion, side: p.side, viewBox: bbox });
            else setLeaf({ region_id: p.region_id, side: p.side, label: labelOf(p.region_id) });
          }}
          emptyHint={l1Paths.length === 0 ? 'Boneco por desenhar nesta vista.' : null}
        />
      ) : (
        <ZoomRegionEditor key={`${zoom.region_id}|${zoom.side}`}
          view={view} zoom={zoom} childPaths={zoomChildPaths}
          parentName={parentNameOf(zoom.region_id)}
          defIntensity={defIntensity} setDefIntensity={setDefIntensity}
          saving={saving}
          onBack={() => setZoom(null)}
          onCommit={(drafts) => {
            saveZones(drafts.map((d) => ({ region_id: d.region_id, side: d.side, intensity: d.intensity, description: d.description })));
            setZoom(null);
          }}
        />
      )}

      {error && <div style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>}

      {savedTotal > 0 && !leaf && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--success)' }}>Dor registada — {savedTotal} zona{savedTotal > 1 ? 's' : ''}.</p>
      )}

      {/* Registo direto de uma folha (lado já vem da geometria — sem seletor) */}
      {leaf && (
        <LeafEditor
          label={leaf.label} side={leaf.side} defIntensity={defIntensity} saving={saving}
          onCancel={() => setLeaf(null)}
          onSave={(intensity, description) => {
            saveZones([{ region_id: leaf.region_id, side: leaf.side, intensity, description }]);
            setLeaf(null);
          }}
        />
      )}
    </div>
  );
}

/* ── O boneco (fundo + paths) ─────────────────────────────────────────────── */
type L1Path = { id: string; d: string; region_id: string; side: Side; unitRegion: string; groupKey: string; drill: boolean };
function Boneco({
  view, paths, selectedIds, onTap, emptyHint,
}: {
  view: BonecoView;
  paths: L1Path[];
  selectedIds: Set<string>;
  onTap: (p: L1Path, bboxViewBox: string) => void;
  emptyHint: string | null;
}) {
  const geom = BODY_GEOMETRY[view];
  const vb = parseViewBox(geom.viewBox);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Destaca-se a UNIDADE inteira (família+lado), não o path isolado — sem rato
  // em cima, vê-se a imagem normal.
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  // bbox da unidade = união dos bboxes de todos os paths do mesmo grupo, para o
  // zoom enquadrar a família toda (ex.: bíceps proximal + distal), não só o path clicado.
  function tap(p: L1Path, el: SVGPathElement) {
    let b = el.getBBox();
    const group = svgRef.current?.querySelectorAll<SVGPathElement>(`[data-group="${p.groupKey}"]`);
    if (group && group.length > 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      group.forEach((n) => { const g = n.getBBox(); x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.width); y1 = Math.max(y1, g.y + g.height); });
      b = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } as DOMRect;
    }
    onTap(p, bboxToViewBox(b));
  }

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div style={{ position: 'relative', height: 'min(58vh, 420px)', aspectRatio: `${vb.w} / ${vb.h}` }}>
        <svg ref={svgRef} viewBox={geom.viewBox} width="100%" height="100%" style={{ display: 'block' }}>
          {geom.background && <image href={geom.background} x={vb.x} y={vb.y} width={vb.w} height={vb.h} preserveAspectRatio="xMidYMid meet" />}
          {paths.map((p) => {
            const on = hoveredGroup === p.groupKey || selectedIds.has(p.id);
            return (
              <path
                key={p.id} d={p.d} data-group={p.groupKey}
                onClick={(e) => tap(p, e.currentTarget as SVGPathElement)}
                onMouseEnter={() => setHoveredGroup(p.groupKey)}
                onMouseLeave={() => setHoveredGroup((h) => (h === p.groupKey ? null : h))}
                style={{ cursor: 'pointer', pointerEvents: 'all', transition: 'fill-opacity .12s' }}
                fill="var(--accent)"
                fillOpacity={on ? 0.34 : 0}
                stroke="none"
              />
            );
          })}
        </svg>
        {emptyHint && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', maxWidth: 200 }}>{emptyHint}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// bbox de um path → string de viewBox com ~12% de folga (o zoom amplia a região).
function bboxToViewBox(b: { x: number; y: number; width: number; height: number }): string {
  const padX = b.width * 0.12, padY = b.height * 0.12;
  return `${b.x - padX} ${b.y - padY} ${b.width + 2 * padX} ${b.height + 2 * padY}`;
}

/* ── Zoom: região ampliada + seleção visual dos filhos + editores ─────────── */
function ZoomRegionEditor({
  view, zoom, childPaths, parentName, defIntensity, setDefIntensity, saving, onBack, onCommit,
}: {
  view: BonecoView;
  zoom: Zoom;
  childPaths: { id: string; d: string; region_id: string; side: Side }[];
  parentName: string;
  defIntensity: number;
  setDefIntensity: (v: number) => void;
  saving: boolean;
  onBack: () => void;
  onCommit: (drafts: Draft[]) => void;
}) {
  const geom = BODY_GEOMETRY[view];
  const vb = parseViewBox(geom.viewBox);
  const [hovered, setHovered] = useState<string | null>(null);

  // Seleção local por region_id (dentro deste zoom o lado é fixo).
  const [sel, setSel] = useState<Record<string, { side: Side; intensity: number; description: string }>>({});

  function toggle(region_id: string, side: Side) {
    setSel((prev) => {
      const next = { ...prev };
      if (next[region_id]) delete next[region_id];
      else next[region_id] = { side, intensity: defIntensity, description: '' };
      return next;
    });
  }
  function patch(region_id: string, p: Partial<{ intensity: number; description: string }>) {
    setSel((prev) => ({ ...prev, [region_id]: { ...prev[region_id], ...p } }));
  }
  function applyDefault(v: number) {
    setDefIntensity(v);
    setSel((prev) => { const n = { ...prev }; for (const k of Object.keys(n)) n[k] = { ...n[k], intensity: v }; return n; });
  }

  const selectedIds = new Set(Object.keys(sel).flatMap((rid) => childPaths.filter((c) => c.region_id === rid).map((c) => c.id)));
  const generalOn = !!sel[zoom.region_id];

  function commit() {
    const drafts: Draft[] = Object.keys(sel).map((rid) => {
      const d = sel[rid];
      return { region_id: rid, side: d.side, intensity: d.intensity, description: d.description };
    });
    onCommit(drafts);
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Voltar</button>
        <span className="section-label" style={{ margin: 0 }}>{parentName} · {SIDE_LABEL[zoom.side]}</span>
      </div>

      <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', height: 'min(52vh, 380px)', aspectRatio: `${vb.w} / ${vb.h}` }}>
          <svg viewBox={zoom.viewBox} width="100%" height="100%" style={{ display: 'block' }}>
            {geom.background && <image href={geom.background} x={vb.x} y={vb.y} width={vb.w} height={vb.h} preserveAspectRatio="xMidYMid meet" />}
            {childPaths.map((p) => {
              const isSel = selectedIds.has(p.id);
              const on = isSel || hovered === p.id;
              return (
                <path key={p.id} d={p.d} onClick={() => toggle(p.region_id, p.side)}
                  onMouseEnter={() => setHovered(p.id)}
                  onMouseLeave={() => setHovered((h) => (h === p.id ? null : h))}
                  style={{ cursor: 'pointer', pointerEvents: 'all', transition: 'fill-opacity .12s' }}
                  fill="var(--accent)" fillOpacity={isSel ? 0.6 : on ? 0.34 : 0}
                  stroke="none" />
              );
            })}
          </svg>
          {childPaths.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Subdivisões por desenhar.</span>
            </div>
          )}
        </div>
      </div>

      {/* Dor generalizada = o próprio pai */}
      <button className="btn btn-sm" onClick={() => toggle(zoom.region_id, zoom.side)}
        style={{ justifySelf: 'start', background: generalOn ? 'var(--accent)' : 'var(--surface-hover)', color: generalOn ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)', fontStyle: 'italic' }}>
        Dor generalizada
      </button>

      {/* Intensidade padrão — só faz sentido com 2+ zonas (aplica a todas de uma vez).
          Com uma só zona, o slider por-zona em baixo já chega. */}
      {Object.keys(sel).length >= 2 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Intensidade (0–10) — aplica a todas as zonas escolhidas</span>
          <IntensitySlider value={defIntensity} onChange={applyDefault} />
        </div>
      )}

      {/* Editor por zona escolhida (sem nome anatómico; intensidade + nota) */}
      {Object.keys(sel).length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {Object.keys(sel).map((rid) => {
            const d = sel[rid];
            const isParent = rid === zoom.region_id;
            return (
              <div key={rid} style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                  {parentName}{isParent ? ' (geral)' : ''} · {SIDE_LABEL[d.side]}
                </span>
                <IntensitySlider value={d.intensity} onChange={(v) => patch(rid, { intensity: v })} />
                <input className="input" placeholder="Nota (opcional) — o que achas que é" value={d.description}
                  onChange={(e) => patch(rid, { description: e.target.value })} style={{ fontSize: 13 }} />
              </div>
            );
          })}
        </div>
      )}

      <button className="btn btn-primary btn-lg" onClick={commit} disabled={saving || Object.keys(sel).length === 0}>
        {saving ? 'A guardar…' : `Guardar${Object.keys(sel).length ? ` (${Object.keys(sel).length})` : ''}`}
      </button>
    </div>
  );
}

/* ── Editor de folha (zona registada direto do boneco; lado vem do path) ───── */
function LeafEditor({
  label, side, defIntensity, saving, onCancel, onSave,
}: {
  label: string;
  side: Side;
  defIntensity: number;
  saving: boolean;
  onCancel: () => void;
  onSave: (intensity: number, description: string) => void;
}) {
  const [intensity, setIntensity] = useState(defIntensity);
  const [description, setDescription] = useState('');
  return (
    <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
        {label}<span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {SIDE_LABEL[side]}</span>
      </span>
      <IntensitySlider value={intensity} onChange={setIntensity} />
      <input className="input" placeholder="Nota (opcional) — o que achas que é" value={description}
        onChange={(e) => setDescription(e.target.value)} style={{ fontSize: 13 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => onSave(intensity, description)} disabled={saving}>
          {saving ? 'A guardar…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

// Slider 0–10: arrastar é mais rápido que carregar +/− dez vezes. A cor do track
// e do número acompanham a intensidade (verde→amarelo→vermelho).
function IntensitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const c = intensityColor(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        type="range" min={0} max={10} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="intensidade"
        style={{ flex: 1, accentColor: c, height: 28, cursor: 'pointer' }}
      />
      <span style={{ minWidth: 26, textAlign: 'right', fontSize: 20, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
