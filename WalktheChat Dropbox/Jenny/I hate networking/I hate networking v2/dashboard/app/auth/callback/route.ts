import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  const redirectTo = request.nextUrl.clone()
  redirectTo.searchParams.delete('code')

  if (!code) {
    redirectTo.pathname = '/login'
    redirectTo.searchParams.set('error', 'auth_failed')
    return NextResponse.redirect(redirectTo)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    redirectTo.pathname = '/login'
    redirectTo.searchParams.set('error', 'auth_failed')
    return NextResponse.redirect(redirectTo)
  }

  // Redirect to login with flag so it can sync session to extension, then forward to /contacts
  redirectTo.pathname = '/login'
  redirectTo.searchParams.set('authenticated', '1')
  return NextResponse.redirect(redirectTo)
}
