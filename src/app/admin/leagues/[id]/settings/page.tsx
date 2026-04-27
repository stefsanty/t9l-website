import { notFound } from 'next/navigation'
import { getLeagueSettings } from '@/lib/admin-data'
import SettingsTab from '@/components/admin/SettingsTab'
import { getDataSource, getWriteMode } from '@/lib/settings'

type Props = { params: Promise<{ id: string }> }

export default async function SettingsPage({ params }: Props) {
  const { id } = await params
  const [league, dataSource, writeMode] = await Promise.all([
    getLeagueSettings(id),
    getDataSource(),
    getWriteMode(),
  ])
  if (!league) notFound()

  return (
    <SettingsTab
      league={league}
      initialDataSource={dataSource}
      initialWriteMode={writeMode}
    />
  )
}
