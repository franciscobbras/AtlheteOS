'use client';

/**
 * Botão de entrada para o registo de treino, no dashboard.
 *
 * Ao montar, verifica se há sessão em curso (get_open_session): se houver, o
 * botão passa a "Retomar treino" e o ecrã de /train retoma o estado exato. Não
 * há redireccionamento forçado — o dashboard continua a ser a página de entrada;
 * daqui é um toque para o ecrã ao vivo.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getOpenSession } from '@/lib/training';

export default function TrainingEntry() {
  const [openSession, setOpenSession] = useState(false);

  useEffect(() => {
    let alive = true;
    getOpenSession()
      .then((s) => { if (alive) setOpenSession(!!s); })
      .catch(() => { /* silencioso: o botão faz na mesma o start em /train */ });
    return () => { alive = false; };
  }, []);

  return (
    <Link
      href="/train"
      className="btn btn-primary btn-lg"
      style={{ height: 52, textDecoration: 'none' }}
    >
      {openSession ? 'Retomar treino' : 'Iniciar treino'}
    </Link>
  );
}
