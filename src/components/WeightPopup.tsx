'use client';

/**
 * Pop-up de PESO — separado do check-in. Aparece DEPOIS de submeter o check-in
 * de sono/recuperação/energia, na mesma tab. É opcional: fechar sem preencher
 * NÃO afeta o check-in já submetido. Um peso por dia (upsert por date).
 *
 * Só regista o número — sem juízo, sem metas. A trend/velocidade vive no cartão
 * do gráfico, não aqui.
 */

import { useEffect, useState } from 'react';
import { upsertWeight, getTodayWeight } from '@/lib/weight';

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center',
  padding: 16, zIndex: 50,
};

export default function WeightPopup({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [kg, setKg] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Prefill com a pesagem de hoje, se já houver (re-pesar substitui).
    getTodayWeight().then((v) => { if (v != null) setKg(String(v)); }).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    const v = Number(kg.replace(',', '.'));
    // CHECK em body.weight: 30–200 kg (rejeita dedo enganado, ex.: 700).
    if (!isFinite(v) || v < 30 || v > 200) { setErr('Peso tem de estar entre 30 e 200 kg.'); return; }
    setSaving(true); setErr(null);
    try {
      await upsertWeight(v);
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao guardar o peso.');
    } finally { setSaving(false); }
  }

  return (
    <div role="dialog" aria-modal="true" style={overlay} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <p className="section-label" style={{ margin: 0 }}>Peso de hoje</p>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--muted)' }}>
          Opcional. Pesa-te de manhã, sempre nas mesmas condições. Podes fechar sem preencher.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            className="input"
            type="number" inputMode="decimal" step="0.1" min="0"
            placeholder="kg" value={kg}
            onChange={(e) => setKg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            autoFocus
            style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', letterSpacing: '0.02em' }}
          />
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>kg</span>
        </div>

        {err && <p className="message message-error" style={{ fontSize: 13, marginTop: 10 }}>{err}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving} style={{ flex: 1 }}>Agora não</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || kg.trim() === ''} style={{ flex: 2 }}>
            {saving ? 'A guardar…' : 'Guardar peso'}
          </button>
        </div>
      </div>
    </div>
  );
}
