'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';


interface Activity {
  id: string;
  created_at: string;
  title: string;
  type: string;
  duration_seconds: number | null;
  notes: string | null;
  ecg: number[] | null;
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  source: string;
}

const TYPE_COLORS: Record<string, string> = {
  Run: 'rgba(251, 191, 36, 0.18)',
  Bike: 'rgba(91, 147, 255, 0.18)',
  Swim: 'rgba(16, 185, 129, 0.18)',
  Strength: 'rgba(248, 113, 113, 0.18)',
  Other: 'rgba(255, 255, 255, 0.08)',
};
const TYPE_TEXT: Record<string, string> = {
  Run: '#fde68a',
  Bike: '#93c5fd',
  Swim: '#6ee7b7',
  Strength: '#fca5a5',
  Other: '#aac1de',
};

function formatDuration(secs: number | null) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function ActivityHistory() {
  const router = useRouter();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/activities');
    if (!res.ok) { setError('Failed to load activities'); setLoading(false); return; }
    setActivities(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);


  const handleDelete = async (id: string) => {
    if (!confirm('Delete this activity?')) return;
    setDeleting(id);
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
    setActivities((prev) => prev.filter((a) => a.id !== id));
    setDeleting(null);
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <p className="subheading" style={{ margin: 0 }}>
          {activities.length} {activities.length === 1 ? 'activity' : 'activities'} recorded
        </p>
        <Link href="/activities/new" className="button primary small">
          + Add activity
        </Link>
      </div>

      {loading && <div className="info-card">Loading activities…</div>}
      {error && <div className="message error">{error}</div>}

      {!loading && activities.length === 0 && (
        <div className="empty-state">
          No activities yet. Record a live session or add one manually.
        </div>
      )}

      {/* Activity list */}
      {activities.map((a) => {
        const bg = TYPE_COLORS[a.type] ?? TYPE_COLORS.Other;
        const fg = TYPE_TEXT[a.type] ?? TYPE_TEXT.Other;
        return (
          <div
            key={a.id}
            className="card"
            onDoubleClick={() => router.push(`/activities/${a.id}`)}
            style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', gap: 16, padding: '20px 24px', cursor: 'pointer' }}
          >
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f4f8ff' }}>{a.title}</span>
                <span style={{ padding: '2px 10px', borderRadius: 999, background: bg, color: fg, fontSize: '0.8rem', fontWeight: 700 }}>
                  {a.type}
                </span>
                {a.source === 'live' && (
                  <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(91,147,255,0.15)', color: '#93c5fd', fontSize: '0.8rem', fontWeight: 700 }}>
                    Live
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: 'var(--muted)', fontSize: '0.88rem' }}>
                <span>{formatDate(a.created_at)}</span>
                {a.duration_seconds != null && <span>Duration: {formatDuration(a.duration_seconds)}</span>}
                {a.heart_rate_avg != null && <span>Avg HR: {a.heart_rate_avg} bpm</span>}
                {a.heart_rate_max != null && <span>Max HR: {a.heart_rate_max} bpm</span>}
                {a.ecg && a.ecg.length > 0 && <span style={{ color: '#5b93ff' }}>ECG recorded</span>}
              </div>
              {a.notes && <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>{a.notes}</p>}
            </div>
            <button
              onClick={() => handleDelete(a.id)}
              disabled={deleting === a.id}
              style={{
                background: 'rgba(248,113,113,0.12)',
                border: '1px solid rgba(248,113,113,0.25)',
                color: '#fca5a5',
                borderRadius: 12,
                padding: '8px 14px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.85rem',
                transition: 'background 0.2s',
              }}
            >
              {deleting === a.id ? '…' : 'Delete'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
