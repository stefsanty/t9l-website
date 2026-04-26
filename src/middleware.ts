import { withAuth } from 'next-auth/middleware'

export default withAuth({
  callbacks: {
    authorized: ({ token }) => token?.isAdmin === true,
  },
  pages: {
    signIn: '/admin/login',
  },
})

export const config = {
  matcher: ['/admin', '/admin/((?!login).*)'],
}
