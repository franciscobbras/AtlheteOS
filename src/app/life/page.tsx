import SleepHistory from '@/components/SleepHistory';

// Tab "Life" — histórico do Sleep Score: o mesmo detalhe do dashboard, para
// qualquer dia, com navegação dia-a-dia e um calendário mensal dos scores.
export default function LifePage() {
  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Life</h1>
      </div>
      <SleepHistory />
    </div>
  );
}
