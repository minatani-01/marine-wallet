// ============================================================================
// Marine Wallet 共通型定義
// ============================================================================

// ---------------------------------------------------------------- 共通 ----
export type Profile = {
  id: string
  display_name: string
  marine_id: string
  /**
   * プロフィールアイコンの保存先（member-avatars バケット上のパス）。
   * null なら表示名の頭文字を表示する。
   */
  avatar_path: string | null
  /**
   * マスター権限。true のアカウントが送った接続リクエストは、
   * 相手の承認を待たずに接続される（0013）。アプリからは変更できない。
   */
  is_master: boolean
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------- 貯金 ----
export type Phase = 'regular' | 'interleague' | 'cs' | 'nippon_series'
export type GameResult = 'win' | 'lose' | 'draw'
export type HomeAway = 'home' | 'away'
export type PitchingHighlight =
  | 'none'
  | 'quality_start'
  | 'complete_game'
  | 'shutout'
  | 'no_hitter'
  | 'perfect_game'

export type Game = {
  id: string
  game_date: string
  opponent: string
  phase: Phase
  /** 旧アプリから移行した試合は不明（null） */
  home_away: HomeAway | null
  stadium: string
  result: GameResult
  is_sayonara: boolean
  marines_score: number | null
  opponent_score: number | null
  /** 満塁HRを含まない本塁打数 */
  home_runs: number
  grand_slams: number
  /** マルチ安打を記録した選手数 */
  multi_hits: number
  rbi: number
  pitching_highlight: PitchingHighlight
  is_winning_pitcher: boolean
  has_save: boolean
  /**
   * その他ボーナス。試合の事実なので全員で同じ値を使う。
   * 単価が人それぞれの勝利やホームランと違い、ここは共通データに置く。
   */
  other_amount: number
  other_note: string
  source: 'manual' | 'npb'
  created_by: string | null
  created_at: string
  updated_at: string
}

export type BreakdownLine = {
  key: string
  label: string
  amount: number
}

export type SavingKind = 'game' | 'custom'

export type SavingEntry = {
  id: string
  user_id: string
  /** kind='custom' のときは null */
  game_id: string | null
  kind: SavingKind
  /** カスタム登録の内容。自動登録では空文字 */
  title: string
  entry_date: string
  /** 'YYYY-MM'（DB側の生成列） */
  month: string
  amount: number
  breakdown: BreakdownLine[]
  other_amount: number
  other_note: string
  created_at: string
  updated_at: string
}

/** 試合を結合した積立。カスタム登録では game が null になる */
export type SavingEntryRow = SavingEntry & { game: Game | null }

/**
 * 貯金ルール。全アカウント共通で、DBには1行だけ置く（0017）。
 * 変更できるのはマスターと、マスターが共有設定で変更を許可した相手だけ。
 */
export type SavingRules = {
  win_amount: number
  draw_amount: number
  lose_amount: number
  sayonara_bonus: number
  home_run_amount: number
  grand_slam_amount: number
  multi_hit_amount: number
  rbi_amount: number
  perfect_game_amount: number
  no_hitter_amount: number
  shutout_amount: number
  complete_game_amount: number
  quality_start_amount: number
  winning_pitcher_amount: number
  save_amount: number
  multiplier_regular: number
  multiplier_interleague: number
  multiplier_cs: number
  multiplier_nippon_series: number
}

/**
 * カスタム登録の「定型」。
 *
 * NPB から取得できない記録は人によって増えるので、
 * アプリに直書きせず行として持ち、貯金ルールの画面から増やせるようにする。
 * 貯金ルールと同じく全アカウント共通。
 */
export type SavingCustomPreset = {
  id: string
  label: string
  amount: number
  sort_order: number
  /** 自動登録が使う定型。カスタム登録の選択肢には出さず、金額だけ変えられる */
  auto: boolean
}

/**
 * 行った球場の記録（0038）。
 *
 * 球場そのものは DB に置かず、lib/stadiums.ts のマスタを id で指す。
 * 記録は人ごと。カスタム登録や割り勘と違い、ここは人によって中身が変わる。
 */
export type StadiumVisit = {
  id: string
  user_id: string
  /** lib/stadiums.ts の Stadium.id */
  stadium_id: string
  visited_on: string
  /** 観戦した試合。試合の無い日の来場なら null */
  game_id: string | null
  note: string
  /** 一緒に行った人。空なら一人で行った（0039） */
  companions: string[]
  /** この行を作った人。写しかどうかの判別に使う */
  created_by: string | null
}

/**
 * 行きたい場所・行った場所（0040）。
 * 行った日が入っていれば「行った」側。全員で共有する。
 */
export type PlaceKind = 'sight' | 'food'

/** また行きたいか。空はまだどちらとも言っていない */
export type Revisit = '' | 'yes' | 'no'


export type Place = {
  id: string
  kind: PlaceKind
  name: string
  area: string
  /** ジャンル（焼肉・寿司など）。複数可（0049） */
  genres: string[]
  /** 食材（牛・豚・鴨など）。ジャンルとは別の軸（0049） */
  ingredients: string[]
  url: string
  note: string
  /** 行った日。null なら「行きたい」側 */
  visited_on: string | null
  /** また行きたいか（0046）。'yes' リピあり / 'no' リピなし / '' まだ決めていない */
  revisit: Revisit
  created_by: string | null
  /** 名前と場所から引いた座標（0041）。引けなければ null で、地図には出ない */
  lat: number | null
  lng: number | null
  /**
   * Google が返した営業状態（0045）。OPERATIONAL / CLOSED_TEMPORARILY /
   * CLOSED_PERMANENTLY のいずれか。空は「まだ確かめていない」
   */
  business_status: string
  /** 最後に確かめた日時。null なら一度も確かめていない */
  status_checked_at: string | null
  /** 種別・ジャンルを Google から取り込んだ日時（0051）。null はまだ */
  types_checked_at: string | null
}

/** ジャンルと食材の候補（0044 / 0049）。設定画面から足せる */
export type PlaceTagKind = 'genre' | 'ingredient'

export type PlaceGenre = {
  id: string
  name: string
  sort_order: number
  kind: PlaceTagKind
}

/**
 * これからの試合の観戦予定（0048）。日付で試合を指す。
 * 自分のぶんと、接続している相手のぶんが入る。
 */
export type GamePlan = {
  id: string
  user_id: string
  game_date: string
}

/**
 * これからの試合（npb_games 由来）。
 * 日程ページに載っている内容をそのまま持つ。中止もここに入る。
 */
export type ScheduledGame = {
  game_date: string
  home_team: string
  away_team: string
  place: string
  start_time: string
  /** 'scheduled' | 'finished' | 'cancelled' */
  status: string
  note: string
}

/**
 * シーズンぶんの試合（npb_games 由来）。対戦ごとの試合数を数えるのに使う。
 *
 * 中止になった試合の振替日は、決まるまで日程ページに出てこない。相手ごとの
 * 試合数を比べれば、何試合が宙に浮いているのかが分かる。
 */
export type SeasonGame = {
  game_date: string
  home_team: string
  away_team: string
  /** 'scheduled' | 'finished' | 'cancelled' */
  status: string
}

/**
 * リーグ順位（0047）。毎朝の取り込みで計算して入れ替える。
 * 順位は「いま何位か」を出すためだけに使う。
 */
export type Standing = {
  team: string
  /** 'p' パ・リーグ / 'c' セ・リーグ */
  league: string
  win: number
  lose: number
  draw: number
  rate: number | null
  rank: number
  /** 首位とのゲーム差 */
  games_behind: number
  /** 集計に入れた最後の試合日 */
  as_of: string | null
}

/** 貯金を共にしている人。同行者を選ぶときに使う（名前だけ） */
export type CircleMember = {
  id: string
  member_name: string
  is_self: boolean
}

/**
 * まもなく達成する記録。ホームのカウントダウンに使う。
 * 毎朝の取り込みで作り直すので、履歴は持たない。
 */
export type UpcomingMilestoneRow = {
  id: string
  kind: 'batting' | 'pitching'
  /** npb.jp の見出しそのまま（例: 2000安打） */
  record_label: string
  holder: string
  /** 背番号。名鑑から引けなければ空 */
  uniform_number: string
  target: number
  unit: string
  /** 通算（昨年まで + 今季） */
  current: number
  remaining: number
}

/** 月末フロー。入金はワンバンク側で一度に終わるので中間状態は持たない */
export type MonthlyStatus = 'calculating' | 'ready' | 'deposited'

export type MonthlySaving = {
  id: string
  user_id: string
  month: string
  status: MonthlyStatus
  confirmed_amount: number | null
  confirmed_at: string | null
  deposited_at: string | null
  note: string
  created_at: string
  updated_at: string
}

// -------------------------------------------------------------- 割り勘 ----
export type SplitStatus = 'unpaid' | 'paid'
export type SplitFilter = 'unpaid' | 'all' | 'paid'
export type SortOrder = 'desc' | 'asc'
export type SplitType = 'equal' | 'ratio' | 'amount'
export type ExpenseCategory = 'ticket' | 'food' | 'beer' | 'goods' | 'transport' | 'other'

export type SplitMember = {
  id: string
  user_id: string
  name: string
  is_self: boolean
  sort_order: number
  /**
   * このメンバーの Marine ID。登録すると、接続済みのそのアカウントから
   * このメンバーが参加している割り勘だけが見えるようになる（0007のRLS）。
   */
  marine_id: string | null
  /** 割り勘に参加するか */
  join_split: boolean
  /** 貯金に参加するか（総累計貯金額の集計対象になる） */
  join_saving: boolean
  /**
   * member-avatars バケット上のパス。null なら名前の頭文字を表示する。
   * バケットは非公開なので、パスをそのまま画像のURLにはできない。
   */
  avatar_path: string | null
  created_at: string
  updated_at: string
}

/**
 * 画面に渡すメンバー。
 * avatar_url は avatar_path から都度発行する署名付きURLで、DBの列ではない。
 * 発行に失敗したときや写真が未設定のときは null になり、頭文字表示に戻る。
 */
export type SplitMemberView = SplitMember & { avatar_url: string | null }

export type Share = {
  member: string
  /** 比率指定時の比率、金額指定時の入力金額。均等割の場合は null */
  value: number | null
  /** このメンバーの最終的な負担額（円）。合計は amount と必ず一致する */
  burden: number
}

export type SplitRecord = {
  id: string
  user_id: string
  /** 払った日 */
  date: string
  /** 何月何日分か。観戦日・予約日など、払った日と違うときだけ入る（0052） */
  target_date: string | null
  content: string
  amount: number
  payer: string
  status: SplitStatus
  split_type: SplitType
  /** 参加人数。shares.length と一致する（2以上） */
  member_count: number
  shares: Share[]
  category: ExpenseCategory
  game_id: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------- Marine Link (Phase 4) ----
/** 共有できるリソース。観戦情報 / Marine Day / Beer Log は Phase 5 以降で追加する */
export type LinkResource = 'saving' | 'saving_rules' | 'monthly' | 'split'
export type MarineLinkStatus = 'pending' | 'accepted' | 'rejected'

export type MarineLinkRow = {
  id: string
  /** リクエストを送った側 */
  user_a: string
  /** 受け取った側 */
  user_b: string
  status: MarineLinkStatus
  requested_by: string
  responded_at: string | null
  created_at: string
  updated_at: string
}

export type LinkPermissionRow = {
  id: string
  marine_link_id: string
  /** 共有する側。相手はこの行が true のリソースだけを見られる */
  owner_id: string
  resource_type: LinkResource
  permission: boolean
  created_at: string
  updated_at: string
}

export type LinkResourceFlags = Record<LinkResource, boolean>

/** 画面が扱いやすい形にまとめた接続 */
export type MarineLinkView = {
  id: string
  status: MarineLinkStatus
  partner_id: string
  /** 相手のプロフィールが読めないときは空文字 */
  partner_name: string
  partner_marine_id: string
  /** 自分が送ったリクエストか */
  outgoing: boolean
  /** 自分が相手に見せているもの */
  shared: LinkResourceFlags
  /** 相手が自分に見せているもの */
  received: LinkResourceFlags
  created_at: string
}

/** 仕様書 16章の月間比較 */
export type LinkMonthlyCompare = {
  partner_id: string
  partner_name: string
  /** 相手が貯金を共有していないときは null */
  partner_amount: number | null
}

/**
 * 貯金の参加者ごとの累計（0008 の saving_circle_totals）。
 *
 * confirmed は「月末に確定した月次金額」の合計で、今月など未確定の月は含まない。
 * pending は未確定の月の見込みで、累計には足さない。
 * 相手が貯金を共有していない場合は is_visible=false になり、0円と区別できる。
 */
/**
 * どの通知を受け取るか。行が無いときは全部 true とみなす。
 * 列名は lib/push.ts の NotifyCategory と揃える。
 */
export type NotificationPreferences = {
  games: boolean
  savings: boolean
  split: boolean
  link: boolean
}

export type SavingCircleTotal = {
  member_name: string
  marine_id: string
  is_self: boolean
  is_visible: boolean
  confirmed: number
  pending: number
}

// ------------------------------------------------- 共同貯金（仕様書17章） ----
export type SharedGoalRow = {
  id: string
  marine_link_id: string
  title: string
  target_amount: number
  /** 'YYYY-MM'。null は期間の制限なし */
  start_month: string | null
  end_month: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/**
 * 共同目標のメンバーごとの進捗。
 * confirmed は月末に確定した月次金額の合計で、未確定の月は pending に入る。
 */
export type SharedGoalMemberProgress = {
  user_id: string
  display_name: string
  marine_id: string
  confirmed: number
  pending: number
}

export type SharedGoalView = SharedGoalRow & {
  progress: SharedGoalMemberProgress[]
  /** 確定済みの合計。達成率はこの値で見る */
  confirmed_total: number
  /** 未確定の見込み合計。達成率には入れない */
  pending_total: number
}

// ------------------------------------------------------------ からだ ----
/**
 * オートファジーの設定（0053 / 0054）。
 *
 * 決めるのは「何時から何時間食べないか」。食べてよい時間はその残りなので
 * 持たない。時刻は 'HH:MM:SS' で返る（Postgres の time）。判定は
 * lib/autophagy.ts にまとめてあり、'HH:MM' の先頭一致で読む。
 */
export type AutophagySettings = {
  user_id: string
  enabled: boolean
  /** 食べない時間の始まり（日本時間） */
  fast_start: string
  /** 食べない時間の長さ（時間）。終わりはこれを足して出す */
  fast_hours: number
  notify_eat: boolean
  notify_fast: boolean
  last_notified_at: string | null
  last_notified_kind: 'eat' | 'fast' | null
  created_at: string
  updated_at: string
}
