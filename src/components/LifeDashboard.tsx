'use client';

import { useState } from 'react';
import Link from 'next/link';
import React from 'react';

// ── Mini helpers ──────────────────────────────────────────────────────────────

function MiniSparkline({ data, color = '#A855F7', w = 80, h = 22 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) =>
    `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - mn) / rng) * (h - 4) - 2).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block', marginTop: 6 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArcMini({ value, max = 100, color, size = 48 }: { value: number; max?: number; color: string; size?: number }) {
  const r = 18, stroke = 4;
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const arcLen = 0.75 * C;
  const filled = Math.min(value / max, 1) * arcLen;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-active)"
        strokeWidth={stroke} strokeDasharray={`${arcLen.toFixed(1)} ${(C - arcLen).toFixed(1)}`}
        strokeLinecap="round" transform={`rotate(135, ${cx}, ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeDasharray={`${filled.toFixed(1)} ${(C - filled).toFixed(1)}`}
        strokeLinecap="round" transform={`rotate(135, ${cx}, ${cy})`} />
    </svg>
  );
}

function FillBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress-bar" style={{ marginTop: 6 }}>
      <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function scoreColor(v: number) { return v >= 67 ? '#22C55E' : v >= 34 ? '#F59E0B' : '#EF4444'; }

// ── Types ─────────────────────────────────────────────────────────────────────

type Goal = { id: number; text: string; category: string; done: boolean };

const INITIAL_GOALS: Goal[] = [
  { id: 1, text: 'Run 5 km in under 25 minutes', category: 'Athlete', done: false },
  { id: 2, text: 'Read 1 book per month',        category: 'Life',    done: true  },
  { id: 3, text: 'Sleep 7+ hours consistently',  category: 'Health',  done: false },
  { id: 4, text: 'Meditate 10 min daily',        category: 'Wellbeing', done: false },
];

const CATEGORIES = ['Athlete', 'Student', 'Life', 'Health', 'Wellbeing', 'Finance'];

