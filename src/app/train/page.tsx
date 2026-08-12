import TrainSession from '@/components/TrainSession';

// Estado de treino é sempre ao vivo — nunca pré-renderizar.
export const dynamic = 'force-dynamic';

export default function TrainPage() {
  return <TrainSession />;
}
