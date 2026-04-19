import '../styles/globals.css';
import Link from 'next/link';
import { ReactNode } from 'react';

export const metadata = {
  title: 'AthleteOS',
  description: 'Upload video and ECG data from Polar H10',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="site-header">
            <div className="container">
              <Link href="/" className="site-brand">
                AthleteOS
              </Link>
              <nav className="site-nav">
                <Link href="/upload">Upload</Link>
                <Link href="/dashboard">Dashboard</Link>
              </nav>
            </div>
          </header>

          <main className="container">{children}</main>

          <footer className="footer">
            <div className="container">
              AthleteOS — sync training video and ECG data with confidence.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
