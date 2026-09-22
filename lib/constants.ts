import type {
  ExpenseCategory,
  LinkResource,
  GameResult,
  HomeAway,
  MonthlyStatus,
  Phase,
  PitchingHighlight,
} from '@/types'

export const APP_NAME = 'Marine Wallet'
export const TEAM_NAME = 'CHIBA LOTTE MARINES'

/** 対戦相手（id は旧 baseball-savings アプリと互換） */
export const OPPONENTS: { id: string; label: string; short: string }[] = [
  { id: 'fighters', label: '日本ハム', short: 'FIGHTERS' },
  { id: 'eagles', label: '楽天', short: 'EAGLES' },
  { id: 'lions', label: '西武', short: 'LIONS' },
  { id: 'hawks', label: 'ソフトバンク', short: 'HAWKS' },
  { id: 'buffaloes', label: 'オリックス', short: 'BUFFALOES' },
  { id: 'giants', label: '巨人', short: 'GIANTS' },
  { id: 'tigers', label: '阪神', short: 'TIGERS' },
  { id: 'dragons', label: '中日', short: 'DRAGONS' },
  { id: 'baystars', label: 'DeNA', short: 'BAYSTARS' },
  { id: 'carp', label: '広島', short: 'CARP' },
  { id: 'swallows', label: 'ヤクルト', short: 'SWALLOWS' },
]

export function opponentLabel(id: string): string {
  return OPPONENTS.find((o) => o.id === id)?.label ?? id
}

export const PHASES: { id: Phase; label: string; ruleKey: keyof PhaseMultiplierMap }[] = [
  { id: 'regular', label: 'レギュラー', ruleKey: 'multiplier_regular' },
  { id: 'interleague', label: '交流戦', ruleKey: 'multiplier_interleague' },
  { id: 'cs', label: 'CS', ruleKey: 'multiplier_cs' },
  { id: 'nippon_series', label: '日本シリーズ', ruleKey: 'multiplier_nippon_series' },
]

export type PhaseMultiplierMap = {
  multiplier_regular: number
  multiplier_interleague: number
  multiplier_cs: number
  multiplier_nippon_series: number
}

export function phaseLabel(id: Phase): string {
  return PHASES.find((p) => p.id === id)?.label ?? id
}

export const RESULTS: { id: GameResult; label: string }[] = [
  { id: 'win', label: '勝利' },
  { id: 'draw', label: '引き分け' },
  { id: 'lose', label: '敗北' },
]

export function resultLabel(id: GameResult, isSayonara = false): string {
  if (id === 'win' && isSayonara) return 'サヨナラ勝利'
  return RESULTS.find((r) => r.id === id)?.label ?? id
}

export const HOME_AWAY: { id: HomeAway; label: string }[] = [
  { id: 'home', label: 'ホーム' },
  { id: 'away', label: 'ビジター' },
]

/** 開催地の表示名。登録の画面と履歴で同じ言い方にする */
export function homeAwayLabel(id: HomeAway): string {
  return HOME_AWAY.find((h) => h.id === id)?.label ?? id
}

/**
 * カウントダウンの「あと◯◯」に付ける単位。
 *
 * 記録名の単位をそのまま使うと「あと8試合出場」となって読みにくい。
 * 試合に出ることは1日1試合なので「あと8日」と数える。
 *
 * ここに無い単位は記録名のまま出す（本塁打・セーブ・死球 など、
 * そのままで意味が通るもの）。
 */
const COUNTDOWN_UNIT: Record<string, string> = {
  試合出場: '日',
}

export function countdownUnit(unit: string): string {
  return COUNTDOWN_UNIT[unit] ?? unit
}

/**
 * 先発ハイライトは最上位のみ加算する（セーブのみ独立）。
 *
 * 表示用の全一覧。過去の記録のラベルを引くのに使う。
 */
export const PITCHING_HIGHLIGHTS: { id: PitchingHighlight; label: string }[] = [
  { id: 'none', label: 'なし' },
  { id: 'quality_start', label: 'QS' },
  { id: 'complete_game', label: '完投' },
  { id: 'shutout', label: '完封' },
  { id: 'no_hitter', label: 'ノーヒットノーラン' },
  { id: 'perfect_game', label: '完全試合' },
]

