import type { PushMessage } from '@/lib/push'
import type { GameResult } from '@/types'

/**
 * 通知の文面。
 *
 * 文面をここにまとめる理由は2つある。
 *   1. 送る側（Cron・API）に文字列を散らすと、言い回しが揃わなくなる
 *   2. 相手から送られてくる文字列をそのまま通知にしない。
 *      本文を組み立てるのは必ずサーバー側にする
 *
 * url は通知をタップしたときに開くパス。
 * tag は同じ種類の通知をまとめる印で、連投しても積み上がらないようにする。
 */

/** 相手の操作をきっかけに送る通知の種類。API はこの4つしか受け付けない */
export const NOTIFY_KINDS = [
  'split_added',
  'split_settle_request',
  'link_request',
  'link_accepted',
] as const

export type NotifyKind = (typeof NOTIFY_KINDS)[number]

export function isNotifyKind(value: unknown): value is NotifyKind {
  return typeof value === 'string' && (NOTIFY_KINDS as readonly string[]).includes(value)
}

/**
 * 相手の操作を知らせる文面。
 *
 * 誰がやったかは入れるが、金額や品目は入れない。
 * 通知はロック画面にも出るので、開かないと分からない状態にしておく。
 */
export function messageForKind(kind: NotifyKind, actorName: string): PushMessage {
  const who = actorName.trim() || '接続している相手'

  switch (kind) {
    case 'split_added':
      return {
        title: '割り勘が追加されました',
        body: `${who} が新しい割り勘を登録しました。`,
        category: 'split',
        url: '/split',
        tag: 'split',
      }
    case 'split_settle_request':
      return {
        title: '精算のお願いが届いています',
        body: `${who} から精算の依頼が届いています。`,
        category: 'split',
        url: '/split',
        tag: 'split',
      }
    case 'link_request':
      return {
        title: '接続のリクエストが届いています',
        body: `${who} から Marine Link のリクエストが届いています。`,
        category: 'link',
        url: '/me/members',
        tag: 'link',
      }
    case 'link_accepted':
      return {
        title: '接続されました',
        body: `${who} と Marine Link がつながりました。`,
        category: 'link',
        url: '/me/members',
        tag: 'link',
      }
  }
}

/**
 * 前日の試合を貯金に入れたときの知らせ。
 *
 * 「取り込んだ」だけでは、貯金に反映されたのかどうかが分からない。
 * 実際に積立まで作れたときにだけ、そう言い切る。
 */
export function messageForGameImported(opponent: string, result: GameResult): PushMessage {
  const word = result === 'win' ? '勝利' : result === 'lose' ? '敗戦' : '引き分け'
  return {
    title: '試合を取り込みました',
    body: `${opponent}戦（${word}）を貯金に追加しました。`,
    category: 'games',
    url: '/savings',
    tag: 'games',
  }
}

/**
 * 取り込めなかったので、手で入れてほしい知らせ。
 *
 * 黙って見送ると、その日の貯金がまるごと抜けたことに気付けない。
 * 試合の無い日・中止・登録済みは普通のことなので、これは送らない。
 */
export function messageForGameNeedsManual(reason: string): PushMessage {
  return {
    title: '試合を取り込めませんでした',
    body: `${reason}。貯金タブから手で登録してください。`,
    category: 'games',
    url: '/savings',
    tag: 'games',
  }
}

/**
 * 確定した直後の、入金のお願い。
 *
 * 確定は「一緒に貯めている人の分もまとめて締める」操作なので、
 * 締められた側は自分が操作していない。入金が要ることを知らせる。
 *
 * 金額は入れない。人によって額が違ううえ、ロック画面に出るため。
 */
export function messageForMonthConfirmed(month: string): PushMessage {
  const [year, m] = month.split('-')
  return {
    title: '入金をお願いします',
    body: `${year}年${Number(m)}月の金額が確定しました。ワンバンクへ入金してください。`,
    category: 'savings',
    url: '/savings',
    // 月末のリマインドとは別の印にして、片方がもう片方を置き換えないようにする
    tag: 'month-deposit',
  }
}

/** 月末の確定・入金のリマインド */
export function messageForMonthEnd(month: string): PushMessage {
  const [year, m] = month.split('-')
  return {
    title: '今月の貯金を確定してください',
    body: `${year}年${Number(m)}月が終わります。金額を確定して、ワンバンクへ入金してください。`,
    category: 'savings',
    url: '/savings',
    tag: 'month-end',
  }
}

/**
 * 記録達成を貯金に入れたときの知らせ。
 *
 * 何の記録かはロック画面に出しても困らないので、1件なら内容をそのまま出す。
 * まとめて入ったときは件数だけにして、長くなりすぎないようにする。
 */
export function messageForMilestones(titles: string[]): PushMessage {
  const body =
    titles.length === 1
      ? `${titles[0]}を貯金に追加しました。`
      : `${titles.length}件の記録達成を貯金に追加しました。`

  return {
    title: '記録達成を取り込みました',
    body,
    category: 'games',
    url: '/savings',
    tag: 'milestones',
  }
}
