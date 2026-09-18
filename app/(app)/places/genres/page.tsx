import { redirect } from 'next/navigation'
import GenresClient from '@/components/places/GenresClient'
import { getPlaceGenres, getSessionUser } from '@/lib/queries'

export default async function PlaceGenresPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // 候補は全員で共有している（0044）
  const genres = await getPlaceGenres()

  return <GenresClient genres={genres} />
}
