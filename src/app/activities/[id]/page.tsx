'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  PointElement, LineElement,
  Title, Tooltip,
} from 'chart.js';
import { supabase } from '@/lib/supabaseClient';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip);

const SAMPLES_PER_PAGE = 1300; // 10 s at 130 Hz

// ── Types ──────────────────────────────────────────────────────────────────────

interface Activity {
  id: string;
  created_at: string;
  started_at: string | null;
  title: string;
  type: string;
  duration_seconds: number | null;
  notes: string | null;
  ecg: number[] | null;
  ecg_sample_count: number | null;
  ecg_frame_count: number | null;
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  heart_rate_min: number | null;
  rr_count: number | null;
  dropped_packets: number | null;
  quality: 'good' | 'fair' | 'poor' | null;
  source: string;
}

interface RrPacket {
  seq: number;
  timestamp_ms: number;
  hr_bpm: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMMSS(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function fmtMsElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// ── Chart options ──────────────────────────────────────────────────────────────

const ECG_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    x: { display: false },
    y: {
      min: -1400, max: 1400,
      ticks: { color: '#71717A', maxTicksLimit: 5, font: { size: 11 } },
      grid: { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'transparent' },
    },
  },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HR_OPTIONS: any = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx: { parsed: { y: number } }) => ` ${ctx.parsed.y} bpm` } },
  },
  scales: {
    x: {
      ticks: { color: '#71717A', font: { size: 11 }, maxTicksLimit: 8, autoSkip: true, maxRotation: 0 },
      grid: { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'transparent' },
    },
    y: {
      ticks: { color: '#71717A', maxTicksLimit: 5, font: { size: 11 } },
      grid: { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'transparent' },
    },
  },
  elements: {
    point: { radius: 2, backgroundColor: '#EF4444', borderColor: 'transparent' },
    line: { borderWidth: 2, tension: 0.3 },
  },
};

