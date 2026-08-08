'use client';

/**
 * Morning check-in form — subjective layer.
 *
 * Three 0-10 scales + optional notes. Buttons (not a slider) with NO
 * pre-selected value: a slider must start somewhere, and that starting
 * position anchors the answer, which is exactly what would contaminate the
 * objective-vs-subjective divergence metric. Nothing objective is shown here.
 *
 * Writes to subjective.morning_checkin, upsert on `date` (the WAKE day, local).
 * logged_at_utc is deliberately NOT sent: on first insert it takes the column
 * default now() (the real first-submission moment, used later to derive how many
 * hours after waking it was filled); on an edit it is left untouched.
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type CheckinValues = {
  sleep_perceived: number | null;
  recovery_feeling: number | null;
  mood_energy: number | null;
  notes: string;
};

// Local wake-day (NOT UTC): at 00:30 local the UTC date is already yesterday,
// but a morning check-in belongs to the local day — same convention as
// wearable.sleep's wake-day key, so today's feeling lines up with last night.
export function localTodayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localOffsetSeconds(): number {
  return -new Date().getTimezoneOffset() * 60; // e.g. UTC+1 → 3600
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' · ');
  }
  return String(e);
}

const SCALES: { key: keyof Omit<CheckinValues, 'notes'>; label: string }[] = [
  { key: 'sleep_perceived', label: 'Qualidade geral do sono' },
  { key: 'recovery_feeling', label: 'Recuperação' },
  { key: 'mood_energy', label: 'Energia' },
];

function Scale({ label, value, onPick }: { label: string; value: number | null; onPick: (n: number) => void }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</p>
      {/* Grelha de 11 colunas iguais: preenche sempre a largura, nunca transborda
          nem faz wrap — no telemóvel os botões encolhem em vez de partir a linha. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 4 }}>
        {Array.from({ length: 11 }, (_, n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              aria-pressed={on}
              style={{
                width: '100%', minWidth: 0, height: 40, padding: 0, borderRadius: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 700, touchAction: 'manipulation',
                border: `1px solid ${on ? '#6366F1' : 'var(--border)'}`,
                background: on ? '#6366F1' : 'var(--surface)',
                color: on ? '#fff' : 'var(--muted)',
                transition: 'background 0.1s, border-color 0.1s',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--muted)' }}>
        <span>0 — péssimo</span><span>10 — excelente</span>
      </div>
    </div>
  );
}

export default function CheckinForm({
  initial,
  onSaved,
}: {
  initial?: Partial<CheckinValues> | null;
  onSaved?: (v: CheckinValues) => void;
}) {
  const [v, setV] = useState<CheckinValues>({
    sleep_perceived: initial?.sleep_perceived ?? null,
    recovery_feeling: initial?.recovery_feeling ?? null,
    mood_energy: initial?.mood_energy ?? null,
    notes: initial?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allAnswered = v.sleep_perceived != null && v.recovery_feeling != null && v.mood_energy != null;

  async function submit() {
    if (!allAnswered || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const { error } = await supabase.schema('subjective').from('morning_checkin').upsert(
        {
          date: localTodayYMD(),
          utc_offset_seconds: localOffsetSeconds(),
          sleep_perceived: v.sleep_perceived,
          recovery_feeling: v.recovery_feeling,
          mood_energy: v.mood_energy,
          notes: v.notes.trim() || null,
        },
        { onConflict: 'date' },
      );
      if (error) throw error;
      onSaved?.(v);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {SCALES.map((s) => (
        <Scale key={s.key} label={s.label} value={v[s.key]} onPick={(n) => setV((p) => ({ ...p, [s.key]: n }))} />
      ))}

      <div style={{ marginBottom: 16 }}>
        <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Notas <span style={{ fontWeight: 400 }}>(opcional)</span></p>
        <textarea
          className="input"
          rows={2}
          placeholder="Algo a registar sobre a noite/manhã…"
          value={v.notes}
          onChange={(e) => setV((p) => ({ ...p, notes: e.target.value }))}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>

      {err && <p className="message message-error" style={{ fontSize: 13 }}>{err}</p>}

      <button
        type="button"
        className="btn btn-primary"
        disabled={!allAnswered || saving}
        onClick={submit}
        style={{ width: '100%' }}
      >
        {saving ? 'A guardar…' : 'Guardar check-in'}
      </button>
      {!allAnswered && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
          Responde às três escalas para guardar.
        </p>
      )}
    </div>
  );
}
