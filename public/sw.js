/*
 * Service worker MÍNIMO — só o necessário para a app ser instalável no Chrome
 * (que exige um handler de `fetch`). NÃO há estratégia de offline nem fila de
 * submissões: o check-in é feito em casa com wifi. Manter propositadamente vazio.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Handler de fetch pass-through: existe para satisfazer o critério de
// instalabilidade, mas não intercepta nada — deixa o browser fazer a rede.
self.addEventListener('fetch', () => {});
