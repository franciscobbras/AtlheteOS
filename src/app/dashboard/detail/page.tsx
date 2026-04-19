'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const DetailedECGChart = dynamic(
  () => import('../../../components/DetailedECGChart'),
  { ssr: false }
);

const DashboardDetailPage = () => {
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

  const ecgCsv = sessionData?.ecg || sessionData?.ecg_values || sessionData?.csv || sessionData?.ecg_csv || null;
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
  const sessionStart = sessionData?.created_at ? new Date(sessionData.created_at) : null;
  const recordedAt = sessionStart ? sessionStart.toLocaleString() : 'Unknown';

  const createTimeLabels = (length: number) => {
    const start = sessionStart || new Date();
    return Array.from({ length }, (_, index) => {
      const sampleTime = new Date(start.getTime() + index * 1000);
      return sampleTime.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    });
  };

  const ecgLabels = ecgData ? createTimeLabels(ecgData.length) : [];

  return (
    <div className="page-shell">
      <div className="panel">
        <div className="detail-header">
          <div>
            <h1>ECG Detail View</h1>
            <p className="subheading">Zoom, pan and inspect the ECG trace with timeline markers.</p>
            <p className="session-info">Session recorded: {recordedAt}</p>
          </div>
          <Link href="/dashboard" className="button secondary small">
            Back to dashboard
          </Link>
        </div>

        {loading && <div className="info-card">Loading session data…</div>}
        {error && <div className="message error">{error}</div>}

        {!loading && !error && (
          <div className="detail-chart-container">
            {ecgData ? (
              <DetailedECGChart ecgData={ecgData} labels={ecgLabels} startLabel={recordedAt} />
            ) : (
              <div className="empty-state">No ECG trace available for this session.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardDetailPage;
