'use client';

/**
 * Blind morning check-in gate.
 *
 * A blocking, non-dismissable overlay shown when ALL of:
 *   - the user is signed in,
 *   - there is no morning_checkin row for today (local wake-day).
 *
 * It shows only the check-in form — no readiness, no scores, no hypnogram,
 * no HRV/RHR — so the answer can't be anchored on the objective data. Once
 * submitted it disappears and the app is free.
 *
 * There is NO time-of-day cutoff: the check-in stays available for the whole
 * day (until answered). A late fill is not rejected — instead its reliability
 * decays with how long after waking it was made (logged_at_utc − sleep wake
 * time). That decay is derived at read time; the blind block just guarantees
 * the answer is never anchored on the day's objective data. Popup windows will
 * be tuned later, once Nexus knows the user's schedule in detail.
 */

import CheckinForm from './CheckinForm';
import { useDayData } from '@/contexts/DayDataContext';

export default function MorningCheckinGate() {
  // Dados do dia partilhados (um só fetch para toda a app). O gate mostra-se
  // quando há sessão e ainda não há check-in de hoje. Nunca bloqueia em erro:
  // se a leitura falhar, checkin fica null e o gate aparece (pode-se preencher).
  const { loading, authed, checkin, checkinError, refresh } = useDayData();
  // fail-open: em erro de leitura não bloqueia (comportamento original).
  const show = authed && !loading && !checkin && !checkinError;

  if (!show) return null;

  return (
    <div
      className="checkin-gate"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '92dvh', overflowY: 'auto' }}>
        <p className="section-label" style={{ marginTop: 0 }}>Check-in matinal</p>
        <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--muted)' }}>
          Antes de veres os dados de hoje: como te sentes? Responde só ao que <strong>percebes</strong>,
          sem pensar nos números — é essa a leitura que interessa.
        </p>
        <CheckinForm onSaved={() => { refresh(); }} />
      </div>
      {/* No telemóvel: aperta o padding para as escalas 0–10 respirarem. dvh em
          vez de vh para a barra do browser móvel não cortar o fundo do card. */}
      <style>{`
        @media (max-width: 480px) {
          .checkin-gate { padding: 8px !important; }
          .checkin-gate > .card { padding: 15px !important; }
        }
      `}</style>
    </div>
  );
}
