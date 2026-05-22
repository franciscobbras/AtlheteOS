'use client';

import { useEffect, useMemo, useState } from 'react';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { supabase } from '@/lib/supabaseClient';
import { ewma, weeklyRateOfChange, projectedTarget, macroRatios } from '@/lib/metrics';
import { RDA } from '@/lib/nutrition-targets';

ChartJS.register(
  CategoryScale, LinearScale,
  PointElement, LineElement,
  ArcElement,
  Title, Tooltip, Legend,
);

// ── Constants ────────────────────────────────────────────────────────────────

const TDEE          = 2500;
const WEIGHT_TARGET = 68;

const COLOR = {
  calories: '#F59E0B',
  protein:  '#22C55E',
  carbs:    '#4F8CFF',
  fat:      '#F97316',
  weight:   '#A855F7',
};

// ── Types ────────────────────────────────────────────────────────────────────

type DailyMetric = {
  id:   string;
  date: string;
  calories: number | null;
  protein:  number | null;
  carbs:    number | null;
  fat:      number | null;
  weight:   number | null;
  fiber:               number | null;
  dietary_sugar:       number | null;
  cholesterol:         number | null;
  saturated_fat:       number | null;
  polyunsaturated_fat: number | null;
  monounsaturated_fat: number | null;
  vitamin_a:        number | null;
  vitamin_b6:       number | null;
  vitamin_b12:      number | null;
  vitamin_c:        number | null;
  vitamin_d:        number | null;
  vitamin_e:        number | null;
  vitamin_k:        number | null;
  thiamin:          number | null;
  riboflavin:       number | null;
  niacin:           number | null;
  pantothenic_acid: number | null;
  folate:           number | null;
  calcium:    number | null;
  iron:       number | null;
  copper:     number | null;
  magnesium:  number | null;
  manganese:  number | null;
  phosphorus: number | null;
  potassium:  number | null;
  selenium:   number | null;
  sodium:     number | null;
  zinc:       number | null;
  caffeine: number | null;
  water:    number | null;
};

// ── Nutrient group definitions ────────────────────────────────────────────────

type NutrientDef = { key: keyof DailyMetric; label: string; unit: string; rda?: number };

const MACRO_DETAIL: NutrientDef[] = [
  { key: 'fiber',               label: 'Fiber',               unit: 'g',  rda: RDA.fiber.value          },
  { key: 'dietary_sugar',       label: 'Dietary Sugar',       unit: 'g'                                  },
  { key: 'cholesterol',         label: 'Cholesterol',         unit: 'mg', rda: RDA.cholesterol.value     },
  { key: 'saturated_fat',       label: 'Saturated Fat',       unit: 'g'                                  },
  { key: 'polyunsaturated_fat', label: 'Polyunsaturated Fat', unit: 'g'                                  },
  { key: 'monounsaturated_fat', label: 'Monounsaturated Fat', unit: 'g'                                  },
];

const VITAMINS: NutrientDef[] = [
  { key: 'vitamin_a',        label: 'Vitamin A',        unit: 'mcg', rda: RDA.vitamin_a.value        },
  { key: 'vitamin_b6',       label: 'Vitamin B6',       unit: 'mg',  rda: RDA.vitamin_b6.value       },
  { key: 'vitamin_b12',      label: 'Vitamin B12',      unit: 'mcg', rda: RDA.vitamin_b12.value      },
  { key: 'vitamin_c',        label: 'Vitamin C',        unit: 'mg',  rda: RDA.vitamin_c.value        },
  { key: 'vitamin_d',        label: 'Vitamin D',        unit: 'mcg', rda: RDA.vitamin_d.value        },
  { key: 'vitamin_e',        label: 'Vitamin E',        unit: 'mg',  rda: RDA.vitamin_e.value        },
  { key: 'vitamin_k',        label: 'Vitamin K',        unit: 'mcg', rda: RDA.vitamin_k.value        },
  { key: 'thiamin',          label: 'Thiamin',          unit: 'mg',  rda: RDA.thiamin.value          },
  { key: 'riboflavin',       label: 'Riboflavin',       unit: 'mg',  rda: RDA.riboflavin.value       },
  { key: 'niacin',           label: 'Niacin',           unit: 'mg',  rda: RDA.niacin.value           },
  { key: 'pantothenic_acid', label: 'Pantothenic Acid', unit: 'mg',  rda: RDA.pantothenic_acid.value },
  { key: 'folate',           label: 'Folate',           unit: 'mcg', rda: RDA.folate.value           },
];

