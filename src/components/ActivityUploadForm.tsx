'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACTIVITY_TYPES = ['Run', 'Bike', 'Swim', 'Strength', 'Other'];

const ActivityUploadForm = () => {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [type, setType] = useState('Run');
  const [durationMin, setDurationMin] = useState('');
  const [notes, setNotes] = useState('');
  const [ecgFile, setEcgFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [macrofactorFile, setMacrofactorFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setLoading(true);
    setError(null);

    try {
      let videoUrl: string | null = null;

      // Upload files if provided
      if (videoFile || ecgFile || macrofactorFile) {
        const formData = new FormData();
        if (videoFile) formData.append('video', videoFile);
        if (ecgFile) formData.append('ecg', ecgFile);
        if (macrofactorFile) formData.append('macrofactor', macrofactorFile);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) {
          const b = await uploadRes.json().catch(() => null);
          throw new Error(b?.error || 'File upload failed');
        }
        const uploadData = await uploadRes.json();
        videoUrl = uploadData.videoUrl ?? null;
      }

      // Parse ECG values
      let ecgValues: number[] | null = null;
      if (ecgFile) {
        const text = await ecgFile.text();
        ecgValues = text
          .split(/\r?\n|,|;/)
          .map((v) => parseFloat(v.trim()))
          .filter((v) => !Number.isNaN(v));
      }

      // Create activity record
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          type,
          duration_seconds: durationMin ? Math.round(parseFloat(durationMin) * 60) : null,
          notes: notes.trim() || null,
          ecg: ecgValues,
          video_url: videoUrl,
          source: 'manual',
        }),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error || 'Failed to save activity');
      }

      router.push('/activities');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      {/* Activity metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="field-group">
          <label className="field-label" htmlFor="act-title">Activity name *</label>
          <input
            id="act-title"
            className="file-input"
            placeholder="e.g. Morning run"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="act-type">Type</label>
          <select
            id="act-type"
            className="file-input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            {ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="field-group">
          <label className="field-label" htmlFor="act-duration">Duration (minutes)</label>
          <input
            id="act-duration"
            className="file-input"
            type="number"
            min="0"
            placeholder="e.g. 45"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="act-notes">Notes</label>
          <input
            id="act-notes"
            className="file-input"
            placeholder="Optional notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* File uploads */}
      <div className="field-group">
        <label className="field-label" htmlFor="act-ecg">ECG file</label>
        <input id="act-ecg" className="file-input" type="file" accept=".csv"
          onChange={(e) => setEcgFile(e.target.files?.[0] || null)} />
        <p className="field-hint">Optional — CSV export from Polar.</p>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="act-video">Video file</label>
        <input id="act-video" className="file-input" type="file" accept="video/*"
          onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
        <p className="field-hint">Optional — session video recording.</p>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="act-mf">Macrofactor data</label>
        <input id="act-mf" className="file-input" type="file" accept=".csv,.json"
          onChange={(e) => setMacrofactorFile(e.target.files?.[0] || null)} />
        <p className="field-hint">Optional — JSON or CSV macrofactor export.</p>
      </div>

      {error && <p className="message error">{error}</p>}

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="button primary" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save activity'}
        </button>
        <button type="button" className="button secondary" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
};

export default ActivityUploadForm;
