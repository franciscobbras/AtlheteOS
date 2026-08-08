import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Ficheiros estáticos da PWA que TÊM de ser públicos (pedidos pelo Chrome sem
// credenciais). Sem isto, o middleware de auth redireciona (307) o manifest e o
// Chrome do Android deixa de oferecer "Instalar app". NÃO afeta o gate cego do
// check-in — isto é só sobre os assets da PWA.
const PUBLIC_PWA_ASSETS = new Set([
  '/manifest.webmanifest',
  '/sw.js',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Assets públicos da PWA — sem verificação de sessão (defesa; o matcher abaixo
  // já os exclui, mas isto garante-o mesmo que o matcher mude).
  if (PUBLIC_PWA_ASSETS.has(pathname)) {
    return NextResponse.next();
  }

  // Allow auth routes through without a session check
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Forward cookie mutations to both the request and the response
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() refreshes the session token if needed — never use getSession() in middleware
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals, static files e os assets públicos da PWA
    // (manifest.webmanifest e sw.js têm de ser servidos sem redirect de auth,
    // senão o Chrome do Android não oferece "Instalar app"). Os ícones já eram
    // apanhados pela regra de extensões (.png); .webmanifest e .ico juntam-se-lhe.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)',
  ],
};