const MINERALS: NutrientDef[] = [
  { key: 'calcium',    label: 'Calcium',    unit: 'mg',  rda: RDA.calcium.value    },
  { key: 'iron',       label: 'Iron',       unit: 'mg',  rda: RDA.iron.value       },
  { key: 'copper',     label: 'Copper',     unit: 'mg',  rda: RDA.copper.value     },
  { key: 'magnesium',  label: 'Magnesium',  unit: 'mg',  rda: RDA.magnesium.value  },
  { key: 'manganese',  label: 'Manganese',  unit: 'mg',  rda: RDA.manganese.value  },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg',  rda: RDA.phosphorus.value },
  { key: 'potassium',  label: 'Potassium',  unit: 'mg',  rda: RDA.potassium.value  },
  { key: 'selenium',   label: 'Selenium',   unit: 'mcg', rda: RDA.selenium.value   },
  { key: 'sodium',     label: 'Sodium',     unit: 'mg',  rda: RDA.sodium.value     },
  { key: 'zinc',       label: 'Zinc',       unit: 'mg',  rda: RDA.zinc.value       },
];

const OTHER_NUTRIENTS: NutrientDef[] = [
  { key: 'caffeine', label: 'Caffeine', unit: 'mg', rda: RDA.caffeine.value },
  { key: 'water',    label: 'Water',    unit: 'mL', rda: RDA.water.value    },
];

const TREND_NUTRIENTS: Array<{ key: keyof DailyMetric; label: string; unit: string; color: string; rda: number }> = [
  { key: 'fiber',     label: 'Fiber',     unit: 'g',  color: '#22C55E', rda: RDA.fiber.value     },
  { key: 'vitamin_c', label: 'Vitamin C', unit: 'mg', color: '#F59E0B', rda: RDA.vitamin_c.value },
  { key: 'calcium',   label: 'Calcium',   unit: 'mg', color: '#4F8CFF', rda: RDA.calcium.value   },
  { key: 'iron',      label: 'Iron',      unit: 'mg', color: '#EF4444', rda: RDA.iron.value      },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', color: '#A855F7', rda: RDA.magnesium.value },
];

