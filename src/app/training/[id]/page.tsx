import SessionDetail from '@/components/SessionDetail';

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionDetail sessionId={id} />;
}
