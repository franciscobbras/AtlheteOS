import WearableRawInspector from '@/components/WearableRawInspector';

export const dynamic = 'force-dynamic';

// Dados crus do wearable (o que antes vivia no fim do /life). Só isto — sem os
// cartões de mock (nutrição/wellbeing/goals) que estavam à volta.
export default function WearableDataPage() {
  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">wearable_data</h1>
      </div>
      <WearableRawInspector />
    </div>
  );
}
