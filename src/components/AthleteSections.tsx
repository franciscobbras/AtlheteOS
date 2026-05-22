'use client';

import { useState } from 'react';
import React from 'react';

// ── Mini chart helpers ────────────────────────────────────────────────────────

function MiniSparkline({ data, color = '#F59E0B', w = 64, h = 18 }: { data: number[]; color?: string; w?: number; h?: number }) {
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

function TRIMPBars({ data }: { data: number[] }) {
  const mx = Math.max(...data, 1);
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 36, marginTop: 8 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{
            width: '100%',
            height: `${Math.max(Math.round((v / mx) * 28), 2)}px`,
            background: i === data.length - 1 ? '#F59E0B' : 'rgba(245,158,11,0.25)',
            borderRadius: 3,
          }} />
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{days[i]}</span>
        </div>
      ))}
    </div>
  );
}

function ZonesBar({ pcts }: { pcts: number[] }) {
  const colors = ['#4F8CFF', '#22C55E', '#F59E0B', '#F97316', '#EF4444'];
  const labels = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
        {pcts.map((p, i) => <div key={i} style={{ width: `${p}%`, background: colors[i] }} />)}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        {pcts.map((p, i) => (
          <span key={i} style={{ fontSize: 9, color: colors[i] }}>{labels[i]} {p}%</span>
        ))}
      </div>
    </div>
  );
}

function SleepBar({ rem, deep, light }: { rem: number; deep: number; light: number }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', height: 5, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${rem}%`, background: '#8B5CF6' }} />
        <div style={{ width: `${deep}%`, background: '#4F8CFF' }} />
        <div style={{ width: `${light}%`, background: '#71717A' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 9, color: '#8B5CF6' }}>REM {rem}%</span>
        <span style={{ fontSize: 9, color: '#4F8CFF' }}>Deep {deep}%</span>
        <span style={{ fontSize: 9, color: 'var(--muted)' }}>Light {light}%</span>
      </div>
    </div>
  );
}

