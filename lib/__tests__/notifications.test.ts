import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  NOTIFY_KINDS,
  isNotifyKind,
  messageForGameImported,
  messageForGameNeedsManual,
  messageForKind,
  messageForMonthConfirmed,
  messageForMonthEnd,
} from '../notifications'
import { NOTIFY_CATEGORIES } from '../push'

test('確定したときの文面には月が入り、金額は入らない', () => {
  const message = messageForMonthConfirmed('2026-09')
  assert.equal(message.title, '入金をお願いします')
  assert.match(message.body, /2026年9月/)
  // 額は人によって違ううえ、ロック画面に出るので入れない
  assert.doesNotMatch(message.body, /[¥\d]{1,3},\d{3}/)
  assert.equal(message.url, '/savings')
})

test('月は先頭の0を落として読む', () => {
  assert.match(messageForMonthConfirmed('2026-01').body, /2026年1月/)
  assert.match(messageForMonthConfirmed('2026-12').body, /2026年12月/)
})

test('確定のお願いと月末のリマインドは別の印にする', () => {
  // 印が同じだと、後から来た方が先の通知を置き換えてしまう
  assert.notEqual(messageForMonthConfirmed('2026-09').tag, messageForMonthEnd('2026-09').tag)
})

test('受け付ける通知の種類は決まったものだけ', () => {
  assert.equal(isNotifyKind('split_added'), true)
  assert.equal(isNotifyKind('month_confirmed'), false)
  assert.equal(isNotifyKind(''), false)
  assert.equal(isNotifyKind(null), false)
})

test('すべての文面が、どの設定で止まるかを名乗る', () => {
  // 名乗り忘れた通知は設定を無視して届いてしまう。増やしたときに気付けるようにする
  const allowed: string[] = [...NOTIFY_CATEGORIES]
  const messages = [
    ...NOTIFY_KINDS.map((kind) => messageForKind(kind, 'テスト')),
    messageForGameImported('日本ハム', 'win'),
    messageForGameNeedsManual('ボックススコアを取得できていません'),
    messageForMonthEnd('2026-09'),
    messageForMonthConfirmed('2026-09'),
  ]
  for (const message of messages) {
    assert.ok(allowed.includes(message.category), `${message.title} の category が不正`)
  }
})

test('割り勘と接続は別の設定で止まる', () => {
  assert.equal(messageForKind('split_added', 'テスト').category, 'split')
  assert.equal(messageForKind('link_request', 'テスト').category, 'link')
  assert.equal(messageForGameImported('西武', 'lose').category, 'games')
  assert.equal(messageForMonthEnd('2026-09').category, 'savings')
  assert.equal(messageForMonthConfirmed('2026-09').category, 'savings')
})

test('取り込めたときだけ「貯金に追加した」と言う', () => {
  assert.match(messageForGameImported('日本ハム', 'win').body, /勝利.*貯金に追加/)
  assert.match(messageForGameImported('西武', 'lose').body, /敗戦/)
  assert.match(messageForGameImported('楽天', 'draw').body, /引き分け/)
  // 取り込めなかったときは、手で入れる必要があると分かる文面にする
  const manual = messageForGameNeedsManual('ボックススコアを取得できていません')
  assert.match(manual.body, /手で登録/)
  assert.equal(/貯金に追加/.test(manual.body), false)
})
