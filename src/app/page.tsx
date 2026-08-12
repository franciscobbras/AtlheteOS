import { redirect } from 'next/navigation';

// A página de entrada é a dashboard. A antiga landing (Polar H10 / vídeo) foi
// removida. Não autenticado → o middleware redireciona para /login antes disto.
export default function HomePage() {
  redirect('/dashboard');
}
