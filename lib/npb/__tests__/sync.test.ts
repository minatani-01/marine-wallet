import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runNpbSync } from '../sync'
import { battingStatsUrl, pitchingStatsUrl, scheduleUrl } from '../fetch'
import {
  BATTING_HTML,
  BOX_SCORE_WITH_SAVE_HTML,
  PITCHING_HTML,
  SCHEDULE_HTML,
} from './fixtures'

/** 取得を差し替える。実際の通信はしない */
function fetcherFor(overrides: Record<string, string> = {}) {
  const calls: string[] = []
  const fetchPage = async (url: string) => {
    calls.push(url)
    if (url in overrides) return overrides[url]
    if (url.includes('schedule_')) return SCHEDULE_HTML
    if (url.includes('/idb1_')) return BATTING_HTML
    if (url.includes('/idp1_')) return PITCHING_HTML
    if (url.includes('/scores/')) return BOX_SCORE_WITH_SAVE_HTML
    throw new Error(`想定外の URL: ${url}`)
  }
  return { fetchPage, calls }
}

const SEPTEMBER = new Date('2026-09-14T20:00:00Z')

test('runNpbSync は5ページだけ取得する', async () => {
  const { fetchPage, calls } = fetcherFor()
  const result = await runNpbSync(SEPTEMBER, fetchPage)

  assert.equal(result.pages, 5)
  assert.equal(calls.length, 5)
  // 当月と翌月。翌月は先の予定と中止を早めに拾うために取る
  assert.equal(calls[0], scheduleUrl(2026, 9))
  assert.equal(calls[1], scheduleUrl(2026, 10))
  assert.match(calls[2], /^https:\/\/npb\.jp\/scores\//)
  assert.equal(calls[3], battingStatsUrl(2026))
  assert.equal(calls[4], pitchingStatsUrl(2026))
})

test('シーズン外は翌月を取りに行かない', async () => {
  const { fetchPage, calls } = fetcherFor()
  // 12月に試合は無い。翌年1月のページを取りに行く意味も無い
  await runNpbSync(new Date('2026-12-14T20:00:00Z'), fetchPage)
  assert.equal(calls.filter((url) => url.includes('schedule_')).length, 1)
})

test('翌月のページが取れなくても当月は止めない', async () => {
  const calls: string[] = []
  const fetchPage = async (url: string) => {
    calls.push(url)
    if (url === scheduleUrl(2026, 10)) throw new Error('404')
    if (url.includes('schedule_')) return SCHEDULE_HTML
    if (url.includes('/idb1_')) return BATTING_HTML
    if (url.includes('/idp1_')) return PITCHING_HTML
    if (url.includes('/scores/')) return BOX_SCORE_WITH_SAVE_HTML
    throw new Error(`想定外の URL: ${url}`)
  }

  const result = await runNpbSync(SEPTEMBER, fetchPage)
  assert.equal(result.games.length, 3)
  assert.equal(
    result.warnings.some((w) => w.includes('2026年10月の日程を取得できませんでした')),
    true
  )
})

test('runNpbSync はマリーンズの試合だけを返す', async () => {
  const { fetchPage } = fetcherFor()
  const result = await runNpbSync(SEPTEMBER, fetchPage)

  // フィクスチャの4試合のうち、ソフトバンク対オリックスは含まない
  assert.equal(result.games.length, 3)
  assert.equal(
    result.games.every((g) => g.home_team === 'ロッテ' || g.away_team === 'ロッテ'),
    true
  )
})

test('runNpbSync は直近の試合にボックススコアの内容を載せる', async () => {
  const { fetchPage } = fetcherFor()
  const result = await runNpbSync(SEPTEMBER, fetchPage)

  // 終了しているのは 9/1 だけなので、そこにセーブ投手が載る
  const finished = result.games.find((g) => g.game_date === '2026-09-01')!
  assert.equal(finished.status, 'finished')
  assert.equal(finished.win_pitcher, '高野脩')
  assert.equal(finished.lose_pitcher, '平良')
  assert.equal(finished.save_pitcher, '横山')

  // 未実施の試合にはボックススコアを載せない
  const upcoming = result.games.find((g) => g.game_date === '2026-09-16')!
  assert.equal(upcoming.status, 'scheduled')
  assert.equal(upcoming.save_pitcher, '')
})

test('runNpbSync は中止の試合を cancelled のまま残す', async () => {
  const { fetchPage } = fetcherFor()
  const result = await runNpbSync(SEPTEMBER, fetchPage)
  const cancelled = result.games.find((g) => g.game_date === '2026-09-17')!
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.note, '雨天中止')
})

