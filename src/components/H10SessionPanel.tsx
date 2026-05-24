'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  PointElement, LineElement,
  Title, Tooltip,
} from 'chart.js';
import { usePolarH10Context } from '../contexts/PolarH10Context';
import type { SessionData } from '../hooks/usePolarH10';
import { supabase } from '../lib/supabaseClient';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip);

const MAX_ECG_POINTS = 1300; // ~10 s at 130 Hz

const ECG_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    x: { display: false, min: 0, max: MAX_ECG_POINTS - 1 },
    y: {
      min: -1400, max: 1400,
      ticks: { color: '#71717A', maxTicksLimit: 5, font: { size: 11 } },
      grid: { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'transparent' },
    },
  },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
};

type WsStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveProgress {
  rrDone: number;
  rrTotal: number;
  ecgDone: number;
  ecgTotal: number;
}

const MAX_WS_BUFFER = 500;
const BACKOFF_MAX_MS = 30_000;
const SIGNAL_LOSS_MS = 5_000;
const RESUBSCRIBE_INTERVAL_MS = 10_000;
const RR_BATCH = 500;
const ECG_BATCH = 200;

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function wsDotClass(s: WsStatus): string {
  if (s === 'connected') return 'dot dot-success';
  if (s === 'connecting' || s === 'reconnecting') return 'dot dot-warning';
  if (s === 'error') return 'dot dot-error';
  return 'dot dot-muted';
}

function downloadSessionJson(data: SessionData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session_${data.session_id?.slice(0, 8) ?? 'unknown'}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  try {
    localStorage.setItem(`session_${data.session_id}`, JSON.stringify(data));
  } catch {
    console.warn('[H10] localStorage save failed (quota exceeded?)');
  }
}

function calcQuality(dropped: number, total: number): 'good' | 'fair' | 'poor' {
  if (total === 0) return 'good';
  const r = dropped / total;
  if (r < 0.01) return 'good';
  if (r < 0.05) return 'fair';
  return 'poor';
}