/**
 * 自動登録で選べる先発ハイライト。
 *
 * 完投と完封は NPB の個人投手成績に「完投」「完封勝」の列があり、
 * その累計差分から求められる。
 *
 * 除いているもの:
 *   QS               累計差分から求められるが、貯金の対象にしない
 *   ノーヒットノーラン 該当する列が無い。「完投+1 かつ安打の増分が0」で
 *   完全試合          導出はできるが、スナップショットを1日取りこぼすと
 *                    判定が崩れる。年に数回あるかないかの記録のために
 *                    壊れやすい推定は入れず、カスタム登録で積み立てる
 *                    （docs/npb-data-sources.md 3章）
 */
/**
 * 並びは貯金ルールの「投手」に合わせる。
 * 金額を決める画面と選ぶ画面で順番が違うと、探すときに迷うため。
 * PITCHING_HIGHLIGHTS の並び（珍しい順）は表示用のラベル引きに使う。
 */
const AUTO_HIGHLIGHT_ORDER: PitchingHighlight[] = ['none', 'shutout', 'complete_game']

export const AUTO_PITCHING_HIGHLIGHTS: { id: PitchingHighlight; label: string }[] =
  AUTO_HIGHLIGHT_ORDER.map((id) => PITCHING_HIGHLIGHTS.find((p) => p.id === id)!)

export function pitchingHighlightLabel(id: PitchingHighlight): string {
  return PITCHING_HIGHLIGHTS.find((p) => p.id === id)?.label ?? id
}

export const MONTHLY_STATUS_LABEL: Record<MonthlyStatus, string> = {
  calculating: '月内集計中',
  ready: '月末金額確定',
  deposited: '入金済み',
}

export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'ticket', label: 'チケット' },
  { id: 'food', label: '飲食' },
  { id: 'beer', label: 'ビール' },
  { id: 'goods', label: 'グッズ' },
  { id: 'transport', label: '交通' },
  { id: 'other', label: 'その他' },
]

export function categoryLabel(id: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.id === id)?.label ?? 'その他'
}

/**
 * 外部金融アプリの起動先。
 * Marine Wallet 自身は資金を移動せず、金額をコピーして各アプリへ誘導するだけ（仕様書 11章・38章）。
 *
 * 起動URL は defaultUrl として組み込む。新しい端末でも設定なしでそのまま起動できる。
 * 起動URL は端末とアプリのバージョンで変わり得るため、マイページから上書きできる
 * （上書きはその端末のブラウザにのみ保存される。入力欄を空にすると既定値に戻る）。
 */
export type ExternalAppKey = 'onebank' | 'paypay' | 'marines'

/**
 * MARINES APP を名指しで起動する intent URL を組み立てる。
 *
 * アプリが受け取ると宣言している道筋に当たれば起動し、外れれば
 * Google Play のページが開く。押して確かめるために使う。
 */
function intentFor(path: string): string {
  const fallback = encodeURIComponent(
    'https://play.google.com/store/apps/details?id=jp.co.marines.official.app'
  )
  return `intent://app.marines-app.com${path}#Intent;scheme=https;package=jp.co.marines.official.app;S.browser_fallback_url=${fallback};end`
}

export const EXTERNAL_APPS: Record<
  ExternalAppKey,
  {
    label: string
    hint: string
    defaultUrl: string
    /**
     * Android のときに使うURL。
     *
     * 同じ検証済みリンクでも、アプリ内のブラウザから開くとアプリへ渡らず、
     * 白い画面が出ることがある。Android では intent を使って、アプリを
     * 名指しで起動する。
     */
    androidUrl?: string
    note?: string
    /**
     * 起動できるかどうかを1つずつ試すための候補。
     *
     * アプリを開ける入口（独自スキーム・検証済みリンク）は公開されて
     * いないことが多い。当たりは端末で押して確かめるしかないので、
     * 押すだけで試せる形にしておく。
     */
    candidates?: { label: string; url: string }[]
  }
