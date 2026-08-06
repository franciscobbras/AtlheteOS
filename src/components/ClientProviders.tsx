'use client';

import { ReactNode } from 'react';
import { PolarH10Provider } from '../contexts/PolarH10Context';
import ServiceWorkerRegister from './ServiceWorkerRegister';

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <PolarH10Provider>
      <ServiceWorkerRegister />
      {children}
    </PolarH10Provider>
  );
}
