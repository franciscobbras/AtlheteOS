'use client';

import React, { useState } from 'react';

const UploadForm = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [ecgFile, setEcgFile] = useState<File | null>(null);
  const [macrofactorFile, setMacrofactorFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    if (!videoFile && !ecgFile && !macrofactorFile) {
      setError('Select at least one file to upload.');
      setLoading(false);
      return;
    }

    const formData = new FormData();
    if (videoFile) formData.append('video', videoFile);
    if (ecgFile) formData.append('ecg', ecgFile);
    if (macrofactorFile) formData.append('macrofactor', macrofactorFile);

    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Upload failed');
      }
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
      <div className="upload-section">
        <label className="field-label" htmlFor="video-upload">Video file</label>
        <input id="video-upload" className="input" type="file" accept="video/*"
          onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
        <p className="field-hint">Optional — upload session video if available.</p>
      </div>

      <div className="upload-section">
        <label className="field-label" htmlFor="ecg-upload">ECG file</label>
        <input id="ecg-upload" className="input" type="file" accept=".csv"
          onChange={(e) => setEcgFile(e.target.files?.[0] || null)} />
        <p className="field-hint">Optional — CSV export from Polar.</p>
      </div>

      <div className="upload-section">
        <label className="field-label" htmlFor="macrofactor-upload">Macrofactor data</label>
        <input id="macrofactor-upload" className="input" type="file" accept=".csv,.json"
          onChange={(e) => setMacrofactorFile(e.target.files?.[0] || null)} />
        <p className="field-hint">Optional — JSON or CSV macrofactor export.</p>
      </div>

      <div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Uploading…' : 'Upload session'}
        </button>
      </div>

      {error && <p className="message message-error">{error}</p>}
      {success && <p className="message message-success">Upload successful!</p>}
    </form>
  );
};

export default UploadForm;
