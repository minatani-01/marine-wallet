import type { Place } from '@/types'

/**
 * 店が続いているかどうかの扱い。
 *
 * DB も通信もしない純関数にしてある。Google の言葉をそのまま持ち、
 * こちらで「閉店」と言い切らない。一時休業と閉店を取り違えないため。
 */

export const OPERATIONAL = 'OPERATIONAL'
export const CLOSED_TEMPORARILY = 'CLOSED_TEMPORARILY'
export const CLOSED_PERMANENTLY = 'CLOSED_PERMANENTLY'

/** 画面に出す言葉。空（未確認）と営業中は何も出さない */
export function statusLabel(status: string): string | null {
  if (status === CLOSED_PERMANENTLY) return '閉店'
  if (status === CLOSED_TEMPORARILY) return '休業中'
  return null
}

/** 閉店・休業のどちらか。一覧で色を変える判定に使う */
export function isClosed(place: Pick<Place, 'business_status'>): boolean {
  return place.business_status === CLOSED_PERMANENTLY || place.business_status === CLOSED_TEMPORARILY
}

/**
 * 突き合わせ用に名前をならす。
 *
 * 空白・記号・全角半角のゆれで別物と判定すると、営業中の店を
 * 「確かめられなかった」に落としてしまう。
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/[（）()【】[\]「」『』・,，.．ー―‐-]/g, '')
    .toLowerCase()
}

/**
 * 検索で返ってきた店が、同じ店かどうか。
 *
 * 名前で探しているので、別の店が返ってくることがある。同じ店だと
 * 言い切れないときに状態を書き込むと、無関係の店の閉店をこちらの店に
 * 付けてしまう。どちらかがもう一方を含む程度には似ていることを求める。
 */
export function sameShop(stored: string, found: string): boolean {
  const a = normalizeName(stored)
  const b = normalizeName(found)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * 何日おきに確かめるか。
 *
 * 「月に1回程度」なので25日にしてある。ちょうど30日にすると、日々の
 * 実行時刻のずれで1か月に1回入らない月ができる。少し短くしておく。
 */
export const CHECK_INTERVAL_DAYS = 25

/** これより前に確かめたものが、今日の確認の対象になる */
export function dueBefore(now: Date): string {
  return new Date(now.getTime() - CHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * 確認のときに Google へ渡す言葉。
 *
 * 店名だけだと同名の別店舗が返る。場所（幕張・千葉 など）を足して絞る。
 */
export function checkQuery(place: Pick<Place, 'name' | 'area'>): string {
  return [place.name, place.area].filter(Boolean).join(' ').trim()
}

/**
 * 検索結果から、書き込んでよい状態を決める。
 *
 * 同じ店だと言い切れないときは null を返し、状態には触らない。
 * 見つからなかっただけで「閉店」にしてしまうと、営業している店が
 * 消える候補として並ぶ。分からないことは分からないままにする。
 */
export function statusFromHit(
  storedName: string,
  hit: { name: string; status: string } | null
): string | null {
  if (!hit || !hit.status) return null
  if (!sameShop(storedName, hit.name)) return null
  return hit.status
}

/** 閉店・休業だけを残す */
export function filterClosed<T extends Pick<Place, 'business_status'>>(places: T[]): T[] {
  return places.filter(isClosed)
}
