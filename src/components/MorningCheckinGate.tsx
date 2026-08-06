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

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import CheckinForm, { localTodayYMD } from './CheckinForm';

export default function MorningCheckinGate() {
  const [show, setShow] = useState(false);

  const evaluate = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setShow(false); return; }
    const { data, error } = await supabase
      .schema('subjective')
      .from('morning_checkin')
      .select('date')
      .eq('date', localTodayYMD())
      .maybeSingle();
    if (error) { setShow(false); return; } // never block on a read error
    setShow(!data);
  }, []);

  useEffect(() => {
    evaluate();
    const { data: sub } = supabase.auth.onAuthStateChange(() => evaluate());
    // Re-check when the tab regains focus (e.g. the local day rolled over).
    const onVis = () => { if (document.visibilityState === 'visible') evaluate(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { sub.subscription.unsubscribe(); document.removeEventListener('visibilitychange', onVis); };
  }, [evaluate]);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto' }}>
        <p className="section-label" style={{ marginTop: 0 }}>Check-in matinal</p>
        <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--muted)' }}>
          Antes de veres os dados de hoje: como te sentes? Responde só ao que <strong>percebes</strong>,
          sem pensar nos números — é essa a leitura que interessa.
        </p>
        <CheckinForm onSaved={() => setShow(false)} />
      </div>
    </div>
  );
}