const WEEKLY_COLS: Array<{ key: keyof DailyMetric; label: string; unit: string; rda: number }> = [
  { key: 'fiber',     label: 'Fiber',     unit: 'g',   rda: RDA.fiber.value     },
  { key: 'sodium',    label: 'Sodium',    unit: 'mg',  rda: RDA.sodium.value    },
  { key: 'calcium',   label: 'Calcium',   unit: 'mg',  rda: RDA.calcium.value   },
  { key: 'iron',      label: 'Iron',      unit: 'mg',  rda: RDA.iron.value      },
  { key: 'vitamin_c', label: 'Vit C',     unit: 'mg',  rda: RDA.vitamin_c.value },
  { key: 'vitamin_d', label: 'Vit D',     unit: 'mcg', rda: RDA.vitamin_d.value },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg',  rda: RDA.magnesium.value },
];

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(date: string) {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function avgOf(vals: (number | null)[]): number | null {
  const valid = vals.filter((v): v is number => v != null);
  if (!valid.length) return null;
  return +(valid.reduce((s, v) => s + v, 0) / valid.length).toFixed(1);
}

function rdaColor(val: number | null, rda: number): string {
  if (val == null) return TICK;
  const pct = (val / rda) * 100;
  if (pct >= 80) return '#22C55E';
  if (pct >= 40) return '#F59E0B';
  return '#EF4444';
}

function barFill(pct: number | null): string {
  if (pct == null) return 'var(--surface-active)';
  if (pct >= 80)   return '#22C55E';
  if (pct >= 40)   return '#F59E0B';
  return '#EF4444';
}

// ── MicronutrientCard ─────────────────────────────────────────────────────────

function MicronutrientCard({
  label, value, unit, rda,
}: {
  label: string;
  value: number | null;
  unit: string;
  rda?: number;
}) {
  const pct = rda != null && value != null ? (value / rda) * 100 : null;
  const bc  = barFill(pct);

  return (
    <div className="inner-card" style={{ padding: '12px 14px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
        {label}
      </p>
      <p style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: value != null ? 'var(--text)' : 'var(--muted)', lineHeight: 1.1 }}>
        {value != null ? value.toLocaleString() : '—'}
        {value != null && (
          <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>{unit}</span>
        )}
      </p>
      {rda != null && (
        <>
          <div className="progress-bar" style={{ height: 3 }}>
            <div className="progress-fill" style={{ width: `${Math.min(pct ?? 0, 100)}%`, background: bc }} />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: pct != null ? bc : 'var(--muted)' }}>
            {pct != null ? `${Math.round(pct)}%` : '—'}
            <span style={{ color: 'var(--muted)', opacity: 0.6 }}> / {rda.toLocaleString()} {unit}</span>
          </p>
        </>
      )}
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  label, value, unit, color, progress, sub,
}: {
  label: string;
  value: number | null;
  unit: string;
  color: string;
  progress?: number;
  sub?: string;
}) {
  return (
    <div className="stat-card animate-slide-up">
      <p className="stat-card-label">{label}</p>
      <p className="stat-card-value" style={{ color }}>
        {value != null ? value.toLocaleString() : '—'}
        {value != null && <span className="stat-card-unit">{unit}</span>}
      </p>
      {progress != null && value != null && (
        <div style={{ marginTop: 12 }}>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%`, background: color }} />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)' }}>
            {Math.round(progress)}% of {TDEE.toLocaleString()} kcal target
          </p>
        </div>
      )}
      {sub && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NutritionDashboard() {
  const [rows, setRows]     = useState<DailyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [alpha, setAlpha]   = useState(0.15);
  const [activeTrends, setActiveTrends] = useState(
    () => new Set(['fiber', 'vitamin_c', 'calcium', 'iron', 'magnesium']),
  );

  useEffect(() => {
    supabase
      .from('daily_metrics')
      .select('*')
      .order('date', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setRows((data as DailyMetric[]) ?? []);
        setLoading(false);
      });
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const latest = rows[rows.length - 1] ?? null;

  const ewmaTrend = useMemo(
    () => ewma(rows.map(r => r.weight), alpha),
    [rows, alpha],
  );

  const currentTrend = useMemo(() => {
    const valid = ewmaTrend.filter(v => !isNaN(v));
    const last  = valid[valid.length - 1];
    return last != null ? +last.toFixed(1) : null;
  }, [ewmaTrend]);

  const latestWeeklyRate = useMemo(() => {
    const roc   = weeklyRateOfChange(ewmaTrend);
    const valid = roc.filter((v): v is number => v !== null);
    return valid[valid.length - 1] ?? null;
  }, [ewmaTrend]);

  const projectedDate = useMemo(
    () => projectedTarget(ewmaTrend, WEIGHT_TARGET),
    [ewmaTrend],
  );

  const weightRows = rows.filter(r => r.weight != null);
  const tableRows  = [...rows].reverse().slice(0, 14);
  const last30     = useMemo(() => rows.slice(-30), [rows]);

  // Weekly averages — last 4 Monday-anchored weeks
  const weeklyAverages = useMemo(() => {
    const buckets: Record<string, DailyMetric[]> = {};
    rows.forEach(r => {
      const ws = getWeekStart(new Date(r.date));
      if (!buckets[ws]) buckets[ws] = [];
      buckets[ws].push(r);
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 4)
      .map(([ws, dayRows]) => {
        const entry: Record<string, string | number | null> = { weekStart: ws };
        for (const c of WEEKLY_COLS) {
          entry[c.key as string] = avgOf(dayRows.map(r => r[c.key] as number | null));
        }
        return entry;
      });
  }, [rows]);

  // ── Chart data ────────────────────────────────────────────────────────────

  const weightLineData = {
    labels: rows.map(r => fmtDate(r.date)),
    datasets: [
      {
        label:                'Daily weight',
        data:                 rows.map(r => r.weight),
        showLine:             false,
        pointRadius:          3,
        pointBackgroundColor: 'rgba(161,161,169,0.3)',
        pointBorderColor:     'transparent',
        spanGaps:             false,
      },
      {
        label:           'Trend',
        data:            ewmaTrend,
        borderColor:     COLOR.weight,
        backgroundColor: 'transparent',
        fill:            false,
        tension:         0.4,
        pointRadius:     0,
        borderWidth:     2,
        spanGaps:        false,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weightLineOptions: any = {
    responsive: true,
    plugins: {
      legend:  { display: false },
      tooltip: { callbacks: { label: (ctx: { parsed: { y: number } }) => ` ${ctx.parsed.y} kg` } },
    },
    scales: { x: darkAxisX, y: darkAxis },
  };

  const hasMacros = latest && (latest.protein || latest.carbs || latest.fat);
  const ratios    = hasMacros
    ? macroRatios(latest!.protein ?? 0, latest!.carbs ?? 0, latest!.fat ?? 0)
    : null;

  const doughnutData = {
    labels: ratios
      ? [`Protein ${ratios.proteinPct}%`, `Carbs ${ratios.carbsPct}%`, `Fat ${ratios.fatPct}%`]
      : ['Protein', 'Carbs', 'Fat'],
    datasets: [{
      data:            [(latest?.protein ?? 0) * 4, (latest?.carbs ?? 0) * 4, (latest?.fat ?? 0) * 9],
      backgroundColor: [COLOR.protein, COLOR.carbs, COLOR.fat],
      borderColor:     'var(--surface)',
      borderWidth:     2,
      hoverOffset:     4,
    }],
  };

  const doughnutOptions = {
    responsive: true,
    cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { color: TICK, boxWidth: 10, padding: 14, font: { size: 11 } },
      },
    },
  };

  // Trend chart
  const trendDatasets = useMemo(() => {
    const nutrientLines = TREND_NUTRIENTS
      .filter(n => activeTrends.has(n.key as string))
      .map(n => ({
        label:                `${n.label} (${n.unit})`,
        data:                 last30.map(r => {
          const v = r[n.key] as number | null;
          return v != null ? +((v / n.rda) * 100).toFixed(1) : null;
        }),
        borderColor:          n.color,
        backgroundColor:      'transparent',
        borderWidth:          2,
        tension:              0.3,
        pointRadius:          2,
        pointBackgroundColor: n.color,
        spanGaps:             false,
      }));
    return [
      ...nutrientLines,
      {
        label:           '100% RDA',
        data:            last30.map(() => 100),
        borderColor:     'rgba(255,255,255,0.12)',
        backgroundColor: 'transparent',
        borderDash:      [5, 5],
        borderWidth:     1,
        pointRadius:     0,
        tension:         0,
        spanGaps:        true,
      },
    ];
  }, [activeTrends, last30]);

  const trendChartData = useMemo(() => ({
    labels:   last30.map(r => fmtDate(r.date)),
    datasets: trendDatasets,
  }), [last30, trendDatasets]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendOptions: any = {
    responsive: true,
    plugins: {
      legend:  { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label: string }; parsed: { y: number } }) =>
            ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(0)}%`,
        },
      },
    },
    scales: {
      x: darkAxisX,
      y: {
        ...darkAxis,
        min:   0,
        ticks: { ...darkAxis.ticks, callback: (v: unknown) => `${v}%` },
      },
    },
  };

  function toggleTrend(key: string) {
    setActiveTrends(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else { next.add(key); }
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="empty-state">Loading…</div>;
  if (error)   return <div className="message message-error">{error}</div>;

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">

      {/* Page title */}
      <div className="page-header">
        <h1 className="page-title">Nutrition</h1>
        <p className="page-subtitle">MacroFactor sync — daily macros, calories &amp; body weight</p>
      </div>

      {/* ── Row 1: stat cards ──────────────────────────────────────────── */}
      <div className="stat-grid stagger" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <StatCard label="Calories" value={latest?.calories ?? null} unit="kcal" color={COLOR.calories}
          progress={latest?.calories != null ? (latest.calories / TDEE) * 100 : undefined} />
        <StatCard label="Protein" value={latest?.protein ?? null} unit="g" color={COLOR.protein} />
        <StatCard label="Carbs"   value={latest?.carbs   ?? null} unit="g" color={COLOR.carbs}   />
        <StatCard label="Fat"     value={latest?.fat     ?? null} unit="g" color={COLOR.fat}     />
        <StatCard label="Weight"  value={latest?.weight  ?? null} unit="kg" color={COLOR.weight} />
      </div>

      {/* ── Row 2: weight line + doughnut ─────────────────────────────── */}
      <div className="chart-grid">
        <div className="card">
          <p className="section-label">Weight over time</p>
          <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Trend smoothing</span>
              <input type="range" className="slider" min={0.10} max={0.20} step={0.01}
                value={alpha} onChange={e => setAlpha(parseFloat(e.target.value))} style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: COLOR.weight, fontWeight: 600, whiteSpace: 'nowrap' }}>
                α = {alpha.toFixed(2)}&thinsp;(N ≈ {Math.round((2 / alpha) - 1)} days)
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--muted)' }}>lower = smoother, higher = more reactive</p>
          </div>
          {weightRows.length === 0
            ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>No weight data recorded.</p>
            : <Line data={weightLineData} options={weightLineOptions} />
          }
          {currentTrend != null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>EWMA trend</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLOR.weight }}>{currentTrend} kg</p>
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>Weekly change</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: latestWeeklyRate == null ? 'var(--muted)' : latestWeeklyRate <= 0 ? '#22C55E' : '#F97316' }}>
                  {latestWeeklyRate != null ? `${latestWeeklyRate >= 0 ? '+' : ''}${latestWeeklyRate} kg/wk` : '—'}
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>Target {WEIGHT_TARGET} kg</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--muted)' }}>{projectedDate}</p>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <p className="section-label">Macro split — latest entry</p>
          {hasMacros
            ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Doughnut data={doughnutData} options={doughnutOptions} />
              </div>
            : <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>No macro data.</p>
          }
        </div>
      </div>

      {/* ── Row 3: last 14 days table ──────────────────────────────────── */}
      <div className="card">
        <p className="section-label">Last 14 days</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {['Date', 'Calories', 'Protein', 'Carbs', 'Fat', 'Weight'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(r => (
                <tr key={r.id}>
                  <td style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtDate(r.date)}</td>
                  <td style={{ color: COLOR.calories }}>{r.calories != null ? `${r.calories.toLocaleString()} kcal` : '—'}</td>
                  <td style={{ color: COLOR.protein  }}>{r.protein  != null ? `${r.protein} g`  : '—'}</td>
                  <td style={{ color: COLOR.carbs    }}>{r.carbs    != null ? `${r.carbs} g`    : '—'}</td>
                  <td style={{ color: COLOR.fat      }}>{r.fat      != null ? `${r.fat} g`      : '—'}</td>
                  <td style={{ color: COLOR.weight   }}>{r.weight   != null ? `${r.weight} kg`  : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════════════ MICRONUTRIENTS ══════════════ */}

      <div className="page-header" style={{ marginBottom: 0 }}>
        <h2 className="page-title" style={{ fontSize: 16 }}>Micronutrients</h2>
        <p className="page-subtitle">Today&#39;s intake vs daily targets — progress bar: green ≥80%, amber 40–80%, red &lt;40%</p>
      </div>

      {/* ── Macronutrient detail ───────────────────────────────────────── */}
      <div className="card">
        <p className="section-label" style={{ opacity: 0.7 }}>Macronutrient detail</p>
        <div className="micro-grid">
          {MACRO_DETAIL.map(n => (
            <MicronutrientCard key={n.key} label={n.label} unit={n.unit} rda={n.rda}
              value={latest ? (latest[n.key] as number | null) : null} />
          ))}
        </div>
      </div>

      {/* ── Vitamins ──────────────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label" style={{ opacity: 0.7 }}>Vitamins</p>
        <div className="micro-grid">
          {VITAMINS.map(n => (
            <MicronutrientCard key={n.key} label={n.label} unit={n.unit} rda={n.rda}
              value={latest ? (latest[n.key] as number | null) : null} />
          ))}
        </div>
      </div>

      {/* ── Minerals ──────────────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label" style={{ opacity: 0.7 }}>Minerals</p>
        <div className="micro-grid">
          {MINERALS.map(n => (
            <MicronutrientCard key={n.key} label={n.label} unit={n.unit} rda={n.rda}
              value={latest ? (latest[n.key] as number | null) : null} />
          ))}
        </div>
      </div>

      {/* ── Other ─────────────────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label" style={{ opacity: 0.7 }}>Other</p>
        <div className="micro-grid">
          {OTHER_NUTRIENTS.map(n => (
            <MicronutrientCard key={n.key} label={n.label} unit={n.unit} rda={n.rda}
              value={latest ? (latest[n.key] as number | null) : null} />
          ))}
        </div>
      </div>

      {/* ── Trends — last 30 days ──────────────────────────────────────── */}
      <div className="card">
        <p className="section-label">Micronutrient trends — last 30 days (% of RDA)</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {TREND_NUTRIENTS.map(n => {
            const active = activeTrends.has(n.key as string);
            return (
              <button key={n.key} onClick={() => toggleTrend(n.key as string)} className="btn btn-sm" style={{
                height: 28,
                border:      `1px solid ${active ? n.color : 'var(--border)'}`,
                background:  active ? `${n.color}18` : 'transparent',
                color:       active ? n.color : 'var(--muted)',
              }}>
                {n.label}
              </button>
            );
          })}
          <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginLeft: 4 }}>
            dashed line = 100% RDA
          </span>
        </div>
        {last30.length === 0
          ? <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>No data in the last 30 days.</p>
          : <Line data={trendChartData} options={trendOptions} />
        }
      </div>

      {/* ── Weekly averages ────────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label">Weekly averages — last 4 weeks</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Week</th>
                {WEEKLY_COLS.map(c => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {weeklyAverages.length === 0 ? (
                <tr>
                  <td colSpan={WEEKLY_COLS.length + 1} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                    No data yet.
                  </td>
                </tr>
              ) : weeklyAverages.map(w => (
                <tr key={w.weekStart as string}>
                  <td style={{ color: 'var(--text)', fontWeight: 600 }}>
                    {new Date(w.weekStart as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </td>
                  {WEEKLY_COLS.map(c => {
                    const val   = w[c.key as string] as number | null;
                    const color = rdaColor(val, c.rda);
                    return (
                      <td key={c.key} style={{ color }}>
                        {val != null ? `${val} ${c.unit}` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
