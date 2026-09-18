import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCsv, parseTakeoutPlaces } from '../csv'

test('ふつうの CSV を読む', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ])
})

test('引用符の中のカンマと改行は区切りにしない', () => {
  const rows = parseCsv('Title,Note\n"寿司, 大","土日は行列\n予約可"')

  assert.deepEqual(rows[1], ['寿司, 大', '土日は行列\n予約可'])
})

test('"" は引用符そのもの', () => {
  assert.deepEqual(parseCsv('Title\n"ゑぶり亭""別館"""')[1], ['ゑぶり亭"別館"'])
})

test('BOM と改行コードのゆれを吸収する', () => {
  assert.deepEqual(parseCsv('﻿Title,Note\r\n店,めも\r\n'), [
    ['Title', 'Note'],
    ['店', 'めも'],
  ])
})

test('空行は落とす', () => {
  assert.equal(parseCsv('a\n\n\nb').length, 2)
})

test('Takeout の保存済みリストを読む', () => {
  const csv = [
    'Title,Note,URL',
    '呑毛笑店 ゑぶり亭,,https://www.google.com/maps/place/?q=place_id:X',
    '幕張の湯,サウナあり,https://maps.app.goo.gl/abc',
  ].join('\n')

  assert.deepEqual(parseTakeoutPlaces(csv), [
    { name: '呑毛笑店 ゑぶり亭', note: '', url: 'https://www.google.com/maps/place/?q=place_id:X' },
    { name: '幕張の湯', note: 'サウナあり', url: 'https://maps.app.goo.gl/abc' },
  ])
})

test('列の順番が違っても見出しから引く', () => {
  const csv = ['URL,Title,Note', 'https://example.com,店,めも'].join('\n')

  assert.deepEqual(parseTakeoutPlaces(csv), [
    { name: '店', note: 'めも', url: 'https://example.com' },
  ])
})

test('同じ店が2回入っていれば1つにする', () => {
  const csv = ['Title,Note,URL', '店,,', '店,,'].join('\n')

  assert.equal(parseTakeoutPlaces(csv).length, 1)
})

test('名前の列が読めないファイルは取り込まない', () => {
  // 並び順を決めつけて、メモを名前として取り込むより、取り込まないほうがよい
  assert.deepEqual(parseTakeoutPlaces('foo,bar\n1,2'), [])
  assert.deepEqual(parseTakeoutPlaces(''), [])
})
