'use client';

import { useEffect } from 'react';

/**
 * Regista o service worker mínimo (/sw.js) — critério de instalabilidade PWA.
 * Só em produção (evita interferir com o HMR do dev). Sem UI.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* silencioso: não bloquear a app */ });
  }, []);
  return null;
}
