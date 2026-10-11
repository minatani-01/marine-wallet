import { test } from 'node:test'
import assert from 'node:assert/strict'

import { adoptablePath, rejectSourceReason } from '@/lib/favorites-adopt'

/**
 * 借りている画像の取り込み（0063）。
 *
 * サーバーが外のURLを取りに行くところなので、通す相手の線をここで固定する。
 */

test('Drive の画像だけ取りに行く', () => {
  assert.equal(
    rejectSourceReason('https://drive.google.com/thumbnail?id=abc&sz=w1200'),
    null
  )
  assert.equal(rejectSourceReason('https://lh3.googleusercontent.com/d/abc'), null)
  assert.equal(rejectSourceReason('https://drive.usercontent.google.com/download?id=abc'), null)
})

test('それ以外は通さない', () => {
  // 社内向けのアドレスを書いて、サーバーに代わりに叩かせる手を塞ぐ
  assert.match(String(rejectSourceReason('https://169.254.169.254/latest/meta-data/')), /Drive/)
  assert.match(String(rejectSourceReason('https://localhost/secret')), /Drive/)
  assert.match(String(rejectSourceReason('https://example.com/a.jpg')), /Drive/)
  // 名前の末尾を似せただけのもの
  assert.match(String(rejectSourceReason('https://evil-googleusercontent.com/a.jpg')), /Drive/)
  assert.match(String(rejectSourceReason('https://drive.google.com.evil.jp/a.jpg')), /Drive/)
  // http と、URLですらないもの
  assert.match(String(rejectSourceReason('http://drive.google.com/a.jpg')), /https/)
  assert.match(String(rejectSourceReason('これはURLではない')), /読めません/)
})

test('大文字で書かれていても見分ける', () => {
  assert.equal(rejectSourceReason('https://Drive.Google.COM/thumbnail?id=abc'), null)
})

test('上げ先は本人のフォルダ。同じ品なら増えない', () => {
  const path = adoptablePath('u1', 'item-1', 'image/jpeg')
  assert.equal(path, 'u1/adopted-item-1.jpg')
  // 2回取り込んでも同じ場所（上書き）
  assert.equal(adoptablePath('u1', 'item-1', 'image/jpeg'), path)

  assert.equal(adoptablePath('u1', 'i', 'image/png'), 'u1/adopted-i.png')
  assert.equal(adoptablePath('u1', 'i', 'image/webp;charset=binary'), 'u1/adopted-i.webp')
  // 分からない形式は jpg 扱い
  assert.equal(adoptablePath('u1', 'i', ''), 'u1/adopted-i.jpg')
})
