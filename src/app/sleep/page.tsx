import SleepHistory from '@/components/SleepHistory';

// Tab "Sleep" — histórico do Sleep Score: o mesmo detalhe do dashboard, para
// qualquer dia, com navegação dia-a-dia e um calendário mensal dos scores. É
// para aqui que o card do Sleep Score no dashboard navega (já não abre modal).
export default function SleepPage() {
  return (
    <div className="animate-fade-in" style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Sleep</h1>
      </div>
      <SleepHistory />
    </div>
  );
}
