'use client';

import { ReactNode } from 'react';
import { PolarH10Provider } from '../contexts/PolarH10Context';
import { DayDataProvider } from '../contexts/DayDataContext';
import ServiceWorkerRegister from './ServiceWorkerRegister';

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <PolarH10Provider>
      <ServiceWorkerRegister />
      <DayDataProvider>{children}</DayDataProvider>
    </PolarH10Provider>
  );
}