> = {
  onebank: {
    label: 'ワンバンク',
    hint: '月末の貯金入金に使うアプリの起動URL',
    // 検証済みのリンク（b43.jp）をそのまま開いてもアプリには渡らなかった。
    // ブラウザの中での移動は、検証済みであってもブラウザが抱え込む。
    // アプリへ渡すには intent の形にして名指しする必要がある。
    // 外れたときは Google Play のページへ飛ぶ
    defaultUrl:
      'intent://b43.jp/#Intent;scheme=https;package=jp.co.smartbank.b43;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Djp.co.smartbank.b43;end',
    note: 'Android 向けの intent を既定にしています。開かないときは下の候補を試して、開いたものを保存してください。iOS では b43.jp を試してください。',
    candidates: [
      { label: 'b43.jp', url: 'https://b43.jp/' },
      { label: 'b43.go.link', url: 'https://b43.go.link/' },
      {
        label: 'b43.jp（intent）',
        url: 'intent://b43.jp/#Intent;scheme=https;package=jp.co.smartbank.b43;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Djp.co.smartbank.b43;end',
      },
      {
        label: 'パッケージ名（intent）',
        url: 'intent://#Intent;package=jp.co.smartbank.b43;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Djp.co.smartbank.b43;end',
      },
      { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=jp.co.smartbank.b43' },
    ],
  },
  paypay: {
    label: 'PayPay',
    hint: '割り勘の精算に使うアプリの起動URL',
    defaultUrl: 'paypay://',
    note: 'iOS / Android 共通の URL スキームです。',
  },
  marines: {
    label: 'TEAM26 マイページ',
    hint: 'ホームの球団ロゴを押したときに開くURL',
    // 公式アプリ（MARINES APP）はブラウザからは起動できなかった。
    // パッケージ名・独自スキーム・検証済みリンクのいずれでも、アプリには
    // 渡らず白いページか Google Play になる。アプリが受け取ると宣言して
    // いるのは特定の道筋だけで、根っこは対象外とみられる。
    //
    // 代わりに TEAM26 のマイページを開く。チケットと会員証への入口で、
    // ブラウザでそのまま使える。公式アプリの入口が分かれば差し替える
    defaultUrl: 'https://mypage.team26.jp/',
    note: '公式アプリはブラウザから起動できないため、TEAM26 のマイページを開きます。アプリの入口が分かれば、下の候補から差し替えられます。',
    // 検証済みのリンクは app.marines-app.com だが、アプリが受け取る道筋
    // （パス）までは端末の設定画面に出ない。根っこ（/）では開かなかったので、
    // ありそうな道筋を押して試せるようにしておく
    candidates: [
      { label: '/（root）', url: intentFor('/') },
      { label: '/home', url: intentFor('/home') },
      { label: '/top', url: intentFor('/top') },
      { label: '/news', url: intentFor('/news') },
      { label: '/mypage', url: intentFor('/mypage') },
      { label: '/ticket', url: intentFor('/ticket') },
      { label: 'TEAM26 マイページ', url: 'https://mypage.team26.jp/' },
      { label: 'app.marines-app.com', url: 'https://app.marines-app.com/' },
      { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=jp.co.marines.official.app' },
      { label: 'App Store', url: 'https://apps.apple.com/jp/app/id1099673155' },
    ],
  },
}

export const APP_LINK_STORAGE_KEY = 'marine_wallet_app_links_v1'

/**
 * Marine Link で共有できるリソース（仕様書 14章）。
 * 観戦情報 / Marine Day / Beer Log / 共同目標 は Phase 5 以降で追加する。
 * 試合情報は仕様書 15章のとおり全ユーザー共通なので、権限の対象にしない。
 */
export const LINK_RESOURCE_META: {
  id: LinkResource
  label: string
  hint: string
}[] = [
  { id: 'saving', label: 'ロッテ貯金', hint: '積立の明細と月ごとの合計' },
  { id: 'saving_rules', label: '貯金ルール', hint: '共通の貯金ルールを変更する権限を渡す' },
  { id: 'monthly', label: '月末入金状況', hint: '月末の確定額とワンバンク入金の進捗' },
  { id: 'split', label: '割り勘', hint: '立替の記録と精算状況' },
]

/**
 * メンバー写真の置き場所（0010のマイグレーションで作る非公開バケット）。
 * パスは <ユーザーID>/<メンバーID>-<タイムスタンプ>.jpg で、
 * 先頭フォルダが自分のIDと一致するオブジェクトだけ読み書きできる。
 */
export const MEMBER_AVATAR_BUCKET = 'member-avatars'

/** 署名付きURLの有効期間（秒）。画面を開いたままでも当面切れない長さにする */
export const MEMBER_AVATAR_TTL_SECONDS = 60 * 60

/** アップロード時に変換する一辺の長さ（px）。等倍表示は最大40pxなので余裕がある */
export const MEMBER_AVATAR_SIZE = 256