export default function H10SessionPanel() {
  const {
    status: bleStatus,
    deviceName,
    heartRate,
    rrIntervals,
    battery,
    ecgFrame,
    ecgLive,
    resubscribeHR,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sessionActive,
    sessionId,
    sessionStartedAt,
    sessionRrCount,
    sessionEcgCount,
    startSessionCapture,
    stopSessionCapture,
  } = usePolarH10Context();

  const sessionActiveRef = useRef(sessionActive);
  sessionActiveRef.current = sessionActive;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // ── BLE connect ───────────────────────────────────────────────────────────
  const [connectError, setConnectError] = useState<string | null>(null);
  const handleConnect = useCallback(async () => {
    setConnectError(null);
    try { await connect(); } catch (err) { setConnectError((err as Error).message); }
  }, [connect]);

  // ── WS address ────────────────────────────────────────────────────────────
  const [wsAddr, setWsAddr] = useState('127.0.0.1:8765');
  const [wsInput, setWsInput] = useState('127.0.0.1:8765');
  useEffect(() => {
    const saved = localStorage.getItem('h10_ws_addr');
    if (saved) { setWsAddr(saved); setWsInput(saved); }
  }, []);

  // ── WS state ──────────────────────────────────────────────────────────────
  const [wsStatus, setWsStatus] = useState<WsStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const wsBufRef = useRef<string[]>([]);
  const backoffRef = useRef(1_000);
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnRef = useRef(false);
  const wsSeqRef = useRef(0);
  const [queueSize, setQueueSize] = useState(0);

  // ── Live display ──────────────────────────────────────────────────────────
  const [dispHr, setDispHr] = useState<number | null>(null);
  const [dispRr, setDispRr] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // ── Signal loss ───────────────────────────────────────────────────────────
  const [signalLost, setSignalLost] = useState(false);
  const lastRrTimeRef = useRef(0);
  const lastResubscribeRef = useRef(0);

  // ── Background notice ─────────────────────────────────────────────────────
  const [bgNotice, setBgNotice] = useState<string | null>(null);

  // ── Wake lock + Web Lock ──────────────────────────────────────────────────
  const wakeLockRef = useRef<any>(null);
  const lockReleaseRef = useRef<(() => void) | null>(null);

  // ── Save state ────────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveProgress, setSaveProgress] = useState<SaveProgress>({ rrDone: 0, rrTotal: 0, ecgDone: 0, ecgTotal: 0 });
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Session log ───────────────────────────────────────────────────────────
  const [log, setLog] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 5));
  }, []);

  // ── WS helpers ────────────────────────────────────────────────────────────
  const sendMsg = useCallback((obj: object) => {
    const json = JSON.stringify(obj);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(json);
    } else {
      wsBufRef.current.push(json);
      if (wsBufRef.current.length > MAX_WS_BUFFER) wsBufRef.current.shift();
      setQueueSize(wsBufRef.current.length);
    }
  }, []);

  const flushBuffer = useCallback(() => {
    while (wsBufRef.current.length && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(wsBufRef.current.shift()!);
    }
    setQueueSize(wsBufRef.current.length);
  }, []);

  const doConnect = useCallback((addr: string) => {
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    if (wsRef.current) wsRef.current.close();
    shouldReconnRef.current = true;
    setWsStatus('connecting');
    addLog(`Connecting to ws://${addr}`);
    const ws = new WebSocket(`ws://${addr}`);
    wsRef.current = ws;
    ws.onopen = () => { setWsStatus('connected'); backoffRef.current = 1_000; addLog('WebSocket connected'); flushBuffer(); };
    ws.onerror = () => setWsStatus('error');
    ws.onclose = () => {
      if (!shouldReconnRef.current) { setWsStatus('idle'); return; }
      setWsStatus('reconnecting');
      const delay = backoffRef.current;
      addLog(`Disconnected — retry in ${(delay / 1000).toFixed(0)}s`);
      backoffRef.current = Math.min(delay * 2, BACKOFF_MAX_MS);
      reconnTimerRef.current = setTimeout(() => { if (shouldReconnRef.current) doConnect(addr); }, delay);
    };
  }, [addLog, flushBuffer]);

  const stopWs = useCallback(() => {
    shouldReconnRef.current = false;
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    setWsStatus('idle');
    addLog('WebSocket disconnected');
  }, [addLog]);

  useEffect(() => () => {
    shouldReconnRef.current = false;
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    wsRef.current?.close();
  }, []);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActive) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - sessionStartedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sessionActive, sessionStartedAt]);

  // ── Signal-loss monitor ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => {
      if (lastRrTimeRef.current > 0 && Date.now() - lastRrTimeRef.current > SIGNAL_LOSS_MS) {
        setSignalLost(true);
        const now = Date.now();
        if (now - lastResubscribeRef.current > RESUBSCRIBE_INTERVAL_MS) {
          lastResubscribeRef.current = now;
          addLog('Signal lost — attempting HR re-subscribe…');
          resubscribeHR().then(() => addLog('HR re-subscribed')).catch(() => {});
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [sessionActive, resubscribeHR, addLog]);

  // ── Page Visibility ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (!sessionActiveRef.current) return;
      if (document.visibilityState === 'hidden') {
        setBgNotice('Recording in background — do not close this tab');
      } else {
        setBgNotice('Recording resumed');
        setTimeout(() => setBgNotice(null), 3000);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // ── RR WS forwarding ──────────────────────────────────────────────────────
  const heartRateRef = useRef(heartRate);
  heartRateRef.current = heartRate;

  useEffect(() => {
    if (!sessionActiveRef.current) return;
    lastRrTimeRef.current = Date.now();
    setSignalLost(false);
    setDispHr(heartRateRef.current);
    if (rrIntervals.length > 0) setDispRr(rrIntervals[rrIntervals.length - 1]);
    sendMsg({ type: 'rr', session_id: sessionIdRef.current, seq: wsSeqRef.current++, ts: Date.now(), hr: heartRateRef.current, rr: rrIntervals });
  }, [rrIntervals, sendMsg]);

  // ── ECG WS forwarding ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActiveRef.current || !ecgFrame) return;
    sendMsg({ type: 'ecg', session_id: sessionIdRef.current, seq: wsSeqRef.current++, ts: Date.now(), samples: ecgFrame.samples });
  }, [ecgFrame, sendMsg]);

  // ── Supabase save ─────────────────────────────────────────────────────────
  const saveToSupabase = useCallback(async (data: SessionData) => {
    setSaveStatus('saving');
    setSaveError(null);
    setSaveProgress({ rrDone: 0, rrTotal: data.rr_packets.length, ecgDone: 0, ecgTotal: data.ecg_frames.length });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const hrValues = data.rr_packets.map(p => p.hr_bpm).filter((v): v is number => v !== null);
      const hrAvg = hrValues.length ? Math.round(hrValues.reduce((s, v) => s + v, 0) / hrValues.length) : null;
      const hrMax = hrValues.length ? Math.max(...hrValues) : null;
      const hrMin = hrValues.length ? Math.min(...hrValues) : null;
      const ecgSampleCount = data.ecg_frames.reduce((s, f) => s + f.samples_uv.length, 0);
      const droppedPackets = 0;
      const total = data.rr_packets.length + data.ecg_frames.length;
      const quality = calcQuality(droppedPackets, total);

      const date = new Date(data.started_at);
      const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

      // 1. Insert activity
      const { data: actRow, error: actErr } = await supabase
        .from('activities')
        .insert({
          user_id: user.id,
          title: `H10 Session — ${dateStr}`,
          type: 'H10 Recording',
          source: 'h10_live',
          started_at: data.started_at,
          duration_seconds: data.duration_seconds,
          heart_rate_avg: hrAvg,
          heart_rate_max: hrMax,
          heart_rate_min: hrMin,
          rr_count: data.rr_packets.length,
          ecg_frame_count: data.ecg_frames.length,
          ecg_sample_count: ecgSampleCount,
          dropped_packets: droppedPackets,
          quality,
        })
        .select('id')
        .single();
      if (actErr) throw actErr;
      const activityId = actRow.id;

      // 2. Insert session
      const { data: sessRow, error: sessErr } = await supabase
        .from('sessions')
        .insert({
          activity_id: activityId,
          user_id: user.id,
          started_at: data.started_at,
          ended_at: data.ended_at,
          streams: data.ecg_frames.length > 0 ? ['rr', 'ecg'] : ['rr'],
        })
        .select('id')
        .single();
      if (sessErr) throw sessErr;
      const sessionId = sessRow.id;

      // 3. RR packets in batches of 500
      for (let i = 0; i < data.rr_packets.length; i += RR_BATCH) {
        const batch = data.rr_packets.slice(i, i + RR_BATCH).map(p => ({
          session_id: sessionId,
          seq: p.seq,
          timestamp_ms: p.timestamp_ms,
          hr_bpm: p.hr_bpm,
          rr_intervals_ms: p.rr_intervals_ms,
        }));
        const { error } = await supabase.from('rr_packets').insert(batch);
        if (error) throw error;
        setSaveProgress(prev => ({ ...prev, rrDone: i + batch.length }));
      }

      // 4. ECG frames in batches of 200
      for (let i = 0; i < data.ecg_frames.length; i += ECG_BATCH) {
        const batch = data.ecg_frames.slice(i, i + ECG_BATCH).map(f => ({
          session_id: sessionId,
          seq: f.seq,
          timestamp_ns: f.timestamp_ns,
          samples_uv: f.samples_uv,
        }));
        const { error } = await supabase.from('ecg_frames').insert(batch);
        if (error) throw error;
        setSaveProgress(prev => ({ ...prev, ecgDone: i + batch.length }));
      }

      setSaveStatus('saved');
      addLog('Session saved to Supabase');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setSaveError(msg);
      setSaveStatus('error');
      addLog('Supabase save failed — downloading JSON backup');
      downloadSessionJson(data);
    }
  }, [addLog]);

  // ── Session control ───────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    startRecording();
    const id = startSessionCapture();
    wsSeqRef.current = 0;
    lastRrTimeRef.current = 0;
    lastResubscribeRef.current = 0;
    setSignalLost(false);
    setDispHr(null);
    setDispRr(null);
    setSaveStatus('idle');
    setSaveError(null);
    addLog(`Session started  ID:${id.slice(0, 8)}…`);
    sendMsg({ type: 'session_start', session_id: id, ts: Date.now() });

    if ((navigator as any).wakeLock) {
      (navigator as any).wakeLock.request('screen')
        .then((wl: any) => { wakeLockRef.current = wl; })
        .catch(() => console.warn('[H10] WakeLock not available'));
    }
    if ((navigator as any).locks) {
      (navigator as any).locks.request('h10_session', { mode: 'exclusive' }, async () => {
        await new Promise<void>(resolve => { lockReleaseRef.current = resolve; });
      }).catch(() => console.warn('[H10] Web Locks not available'));
    }
  }, [startRecording, startSessionCapture, addLog, sendMsg]);

  const stopSession = useCallback(() => {
    lockReleaseRef.current?.();
    lockReleaseRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setBgNotice(null);

    stopRecording();
    const data = stopSessionCapture();
    addLog(`Session ended  ${fmtElapsed(data.duration_seconds)}`);
    sendMsg({ type: 'session_end', session_id: data.session_id, ts: Date.now(), duration_seconds: data.duration_seconds });
    saveToSupabase(data);
  }, [stopRecording, stopSessionCapture, addLog, sendMsg, saveToSupabase]);

  const saveAddr = useCallback(() => {
    setWsAddr(wsInput);
    localStorage.setItem('h10_ws_addr', wsInput);
    addLog(`WS address set to ${wsInput}`);
  }, [wsInput, addLog]);

  // ── ECG chart data ────────────────────────────────────────────────────────
  const paddedEcg = ecgLive.length < MAX_ECG_POINTS
    ? [...new Array(MAX_ECG_POINTS - ecgLive.length).fill(null), ...ecgLive]
    : ecgLive;

  const ecgChartData = {
    labels: Array.from({ length: MAX_ECG_POINTS }, (_, i) => i),
    datasets: [{
      data: paddedEcg,
      borderColor: 'rgba(79,140,255,0.9)',
      backgroundColor: 'transparent',
      spanGaps: false,
    }],
  };

  // ── Save progress bar ─────────────────────────────────────────────────────
  const savePct = (() => {
    const total = saveProgress.rrTotal + saveProgress.ecgTotal;
    if (total === 0) return saveStatus === 'saved' ? 100 : 0;
    return Math.round(((saveProgress.rrDone + saveProgress.ecgDone) / total) * 100);
  })();

  // ── Render ────────────────────────────────────────────────────────────────
  const isConnected = bleStatus === 'connected';
  const isConnecting = bleStatus === 'connecting';
  const displayBleError = connectError ?? (bleStatus === 'error' ? 'Connection failed' : null);

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* BLE status bar */}
      <div className="inner-card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className={isConnected ? 'dot dot-success' : isConnecting ? 'dot dot-warning' : bleStatus === 'error' ? 'dot dot-error' : 'dot dot-muted'} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0 }}>
          {isConnected ? (deviceName ?? 'Polar H10') : isConnecting ? 'Connecting…' : bleStatus === 'error' ? 'Connection failed' : 'Not connected'}
        </span>
        {battery !== null && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Battery: {battery}%</span>
        )}
        {!isConnected && (
          <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? 'Connecting…' : 'Connect Polar H10'}
          </button>
        )}
        {isConnected && (
          <button className="btn btn-secondary btn-sm" onClick={disconnect} disabled={sessionActive}>
            Disconnect
          </button>
        )}
      </div>
      {displayBleError && (
        <div style={{ fontSize: 12, color: 'var(--error)', padding: '6px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)' }}>
          {displayBleError}
        </div>
      )}

      {/* Background-recording banner */}
      {bgNotice && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '10px 20px',
          fontSize: 13, fontWeight: 600, color: 'var(--text)',
          zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
        }}>
          {bgNotice}
        </div>
      )}

      {/* Live ECG chart — shown during active session */}
      {sessionActive && (
        <div className="inner-card">
          <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>
            Live ECG (130 Hz)
          </div>
          <div style={{ position: 'relative', height: 140 }}>
            {ecgLive.length > 0 ? (
              <Line data={ecgChartData} options={ECG_CHART_OPTIONS} />
            ) : (
              <div className="empty-state" style={{ height: '100%' }}>Waiting for ECG data…</div>
            )}
          </div>
        </div>
      )}

      {/* WS config row */}
      <div className="inner-card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={wsDotClass(wsStatus)} />
        <span style={{ fontWeight: 600, fontSize: 13, minWidth: 100 }}>WS&nbsp;{wsStatus}</span>
        <input
          type="text" className="input" value={wsInput}
          onChange={e => setWsInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveAddr()}
          placeholder="ip:port" style={{ width: 160 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={saveAddr}>Save</button>
        {wsStatus === 'idle'
          ? <button className="btn btn-primary btn-sm" onClick={() => doConnect(wsAddr)}>Connect WS</button>
          : <button className="btn btn-secondary btn-sm" onClick={stopWs}>Disconnect WS</button>
        }
        {queueSize > 0 && (
          <span style={{ marginLeft: 'auto', color: 'var(--warning)', fontSize: 12 }}>Queued: {queueSize}</span>
        )}
      </div>

      {/* H10 status + session control */}
      <div className="inner-card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: sessionActive ? 8 : 0 }}>
            <span className={isConnected ? 'dot dot-success' : 'dot dot-muted'} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {isConnected ? (deviceName ?? 'Polar H10') : 'H10 not connected'}
            </span>
            {signalLost && sessionActive && (
              <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 4 }}>⚠ signal lost</span>
            )}
          </div>
          {sessionActive && (
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em', lineHeight: 1 }}>
              {fmtElapsed(elapsed)}
            </div>
          )}
        </div>
        <div>
          {!sessionActive ? (
            <button
              className="btn btn-primary btn-sm"
              disabled={!isConnected}
              title={isConnected ? undefined : 'Connect Polar H10 first'}
              onClick={startSession}
            >
              Start session
            </button>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={stopSession}>Stop session</button>
          )}
        </div>
      </div>

      {/* Live data preview */}
      {sessionActive && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
            <DataCell label="HR"       value={dispHr !== null ? `${dispHr} bpm` : '—'} />
            <DataCell label="Last RR"  value={dispRr !== null ? `${Math.round(dispRr)} ms` : '—'} />
            <DataCell label="RR pkts"  value={String(sessionRrCount)} />
            <DataCell label="ECG pkts" value={String(sessionEcgCount)} />
            {queueSize > 0 && <DataCell label="Queued" value={String(queueSize)} warn />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 2 }}>
            {sessionRrCount} RR packets · {sessionEcgCount} ECG frames buffered
          </div>
        </>
      )}

      {/* Save progress / result */}
      {saveStatus === 'saving' && (
        <div className="inner-card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            Saving… (RR: {saveProgress.rrDone}/{saveProgress.rrTotal} · ECG: {saveProgress.ecgDone}/{saveProgress.ecgTotal})
          </div>
          <div style={{ background: 'var(--surface-hover)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
            <div style={{
              background: 'var(--accent)', height: '100%',
              width: `${savePct}%`, transition: 'width 0.2s ease',
            }} />
          </div>
        </div>
      )}

      {saveStatus === 'saved' && (
        <div className="inner-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--success, #22C55E)', fontWeight: 600, fontSize: 13 }}>Session saved ✓</span>
          <Link href="/dashboard" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
            View in dashboard →
          </Link>
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="inner-card">
          <p style={{ margin: 0, color: 'var(--error)', fontSize: 13, fontWeight: 600 }}>
            Save failed — JSON backup downloaded
          </p>
          {saveError && (
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>{saveError}</p>
          )}
        </div>
      )}

      {/* Session log */}
      {log.length > 0 && (
        <div className="inner-card" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>
            Session log
          </div>
          {log.map((entry, i) => (
            <div key={i} style={{ fontSize: 12, color: i === 0 ? 'var(--text)' : 'var(--muted)', lineHeight: 1.65 }}>
              {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="inner-card" style={{ padding: '8px 12px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 2, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--text)', fontSize: 14 }}>
        {value}
      </div>
    </div>
  );
}
