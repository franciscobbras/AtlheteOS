'use client';

import React from 'react';

function scoreColor(v: number) {
  return v >= 67 ? '#22C55E' : v >= 34 ? '#F59E0B' : '#EF4444';
}
function tsbColor(v: number) {
  return v < -20 ? '#EF4444' : v < 0 ? '#F59E0B' : '#22C55E';
}

function ArcRing({ value, max = 100, color, size = 64 }: { value: number; max?: number; color: string; size?: number }) {
  const r = 26, stroke = 4;
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

function Sparkline({ data, color = '#4F8CFF', w = 56, h = 18 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) =>
    `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - mn) / rng) * (h - 4) - 2).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HomeSignalsStrip() {
  const readiness = 74;
  const hrv = 58;
  const hrvSpark = [52, 55, 61, 57, 53, 60, 58];
  const sleepPct = 82;
  const sleepHrs = '7h 20m';
  const tsb = -12;
  const stress = 38;

  const sc: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px 18px',
    minWidth: 150,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };

  const lbl: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    fontWeight: 600,
    margin: 0,
  };

  const bigNum: React.CSSProperties = {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 700,
    lineHeight: 1,
  };

  return (
    <section style={{ margin: '24px 0' }}>
      <p style={{ ...lbl, marginBottom: 10, opacity: 0.6 }}>Today&apos;s signals</p>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div className="stagger" style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>

          {/* Readiness */}
          <div className="animate-slide-up" style={sc}>
            <p style={lbl}>Readiness</p>
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <ArcRing value={readiness} color={scoreColor(readiness)} />
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: scoreColor(readiness) }}>
                {readiness}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>SNC Score</p>
          </div>

          {/* HRV */}
          <div className="animate-slide-up" style={sc}>
            <p style={lbl}>HRV</p>
            <p style={{ ...bigNum, color: '#4F8CFF' }}>
              {hrv}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>ms</span>
            </p>
            <Sparkline data={hrvSpark} color="#4F8CFF" />
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>7-day trend</p>
          </div>

          {/* Sleep Recovery */}
          <div className="animate-slide-up" style={sc}>
            <p style={lbl}>Sleep Recovery</p>
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <ArcRing value={sleepPct} color={scoreColor(sleepPct)} />
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: scoreColor(sleepPct) }}>
                {sleepPct}%
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>{sleepHrs}</p>
          </div>

          {/* TSB */}
          <div className="animate-slide-up" style={sc}>
            <p style={lbl}>TSB</p>
            <p style={{ ...bigNum, color: tsbColor(tsb) }}>
              {tsb > 0 ? `+${tsb}` : tsb}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: tsbColor(tsb) }}>
              {tsb < -20 ? 'High fatigue' : tsb < 0 ? 'Moderate load' : tsb <= 25 ? 'Fresh' : 'Very fresh'}
            </p>
          </div>

          {/* Stress Score */}
          <div className="animate-slide-up" style={sc}>
            <p style={lbl}>Stress Score</p>
            <p style={{ ...bigNum, color: scoreColor(100 - stress) }}>
              {stress}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>/100</span>
            </p>
            <div className="progress-bar" style={{ marginTop: 2 }}>
              <div className="progress-fill" style={{ width: `${stress}%`, background: scoreColor(100 - stress) }} />
            </div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
              {stress <= 33 ? 'Low stress' : stress <= 66 ? 'Moderate' : 'High stress'}
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}
