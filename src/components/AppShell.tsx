'use client';

import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Breadcrumb from './Breadcrumb';
import Link from 'next/link';

/** Routes that use standalone layout (no sidebar) */
const STANDALONE_ROUTES = ['/', '/login', '/auth'];

function isStandalone(path: string): boolean {
  return STANDALONE_ROUTES.includes(path) || path.startsWith('/auth/');
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isStandalone(pathname)) {
    return (
      <div className="standalone-layout">
        <header className="standalone-header">
          <Link href="/" className="standalone-brand">
            <span style={{
              width: 24,
              height: 24,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 9,
              color: '#fff',
              flexShrink: 0,
            }}>
              NXS
            </span>
            Nexus
          </Link>
          <nav className="standalone-nav">
            <Link href="/live">Live</Link>
            <Link href="/dashboard">Training</Link>
            <Link href="/nutrition">Nutrition</Link>
            <Link href="/life">Life</Link>
            <Link href="/student">Student</Link>
          </nav>
        </header>
        <main className="standalone-body">{children}</main>
        <footer className="footer">
          Nexus — sync training video and ECG data with confidence.
        </footer>
      </div>
    );
  }

  return (
    <div className="sidebar-layout">
      <Sidebar />
      <div className="main-content">
        <div className="main-topbar">
          <Breadcrumb />
        </div>
        <main className="main-body animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
