import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const isAdmin = req.nextauth.token?.isAdmin === true
    if (req.nextUrl.pathname.startsWith('/admin') && !isAdmin) {
      return NextResponse.redirect(new URL('/', req.url))
    }
    return NextResponse.next()
  },
  {
    callbacks: {
      // Let everyone through — the middleware fn above handles the admin gate.
      // Returning false here would cause next-auth to redirect to /?callbackUrl=...
      authorized: () => true,
    },
  }
)

export const config = {
  matcher: ['/admin/:path*'],
}
