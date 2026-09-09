'use client';

/**
 * Dores registadas numa sessão de treino — revisão POSTERIOR (o boneco grava
 * pain_reports com o session_id do treino; aqui lê-se de volta por sessão).
 *
 * `compact` corta a nota (cartão do histórico). `editable` abre, ao clicar numa
 * dor, um editor inline (intensidade / lado / nota / apagar) que escreve direto
 * em subjective.pain_reports (authenticated tem UPDATE; apagar precisa de grant
 * DELETE). A cor segue a intensidade, igual ao boneco.
 */

import { useState } from 'react';
import {
  type PainReport, type RegionLabelInfo, type Side, painLabel,
  updatePainReport, deletePainReport,
} from '@/lib/pain';

const SIDE_LABEL: Record<Side, string> = { esquerda: 'Esq.', direita: 'Dir.', central: '' };
const SIDES: Side[] = ['esquerda', 'direita', 'central'];

function intensityColor(v: number): string {
  return v >= 7 ? '#EF4444' : v >= 4 ? '#F59E0B' : '#22C55E';
}

export default function SessionPains({
  pains, regions, compact, divided, editable, onChanged,
}: {
  pains: PainReport[];
  regions: Map<string, RegionLabelInfo>;
  compact?: boolean;
  /** separador por cima (para o cartão do histórico, que já tem conteúdo antes). */
  divided?: boolean;
  /** liga a edição inline (só no detalhe do treino). */
  editable?: boolean;
  /** recarregar as dores depois de gravar/apagar. */
  onChanged?: () => void | Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!pains.length) return null;

  async function save(p: PainReport, patch: { intensity?: number; side?: Side; description?: string | null }) {
    setBusy(true); setErr(null);
    try {
      await updatePainReport(p.id, patch);
      setOpenId(null);
      await onChanged?.();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  async function remove(p: PainReport) {
    setBusy(true); setErr(null);
    try {
      await deletePainReport(p.id);
      setOpenId(null);
      await onChanged?.();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 6, ...(divided ? { borderTop: '1px solid var(--border)', paddingTop: 10 } : null) }}>
      <span className="section-label" style={{ margin: 0 }}>Dores registadas</span>
      {err && <p className="message message-error" style={{ fontSize: 13 }}>{err}</p>}
      <div style={{ display: 'grid', gap: compact ? 4 : 8 }}>
        {pains.map((p) => {
          const side = SIDE_LABEL[p.side];
          const c = intensityColor(p.intensity);
          const open = openId === p.id;
          return (
            <div key={p.id} style={{ display: 'grid', gap: 6 }}>
              <div
                onClick={editable ? () => setOpenId((id) => (id === p.id ? null : p.id)) : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: editable ? 'pointer' : 'default' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c, flex: '0 0 auto' }} />
                <span style={{ color: 'var(--text)' }}>
                  {painLabel(regions, p.region_id)}{side ? ` · ${side}` : ''}
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>
                  {p.intensity}
                </span>
                {editable && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{open ? '▲' : 'editar'}</span>}
              </div>
              {!compact && !open && p.description && (
                <span style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 16 }}>{p.description}</span>
              )}
              {editable && open && (
                <PainEditor p={p} busy={busy} onSave={(patch) => save(p, patch)} onDelete={() => remove(p)} onCancel={() => setOpenId(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PainEditor({
  p, busy, onSave, onDelete, onCancel,
}: {
  p: PainReport;
  busy: boolean;
  onSave: (patch: { intensity?: number; side?: Side; description?: string | null }) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [intensity, setIntensity] = useState(p.intensity);
  const [side, setSide] = useState<Side>(p.side);
  const [description, setDescription] = useState(p.description ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const c = intensityColor(intensity);

  return (
    <div style={{ display: 'grid', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-hover)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="range" min={0} max={10} step={1} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} style={{ flex: 1, accentColor: c, height: 24, cursor: 'pointer' }} />
        <span style={{ minWidth: 24, textAlign: 'right', fontSize: 18, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{intensity}</span>
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        Lado
        <select className="input" value={side} onChange={(e) => setSide(e.target.value as Side)} style={{ fontSize: 13.5 }}>
          {SIDES.map((s) => <option key={s} value={s}>{s === 'esquerda' ? 'Esquerda' : s === 'direita' ? 'Direita' : 'Central'}</option>)}
        </select>
      </label>
      <input className="input" placeholder="Nota (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} style={{ fontSize: 13 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSave({ intensity, side, description })}>{busy ? 'A guardar…' : 'Guardar'}</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>Cancelar</button>
        <span style={{ marginLeft: 'auto' }}>
          {!confirmDel ? (
            <button className="btn btn-sm" disabled={busy} onClick={() => setConfirmDel(true)} style={{ color: '#fff', background: '#EF4444', border: 'none', borderRadius: 6, padding: '3px 12px', fontWeight: 600 }}>Apagar</button>
          ) : (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <span style={{ color: 'var(--error)' }}>Apagar?</span>
              <button className="btn btn-sm" disabled={busy} onClick={onDelete} style={{ background: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px' }}>Sim</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmDel(false)}>Não</button>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  const anyE = e as { code?: string; message?: string };
  if (anyE?.code === '42501') return 'Sem permissão para apagar dores (falta o grant DELETE). Aplica o SQL no Supabase.';
  return e instanceof Error ? e.message : 'Erro ao editar a dor.';
}