test('runNpbSync は打撃と投手のスナップショットを基準日付きで返す', async () => {
  const { fetchPage } = fetcherFor()
  const result = await runNpbSync(SEPTEMBER, fetchPage)

  assert.equal(result.battingAsOf, '2026-09-13')
  assert.equal(result.pitchingAsOf, '2026-09-13')
  // 打撃2人 + 投手2人
  assert.equal(result.snapshots.length, 4)
  assert.equal(result.snapshots.filter((s) => s.kind === 'batting').length, 2)
  assert.equal(
    result.snapshots.every((s) => s.as_of === '2026-09-13'),
    true
  )
  assert.equal(result.warnings.length, 0)
})

test('runNpbSync は打撃と投手で基準日が違えば警告する', async () => {
  const { fetchPage } = fetcherFor({
    [pitchingStatsUrl(2026)]: PITCHING_HTML.replace('2026年9月13日', '2026年9月12日'),
  })
  const result = await runNpbSync(SEPTEMBER, fetchPage)
  assert.equal(result.battingAsOf, '2026-09-13')
  assert.equal(result.pitchingAsOf, '2026-09-12')
  assert.equal(result.warnings.some((w) => w.includes('基準日が違います')), true)
})

test('runNpbSync はボックススコアが取れなくても試合の保存を止めない', async () => {
  const calls: string[] = []
  const fetchPage = async (url: string) => {
    calls.push(url)
    if (url.includes('/scores/')) throw new Error('接続できませんでした')
    if (url.includes('schedule_')) return SCHEDULE_HTML
    if (url.includes('/idb1_')) return BATTING_HTML
    return PITCHING_HTML
  }

  const result = await runNpbSync(SEPTEMBER, fetchPage)
  assert.equal(result.games.length, 3)
  assert.equal(result.snapshots.length, 4)
  assert.equal(
    result.warnings.some((w) => w.includes('ボックススコアを取得できませんでした')),
    true
  )
  // 日程表から取れる責任投手は残る
  const finished = result.games.find((g) => g.game_date === '2026-09-01')!
  assert.equal(finished.win_pitcher, '高野脩')
  assert.equal(finished.save_pitcher, '')
})

test('runNpbSync はボックススコアの日付が食い違えば使わない', async () => {
  const { fetchPage } = fetcherFor({
    // 別の日の試合が返ってきた場合
    'https://npb.jp/scores/2026/0901/m-l-20/': BOX_SCORE_WITH_SAVE_HTML.replace(
      '2026年9月1日',
      '2026年8月30日'
    ),
  })
  const result = await runNpbSync(SEPTEMBER, fetchPage)
  assert.equal(result.warnings.some((w) => w.includes('日付が日程と一致しません')), true)
  const finished = result.games.find((g) => g.game_date === '2026-09-01')!
  // 取り違えた内容は載せず、日程表から取れる分だけにする
  assert.equal(finished.save_pitcher, '')
  assert.equal(finished.win_pitcher, '高野脩')
})

test('runNpbSync は成績ページの構造が変わったら失敗する', async () => {
  const { fetchPage } = fetcherFor({
    [battingStatsUrl(2026)]: BATTING_HTML.replace('<span>打点</span>', '<span>ＲＢＩ</span>'),
  })
  await assert.rejects(() => runNpbSync(SEPTEMBER, fetchPage), /構造が変わっています/)
})
