'use client';

import { createContext, useContext, ReactNode } from 'react';
import { usePolarH10 } from '../hooks/usePolarH10';

type PolarH10ContextValue = ReturnType<typeof usePolarH10>;

const PolarH10Context = createContext<PolarH10ContextValue | null>(null);

export function PolarH10Provider({ children }: { children: ReactNode }) {
  const polar = usePolarH10();
  return <PolarH10Context.Provider value={polar}>{children}</PolarH10Context.Provider>;
}

export function usePolarH10Context(): PolarH10ContextValue {
  const ctx = useContext(PolarH10Context);
  if (!ctx) throw new Error('usePolarH10Context used outside PolarH10Provider');
  return ctx;
}
