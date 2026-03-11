import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as 'signup' | 'email' | null

  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = '/campaigns'
  redirectTo.searchParams.delete('token_hash')
  redirectTo.searchParams.delete('type')

  if (!token_hash || !type) {
    redirectTo.pathname = '/login'
    redirectTo.searchParams.set('error', 'invalid_link')
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

  const { error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error) {
    redirectTo.pathname = '/login'
    redirectTo.searchParams.set('error', 'confirmation_failed')
    return NextResponse.redirect(redirectTo)
  }

  // Email confirmed + session set via cookies — go to dashboard
  redirectTo.pathname = '/login'
  redirectTo.searchParams.set('confirmed', '1')
  return NextResponse.redirect(redirectTo)
}
