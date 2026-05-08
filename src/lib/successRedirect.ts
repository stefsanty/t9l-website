/**
 * v1.81.0 — Helpers for the post-submit success-popup redirect pattern.
 *
 * Recruiting + onboarding server actions accept an optional `originPath`
 * captured at form-mount time on the originating page. On success the
 * action calls `redirect(buildSuccessRedirect(originPath, descriptor, fallback))`
 * which appends `?submitted=<descriptor>` so the originating page's
 * `<SuccessConfirmationGate>` mounts the modal.
 *
 * `originPath` is user-supplied (form field), so it MUST be validated to
 * an absolute path on this origin — never a full URL, never a
 * protocol-relative `//`, never a path-traversal-shaped value. The
 * validator returns the input on pass or `null` on fail; callers fall
 * back to a known-safe absolute path.
 */

const SAFE_PATH_RE = /^\/[^\/].*$|^\/$/

export function safeOriginPath(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  // Reject empty, protocol-relative, full URL, and any control characters.
  if (input === '' || input.includes('\n') || input.includes('\r')) return null
  if (input.startsWith('//')) return null
  if (!SAFE_PATH_RE.test(input)) return null
  // Defense-in-depth: refuse explicit traversal sequences.
  if (input.includes('..')) return null
  if (input.length > 512) return null
  return input
}

/**
 * Build the post-submit redirect URL. The `submitted=<descriptor>`
 * query param triggers the success popup on the destination page; any
 * existing query string on `originPath` is preserved.
 */
export function buildSuccessRedirect(
  originPath: string | null | undefined,
  descriptor: string,
  fallback: string,
): string {
  const safe = safeOriginPath(originPath) ?? fallback
  const sep = safe.includes('?') ? '&' : '?'
  return `${safe}${sep}submitted=${encodeURIComponent(descriptor)}`
}
