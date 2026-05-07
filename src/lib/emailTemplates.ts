/**
 * v1.79.0 — Transactional email templates.
 *
 * Pure builders — return `{ subject, text, html }` for a given input. No
 * I/O. Kept separate from `lib/email.ts` so the templates are unit-testable
 * without touching `nodemailer`.
 */

export interface ApplicationReceivedInput {
  leagueName: string
  playerName: string
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function applicationReceivedEmail(
  input: ApplicationReceivedInput,
): RenderedEmail {
  const { leagueName, playerName } = input
  const subject = `Application received — ${leagueName}`

  const text = [
    `Hi ${playerName},`,
    '',
    `We've received your application to ${leagueName}.`,
    '',
    `What happens next: a league admin will review your application and let you know once you're approved. You don't need to do anything in the meantime.`,
    '',
    `Thanks for applying!`,
    `— The ${leagueName} team`,
  ].join('\n')

  const html = [
    `<p>Hi ${escapeHtml(playerName)},</p>`,
    `<p>We've received your application to <strong>${escapeHtml(leagueName)}</strong>.</p>`,
    `<p><strong>What happens next:</strong> a league admin will review your application and let you know once you're approved. You don't need to do anything in the meantime.</p>`,
    `<p>Thanks for applying!<br>— The ${escapeHtml(leagueName)} team</p>`,
  ].join('\n')

  return { subject, text, html }
}
