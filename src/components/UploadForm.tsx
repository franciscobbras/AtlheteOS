'use client';

import React, { useState } from 'react';

const UploadForm = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [ecgFile, setEcgFile] = useState<File | null>(null);
  const [macrofactorFile, setMacrofactorFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setVideoFile(event.target.files?.[0] || null);
  };

  const handleEcgChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEcgFile(event.target.files?.[0] || null);
  };

  const handleMacrofactorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setMacrofactorFile(event.target.files?.[0] || null);
  };

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
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error || 'Upload failed';
        throw new Error(message);
      }

      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <div className="field-group">
        <label className="field-label" htmlFor="video-upload">
          Video File
        </label>
        <input
          id="video-upload"
          className="file-input"
          type="file"
          accept="video/*"
          onChange={handleVideoChange}
        />
        <p className="field-hint">Optional: upload video if available.</p>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="ecg-upload">
          ECG File
        </label>
        <input
          id="ecg-upload"
          className="file-input"
          type="file"
          accept=".csv"
          onChange={handleEcgChange}
        />
        <p className="field-hint">Optional: upload ECG data to populate the waveform and raw preview.</p>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="macrofactor-upload">
          Macrofactor Data
        </label>
        <input
          id="macrofactor-upload"
          className="file-input"
          type="file"
          accept=".csv,.json"
          onChange={handleMacrofactorChange}
        />
        <p className="field-hint">
          Upload macrofactor metrics for advanced session context. JSON or CSV accepted.
        </p>
      </div>

      <button className="button primary" type="submit" disabled={loading}>
        {loading ? 'Uploading...' : 'Upload session'}
      </button>

      {error && <p className="message error">{error}</p>}
      {success && <p className="message success">Upload successful!</p>}
    </form>
  );
};

export default UploadForm;
