'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
} from 'chart.js';
import { usePolarH10Context } from '../contexts/PolarH10Context';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip);

const MAX_ECG_POINTS = 1300; // ~10 s at 130 Hz

const ECG_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: false },
    title: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: {
      display: false,
      min: 0,
      max: MAX_ECG_POINTS - 1,
    },
    y: {
      min: -1400,
      max: 1400,
      ticks: { color: '#71717A', maxTicksLimit: 5, font: { size: 11 } },
      grid: { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'transparent' },
    },
  },
  elements: {
    point: { radius: 0 },
    line: { borderWidth: 1.5 },
  },
};

export default function PolarH10Connect() {
  const {
    status,
    deviceName,
    heartRate,
    battery,
    ecgLive,
    recording,
    error,
    connect,
    disconnect,
    startRecording,
    stopRecording,
  } = usePolarH10Context();

  const [saveErr, setSaveErr] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaveErr(null);
    const summary = stopRecording();

    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Live session — ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
          type: 'Other',
          duration_seconds: summary.durationSeconds,
          heart_rate_avg: summary.heartRateAvg,
          heart_rate_max: summary.heartRateMax,
          ecg: summary.ecg,
          source: 'live',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to save session:', message);
      setSaveErr(message);
    }
  }, [stopRecording]);

  const paddedEcg = ecgLive.length < MAX_ECG_POINTS
    ? [...new Array(MAX_ECG_POINTS - ecgLive.length).fill(null), ...ecgLive]
    : ecgLive;

  const ecgChartData = {
    labels: Array.from({ length: MAX_ECG_POINTS }, (_, i) => i),
    datasets: [
      {
        data: paddedEcg,
        borderColor: 'rgba(79, 140, 255, 0.9)',
        backgroundColor: 'transparent',
        spanGaps: false,
      },
    ],
  };

  const [bluetoothDefined, setBluetoothDefined] = useState<boolean | null>(null);
  const [secureContext, setSecureContext] = useState<boolean | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    setBluetoothDefined('bluetooth' in navigator);
    setSecureContext(window.isSecureContext);
  }, []);

  const handleConnect = useCallback(async () => {
    setConnectError(null);
    try {
      await connect();
    } catch (err) {
      setConnectError((err as Error).message);
    }
  }, [connect]);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const displayError = connectError ?? error;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Status bar */}
      <div className="inner-card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className={dotClass(status)} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          {isConnected ? deviceName : statusLabel(status)}
        </span>
        {battery !== null && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            Battery: {battery}%
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!isConnected && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting…' : 'Connect Polar H10'}
            </button>
          )}
          {isConnected && (
            <button className="btn btn-secondary btn-sm" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* BLE debug box */}
      {bluetoothDefined !== null && (
        <div className="inner-card" style={{
          borderColor: 'rgba(239,68,68,0.2)',
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: 1.75,
          color: 'var(--muted)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10 }}>
            BLE Debug
          </div>
          <div>
            navigator.bluetooth:{' '}
            <span style={{ color: bluetoothDefined ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
              {bluetoothDefined ? 'defined ✓' : 'undefined ✗'}
            </span>
          </div>
          <div>
            isSecureContext:{' '}
            <span style={{ color: secureContext ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
              {secureContext === null ? '…' : secureContext ? 'true ✓' : 'false ✗'}
            </span>
          </div>
          {displayError && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', color: '#FCA5A5', wordBreak: 'break-word' }}>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>Error: </span>{displayError}
            </div>
          )}
        </div>
      )}

      {/* Idle prompt */}
      {!isConnected && status === 'idle' && (
        <div className="empty-state" style={{ minHeight: 80 }}>
          Connect your Polar H10 via Bluetooth to stream live ECG and heart rate.
          {bluetoothDefined === false && (
            <span style={{ display: 'block', marginTop: 10, color: '#FCA5A5' }}>
              Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop.
            </span>
          )}
        </div>
      )}

      {isConnected && (
        <>
          {/* Heart rate + ECG */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, alignItems: 'start' }}>
            <div className="inner-card" style={{ textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>
                Heart Rate
              </div>
              <div style={{ fontSize: 48, fontWeight: 800, color: heartRate ? '#EF4444' : 'var(--muted)', lineHeight: 1 }}>
                {heartRate ?? '—'}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>bpm</div>
            </div>

            <div className="inner-card">
              <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>
                Live ECG (130 Hz)
              </div>
              <div style={{ position: 'relative', height: 160 }}>
                {ecgLive.length > 0 ? (
                  <Line data={ecgChartData} options={ECG_CHART_OPTIONS} />
                ) : (
                  <div className="empty-state" style={{ height: '100%' }}>
                    Waiting for ECG data…
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recording controls */}
          <div className="inner-card" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2, fontSize: 14 }}>Record session</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Capture ECG to save to your dashboard.
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {!recording ? (
                  <button className="btn btn-primary btn-sm" onClick={() => { setSaveErr(null); startRecording(); }}>
                    Start recording
                  </button>
                ) : (
                  <>
                    <RecordingBadge />
                    <button className="btn btn-secondary btn-sm" onClick={handleSave}>
                      Stop &amp; save
                    </button>
                  </>
                )}
              </div>
            </div>
            {saveErr && (
              <p style={{ margin: 0, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--error)', fontSize: 12 }}>
                Save failed: {saveErr}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function dotClass(status: string): string {
  if (status === 'connected') return 'dot dot-success';
  if (status === 'connecting') return 'dot dot-warning';
  if (status === 'error') return 'dot dot-error';
  return 'dot dot-muted';
}

function RecordingBadge() {
  return (
    <span className="badge badge-error" style={{
      gap: 6,
      padding: '4px 14px',
      fontWeight: 700,
      fontSize: 12,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#EF4444', animation: 'pulse-dot 1.2s infinite', display: 'inline-block' }} />
      Recording
    </span>
  );
}

function statusLabel(s: string) {
  if (s === 'connecting') return 'Connecting…';
  if (s === 'error') return 'Connection failed';
  return 'Not connected';
}
