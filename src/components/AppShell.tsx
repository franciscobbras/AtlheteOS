'use client';

import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import Breadcrumb from './Breadcrumb';
import Link from 'next/link';

const STANDALONE_ROUTES = ['/', '/login', '/auth'];

function isStandalone(path: string): boolean {
  return STANDALONE_ROUTES.includes(path) || path.startsWith('/auth/');
}

const DRAWER_ITEMS = [
  { href: '/dashboard', label: 'Training' },
  { href: '/nutrition', label: 'Nutrition' },
  { href: '/life',      label: 'Life' },
  { href: '/student',   label: 'Student' },
  { href: '/live',      label: 'Live' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (isStandalone(pathname)) {
    return (
      <div className="standalone-layout">
        <header className="standalone-header">
          <button
            onClick={() => setDrawerOpen(v => !v)}
            className="standalone-brand"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Nexus
          </button>
        </header>

        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 29 }}
          />
        )}

        <aside style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: 220,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.22s ease',
        }}>
          <div style={{ padding: '0 20px 24px', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Nexus
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
            {DRAWER_ITEMS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setDrawerOpen(false)}
                className="sidebar-link"
              >
                <span className="sidebar-link-label">{label}</span>
              </Link>
            ))}
          </nav>
        </aside>

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
