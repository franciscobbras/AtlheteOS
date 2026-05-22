import '../styles/globals.css';
import { ReactNode } from 'react';
import ClientProviders from '../components/ClientProviders';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'Nexus',
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
        <ClientProviders>
          <AppShell>{children}</AppShell>
        </ClientProviders>
      </body>
    </html>
  );
}
