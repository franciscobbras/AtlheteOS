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

export function usePolarH10() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [rrIntervals, setRrIntervals] = useState<number[]>([]);
  const [battery, setBattery] = useState<number | null>(null);
  const [ecgLive, setEcgLive] = useState<number[]>([]);
  const [ecgSampleTotal, setEcgSampleTotal] = useState(0);
  const [ecgRecorded, setEcgRecorded] = useState<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const polar = useRef<PolarH10 | null>(null);
  const recordBuffer = useRef<number[]>([]);
  const isRecordingRef = useRef(false);
  const recordStartTime = useRef<number>(0);
  const hrDuringRecord = useRef<number[]>([]);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);

    polar.current = new PolarH10({
      onHeartRate(bpm, rr) {
        setHeartRate(bpm);
        setRrIntervals(rr);
        if (isRecordingRef.current) hrDuringRecord.current.push(bpm);
      },
      onEcgSamples(samples) {
        setEcgLive((prev) => {
          const next = [...prev, ...samples];
          return next.length > MAX_LIVE_ECG_SAMPLES
            ? next.slice(next.length - MAX_LIVE_ECG_SAMPLES)
            : next;
        });
        setEcgSampleTotal((prev) => prev + samples.length);
        if (isRecordingRef.current) {
          recordBuffer.current.push(...samples);
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
      },
    });

    try {
      const name = await polar.current.connect();
      setDeviceName(name);
      setStatus('connected');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
      polar.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    polar.current?.disconnect();
    polar.current = null;
    setStatus('idle');
    setHeartRate(null);
    setBattery(null);
    setEcgLive([]);
  }, []);

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
    status,
    deviceName,
    heartRate,
    rrIntervals,
    battery,
    ecgLive,
    ecgSampleTotal,
    ecgRecorded,
    recording,
    error,
    connect,
    disconnect,
    startRecording,
    stopRecording,
  };
}
