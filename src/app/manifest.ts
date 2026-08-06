import type { MetadataRoute } from 'next';

// Web app manifest — servido em /manifest.webmanifest, ligado automaticamente
// pelo Next no <head>. Instalável no Android; abre direto no check-in.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Nexus',
    short_name: 'Nexus',
    description: 'Registo matinal e recuperação',
    display: 'standalone',
    // Direto no check-in: menos fricção mal acordo. NÃO substitui o gate cego —
    // é só onde a app abre.
    start_url: '/checkin',
    scope: '/',
    theme_color: '#0A0A0B',
    background_color: '#0A0A0B',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Sem maskable o Android recorta o ícone num círculo e corta o glifo.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Check-in matinal',
        short_name: 'Check-in',
        url: '/checkin',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
