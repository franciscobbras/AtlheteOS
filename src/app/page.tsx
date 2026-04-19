import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AthleteOS</p>
          <h1>Sync training video with Polar H10 ECG insights</h1>
          <p>
            Upload your session files, visualize heart rate data in time with your footage,
            and review performance from a modern, athlete-first dashboard.
          </p>
          <div className="hero-actions">
            <Link href="/upload" className="button primary">
              Upload Session
            </Link>
            <Link href="/dashboard" className="button secondary">
              View Dashboard
            </Link>
          </div>
        </div>

        <div className="hero-panel card">
          <h2>Designed for athletes</h2>
          <ol>
            <li>Upload a video recording and ECG export from Polar.</li>
            <li>Let AthleteOS sync your session automatically.</li>
            <li>Analyze heart performance and playback the footage together.</li>
          </ol>
        </div>
      </section>

      <section className="feature-grid">
        <div className="card">
          <h3>Fast upload workflow</h3>
          <p>Keep your sessions flowing with a streamlined uploader built for training files.</p>
        </div>
        <div className="card">
          <h3>Clear session insights</h3>
          <p>Review synchronized ECG charts and video playback in one place.</p>
        </div>
        <div className="card">
          <h3>Modern athlete dashboard</h3>
          <p>Track progress across workouts with polished visual summaries.</p>
        </div>
      </section>
    </div>
  );
}
