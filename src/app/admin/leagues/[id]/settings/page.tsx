import { notFound } from 'next/navigation'
import { getLeagueSettings } from '@/lib/admin-data'
import SettingsTab from '@/components/admin/SettingsTab'

type Props = { params: Promise<{ id: string }> }

export default async function SettingsPage({ params }: Props) {
  const { id } = await params
  const league = await getLeagueSettings(id)
  if (!league) notFound()

  return <SettingsTab league={league} />
}
