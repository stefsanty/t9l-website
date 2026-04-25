import { withAuth } from 'next-auth/middleware'

export default withAuth({
  callbacks: {
    authorized: ({ token }) => token?.isAdmin === true,
  },
  pages: {
    signIn: '/',
  },
})

export const config = {
  matcher: ['/admin/:path*'],
}
