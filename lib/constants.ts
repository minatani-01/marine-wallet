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
export type ExternalAppKey = 'onebank' | 'paypay'

export const EXTERNAL_APPS: Record<
  ExternalAppKey,
  { label: string; hint: string; defaultUrl: string; note?: string }
> = {
  onebank: {
    label: 'ワンバンク',
    hint: '月末の貯金入金に使うアプリの起動URL',
    // Android の intent スキーム。アプリ未インストールなら
    // browser_fallback_url で Google Play のページへ飛ぶ。
    defaultUrl:
      'intent://#Intent;package=jp.co.smartbank.b43;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Djp.co.smartbank.b43;end',
    note: 'Android Chrome 向けの intent URL を既定にしています。iOS や PC では開けないため、その端末では上書きしてください。',
  },
  paypay: {
    label: 'PayPay',
    hint: '割り勘の精算に使うアプリの起動URL',
    defaultUrl: 'paypay://',
    note: 'iOS / Android 共通の URL スキームです。',
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
