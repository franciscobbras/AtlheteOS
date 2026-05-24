'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
    // On success the browser navigates away — no state reset needed
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center' }}>
        <h1>Check your email</h1>
        <p>
          A magic link was sent to <strong>{email}</strong>. Click it to sign in.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: '80px auto' }}>
      <h1 style={{ marginBottom: 24 }}>Sign in to Nexus</h1>

      {/* Google SSO */}
      <button
        onClick={handleGoogleSignIn}
        disabled={googleLoading}
        style={{
          width: '100%',
          padding: '10px 16px',
          fontSize: 15,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginBottom: 20,
          border: '1px solid #dadce0',
          borderRadius: 4,
          background: '#fff',
          color: '#3c4043',
        }}
      >
        <GoogleIcon />
        {googleLoading ? 'Redirecting…' : 'Sign in with Google'}
      </button>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <hr style={{ flex: 1, margin: 0 }} />
        <span style={{ fontSize: 13, color: '#666' }}>or use a magic link</span>
        <hr style={{ flex: 1, margin: 0 }} />
      </div>

      {/* Magic link form */}
      <form onSubmit={handleMagicLink}>
        <div style={{ marginBottom: 12 }}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 16,
              boxSizing: 'border-box',
            }}
          />
        </div>
        <button type="submit" disabled={loading} style={{ padding: '8px 20px', cursor: 'pointer' }}>
          {loading ? 'Sending…' : 'Send magic link'}
        </button>
      </form>

      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
