'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePolarH10Context } from '../contexts/PolarH10Context';

type WsStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting';

const MAX_BUFFER = 500;
const BACKOFF_MAX_MS = 30_000;
const SIGNAL_LOSS_MS = 5_000;

function genSessionId(): string {
  try { return crypto.randomUUID(); } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

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

export default function H10SessionPanel() {
  const {
    status: bleStatus,
    deviceName,
    heartRate,
    rrIntervals,
    ecgLive,
    ecgSampleTotal,
  } = usePolarH10Context();

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
  const bufferRef = useRef<string[]>([]);
  const backoffRef = useRef(1_000);
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnRef = useRef(false);
  const seqRef = useRef(0);
  const [queueSize, setQueueSize] = useState(0);

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessionActive, setSessionActive] = useState(false);
  const sessionActiveRef = useRef(false);
  sessionActiveRef.current = sessionActive;

  const sessionIdRef = useRef<string | null>(null);
  const sessionStartRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  // ── Live preview ──────────────────────────────────────────────────────────
  const [dispHr, setDispHr] = useState<number | null>(null);
  const [dispRr, setDispRr] = useState<number | null>(null);
  const [rrCount, setRrCount] = useState(0);
  const [ecgCount, setEcgCount] = useState(0);

  // ── Signal loss ───────────────────────────────────────────────────────────
  const [signalLost, setSignalLost] = useState(false);
  const lastRrTimeRef = useRef(0);

  // ── Session log ───────────────────────────────────────────────────────────
  const [log, setLog] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 5));
  }, []);

  // ── WS send / buffer ──────────────────────────────────────────────────────
  const sendMsg = useCallback((obj: object) => {
    const json = JSON.stringify(obj);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(json);
    } else {
      bufferRef.current.push(json);
      if (bufferRef.current.length > MAX_BUFFER) bufferRef.current.shift();
      setQueueSize(bufferRef.current.length);
    }
  }, []);

  const flushBuffer = useCallback(() => {
    while (bufferRef.current.length && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(bufferRef.current.shift()!);
    }
    setQueueSize(bufferRef.current.length);
  }, []);

  // ── WS connect / disconnect ───────────────────────────────────────────────
  const doConnect = useCallback((addr: string) => {
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    if (wsRef.current) wsRef.current.close();
    shouldReconnRef.current = true;
    setWsStatus('connecting');
    addLog(`Connecting to ws://${addr}`);

    const ws = new WebSocket(`ws://${addr}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      backoffRef.current = 1_000;
      addLog('WebSocket connected');
      flushBuffer();
    };
    ws.onerror = () => setWsStatus('error');
    ws.onclose = () => {
      if (!shouldReconnRef.current) { setWsStatus('idle'); return; }
      setWsStatus('reconnecting');
      const delay = backoffRef.current;
      addLog(`Disconnected — retry in ${(delay / 1000).toFixed(0)}s`);
      backoffRef.current = Math.min(delay * 2, BACKOFF_MAX_MS);
      reconnTimerRef.current = setTimeout(() => {
        if (shouldReconnRef.current) doConnect(addr);
      }, delay);
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

  // Stop WS and clear reconnect on unmount
  useEffect(() => () => {
    shouldReconnRef.current = false;
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    wsRef.current?.close();
  }, []);

  // ── Session timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sessionActive]);

  // ── Signal-loss monitor ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => {
      if (lastRrTimeRef.current > 0 && Date.now() - lastRrTimeRef.current > SIGNAL_LOSS_MS) {
        setSignalLost(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [sessionActive]);

  // ── HR / RR forwarding ────────────────────────────────────────────────────
  const heartRateRef = useRef(heartRate);
  heartRateRef.current = heartRate;

  useEffect(() => {
    if (!sessionActiveRef.current) return;
    lastRrTimeRef.current = Date.now();
    setSignalLost(false);
    setDispHr(heartRateRef.current);
    if (rrIntervals.length > 0) setDispRr(rrIntervals[rrIntervals.length - 1]);
    setRrCount(c => c + 1);
    sendMsg({
      type: 'rr',
      session_id: sessionIdRef.current,
      seq: seqRef.current++,
      ts: Date.now(),
      hr: heartRateRef.current,
      rr: rrIntervals,
    });
  }, [rrIntervals, sendMsg]);

  // ── ECG forwarding ────────────────────────────────────────────────────────
  const prevEcgTotalRef = useRef(0);
  const ecgSampleTotalRef = useRef(ecgSampleTotal);
  ecgSampleTotalRef.current = ecgSampleTotal;
  const ecgLiveRef = useRef(ecgLive);
  ecgLiveRef.current = ecgLive;

  useEffect(() => {
    if (!sessionActiveRef.current) return;
    const delta = ecgSampleTotal - prevEcgTotalRef.current;
    prevEcgTotalRef.current = ecgSampleTotal;
    if (delta <= 0) return;
    const buf = ecgLiveRef.current;
    const newSamples = buf.slice(Math.max(0, buf.length - delta));
    if (newSamples.length === 0) return;
    setEcgCount(c => c + 1);
    sendMsg({
      type: 'ecg',
      session_id: sessionIdRef.current,
      seq: seqRef.current++,
      ts: Date.now(),
      samples: newSamples,
    });
  }, [ecgSampleTotal, sendMsg]);

  // ── Session control ───────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    const id = genSessionId();
    sessionIdRef.current = id;
    sessionStartRef.current = Date.now();
    seqRef.current = 0;
    setElapsed(0);
    setDispHr(null); setDispRr(null);
    setRrCount(0); setEcgCount(0);
    setSignalLost(false);
    lastRrTimeRef.current = 0;
    prevEcgTotalRef.current = ecgSampleTotalRef.current;
    setSessionActive(true);
    addLog(`Session started  ID:${id.slice(0, 8)}…`);
    sendMsg({ type: 'session_start', session_id: id, ts: Date.now() });
  }, [addLog, sendMsg]);

  const stopSession = useCallback(() => {
    const id = sessionIdRef.current;
    const dur = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    setSessionActive(false);
    addLog(`Session ended  ${fmtElapsed(dur)}`);
    sendMsg({ type: 'session_end', session_id: id, ts: Date.now(), duration_seconds: dur });
  }, [addLog, sendMsg]);

  const saveAddr = useCallback(() => {
    setWsAddr(wsInput);
    localStorage.setItem('h10_ws_addr', wsInput);
    addLog(`WS address set to ${wsInput}`);
  }, [wsInput, addLog]);

  // ── Render ────────────────────────────────────────────────────────────────
  const isConnected = bleStatus === 'connected';

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* WS config row */}
      <div className="inner-card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={wsDotClass(wsStatus)} />
        <span style={{ fontWeight: 600, fontSize: 13, minWidth: 100 }}>
          WS&nbsp;{wsStatus}
        </span>
        <input
          type="text"
          className="input"
          value={wsInput}
          onChange={e => setWsInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveAddr()}
          placeholder="ip:port"
          style={{ width: 160 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={saveAddr}>Save</button>
        {wsStatus === 'idle' ? (
          <button className="btn btn-primary btn-sm" onClick={() => doConnect(wsAddr)}>Connect WS</button>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={stopWs}>Disconnect WS</button>
        )}
        {queueSize > 0 && (
          <span style={{ marginLeft: 'auto', color: 'var(--warning)', fontSize: 12 }}>
            Queued: {queueSize}
          </span>
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
              <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 4 }}>
                ⚠ signal lost
              </span>
            )}
          </div>
          {sessionActive && (
            <div style={{
              fontSize: 28, fontWeight: 800, color: 'var(--accent)',
              letterSpacing: '-0.02em', lineHeight: 1,
            }}>
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
            <button className="btn btn-secondary btn-sm" onClick={stopSession}>
              Stop session
            </button>
          )}
        </div>
      </div>

      {/* Live data preview — shown while session is running */}
      {sessionActive && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
          gap: 6,
        }}>
          <DataCell label="HR" value={dispHr !== null ? `${dispHr} bpm` : '—'} />
          <DataCell label="Last RR" value={dispRr !== null ? `${Math.round(dispRr)} ms` : '—'} />
          <DataCell label="RR pkts" value={String(rrCount)} />
          <DataCell label="ECG pkts" value={String(ecgCount)} />
          {queueSize > 0 && <DataCell label="Buffered" value={String(queueSize)} warn />}
        </div>
      )}

      {/* Session log */}
      {log.length > 0 && (
        <div className="inner-card" style={{ padding: '10px 14px' }}>
          <div style={{
            fontSize: 10, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, fontWeight: 600,
          }}>
            Session log
          </div>
          {log.map((entry, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: i === 0 ? 'var(--text)' : 'var(--muted)',
                lineHeight: 1.65,
              }}
            >
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
      <div style={{
        fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 2, fontWeight: 600,
      }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--text)', fontSize: 14 }}>
        {value}
      </div>
    </div>
  );
}
