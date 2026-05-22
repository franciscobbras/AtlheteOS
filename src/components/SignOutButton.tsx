'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <button
      onClick={handleSignOut}
      style={{
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--text-secondary)',
        transition: 'color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
    >
      Sign out
    </button>
  );
}
