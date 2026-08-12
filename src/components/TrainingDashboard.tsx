'use client';

/**
 * Dashboard. Por agora mostra apenas o cartão do Sleep Score (que inclui o SRI
 * fundido). Os cartões de mock (sessões, gráficos, CTL/ATL, readiness fictícia)
 * e a landing antiga foram removidos — nada de valores hardcoded aqui.
 */

import SleepScoreCard from './SleepScoreCard';
import TrainingEntry from './TrainingEntry';

export default function TrainingDashboard() {
  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      <SleepScoreCard />
      <TrainingEntry />
    </div>
  );
}
