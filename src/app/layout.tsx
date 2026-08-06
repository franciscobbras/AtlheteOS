import '../styles/globals.css';
import { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import ClientProviders from '../components/ClientProviders';
import AppShell from '../components/AppShell';

export const metadata: Metadata = {
  title: 'Nexus',
  description: 'Registo matinal e recuperação',
  // O manifest (/manifest.webmanifest) é ligado automaticamente a partir de
  // app/manifest.ts. Aqui só os extras que o manifest não cobre.
  applicationName: 'Nexus',
  appleWebApp: {
    capable: true,            // standalone no iOS (Adicionar ao ecrã principal)
    title: 'Nexus',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    // iOS ignora o maskable — precisa de um PNG opaco 180×180 próprio.
    apple: '/apple-touch-icon.png',
    icon: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  // Cor da barra de estado do Android em standalone — a condizer com o tema escuro.
  themeColor: '#0A0A0B',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClientProviders>
          <AppShell>{children}</AppShell>
        </ClientProviders>
      </body>
    </html>
  );
}
