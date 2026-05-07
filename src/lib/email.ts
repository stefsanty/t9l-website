/**
 * v1.79.0 — Generic SMTP mailer.
 *
 * Wraps `nodemailer` over the same `EMAIL_SERVER` SMTP URL that NextAuth's
 * `EmailProvider` (magic-link sign-in) already uses. We reuse those env vars
 * rather than introducing a new transport so operators only manage one
 * SMTP connection across the platform.
 *
 *   - `EMAIL_SERVER` — SMTP connection string (e.g. `smtps://user:pass@host:465`)
 *   - `EMAIL_FROM`   — From address (e.g. `T9L <noreply@t9l.me>`)
 *
 * Both must be set for sends to actually land. When either is unset
 * (local dev, preview deploys without SMTP, and during the v1.79.0
 * cutover before operators provision the env vars), `sendMail` resolves
 * silently as a no-op — there's nothing meaningful to do, and throwing
 * would break the post-application redirect.
 *
 * Callers MUST queue this via `waitUntil(...)` so SMTP latency stays off
 * the response critical path.
 */
import { createTransport, type Transporter } from 'nodemailer'

export interface SendMailInput {
  to: string
  subject: string
  text: string
  html: string
}

export interface SendMailResult {
  status: 'sent' | 'skipped' | 'error'
  reason?: string
}

let cachedTransporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (cachedTransporter) return cachedTransporter
  const server = process.env.EMAIL_SERVER
  if (!server) return null
  cachedTransporter = createTransport(server)
  return cachedTransporter
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const transporter = getTransporter()
  const from = process.env.EMAIL_FROM
  if (!transporter || !from) {
    return { status: 'skipped', reason: 'EMAIL_SERVER or EMAIL_FROM not configured' }
  }
  try {
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    })
    return { status: 'sent' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', reason: message }
  }
}

/**
 * Test-only seam — clears the cached transporter so a test that swaps
 * env vars between cases sees the new value. Production code never calls
 * this.
 */
export function __resetMailerForTesting(): void {
  cachedTransporter = null
}
