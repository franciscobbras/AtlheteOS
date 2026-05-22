'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  PointElement, LineElement,
  BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import { useRouter } from 'next/navigation';
import { parseECG, parseHRFile } from '@/lib/parsers';
import { DailyReadinessSection, LoadManagementSection, AdvancedSection } from './AthleteSections';

ChartJS.register(
  CategoryScale, LinearScale,
  PointElement, LineElement,
  BarElement, ArcElement,
  Title, Tooltip, Legend,
);

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVITY_TYPES = ['Run', 'Bike', 'Swim', 'Strength', 'Gymnastics', 'Other'];

const TYPE_BG: Record<string, string> = {
  Run:        'rgba(245,158,11,0.12)',
  Bike:       'rgba(79,140,255,0.12)',
  Swim:       'rgba(34,197,94,0.12)',
  Strength:   'rgba(239,68,68,0.12)',
  Gymnastics: 'rgba(245,158,11,0.2)',
  Other:      'var(--surface-hover)',
};

const TYPE_FG: Record<string, string> = {
  Run:        '#F59E0B',
  Bike:       '#4F8CFF',
  Swim:       '#22C55E',
  Strength:   '#EF4444',
  Gymnastics: '#F59E0B',
  Other:      'var(--muted)',
};

const TYPE_CHART: Record<string, string> = {
  Run:        '#F59E0B',
  Bike:       '#4F8CFF',
  Swim:       '#22C55E',
  Strength:   '#EF4444',
  Gymnastics: '#F59E0B',
  Other:      '#71717A',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Activity = {
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
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(secs: number | null): string {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtWeekTime(secs: number): string {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// ── Shared chart tokens ───────────────────────────────────────────────────────

const TICK = '#71717A';
const GRID = 'rgba(255,255,255,0.04)';

const darkAxis = {
  ticks:  { color: TICK, font: { size: 11 } },
  grid:   { color: GRID },
  border: { color: 'transparent' },
};

const darkAxisX = {
  ...darkAxis,
  ticks: { ...darkAxis.ticks, maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
};

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="stat-card animate-slide-up">
      <p className="stat-card-label">
        {icon}
        {label}
      </p>
      <p className="stat-card-value" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IconSessions() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>;
}
function IconCalendar() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}
function IconHeart() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>;
}
function IconClock() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
}
function IconTrash() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>;
}
function IconPlus() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TrainingDashboard() {
  const router = useRouter();

  // ── Data state ───────────────────────────────────────────────────────────
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);

  // ── Form state ───────────────────────────────────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType]   = useState('Run');
  const [formDur, setFormDur]     = useState('');
  const [formHrAvg, setFormHrAvg] = useState('');
  const [formHrMax, setFormHrMax] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formErr, setFormErr]     = useState<string | null>(null);
  const [formBusy, setFormBusy]   = useState(false);

  // ECG / HR file upload state
  const [ecgData, setEcgData]       = useState<number[] | null>(null);
  const [ecgPreview, setEcgPreview] = useState<string | null>(null);
  const [ecgError, setEcgError]     = useState<string | null>(null);
  const [hrPreview, setHrPreview]   = useState<string | null>(null);
  const [hrError, setHrError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/activities');
    if (!res.ok) { setError('Failed to load activities'); setLoading(false); return; }
    setActivities(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const weekStart    = useMemo(() => getWeekStart(), []);
  const sevenDaysAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), []);

  const thisWeek = useMemo(
    () => activities.filter(a => new Date(a.created_at) >= weekStart),
    [activities, weekStart],
  );

  const avgHR = useMemo(() => {
    const vals = activities
      .filter(a => new Date(a.created_at) >= sevenDaysAgo && a.heart_rate_avg != null)
      .map(a => a.heart_rate_avg!);
    return vals.length
      ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
      : null;
  }, [activities, sevenDaysAgo]);

  const weekTime = useMemo(() => {
    const secs = thisWeek.reduce((s, a) => s + (a.duration_seconds ?? 0), 0);
    return fmtWeekTime(secs);
  }, [thisWeek]);

  // ── Chart data ───────────────────────────────────────────────────────────
  const hrChartData = useMemo(() => {
    const sessions = [...activities]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .filter(a => a.heart_rate_avg != null)
      .slice(-30);
    return {
      labels: sessions.map(a => fmtDate(new Date(a.created_at))),
      datasets: [{
        data:                 sessions.map(a => a.heart_rate_avg),
        borderColor:          '#EF4444',
        backgroundColor:      'rgba(239,68,68,0.06)',
        fill:                 true,
        tension:              0.35,
        pointRadius:          3,
        pointBackgroundColor: '#EF4444',
        pointBorderColor:     'transparent',
        borderWidth:          2,
      }],
    };
  }, [activities]);

  const typeChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    ACTIVITY_TYPES.forEach(t => { counts[t] = 0; });
    activities.forEach(a => {
      const key = ACTIVITY_TYPES.includes(a.type) ? a.type : 'Other';
      counts[key]++;
    });
    const labels = ACTIVITY_TYPES.filter(t => counts[t] > 0);
    return {
      labels,
      datasets: [{
        data:            labels.map(k => counts[k]),
        backgroundColor: labels.map(k => TYPE_CHART[k] ?? TYPE_CHART.Other),
        borderColor:     'var(--surface)',
        borderWidth:     2,
        hoverOffset:     4,
      }],
    };
  }, [activities]);

  const weeklyBarData = useMemo(() => {
    const now = new Date();
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      return getWeekStart(d);
    }).reverse();

    return {
      labels: weeks.map(w => fmtDate(w)),
      datasets: [{
        label: 'Minutes',
        data: weeks.map(mon => {
          const end = new Date(mon);
          end.setDate(end.getDate() + 7);
          return activities
            .filter(a => { const d = new Date(a.created_at); return d >= mon && d < end; })
            .reduce((sum, a) => sum + Math.floor((a.duration_seconds ?? 0) / 60), 0);
        }),
        backgroundColor: 'rgba(79,140,255,0.5)',
        borderColor:     '#4F8CFF',
        borderWidth:     1,
        borderRadius:    4,
      }],
    };
  }, [activities]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleEcgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseECG(reader.result as string);
        if (!parsed) {
          setEcgError('No ECG samples found in file.');
          setEcgData(null); setEcgPreview(null);
          return;
        }
        setEcgData(parsed);
        setEcgError(null);
        const secs = parsed.length / 130;
        const mins = Math.floor(secs / 60);
        const rem  = Math.round(secs % 60);
        setEcgPreview(`✓ ${parsed.length.toLocaleString()} samples detected (~${mins}m ${rem}s at 130Hz)`);
      } catch (err) {
        setEcgError((err as Error).message);
        setEcgData(null); setEcgPreview(null);
      }
    };
    reader.readAsText(file);
  }

  function handleHrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseHRFile(reader.result as string);
      if (!result) {
        setHrError('Could not parse HR file — expected columns "HR (bpm)" (Polar) or "Heart Rate" (Garmin).');
        setHrPreview(null);
        return;
      }
      setHrError(null);
      setFormHrAvg(String(result.avg));
      setFormHrMax(String(result.max));
      setFormDur(prev => prev || String(Math.round(result.duration / 60)));
      const mins = Math.floor(result.duration / 60);
      setHrPreview(`✓ Avg: ${result.avg} bpm  Max: ${result.max} bpm  Duration: ${mins}min`);
    };
    reader.readAsText(file);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(id);
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
    setActivities(prev => prev.filter(a => a.id !== id));
    setDeleting(null);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim()) { setFormErr('Title is required.'); return; }
    if (ecgError) { setFormErr('Fix the ECG file error before saving.'); return; }
    setFormBusy(true);
    setFormErr(null);

    const res = await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:            formTitle.trim(),
        type:             formType,
        duration_seconds: formDur    ? Math.round(parseFloat(formDur) * 60) : null,
        heart_rate_avg:   formHrAvg  ? parseInt(formHrAvg)                  : null,
        heart_rate_max:   formHrMax  ? parseInt(formHrMax)                  : null,
        notes:            formNotes.trim() || null,
        ecg:              ecgData ?? undefined,
        source:           'manual',
      }),
    });

    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setFormErr(b?.error ?? 'Failed to save activity');
      setFormBusy(false);
      return;
    }

    setFormTitle(''); setFormType('Run'); setFormDur('');
    setFormHrAvg(''); setFormHrMax(''); setFormNotes('');
    setEcgData(null); setEcgPreview(null); setEcgError(null);
    setHrPreview(null); setHrError(null);
    setShowForm(false);
    setFormBusy(false);
    load();
  }

  // ── Chart options ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hrOptions: any = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: { parsed: { y: number } }) => ` ${ctx.parsed.y} bpm` } },
    },
    scales: { x: darkAxisX, y: darkAxis },
  };

  const doughnutOptions = {
    responsive: true,
    cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { color: TICK, boxWidth: 10, padding: 12, font: { size: 11 } },
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const barOptions: any = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: { parsed: { y: number } }) => ` ${ctx.parsed.y} min` } },
    },
    scales: {
      x: darkAxisX,
      y: { ...darkAxis, beginAtZero: true },
    },
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="empty-state">Loading…</div>;
  if (error)   return <div className="message message-error">{error}</div>;

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">

      {/* Page title */}
      <div className="page-header">
        <h1 className="page-title">Training</h1>
        <p className="page-subtitle">All sessions, volume trends, and performance metrics</p>
      </div>

      {/* ── Row 1: stat cards ──────────────────────────────────────────── */}
      <div className="stat-grid stagger">
        <StatCard label="Total sessions"       value={activities.length.toString()}  color="#4F8CFF"  icon={<IconSessions />} />
        <StatCard label="This week"            value={thisWeek.length.toString()}    color="#22C55E"  icon={<IconCalendar />} />
        <StatCard label="Avg HR — last 7 days" value={avgHR ? `${avgHR} bpm` : '—'} color="#EF4444"  icon={<IconHeart />} />
        <StatCard label="Time this week"       value={weekTime}                      color="#A855F7"  icon={<IconClock />} />
      </div>

      {/* ── Row 2: HR line + type doughnut ─────────────────────────────── */}
      <div className="chart-grid">
        <div className="card">
          <p className="section-label">Heart rate — last 30 sessions</p>
          {hrChartData.labels.length === 0
            ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>No HR data recorded yet.</p>
            : <Line data={hrChartData} options={hrOptions} />
          }
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <p className="section-label">Activity type breakdown</p>
          {activities.length === 0
            ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>No activities yet.</p>
            : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Doughnut data={typeChartData} options={doughnutOptions} />
              </div>
          }
        </div>
      </div>

      {/* ── Row 3: weekly volume ────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label">Weekly volume — last 12 weeks</p>
        <Bar data={weeklyBarData} options={barOptions} />
      </div>

      {/* ── Nexus sections ─────────────────────────────────────────────── */}
      <DailyReadinessSection />
      <LoadManagementSection />
      <AdvancedSection />

      {/* ── Row 4: activity list ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 10 }}>

        {/* List header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 2 }}>All sessions</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
              {activities.length} {activities.length === 1 ? 'activity' : 'activities'} — click to open
            </p>
          </div>
          <button
            onClick={() => {
              if (showForm) {
                setEcgData(null); setEcgPreview(null); setEcgError(null);
                setHrPreview(null); setHrError(null);
              }
              setShowForm(v => !v);
            }}
            className={showForm ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
          >
            {showForm ? 'Cancel' : <><IconPlus /> New activity</>}
          </button>
        </div>

        {/* Inline new-activity form */}
        {showForm && (
          <div className="card animate-scale-in" style={{ borderColor: 'rgba(79,140,255,0.2)' }}>
            <p className="section-label">New activity</p>
            <form onSubmit={handleFormSubmit} style={{ display: 'grid', gap: 10 }}>
              <div className="form-grid">
                <div>
                  <label className="field-label">Title *</label>
                  <input className="input" placeholder="e.g. Morning run" value={formTitle} onChange={e => setFormTitle(e.target.value)} required />
                </div>
                <div>
                  <label className="field-label">Type</label>
                  <select className="input" value={formType} onChange={e => setFormType(e.target.value)}>
                    {ACTIVITY_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {/* ECG file upload */}
              <div className="upload-section">
                <label className="field-label">ECG file (optional — .csv or .txt)</label>
                <input className="input" type="file" accept=".csv,.txt" onChange={handleEcgFile} />
                {ecgPreview && <p className="upload-ok">{ecgPreview}</p>}
                {ecgError   && <p className="upload-err">{ecgError}</p>}
              </div>

              {/* HR file upload */}
              <div className="upload-section">
                <label className="field-label">HR file (optional — .csv)</label>
                <input className="input" type="file" accept=".csv" onChange={handleHrFile} />
                <p className="field-hint">Auto-fills avg HR, max HR, and duration · Polar (HR (bpm)) or Garmin (Heart Rate)</p>
                {hrPreview && <p className="upload-ok">{hrPreview}</p>}
                {hrError   && <p className="upload-err">{hrError}</p>}
              </div>

              <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>— or enter manually</p>

              <div className="form-grid">
                <div>
                  <label className="field-label">Duration (min)</label>
                  <input className="input" type="number" min="0" placeholder="e.g. 45" value={formDur} onChange={e => setFormDur(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Notes</label>
                  <input className="input" placeholder="Optional…" value={formNotes} onChange={e => setFormNotes(e.target.value)} />
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <label className="field-label">Avg HR (bpm)</label>
                  <input className="input" type="number" min="0" placeholder="e.g. 145" value={formHrAvg} onChange={e => setFormHrAvg(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Max HR (bpm)</label>
                  <input className="input" type="number" min="0" placeholder="e.g. 178" value={formHrMax} onChange={e => setFormHrMax(e.target.value)} />
                </div>
              </div>
              {formErr && <p className="message message-error" style={{ fontSize: 13 }}>{formErr}</p>}
              <div>
                <button type="submit" disabled={formBusy} className="btn btn-primary btn-sm">
                  {formBusy ? 'Saving…' : 'Save activity'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Empty state */}
        {activities.length === 0 && (
          <div className="card empty-state">
            No activities yet — click &quot;+ New activity&quot; to log your first session.
          </div>
        )}

        {/* Activity cards */}
        {activities.map(a => {
          const bg = TYPE_BG[a.type]  ?? TYPE_BG.Other;
          const fg = TYPE_FG[a.type]  ?? TYPE_FG.Other;
          return (
            <div
              key={a.id}
              onClick={() => router.push(`/activities/${a.id}`)}
              className="card card-hover"
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', gap: 12, padding: '14px 18px' }}
            >
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{a.title}</span>
                  <span className="badge" style={{ background: bg, color: fg }}>{a.type}</span>
                  {a.source === 'live' && <span className="badge badge-accent">Live</span>}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--muted)', fontSize: 12 }}>
                  <span>{fmtDateTime(a.created_at)}</span>
                  {a.duration_seconds != null && <span>{fmtDuration(a.duration_seconds)}</span>}
                  {a.heart_rate_avg   != null && <span>Avg {a.heart_rate_avg} bpm</span>}
                  {a.heart_rate_max   != null && <span>Max {a.heart_rate_max} bpm</span>}
                  {a.ecg && a.ecg.length > 0  && <span style={{ color: 'var(--accent)' }}>ECG</span>}
                </div>
                {a.notes && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>{a.notes}</p>}
              </div>
              <button
                onClick={(e) => handleDelete(a.id, e)}
                disabled={deleting === a.id}
                className="btn btn-danger btn-icon btn-sm"
                title="Delete activity"
              >
                {deleting === a.id ? '…' : <IconTrash />}
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}
