import { redirect } from 'next/navigation'
import PlacesClient from '@/components/places/PlacesClient'
import { getPlaceGenres, getPlaces, getSessionUser } from '@/lib/queries'

export default async function PlacesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // リストもジャンルの候補も全員で共有している（0040 / 0044）
  const [places, genreOptions] = await Promise.all([getPlaces(), getPlaceGenres()])

  return <PlacesClient userId={user.id} places={places} genreOptions={genreOptions} />
}
