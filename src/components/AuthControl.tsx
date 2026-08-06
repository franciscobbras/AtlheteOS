'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

// Initials from the Google full name (→ "FB"), falling back to the email.
function initialsOf(user: User): string {
  const meta = user.user_metadata ?? {};
  const name = (meta.full_name || meta.name || '') as string;
  if (name.trim()) {
    const parts = name.trim().split(/\s+/);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? '');
    const ini = (a + b).toUpperCase();
    if (ini) return ini.slice(0, 2);
  }
  const email = user.email ?? '';
  return email ? email.slice(0, 2).toUpperCase() : '?';
}

export default function AuthControl() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  // Reserve the slot even before the session resolves, to avoid layout shift.
  if (!ready) return <div style={{ width: 32, height: 32 }} />;

  if (!user) {
    return (
      <Link href="/login" className="btn btn-primary btn-sm">
        Login
      </Link>
    );
  }

  const initials = initialsOf(user);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={user.email ?? 'Account'}
        aria-label="Account menu"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '1px solid var(--border)',
          background: 'var(--accent, #4F8CFF)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        {initials}
      </button>

      {open && (
        <>
          {/* click-away overlay */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 8px)',
              zIndex: 51,
              minWidth: 200,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius, 10px)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              padding: 10,
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>
              {user.email}
            </p>
            <button onClick={signOut} className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