function IC({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="inner-card">
      <p style={{ margin: '0 0 8px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{title}</p>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="collapsible">
      <button className="collapsible-trigger" onClick={() => setOpen(v => !v)}>
        <span className="collapsible-title">{title}</span>
        <svg className={`collapsible-chevron ${open ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

function tsbColor(v: number) { return v < -20 ? '#EF4444' : v < 0 ? '#F59E0B' : '#22C55E'; }
function scoreColor(v: number) { return v >= 67 ? '#22C55E' : v >= 34 ? '#F59E0B' : '#EF4444'; }

const VAL: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1.1,
};

// ── Section 1 — Daily Readiness ───────────────────────────────────────────────

export function DailyReadinessSection() {
  return (
    <Section title="Daily Readiness">
      <div className="micro-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>

        <IC title="HRV">
          <p style={VAL}>58<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>ms</span></p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#22C55E' }}>↑ +4 ms vs 7-day avg</p>
        </IC>

        <IC title="HRV CV — Coeff. of Variation">
          <p style={VAL}>8.2<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>%</span></p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>Low variability</p>
        </IC>

        <IC title="RHR — Resting Heart Rate">
          <p style={VAL}>52<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>bpm</span></p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#22C55E' }}>−2 vs 7-day avg</p>
        </IC>

        <IC title="SNC / Prontidão">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="dot dot-success" />
            <p style={{ ...VAL, margin: 0 }}>7.4<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>/10</span></p>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)' }}>Ready to train</p>
        </IC>

        <IC title="Sleep">
          <p style={VAL}>7h 20m</p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>Efficiency 89%</p>
          <SleepBar rem={22} deep={18} light={60} />
        </IC>

        <IC title="Risco de Lesão">
          <span className="badge badge-warning">Moderate</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
            <span className="badge">Load spike</span>
            <span className="badge">Asymmetry</span>
          </div>
        </IC>

        <IC title="Cinética de Recuperação da FC">
          <p style={VAL}>−32<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>bpm/min</span></p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>60s post-workout</p>
        </IC>

        <IC title="Rácio LF/HF">
          <p style={VAL}>1.8</p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#4F8CFF' }}>Parasympathetic dominant</p>
        </IC>

      </div>
    </Section>
  );
}

// ── Section 2 — Load Management ───────────────────────────────────────────────

export function LoadManagementSection() {
  const trimp7 = [45, 68, 52, 70, 38, 90, 68];
  const tsb = -12, stress = 38;
  return (
    <Section title="Load Management">
      <div className="micro-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>

        <IC title="CTL — Chronic Training Load">
          <p style={VAL}>52</p>
          <MiniSparkline data={[44, 46, 48, 49, 50, 51, 52]} color="#4F8CFF" />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>↗ Building phase</p>
        </IC>

        <IC title="ATL — Acute Training Load">
          <p style={VAL}>64</p>
          <MiniSparkline data={[55, 70, 60, 72, 65, 68, 64]} color="#F59E0B" />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>↘ Post-peak</p>
        </IC>

        <IC title="TSB — Training Stress Balance">
          <p style={{ ...VAL, color: tsbColor(tsb) }}>{tsb > 0 ? `+${tsb}` : tsb}</p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: tsbColor(tsb) }}>Moderate fatigue</p>
        </IC>

        <IC title="TRIMP — Today">
          <p style={VAL}>68</p>
          <TRIMPBars data={trimp7} />
        </IC>

        <IC title="FC Máxima">
          <p style={VAL}>192<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>bpm</span></p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>Last measured 15 Apr 2026</p>
        </IC>

        <IC title="Tempo em Zonas">
          <ZonesBar pcts={[35, 30, 20, 12, 3]} />
        </IC>

        <IC title="Carga Externa Mecânica">
          <p style={VAL}>847<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>AU</span></p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>↑ 124 acc &nbsp;·&nbsp; ↓ 118 dec</p>
        </IC>

        <IC title="Stress Score">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
              <ArcMini value={stress} color={scoreColor(100 - stress)} />
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: scoreColor(100 - stress) }}>
                {stress}
              </span>
            </div>
            <div>
              <p style={{ ...VAL, fontSize: 16 }}>{stress}/100</p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--muted)' }}>Low stress</p>
            </div>
          </div>
        </IC>

      </div>
    </Section>
  );
}

// ── Section 3 — Advanced / Periodic ──────────────────────────────────────────

export function AdvancedSection() {
  return (
    <Section title="Advanced / Periodic">
      <div className="micro-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>

        <IC title="VO2max">
          <p style={VAL}>52.4<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>ml/kg/min</span></p>
          <div style={{ marginTop: 6 }}><span className="badge badge-success">Good</span></div>
        </IC>

        <IC title="ECG">
          <span className="badge badge-success">Clean</span>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)' }}>Last upload 18 Apr 2026</p>
        </IC>

        <IC title="Rácio LF/HF — Detail">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 9, color: 'var(--muted)' }}>LF</p>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>1240<span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 2 }}>ms²</span></p>
            </div>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 9, color: 'var(--muted)' }}>HF</p>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>690<span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 2 }}>ms²</span></p>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>Ratio 1.80 — parasympathetic</p>
        </IC>

        <IC title="EA — Energy Availability">
          <p style={VAL}>37<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kcal/kg FFM/day</span></p>
          <div style={{ marginTop: 6 }}><span className="badge badge-success">Adequate</span></div>
        </IC>

        <IC title="Peso">
          <p style={VAL}>73.2<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kg</span></p>
          <MiniSparkline data={[74.1, 73.8, 73.9, 73.5, 73.4, 73.3, 73.2]} color="#A855F7" />
        </IC>

        <IC title="FFM — Fat-Free Mass">
          <p style={VAL}>62.8<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>kg</span></p>
          <div style={{ marginTop: 6 }}><span className="badge">DEXA scan</span></div>
        </IC>

      </div>
    </Section>
  );
}
