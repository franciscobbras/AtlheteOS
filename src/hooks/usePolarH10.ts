'use client';

import { useCallback, useRef, useState } from 'react';
import { PolarH10 } from '../lib/polarH10';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

const MAX_LIVE_ECG_SAMPLES = 1300; // ~10 s at 130 Hz

export interface RecordingSummary {
  ecg: number[];
  durationSeconds: number;
  heartRateAvg: number | null;
  heartRateMax: number | null;
}

// Session buffer types — exported so the panel can reference them
export interface RrPacket {
  timestamp_ms: number;
  hr_bpm: number | null;
  rr_intervals_ms: number[];
  seq: number;
}

export interface EcgFrame {
  timestamp_ns: string; // bigint serialised as string
  samples_uv: number[];
  seq: number;
}

export interface SessionData {
  session_id: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  rr_packets: RrPacket[];
  ecg_frames: EcgFrame[];
}

function genSessionId(): string {
  try { return crypto.randomUUID(); } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function usePolarH10() {
  // ── BLE state ─────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [rrIntervals, setRrIntervals] = useState<number[]>([]);
  const [battery, setBattery] = useState<number | null>(null);
  const [ecgLive, setEcgLive] = useState<number[]>([]);
  const [ecgSampleTotal, setEcgSampleTotal] = useState(0);
  const [ecgFrame, setEcgFrame] = useState<{ samples: number[]; timestampNs: bigint } | null>(null);
  const [ecgRecorded, setEcgRecorded] = useState<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const polar = useRef<PolarH10 | null>(null);
  const recordBuffer = useRef<number[]>([]);
  const isRecordingRef = useRef(false);
  const recordStartTime = useRef<number>(0);
  const hrDuringRecord = useRef<number[]>([]);
  const hrCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  // ── Session state (persists across navigation) ────────────────────────────
  const [sessionActive, setSessionActive] = useState(false);
  const sessionActiveRef = useRef(false);
  sessionActiveRef.current = sessionActive;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [sessionStartedAt, setSessionStartedAt] = useState(0);
  const sessionStartedAtRef = useRef(0);

  const [sessionRrCount, setSessionRrCount] = useState(0);
  const [sessionEcgCount, setSessionEcgCount] = useState(0);

  const rrBufferRef = useRef<RrPacket[]>([]);
  const ecgBufferRef = useRef<EcgFrame[]>([]);
  const sessionSeqRef = useRef(0);

  // ── BLE connect ───────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);

    polar.current = new PolarH10({
      onHeartRate(bpm, rr) {
        setHeartRate(bpm);
        setRrIntervals(rr);
        if (isRecordingRef.current) hrDuringRecord.current.push(bpm);
        // Buffer for active streaming session
        if (sessionActiveRef.current) {
          rrBufferRef.current.push({
            timestamp_ms: Date.now(),
            hr_bpm: bpm,
            rr_intervals_ms: rr,
            seq: sessionSeqRef.current++,
          });
          setSessionRrCount(c => c + 1);
        }
      },
      onEcgSamples(samples, timestampNs) {
        setEcgLive((prev) => {
          const next = [...prev, ...samples];
          return next.length > MAX_LIVE_ECG_SAMPLES
            ? next.slice(next.length - MAX_LIVE_ECG_SAMPLES)
            : next;
        });
        setEcgSampleTotal((prev) => prev + samples.length);
        setEcgFrame({ samples, timestampNs });
        if (isRecordingRef.current) recordBuffer.current.push(...samples);
        // Buffer for active streaming session
        if (sessionActiveRef.current) {
          ecgBufferRef.current.push({
            timestamp_ns: timestampNs.toString(),
            samples_uv: samples,
            seq: sessionSeqRef.current++,
          });
          setSessionEcgCount(c => c + 1);
        }
      },
      onBattery: setBattery,
      onError(err) {
        setError(err.message);
        setStatus('error');
      },
      onDisconnect() {
        setStatus('idle');
        setHeartRate(null);
        setBattery(null);
        hrCharRef.current = null;
      },
    });

    try {
      const name = await polar.current.connect();
      setDeviceName(name);
      setStatus('connected');
      // Cache HR characteristic for potential re-subscription on signal loss
      try {
        const server = (polar.current as any).server as BluetoothRemoteGATTServer;
        const svc = await server.getPrimaryService('heart_rate');
        hrCharRef.current = await svc.getCharacteristic('heart_rate_measurement');
      } catch {
        console.warn('[H10] Could not cache HR characteristic');
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
      polar.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    polar.current?.disconnect();
    polar.current = null;
    hrCharRef.current = null;
    setStatus('idle');
    setHeartRate(null);
    setBattery(null);
    setEcgLive([]);
  }, []);

  const resubscribeHR = useCallback(async () => {
    const char = hrCharRef.current;
    if (!char) return;
    try {
      await char.startNotifications();
      console.log('[H10] HR notifications re-subscribed');
    } catch (e) {
      console.warn('[H10] HR re-subscribe failed', e);
    }
  }, []);

  // ── Session capture (survives navigation — lives in hook) ─────────────────
  const startSessionCapture = useCallback(() => {
    const id = genSessionId();
    sessionIdRef.current = id;
    sessionStartedAtRef.current = Date.now();
    sessionSeqRef.current = 0;
    rrBufferRef.current = [];
    ecgBufferRef.current = [];
    setSessionId(id);
    setSessionStartedAt(sessionStartedAtRef.current);
    setSessionRrCount(0);
    setSessionEcgCount(0);
    setSessionActive(true);
    return id;
  }, []);

  const stopSessionCapture = useCallback((): SessionData => {
    const endedAt = new Date().toISOString();
    const dur = Math.floor((Date.now() - sessionStartedAtRef.current) / 1000);
    const data: SessionData = {
      session_id: sessionIdRef.current,
      started_at: new Date(sessionStartedAtRef.current).toISOString(),
      ended_at: endedAt,
      duration_seconds: dur,
      rr_packets: [...rrBufferRef.current],
      ecg_frames: [...ecgBufferRef.current],
    };
    rrBufferRef.current = [];
    ecgBufferRef.current = [];
    setSessionActive(false);
    setSessionId(null);
    setSessionStartedAt(0);
    setSessionRrCount(0);
    setSessionEcgCount(0);
    return data;
  }, []);

  // ── ECG recording (separate from streaming session) ───────────────────────
  const startRecording = useCallback(() => {
    recordBuffer.current = [];
    hrDuringRecord.current = [];
    recordStartTime.current = Date.now();
    isRecordingRef.current = true;
    setRecording(true);
  }, []);

  const stopRecording = useCallback((): RecordingSummary => {
    isRecordingRef.current = false;
    setRecording(false);
    const ecg = [...recordBuffer.current];
    const hrs = hrDuringRecord.current;
    const durationSeconds = Math.round((Date.now() - recordStartTime.current) / 1000);
    const heartRateAvg = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
    const heartRateMax = hrs.length ? Math.max(...hrs) : null;
    setEcgRecorded(ecg);
    recordBuffer.current = [];
    hrDuringRecord.current = [];
    return { ecg, durationSeconds, heartRateAvg, heartRateMax };
  }, []);

  return {
    // BLE
    status,
    deviceName,
    heartRate,
    rrIntervals,
    battery,
    ecgLive,
    ecgSampleTotal,
    ecgFrame,
    ecgRecorded,
    recording,
    error,
    connect,
    disconnect,
    resubscribeHR,
    startRecording,
    stopRecording,
    // Streaming session
    sessionActive,
    sessionId,
    sessionStartedAt,
    sessionRrCount,
    sessionEcgCount,
    startSessionCapture,
    stopSessionCapture,
  };
}
