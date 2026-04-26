import { redirect } from 'next/navigation'

type Props = { params: Promise<{ id: string }> }

export default async function LeaguePage({ params }: Props) {
  const { id } = await params
  redirect(`/admin/leagues/${id}/schedule`)
}
