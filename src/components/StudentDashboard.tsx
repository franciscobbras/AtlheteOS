'use client';

import React from 'react';

function FillBar({ pct, color, height = 5 }: { pct: number; color: string; height?: number }) {
  return (
    <div className="progress-bar" style={{ height }}>
      <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

const STUDY_PLAN = [
  { subject: 'Mathematics',  topic: 'Chapter 5 — Integration',    due: 3,  daily: 1.5, done: 0.8, color: '#4F8CFF' },
  { subject: 'Statistics',   topic: 'Problem Set 4',              due: 5,  daily: 1.0, done: 0.0, color: '#A855F7' },
  { subject: 'Economics',    topic: 'Essay — Market Structures',  due: 7,  daily: 1.2, done: 0.5, color: '#22C55E' },
  { subject: 'Programming',  topic: 'Final Project',              due: 14, daily: 2.0, done: 1.2, color: '#F59E0B' },
];

function urgencyColor(days: number) {
  return days <= 3 ? '#EF4444' : days <= 7 ? '#F59E0B' : 'var(--muted)';
}

export default function StudentDashboard() {
  const plannedHrs   = 15;
  const completedHrs = 8;

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">

      {/* Page title */}
      <div className="page-header">
        <h1 className="page-title">Student</h1>
        <p className="page-subtitle">AI-powered study schedule adapted to your readiness</p>
      </div>

      {/* ══ AI STUDY INTELLIGENCE ══════════════════════════════════════════ */}
      <div className="card" style={{ borderLeft: '3px solid #4F8CFF' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span className="dot dot-success" style={{
            background: '#4F8CFF',
            animation: 'pulse-dot 2s ease-in-out infinite',
          }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: '#4F8CFF', letterSpacing: '0.02em' }}>
            AI Schedule Engine
          </span>
        </div>

        {/* Info rows */}
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          <div className="inner-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Next high-priority deadline</span>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontWeight: 600, color: '#EF4444', fontSize: 13 }}>Mathematics</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>in 3 days</span>
            </div>
          </div>
          <div className="inner-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Recommended study load today</span>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontWeight: 600, color: '#4F8CFF', fontSize: 13 }}>2.5h</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>high readiness (74)</span>
            </div>
          </div>
        </div>

        {/* Weekly progress bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>This week — planned vs completed</span>
            <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 600 }}>{completedHrs}h / {plannedHrs}h</span>
          </div>
          <div style={{ position: 'relative' }}>
            <FillBar pct={(completedHrs / plannedHrs) * 100} color="#4F8CFF" height={8} />
          </div>
        </div>

        {/* Note */}
        <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
          Schedule adapts based on Nexus readiness and stress score
        </p>
      </div>

      {/* ══ STUDY PLAN ═════════════════════════════════════════════════════ */}
      <div className="card">
        <p className="section-label">Study Plan</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {STUDY_PLAN.map(s => (
            <div key={s.subject} className="inner-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 14, color: s.color }}>{s.subject}</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{s.topic}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 600, color: urgencyColor(s.due) }}>
                    {s.due} day{s.due !== 1 ? 's' : ''} left
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>{s.daily}h/day target</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <FillBar pct={(s.done / s.daily) * 100} color={s.color} height={4} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                  {s.done}h / {s.daily}h today
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
