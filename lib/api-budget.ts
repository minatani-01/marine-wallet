import { createClient } from '@/lib/supabase/server'

/**
 * 外部APIの使い過ぎを止める。
 *
 * Google マップは無料の範囲（各API 月10,000回）を超えると課金される。
 * Google Cloud 側の割り当て上限が最後の砦だが、アプリからも数えて止める。
 * 割り当ての設定を忘れていたり、あとから外れたりしたときに、請求で
 * 気付くのでは遅い。ここで止めれば、そもそも呼ばない。
 *
 * 上限は無料の範囲よりかなり低く置いてある。2〜3人で使うアプリなので、
 * 普通に使っていて当たることはない。当たったらその日は地図が出ないだけで、
 * リストと「地図で開く」は使える。
 */

export type ApiName = 'maps_js' | 'geocoding' | 'places_search'

/** 1日と1か月の上限。月10,000回の無料枠に対して十分低く取る */
export const API_BUDGET: Record<ApiName, { daily: number; monthly: number }> = {
  // 地図の読み込み。1日200回は、2〜3人で開く回数としては多すぎるくらい
  maps_js: { daily: 200, monthly: 8000 },
  // 座標の取得。場所を登録・編集したときだけ呼ぶ
  geocoding: { daily: 100, monthly: 2000 },
  // 店の検索。打つたびではなく、検索を押したときだけ1回呼ぶ。
  // 名前・住所・座標を受け取る形は無料枠が月5,000回なので、そこより低く取る
  places_search: { daily: 50, monthly: 1000 },
}

export type Spend = {
  allowed: boolean
  used_today: number
  used_month: number
  daily: number
  monthly: number
}

/**
 * rpc が呼べれば何でもよい。ログイン中のユーザーがいる画面からは
 * server クライアント、Cron からは admin クライアントを渡す。
 */
type RpcClient = {
  rpc: (
    fn: 'spend_api_call',
    args: { p_api: string; p_daily: number; p_monthly: number }
  ) => PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * 1回ぶん使う。上限に達していれば allowed=false を返し、数は増やさない。
 *
 * 数えられなかったとき（DBに届かないなど）は使わせない。
 * 数えずに呼ぶより、地図が出ないほうがましである。
 */
export async function spendApiCall(api: ApiName, client?: RpcClient): Promise<Spend> {
  const { daily, monthly } = API_BUDGET[api]
  const supabase = client ?? (await createClient())

  const { data, error } = await supabase.rpc('spend_api_call', {
    p_api: api,
    p_daily: daily,
    p_monthly: monthly,
  })

  if (error || !data) {
    return { allowed: false, used_today: daily, used_month: monthly, daily, monthly }
  }
  return data as Spend
}
