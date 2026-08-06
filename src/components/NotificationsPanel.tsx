'use client';

/**
 * Notifications — read-only list of ops.notifications + a "mark resolved" button.
 *
 * Deliberately minimal per spec: no filters, no pagination, no color/icon coding
 * by severity or type (that visual hierarchy is a deferred UX decision).
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Notification = {
  id: string;
  created_at_utc: string;
  type: string;
  severity: string;
  title: string;
  detail: string | null;
  resolved: boolean;
  resolved_at_utc: string | null;
};

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

export default function NotificationsPanel() {
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .schema('ops')
        .from('notifications')
        .select('id, created_at_utc, type, severity, title, detail, resolved, resolved_at_utc')
        .order('created_at_utc', { ascending: false });
      if (error) throw error;
      setRows((data as Notification[]) ?? []);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function markResolved(id: string) {
    setResolving(id);
    try {
      const { error } = await supabase
        .schema('ops')
        .from('notifications')
        .update({ resolved: true, resolved_at_utc: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="card">
      <p className="section-label">Notificações</p>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--muted)' }}>
        Incidentes de ingestão (<code>ops.notifications</code>) — reautenticação necessária,
        falhas de ingestão e dados em falta. Ordenado do mais recente para o mais antigo.
      </p>

      {loading && <p style={{ color: 'var(--muted)' }}>A carregar…</p>}
      {err && <p className="message message-error" style={{ fontSize: 13 }}>{err}</p>}

      {!loading && !err && rows && rows.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem notificações.</p>
      )}

      {!loading && !err && rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((n) => (
            <div key={n.id} className="inner-card" style={{ opacity: n.resolved ? 0.55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <strong style={{ color: 'var(--text)' }}>{n.title}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {n.type} · {n.severity} · {new Date(n.created_at_utc).toLocaleString()}
                    {n.resolved && n.resolved_at_utc ? ` · resolvido em ${new Date(n.resolved_at_utc).toLocaleString()}` : ''}
                  </div>
                  {n.detail && (
                    <div style={{ fontSize: 12.5, marginTop: 6, whiteSpace: 'pre-wrap' }}>{n.detail}</div>
                  )}
                </div>
                {!n.resolved && (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={resolving === n.id}
                    onClick={() => markResolved(n.id)}
                  >
                    {resolving === n.id ? 'A marcar…' : 'Marcar resolvido'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
