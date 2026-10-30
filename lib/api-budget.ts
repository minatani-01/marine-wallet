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

export type ApiName =
  | 'maps_js'
  | 'geocoding'
  | 'places_search'
  | 'places_nearby'
  | 'places_rating'
  | 'routes_walk'

/** 1日と1か月の上限。月10,000回の無料枠に対して十分低く取る */
export const API_BUDGET: Record<ApiName, { daily: number; monthly: number }> = {
  // 地図の読み込み。1日200回は、2〜3人で開く回数としては多すぎるくらい
  maps_js: { daily: 200, monthly: 8000 },
  // 座標の取得。場所を登録・編集したときだけ呼ぶ
  geocoding: { daily: 100, monthly: 2000 },
  // 店の検索。打つたびではなく、検索を押したときだけ1回呼ぶ。
  // 名前・住所・座標を受け取る形は無料枠が月5,000回なので、そこより低く取る
  places_search: { daily: 50, monthly: 1000 },
  // 賃貸さがしの建物名（0075）。1回の検索で、範囲の広さに応じて数回呼ぶ
  places_nearby: { daily: 60, monthly: 1200 },
  // 賃貸さがしの飲食店（0079）。口コミの評価まで受け取るので、名前や住所
  // だけのものより課金の区分が一段上になる。別に数えて、別に止める
  places_rating: { daily: 40, monthly: 800 },
  // 賃貸さがしの徒歩時間（0075）。数えるのは呼び出し回数ではなく、
  // 課金の単位である element 数（駅数 × 建物数）。回数で数えると、
  // 1回の検索で200件ぶん使っても1と数えてしまい、止める意味が無くなる
  routes_walk: { daily: 600, monthly: 8000 },
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
    fn: 'spend_api_call' | 'spend_api_calls',
    args: Record<string, unknown>
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

/**
 * まとめて n 回ぶん使う（0074）。
 *
 * 徒歩時間の実測のように、1回の呼び出しで何十回ぶんも課金されるものに使う。
 * 足りなければ1つも使わせない。半分だけ測った一覧は、入っている建物と
 * 入っていない建物が混ざるだけで、見るほうが判断できない。
 */
export async function spendApiCalls(
  api: ApiName,
  count: number,
  client?: RpcClient
): Promise<Spend> {
  const { daily, monthly } = API_BUDGET[api]
  const supabase = client ?? (await createClient())

  const { data, error } = await supabase.rpc('spend_api_calls', {
    p_api: api,
    p_count: Math.max(1, Math.round(count)),
    p_daily: daily,
    p_monthly: monthly,
  })

  if (error || !data) {
    return { allowed: false, used_today: daily, used_month: monthly, daily, monthly }
  }
  return data as Spend
}
