'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import VideoPlayer from './VideoPlayer';
import PolarECGChart from './PolarECGChart';

const DashboardSync = () => {
  const [sessionData, setSessionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/sync');
        if (!response.ok) {
          throw new Error('Failed to load session details');
        }

        const data = await response.json();
        setSessionData(data?.[0] || null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const videoUrl = sessionData?.video_url || sessionData?.video?.url || sessionData?.videoUrl || sessionData?.video || null;
  const ecgCsv = sessionData?.ecg || sessionData?.ecg_values || sessionData?.csv || sessionData?.ecg_csv || null;
  const macrofactor = sessionData?.macrofactor || sessionData?.macrofactor_data || sessionData?.macrofactorValues || sessionData?.macrofactor_data || null;
  const rawData = sessionData?.raw_data || sessionData?.raw || sessionData?.rawData || null;

  const parseEcg = () => {
    if (!ecgCsv) return null;
    if (Array.isArray(ecgCsv)) return ecgCsv;
    if (typeof ecgCsv === 'string') {
      const values = ecgCsv
        .split(/\r?\n|,|;/)
        .map((value) => parseFloat(value.trim()))
        .filter((value) => !Number.isNaN(value));
      return values.length ? values : null;
    }
    return null;
  };

  const ecgData = parseEcg();
  const rawPreviewData = rawData && rawData.length > 0 ? rawData : ecgData || [];
  const hasRawPreview = rawPreviewData && rawPreviewData.length > 0;

  const sessionStart = sessionData?.created_at ? new Date(sessionData.created_at) : null;
  const recordedAt = sessionStart ? sessionStart.toLocaleString() : null;

  const createTimeLabels = (length: number) => {
    const start = sessionStart || new Date();
    return Array.from({ length }, (_, index) => {
      const sampleTime = new Date(start.getTime() + index * 1000);
      return sampleTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    });
  };

  const ecgLabels = ecgData ? createTimeLabels(ecgData.length) : undefined;

  return (
    <div className="dashboard-content">
      <div className="dashboard-header">
        <h2>First layer session view</h2>
        <p className="subheading">
          Inspect raw telemetry, ECG waveform, video playback, and macrofactor context in one view.
        </p>
        {recordedAt && <p className="subheading">Session recorded: {recordedAt}</p>}
      </div>

      {loading && <div className="info-card">Loading session data…</div>}
      {error && <div className="message error">{error}</div>}

      {!loading && !error && (
        <>
          <section className="dashboard-grid">
            <div className="video-card">
              <div className="preview-heading">Uploaded video</div>
                {videoUrl ? (
                <VideoPlayer videoUrl={videoUrl} />
              ) : (
                <div className="empty-state">Video preview will appear here after upload.</div>
              )}
            </div>
            <div className="chart-card">
              <div className="preview-heading">ECG waveform</div>
              {ecgData ? (
                <>
                  <PolarECGChart ecgData={ecgData} labels={ecgLabels} />
                  <div className="detail-actions">
                    <Link href="/dashboard/detail" className="button secondary small">
                      Open ECG detail view
                    </Link>
                  </div>
                </>
              ) : (
                <div className="empty-state">ECG chart will appear here after upload.</div>
              )}
            </div>
          </section>

          <section className="raw-grid">
            <div className="card raw-card">
              <h3>Raw data</h3>
              {hasRawPreview ? (
                <pre className="raw-preview">{JSON.stringify(rawPreviewData.slice(0, 8), null, 2)}</pre>
              ) : (
                <div className="empty-state">Raw sensor values will show here once ECG or raw data is available.</div>
              )}
            </div>
            <div className="card macro-card">
              <h3>Macrofactor data</h3>
              {macrofactor ? (
                <pre className="raw-preview">{JSON.stringify(macrofactor, null, 2)}</pre>
              ) : (
                <div className="empty-state">Upload macrofactor metrics to populate this panel.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default DashboardSync;
