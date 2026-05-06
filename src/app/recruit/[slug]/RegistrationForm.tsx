'use client'

import { useRouter } from 'next/navigation'
import RegistrationFields from '@/components/registration/RegistrationFields'
import { registerToLeague } from '@/app/api/recruiting/actions'

/**
 * v1.68.0 — `/recruit/[slug]` form, single-page name + position + ID
 * front + ID back + (optional) profile picture.
 *
 * Pre-v1.68.0 the form collected only name + position via
 * `applyToLeague`. ID upload was missing entirely — users couldn't
 * complete registration as a non-invited recruit. v1.68.0 routes
 * through `registerToLeague` (FormData) which handles every Blob
 * upload and the atomic Player + PLM creation in one shot.
 *
 * On success: router.push(`/id/<slug>`) where the apex
 * RecruitingBanner shows State B ("Application submitted").
 */

interface Props {
  leagueId: string
  leagueSlug: string
  leagueName: string
}

export default function RegistrationForm({ leagueId, leagueSlug, leagueName }: Props) {
  const router = useRouter()

  async function handleSubmit(formData: FormData) {
    formData.append('leagueId', leagueId)
    const result = await registerToLeague(formData)
    if (!result.ok) {
      throw new Error(result.error)
    }
    router.push(`/id/${leagueSlug}`)
  }

  return (
    <div data-testid="recruit-registration-form">
      <RegistrationFields
        submitLabel={`Apply to ${leagueName}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
