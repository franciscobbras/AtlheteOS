'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const DetailedECGChart = dynamic(() => import('../../../components/DetailedECGChart'), { ssr: false });

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

function formatDuration(secs: number | null) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const TYPE_BG: Record<string, string> = {
  Run: 'rgba(245,158,11,0.12)', Bike: 'rgba(79,140,255,0.12)',
  Swim: 'rgba(34,197,94,0.12)', Strength: 'rgba(239,68,68,0.12)', Other: 'var(--surface-hover)',
};
const TYPE_FG: Record<string, string> = {
  Run: '#F59E0B', Bike: '#4F8CFF', Swim: '#22C55E', Strength: '#EF4444', Other: 'var(--muted)',
};

export default function ActivityDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then((r) => r.ok ? r.json() : r.json().then((b) => Promise.reject(b.error)))
      .then(setActivity)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="empty-state">Loading…</div>;
  if (error || !activity) return <div className="message message-error">{error ?? 'Activity not found'}</div>;

  const bg = TYPE_BG[activity.type] ?? TYPE_BG.Other;
  const fg = TYPE_FG[activity.type] ?? TYPE_FG.Other;
  const ecgLabels = activity.ecg?.map((_, i) => String(i)) ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>{activity.title}</h1>
            <span className="badge" style={{ background: bg, color: fg }}>{activity.type}</span>
            {activity.source === 'live' && (
              <span className="badge badge-accent">Live</span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            {new Date(activity.created_at).toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Link href="/dashboard" className="btn btn-secondary btn-sm">
          ← Back to training
        </Link>
      </div>

      {/* Stats row */}
      <div className="stat-grid stagger">
        <StatCard label="Duration" value={formatDuration(activity.duration_seconds)} />
        <StatCard label="Avg heart rate" value={activity.heart_rate_avg ? `${activity.heart_rate_avg} bpm` : '—'} color="#EF4444" />
        <StatCard label="Max heart rate" value={activity.heart_rate_max ? `${activity.heart_rate_max} bpm` : '—'} color="#EF4444" />
        <StatCard label="ECG samples" value={activity.ecg ? activity.ecg.length.toLocaleString() : '—'} />
      </div>

      {activity.notes && (
        <div className="card" style={{ padding: '14px 18px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{activity.notes}</span>
        </div>
      )}

      {/* ECG chart */}
      {activity.ecg && activity.ecg.length > 0 ? (
        <div className="card">
          <p className="section-label">ECG trace</p>
          <DetailedECGChart ecgData={activity.ecg} labels={ecgLabels} startLabel={activity.title} />
        </div>
      ) : (
        <div className="card empty-state">No ECG data recorded for this session.</div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat-card animate-slide-up" style={{ textAlign: 'center' }}>
      <p className="stat-card-label" style={{ justifyContent: 'center' }}>{label}</p>
      <p className="stat-card-value" style={{ color: color ?? 'var(--text)' }}>{value}</p>
    </div>
  );
}
