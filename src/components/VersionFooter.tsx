import { APP_VERSION } from '@/lib/version'

/**
 * Small, subtle version label. Used by the public-site root layout and the
 * admin shell. Pulls from `lib/version.ts` so a release bump is one line.
 *
 * Variant `public` matches the apex public-site neutral palette.
 * Variant `admin` matches the dark admin-shell tokens.
 */
export default function VersionFooter({
  variant = 'public',
}: {
  variant?: 'public' | 'admin'
}) {
  const className =
    variant === 'admin'
      ? 'text-admin-text3'
      : 'text-fg-low'
  return (
    <footer
      data-testid="version-footer"
      className={`${className} text-[10px] uppercase tracking-[0.2em] text-center py-3 font-mono`}
    >
      v{APP_VERSION}
    </footer>
  )
}
