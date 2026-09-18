import { redirect } from 'next/navigation'
import PlacesClient from '@/components/places/PlacesClient'
import { getPlaces, getSessionUser } from '@/lib/queries'

export default async function PlacesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // リストは全員で共有している（0040）。誰が入れたかでは絞らない
  const places = await getPlaces()

  return <PlacesClient userId={user.id} places={places} />
}
