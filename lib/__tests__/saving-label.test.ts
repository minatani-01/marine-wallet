import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SCENES,
  entryLabel,
  isAutoScene,
  isPlayerRecord,
  parseLegacyNote,
  whoLabel,
} from '@/lib/saving-label'

test('背番号と名前は空けて並べる', () => {
  assert.equal(whoLabel({ uniform_number: '51', player_name: '山口' }), '#51 山口')
  // 先頭の # を手で書かれても二重にしない
  assert.equal(whoLabel({ uniform_number: '#51', player_name: '山口' }), '#51 山口')
  // 全角の空白や前後の空白は落とす
  assert.equal(whoLabel({ uniform_number: ' 52 ', player_name: '　益田　' }), '#52 益田')
})

test('背番号が無ければ球団の記録になる', () => {
  assert.equal(whoLabel({ uniform_number: '', player_name: '' }), 'マリーンズ')
  assert.equal(isPlayerRecord({ uniform_number: '', player_name: '' }), false)
  assert.equal(isPlayerRecord({ uniform_number: '51', player_name: '山口' }), true)
  // 名前だけでも選手の記録にはしない。番号が判定の軸である
  assert.equal(isPlayerRecord({ uniform_number: '', player_name: '山口' }), false)
})

test('番号だけ・名前だけでも形になる', () => {
  // 背番号は分かるが名前を入れなかった
  assert.equal(whoLabel({ uniform_number: '51', player_name: '' }), '#51')
  // 番号の分からない昔の選手
  assert.equal(whoLabel({ uniform_number: '', player_name: '里崎' }), '里崎')
})

test('見出しは「誰が」と「記録名」をつなぐ', () => {
  assert.equal(
    entryLabel({ uniform_number: '51', player_name: '山口' }, '逆転サヨナラHR'),
    '#51 山口 逆転サヨナラHR'
  )
  assert.equal(
    entryLabel({ uniform_number: '', player_name: '' }, '5500敗記念'),
    'マリーンズ 5500敗記念'
  )
  // 記録名が空でも、誰のことかは残す
  assert.equal(entryLabel({ uniform_number: '52', player_name: '益田' }, ''), '#52 益田')
  assert.equal(entryLabel({ uniform_number: '', player_name: '' }, ''), 'マリーンズ')
})

test('自動で入るぶんと手で入れるぶんが同じ形になる', () => {
  // npb.jp から入るぶん
  const auto = entryLabel({ uniform_number: '52', player_name: '益田' }, '通算250セーブ記念')
  // 手で入れるぶん
  const manual = entryLabel({ uniform_number: '51', player_name: '山口' }, '逆転サヨナラHR')

  // どちらも「#番号 名前 記録名」
  assert.match(auto, /^#\d+ \S+ .+$/)
  assert.match(manual, /^#\d+ \S+ .+$/)
  assert.equal(auto, '#52 益田 通算250セーブ記念')
  assert.equal(manual, '#51 山口 逆転サヨナラHR')
})

test('前に書いていた1行を読み分ける', () => {
  // 詰めて書いてあった自動登録ぶん
  assert.deepEqual(parseLegacyNote('#52益田 通算250セーブ記念'), {
    uniform_number: '52',
    player_name: '益田',
    record_name: '通算250セーブ記念',
  })
  // 空けて書いてあった手入力ぶん
  assert.deepEqual(parseLegacyNote('#51 山口 逆転サヨナラHR'), {
    uniform_number: '51',
    player_name: '山口',
    record_name: '逆転サヨナラHR',
  })
  // 球団
  assert.deepEqual(parseLegacyNote('マリーンズ 5500敗記念'), {
    uniform_number: '',
    player_name: '',
    record_name: '5500敗記念',
  })
  // かっこ付きもそのまま記録名に入れる。分けると中身が落ちる
  assert.deepEqual(parseLegacyNote('#61山本 初サヨナラ打（チーム2夜連続サヨナラ）'), {
    uniform_number: '61',
    player_name: '山本',
    record_name: '初サヨナラ打（チーム2夜連続サヨナラ）',
  })
  // 誰のことでもない1行
  assert.deepEqual(parseLegacyNote('球場で見た'), {
    uniform_number: '',
    player_name: '',
    record_name: '球場で見た',
  })
  assert.deepEqual(parseLegacyNote(''), {
    uniform_number: '',
    player_name: '',
    record_name: '',
  })
})

test('読み分けたものを組み直すと元に戻る', () => {
  // 詰めて書いてあったぶんは、空ける形に直って戻る
  for (const [before, after] of [
    ['#52益田 通算250セーブ記念', '#52 益田 通算250セーブ記念'],
    ['#51 山口 逆転サヨナラHR', '#51 山口 逆転サヨナラHR'],
    ['マリーンズ 5500敗記念', 'マリーンズ 5500敗記念'],
  ]) {
    const parsed = parseLegacyNote(before)
    assert.equal(entryLabel(parsed, parsed.record_name), after)
  }
})

test('名場面は5つで固定', () => {
  assert.deepEqual([...SCENES], ['名場面', 'シーズン記録', '生涯記録', '名球会記録', '球団記録'])
  // 「サヨナラ打（HR）」のような具体の出来事は記録名の側。名場面には入れない
  assert.equal(
    SCENES.some((s) => s.includes('サヨナラ')),
    false
  )
})

test('自動で入る名場面は4つ', () => {
  assert.equal(isAutoScene('名球会記録'), true)
  assert.equal(isAutoScene('球団記録'), true)
  assert.equal(isAutoScene('シーズン記録'), true)
  assert.equal(isAutoScene('生涯記録'), true)
  // 手で入れるぶん
  assert.equal(isAutoScene('名場面'), false)
  // 一覧に無い言葉
  assert.equal(isAutoScene('サヨナラ打（HR）'), false)
  assert.equal(isAutoScene(''), false)
})
