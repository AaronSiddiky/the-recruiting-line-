import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Next 16 renamed Middleware to Proxy. Its only job here is refreshing the
 * Supabase session cookie and bouncing signed-out users to /login.
 *
 * Twilio webhooks are excluded: they arrive with no cookies and authenticate
 * by request signature instead.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // getUser() revalidates the token with Supabase. Do not swap this for
  // getSession(), which trusts whatever cookie the browser sent.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = pathname === '/login' || pathname.startsWith('/auth')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/leads'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  /*
   * Only the dialer/CRM is behind sign-in. The marketing site (/, /api/lead,
   * icons, hero media) is public, so it never runs through here.
   *
   * Twilio webhooks (/api/twilio) must never be redirected to /login -- Twilio
   * would see a 307 and mark the call failed. The session routes (/api/session)
   * are left out for cost, not correctness: each one calls getUser() and checks
   * that the session belongs to the caller, and the dialer polls one of them
   * every 1.5 seconds while lines are out.
   */
  matcher: [
    '/login',
    '/auth/:path*',
    '/leads/:path*',
    '/crm/:path*',
    '/dialer/:path*',
    '/stats/:path*',
    '/clients/:path*',
    '/health/:path*',
    '/api/clients/:path*',
    '/companies/:path*',
    '/lead-list/:path*',
    '/api/calls/:path*',
    '/api/recordings/:path*',
    '/api/voicemail/:path*',
    '/api/spotify/:path*',
  ],
}
