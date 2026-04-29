import { getAllVenuesWithUsage } from '@/lib/admin-data'
import VenuesList from '@/components/admin/VenuesList'

export default async function VenuesPage() {
  const venues = await getAllVenuesWithUsage()
  return <VenuesList venues={venues} />
}
