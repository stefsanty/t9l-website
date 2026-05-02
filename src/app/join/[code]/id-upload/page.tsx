import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import IdUploadForm from './IdUploadForm'

/**
 * v1.35.0 (PR η of the onboarding chain) — ID upload step.
 *
 * Inserted between `submitOnboarding` (form completion) and `/welcome`.
 * Without an upload, `onboardingStatus` stays NOT_YET; admin sees the
 * un-uploaded state in the players list and follows up.
 *
 * Two consent contexts:
 *   - Front + back image inputs.
 *   - Consent line: "We will only ever use your ID for the sole purpose
 *     of booking more courts for the league" (per operator decision
 *     2026-05-02).
 *
 * Operator-side gate: writes require `BLOB_READ_WRITE_TOKEN` on Vercel.
 * Without it, the page renders a "service unavailable" surface with a
 * Skip button that calls `skipIdUpload` to flip the status anyway —
 * admin will collect ID out-of-band. The same Skip option is also
 * available when BLOB IS configured (the user might not have their
 * ID handy at sign-up time).
 *
 * Idempotent re-visit:
 *   - User comes back with onboardingStatus already COMPLETED → bounce
 *     to /welcome.
 *   - User comes back with form not yet submitted (no name) → bounce
 *     to /onboarding.
 *   - User comes back with form submitted but no ID upload → render
 *     the upload form (this is the steady state).
 */

interface Props {
  params: Promise<{ code: string }>
}

export default async function IdUploadPage({ params }: Props) {
  const { code } = await params

  const session = await getServerSession(authOptions)
  const userId = (session as { userId?: string | null } | null)?.userId ?? null
  if (!userId) redirect(`/join/${code}`)

  const invite = await prisma.leagueInvite.findUnique({
    where: { code },
    select: { leagueId: true },
  })
  if (!invite) redirect(`/join/${code}`)

  const [league, assignment] = await Promise.all([
    prisma.league.findUnique({
      where: { id: invite.leagueId },
      select: { id: true, name: true, subdomain: true },
    }),
    prisma.playerLeagueAssignment.findFirst({
      where: {
        leagueTeam: { leagueId: invite.leagueId },
        player: { userId },
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            idFrontUrl: true,
            idBackUrl: true,
            idUploadedAt: true,
          },
        },
      },
    }),
  ])

  if (!league || !assignment) redirect(`/join/${code}`)

  // Idempotent re-visit handling.
  if (assignment.onboardingStatus === 'COMPLETED') {
    redirect(`/join/${code}/welcome`)
  }
  if (!assignment.player.name) {
    // Form not submitted yet — route them through the form first.
    redirect(`/join/${code}/onboarding`)
  }

  const blobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN
  const alreadyUploaded = !!assignment.player.idUploadedAt

  return (
    <main
      className="min-h-dvh flex items-start justify-center px-4 py-8 bg-background"
      data-testid="join-id-upload"
    >
      <div className="max-w-md w-full bg-surface rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-fg-mid text-sm mb-1">{league.name}</p>
        <h1 className="text-2xl font-display font-bold text-fg-high mb-3">
          One last step — ID check
        </h1>
        <p className="text-fg-mid text-sm mb-2">
          We need a photo of the front and back of your ID. We will only ever use
          your ID for the sole purpose of booking more courts for the league.
        </p>
        {alreadyUploaded && (
          <p
            className="text-fg-mid text-xs mb-4 italic"
            data-testid="id-already-uploaded-note"
          >
            You've already uploaded an ID. Submitting again replaces the previous one.
          </p>
        )}

        {blobConfigured ? (
          <IdUploadForm
            code={code}
            playerId={assignment.player.id}
          />
        ) : (
          <BlobUnconfiguredFallback code={code} playerId={assignment.player.id} />
        )}
      </div>
    </main>
  )
}

function BlobUnconfiguredFallback({ code, playerId }: { code: string; playerId: string }) {
  // Inline use of skipIdUpload via a form post so we don't need to make
  // this whole component a client component just for one button.
  return (
    <div data-testid="id-upload-blob-unavailable">
      <div className="rounded-lg border border-border-default bg-background p-3 mb-4 text-sm text-fg-mid">
        ID upload service is being set up. Your league admin will collect your ID
        separately. Click below to finish onboarding now.
      </div>
      <SkipForm code={code} playerId={playerId} label="Skip — admin will collect" />
    </div>
  )
}

function SkipForm({ code, playerId, label }: { code: string; playerId: string; label: string }) {
  // Server-action form post for the skip path — no client JS needed.
  // Uses the standard server-action `formAction` pattern with a hidden
  // input for the playerId since `skipIdUpload` takes a structured
  // input rather than FormData.
  async function handleSkip(formData: FormData) {
    'use server'
    const { skipIdUpload } = await import('../actions')
    await skipIdUpload({
      code: formData.get('code') as string,
      playerId: formData.get('playerId') as string,
    })
  }
  return (
    <form action={handleSkip}>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="playerId" value={playerId} />
      <button
        type="submit"
        className="w-full rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
        data-testid="id-upload-skip"
      >
        {label}
      </button>
    </form>
  )
}