const CAT_COLOR: Record<string, string> = {
  Athlete:  '#F59E0B',
  Student:  '#4F8CFF',
  Life:     '#22C55E',
  Health:   '#22C55E',
  Wellbeing:'#A855F7',
  Finance:  '#F97316',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function LifeDashboard() {
  const [goals, setGoals] = useState<Goal[]>(INITIAL_GOALS);
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat]   = useState('Life');

  function addGoal() {
    if (!newText.trim()) return;
    setGoals(prev => [...prev, { id: Date.now(), text: newText.trim(), category: newCat, done: false }]);
    setNewText('');
  }

  function toggleGoal(id: number) {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, done: !g.done } : g));
  }

  function deleteGoal(id: number) {
    setGoals(prev => prev.filter(g => g.id !== id));
  }

  const stress = 38;
  const weightSpark = [74.1, 73.8, 73.9, 73.5, 73.4, 73.3, 73.2,
                       73.0, 73.1, 72.9, 73.0, 72.8, 72.9, 72.7];

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">

      {/* Page title */}
      <div className="page-header">
        <h1 className="page-title">Life</h1>
        <p className="page-subtitle">Nutrition, wellbeing, and personal goals in one place</p>
      </div>

      {/* ══ NUTRITION ══════════════════════════════════════════════════════ */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p className="section-label" style={{ margin: 0 }}>Nutrition</p>
          <Link href="/nutrition" className="btn btn-sm btn-secondary">
            See full nutrition →
          </Link>
        </div>

        <div className="micro-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>

          {/* TDEE */}
          <div className="inner-card">
            <p style={{ margin: '0 0 6px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>TDEE</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>2 480<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kcal/day</span></p>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', height: 5, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
                <div title="BMR" style={{ width: '58%', background: '#4F8CFF' }} />
                <div title="Activity" style={{ width: '30%', background: '#22C55E' }} />
                <div title="TEF" style={{ width: '12%', background: '#F59E0B' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 10, color: '#4F8CFF' }}>BMR 58%</span>
                <span style={{ fontSize: 10, color: '#22C55E' }}>Activity 30%</span>
                <span style={{ fontSize: 10, color: '#F59E0B' }}>TEF 12%</span>
              </div>
            </div>
          </div>

          {/* EA */}
          <div className="inner-card">
            <p style={{ margin: '0 0 6px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>EA — Energy Availability</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>37<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kcal/kg FFM/day</span></p>
            <div style={{ marginTop: 6 }}><span className="badge badge-success">Adequate</span></div>
          </div>

          {/* Macros */}
          <div className="inner-card" style={{ gridColumn: 'span 2' }}>
            <p style={{ margin: '0 0 8px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Macros — today</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { name: 'Protein', v: 158, target: 180, unit: 'g', color: '#22C55E' },
                { name: 'Carbs',   v: 240, target: 280, unit: 'g', color: '#4F8CFF' },
                { name: 'Fat',     v:  68, target:  80, unit: 'g', color: '#F97316' },
                { name: 'Calories',v:2240, target:2480, unit:'kcal',color: '#F59E0B' },
              ].map(m => (
                <div key={m.name}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{m.name}</p>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: m.color }}>
                    {m.v.toLocaleString()}<span style={{ fontSize: 10, marginLeft: 2, color: 'var(--muted)' }}>{m.unit}</span>
                  </p>
                  <FillBar pct={(m.v / m.target) * 100} color={m.color} />
                  <p style={{ margin: '3px 0 0', fontSize: 10, color: 'var(--muted)' }}>
                    {Math.round((m.v / m.target) * 100)}% of {m.target.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Weight */}
          <div className="inner-card">
            <p style={{ margin: '0 0 6px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Weight</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>72.7<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kg</span>
              <span style={{ fontSize: 12, color: '#22C55E', marginLeft: 6 }}>↓</span>
            </p>
            <MiniSparkline data={weightSpark} color="#A855F7" w={100} />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>14-day trend</p>
          </div>

        </div>
      </div>

      {/* ══ WELLBEING ══════════════════════════════════════════════════════ */}
      <div className="card">
        <p className="section-label">Wellbeing</p>
        <div className="micro-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>

          {/* Stress Score */}
          <div className="inner-card">
            <p style={{ margin: '0 0 8px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Stress Score</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
                <ArcMini value={stress} color={scoreColor(100 - stress)} />
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: scoreColor(100 - stress) }}>
                  {stress}
                </span>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{stress}/100</p>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--muted)' }}>Low stress</p>
              </div>
            </div>
          </div>

          {/* FFM Control */}
          <div className="inner-card">
            <p style={{ margin: '0 0 6px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>FFM Control</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>62.8<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kg</span></p>
            <p style={{ margin: '4px 0 4px', fontSize: 11, color: 'var(--muted)' }}>Measured 18 Apr 2026</p>
            <span className="badge">DEXA scan</span>
          </div>

          {/* Sleep summary */}
          <div className="inner-card">
            <p style={{ margin: '0 0 6px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Sleep</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>7h 20m</p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#22C55E' }}>Good quality · 89% efficiency</p>
          </div>

        </div>
      </div>

      {/* ══ GOALS ══════════════════════════════════════════════════════════ */}
      <div className="card">
        <p className="section-label">Goals</p>

        {/* Goal list */}
        <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
          {goals.map(g => (
            <div key={g.id} className="inner-card" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              opacity: g.done ? 0.5 : 1,
              transition: 'opacity 0.2s',
            }}>
              <button onClick={() => toggleGoal(g.id)} style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                border: `2px solid ${g.done ? '#22C55E' : 'var(--border-hover)'}`,
                background: g.done ? '#22C55E' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}>
                {g.done && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
              </button>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', textDecoration: g.done ? 'line-through' : 'none' }}>
                {g.text}
              </span>
              <span className="badge" style={{
                background: `${CAT_COLOR[g.category] ?? 'var(--muted)'}18`,
                color: CAT_COLOR[g.category] ?? 'var(--muted)',
              }}>
                {g.category}
              </span>
              <button onClick={() => deleteGoal(g.id)} className="btn btn-ghost btn-icon btn-sm" style={{ opacity: 0.4, width: 24, height: 24 }}>
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Add goal form */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Add a new goal…"
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addGoal()}
          />
          <select
            className="input"
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            style={{ width: 130 }}
          >
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <button onClick={addGoal} className="btn btn-primary btn-sm">
            + Add
          </button>
        </div>

        {/* AI square */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            width: 72, height: 72, borderRadius: 'var(--radius-lg)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>AI</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.05em' }}>SOON</span>
          </div>
        </div>
      </div>

    </div>
  );
}
