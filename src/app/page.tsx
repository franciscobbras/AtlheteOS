import Link from 'next/link';
import HomeSignalsStrip from '@/components/HomeSignalsStrip';

export default function HomePage() {
  return (
    <div className="animate-fade-in">
      <section className="hero">
        <div>
          <p className="hero-eyebrow">Nexus</p>
          <h1>Sync training video with Polar H10 ECG insights</h1>
          <p className="hero-desc">
            Upload your session files, visualize heart rate data in time with your footage,
            and review performance from a modern, nexus-powered dashboard.
          </p>
          <div className="hero-actions">
            <Link href="/live" className="btn btn-primary btn-lg">
              Live Session
            </Link>
            <Link href="/upload" className="btn btn-secondary btn-lg">
              Upload Session
            </Link>
            <Link href="/dashboard" className="btn btn-secondary btn-lg">
              View Dashboard
            </Link>
          </div>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Designed for athletes</h2>
          <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', display: 'grid', gap: 10 }}>
            <li style={{ lineHeight: 1.7, fontSize: 14 }}>Upload a video recording and ECG export from Polar.</li>
            <li style={{ lineHeight: 1.7, fontSize: 14 }}>Let Nexus sync your session automatically.</li>
            <li style={{ lineHeight: 1.7, fontSize: 14 }}>Analyze heart performance and playback the footage together.</li>
          </ol>
        </div>
      </section>

      <HomeSignalsStrip />

      <section className="feature-grid stagger">
        <div className="card animate-slide-up" style={{ padding: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h3>Fast upload workflow</h3>
          <p>Keep your sessions flowing with a streamlined uploader built for training files.</p>
        </div>
        <div className="card animate-slide-up" style={{ padding: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h3>Clear session insights</h3>
          <p>Review synchronized ECG charts and video playback in one place.</p>
        </div>
        <div className="card animate-slide-up" style={{ padding: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'rgba(168,85,247,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <h3>Modern Nexus dashboard</h3>
          <p>Track progress across workouts with polished visual summaries.</p>
        </div>
      </section>
    </div>
  );
}