// ── Badge helpers ──────────────────────────────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  Run: 'rgba(245,158,11,0.12)', Bike: 'rgba(79,140,255,0.12)',
  Swim: 'rgba(34,197,94,0.12)', Strength: 'rgba(239,68,68,0.12)', Other: 'var(--surface-hover)',
};
const TYPE_FG: Record<string, string> = {
  Run: '#F59E0B', Bike: '#4F8CFF', Swim: '#22C55E', Strength: '#EF4444', Other: 'var(--muted)',
};
const QUALITY_STYLE = {
  good: { color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  fair: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  poor: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ActivityDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ecgSamples, setEcgSamples] = useState<number[]>([]);
  const [rrPackets, setRrPackets] = useState<RrPacket[]>([]);
  const [h10Loading, setH10Loading] = useState(false);
  const [ecgPage, setEcgPage] = useState(0);

  // Fetch activity metadata
  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(b.error)))
      .then(setActivity)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  // Fetch ECG frames + RR packets via sessions link
  useEffect(() => {
    if (!id) return;
    setH10Loading(true);

    async function loadH10() {
      try {
        const { data: sess } = await supabase
          .from('sessions')
          .select('id')
          .eq('activity_id', id)
          .limit(1)
          .maybeSingle();

        if (!sess) return;

        const [{ data: frames }, { data: packets }] = await Promise.all([
          supabase
            .from('ecg_frames')
            .select('seq, samples_uv')
            .eq('session_id', sess.id)
            .order('seq', { ascending: true }),
          supabase
            .from('rr_packets')
            .select('seq, timestamp_ms, hr_bpm')
            .eq('session_id', sess.id)
            .order('seq', { ascending: true }),
        ]);

        if (frames?.length) setEcgSamples(frames.flatMap((f: { samples_uv: number[] }) => f.samples_uv));
        if (packets?.length) setRrPackets(packets as RrPacket[]);
      } catch (err) {
        console.error('[ActivityDetail] H10 data load failed', err);
      } finally {
        setH10Loading(false);
      }
    }

    loadH10();
  }, [id]);

  // Prefer ecg_frames data; fall back to legacy activity.ecg array
  const allEcgSamples = ecgSamples.length > 0 ? ecgSamples : (activity?.ecg ?? []);
  const ecgPageCount = Math.ceil(allEcgSamples.length / SAMPLES_PER_PAGE);
  const ecgSlice = allEcgSamples.slice(ecgPage * SAMPLES_PER_PAGE, (ecgPage + 1) * SAMPLES_PER_PAGE);

  const ecgChartData = useMemo(() => ({
    labels: Array.from({ length: ecgSlice.length }, (_, i) => String(i)),
    datasets: [{
      data: ecgSlice,
      borderColor: 'rgba(79,140,255,0.9)',
      backgroundColor: 'transparent',
      spanGaps: false,
    }],
  }), [ecgSlice]);

  const hrChartData = useMemo(() => {
    const withHr = rrPackets.filter(p => p.hr_bpm !== null);
    if (!withHr.length) return null;
    const t0 = withHr[0].timestamp_ms;
    return {
      labels: withHr.map(p => fmtMsElapsed(p.timestamp_ms - t0)),
      datasets: [{
        data: withHr.map(p => p.hr_bpm),
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239,68,68,0.06)',
        fill: true,
      }],
    };
  }, [rrPackets]);

  if (loading) return <div className="empty-state">Loading…</div>;
  if (error || !activity) return <div className="message message-error">{error ?? 'Activity not found'}</div>;

  const bg = TYPE_BG[activity.type] ?? TYPE_BG.Other;
  const fg = TYPE_FG[activity.type] ?? TYPE_FG.Other;
  const qs = activity.quality ? QUALITY_STYLE[activity.quality] : null;
  const displayDate = activity.started_at ?? activity.created_at;

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>{activity.title}</h1>
            <span className="badge" style={{ background: bg, color: fg }}>{activity.type}</span>
            {qs && (
              <span className="badge" style={{ background: qs.bg, color: qs.color, textTransform: 'capitalize' }}>
                {activity.quality}
              </span>
            )}
            {activity.source === 'live' && <span className="badge badge-accent">Live</span>}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            {new Date(displayDate).toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Link href="/dashboard" className="btn btn-secondary btn-sm">← Back to training</Link>
      </div>

      {/* Top stat cards */}
      <div className="stat-grid stagger">
        <StatCard label="Duration"      value={fmtMMSS(activity.duration_seconds)} />
        <StatCard label="Avg heart rate" value={activity.heart_rate_avg ? `${activity.heart_rate_avg} bpm` : '—'} color="#EF4444" />
        <StatCard label="Max heart rate" value={activity.heart_rate_max ? `${activity.heart_rate_max} bpm` : '—'} color="#EF4444" />
        <StatCard label="ECG samples"   value={
          activity.ecg_sample_count != null ? activity.ecg_sample_count.toLocaleString()
          : allEcgSamples.length ? allEcgSamples.length.toLocaleString()
          : '—'
        } />
      </div>

      {activity.notes && (
        <div className="card" style={{ padding: '14px 18px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{activity.notes}</span>
        </div>
      )}

      {/* ECG Waveform */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>ECG Signal — 130 Hz</p>
          {ecgPageCount > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEcgPage(p => Math.max(0, p - 1))}
                disabled={ecgPage === 0}
              >← prev 10s</button>
              <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 60, textAlign: 'center' }}>
                {ecgPage + 1} / {ecgPageCount}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEcgPage(p => Math.min(ecgPageCount - 1, p + 1))}
                disabled={ecgPage >= ecgPageCount - 1}
              >next 10s →</button>
            </div>
          )}
        </div>
        {h10Loading ? (
          <div className="empty-state" style={{ height: 160 }}>Loading ECG data…</div>
        ) : allEcgSamples.length > 0 ? (
          <div style={{ height: 200 }}>
            <Line data={ecgChartData} options={ECG_OPTIONS} />
          </div>
        ) : (
          <div className="empty-state" style={{ height: 80 }}>No ECG data recorded for this session.</div>
        )}
      </div>

      {/* HR Over Time */}
      <div className="card">
        <p className="section-label">Heart Rate</p>
        {h10Loading ? (
          <div className="empty-state" style={{ height: 120 }}>Loading heart rate data…</div>
        ) : hrChartData ? (
          <div style={{ height: 180 }}>
            <Line data={hrChartData} options={HR_OPTIONS} />
          </div>
        ) : (
          <div className="empty-state" style={{ height: 80 }}>No heart rate data for this session.</div>
        )}
      </div>

      {/* Session Stats */}
      {(activity.rr_count != null || activity.ecg_frame_count != null || activity.heart_rate_min != null || activity.dropped_packets != null) && (
        <div className="card">
          <p className="section-label">Session Stats</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {activity.rr_count         != null && <MetaCell label="RR packets"      value={activity.rr_count.toLocaleString()} />}
            {activity.ecg_frame_count  != null && <MetaCell label="ECG frames"      value={activity.ecg_frame_count.toLocaleString()} />}
            {activity.ecg_sample_count != null && <MetaCell label="ECG samples"     value={activity.ecg_sample_count.toLocaleString()} />}
            {activity.dropped_packets  != null && <MetaCell label="Dropped packets" value={activity.dropped_packets.toLocaleString()} />}
            {activity.heart_rate_min   != null && <MetaCell label="Min HR"          value={`${activity.heart_rate_min} bpm`} />}
            <MetaCell label="Duration" value={fmtMMSS(activity.duration_seconds)} />
            <MetaCell label="Recorded" value={new Date(displayDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
            {activity.quality && qs && (
              <div className="stat-card" style={{ padding: '10px 14px' }}>
                <p className="stat-card-label">Quality</p>
                <span className="badge" style={{ background: qs.bg, color: qs.color, textTransform: 'capitalize', fontSize: 13, fontWeight: 700 }}>
                  {activity.quality}
                </span>
              </div>
            )}
          </div>
        </div>
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

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card" style={{ padding: '10px 14px' }}>
      <p className="stat-card-label" style={{ marginBottom: 4 }}>{label}</p>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{value}</p>
    </div>
  );
}
