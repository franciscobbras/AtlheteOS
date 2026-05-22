'use client';

import { ReactNode } from 'react';
import { PolarH10Provider } from '../contexts/PolarH10Context';

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <PolarH10Provider>{children}</PolarH10Provider>;
}
