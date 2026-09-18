/**
 * CSV の読み取り。
 *
 * Google Takeout が書き出す「保存済みリスト」を読むために使う。
 * 外部のライブラリは入れない。読むのは Takeout の素直な CSV だけで、
 * 必要なのは引用符の扱い（カンマや改行を含む店名がある）と、
 * 先頭の BOM を落とすことの2つだけである。
 */

/** 1行1レコードに切り分ける。引用符の中のカンマと改行は区切りにしない */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // BOM と改行コードのゆれを先に均す
  const source = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]

    if (quoted) {
      if (c === '"') {
        // "" は引用符そのもの
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }

  // 最後の行が改行で終わっていないこともある
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0))
}

export type TakeoutPlace = {
  name: string
  note: string
  url: string
}

/**
 * Takeout の保存済みリストを読む。
 *
 * 列は Title / Note / URL で、順番や大文字小文字が変わることがあるので
 * 見出し行から位置を引く。見出しが無い（列名が読めない）ファイルは
 * 何も返さない。並び順を勝手に決めつけて、メモを名前として取り込むより、
 * 取り込めないほうがよい。
 */
export function parseTakeoutPlaces(text: string): TakeoutPlace[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const titleAt = header.indexOf('title')
  const noteAt = header.indexOf('note')
  const urlAt = header.indexOf('url')

  if (titleAt < 0) return []

  const seen = new Set<string>()
  const places: TakeoutPlace[] = []

  for (const row of rows.slice(1)) {
    const name = (row[titleAt] ?? '').trim()
    if (!name) continue
    // 同じ店が2回入っていることがある
    if (seen.has(name)) continue
    seen.add(name)

    places.push({
      name,
      note: noteAt >= 0 ? (row[noteAt] ?? '').trim() : '',
      url: urlAt >= 0 ? (row[urlAt] ?? '').trim() : '',
    })
  }

  return places
}
