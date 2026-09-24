'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui'
import { IconExpand, IconPin, IconTarget } from '@/components/icons'
import { tapFeedback } from '@/lib/haptics'
import { isVisited, placeKindLabel } from '@/lib/places'
import { isClosed, statusLabel } from '@/lib/places-status'
import type { Place } from '@/types'
import type { Point } from '@/lib/places-near'

/**
 * Google マップに、自分たちのリストのピンを並べる。
 *
 * 地図そのものは Maps JavaScript API で描く。鍵はページに埋め込まず、
 * 開くときにサーバーへ取りに行く。埋め込むと読み込みの回数を数えられず、
 * 上限で止められない（lib/api-budget.ts）。鍵はブラウザに出るので、
 * Google Cloud 側で参照元と API も絞っておく。
 *
 * 鍵が無いとき・その日の上限に達したときは地図を出さない。エラーで
 * 画面を壊さず、下のリストとリンクでこれまでどおり使える。
 *
 * ピンは座標を持つ場所だけに立つ。座標は保存したときに1回だけ引いており
 * （0041）、引けなかった場所は地図に出ない。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any
    __marineMapsLoader?: Promise<void>
  }
}

/** 暗い画面に合わせた地図の色。Map ID を作らずに済むよう、その場で指定する */
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0e1420' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#05070b' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9fb0c0' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6b7c8d' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#131d1a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1c2534' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6b7c8d' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#28354a' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#182131' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#070d17' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#33506b' }] },
]

/** 日本のまんなか。ピンが1つも無いときの表示位置 */
const CENTER_JP = { lat: 36.2, lng: 138.2 }

function loadMaps(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.maps) return Promise.resolve()
  if (window.__marineMapsLoader) return window.__marineMapsLoader

  window.__marineMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=ja&region=JP`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('load failed'))
    document.head.appendChild(script)
  })

  return window.__marineMapsLoader
}

type Gate = 'loading' | 'ready' | 'off' | 'over' | 'failed'

export default function PlacesMap({
  places,
  here,
  radiusKm,
  steps,
  onHere,
  onPickCenter,
  onRadius,
}: {
  places: Place[]
  /** 絞り込みの中心。現在位置か、地図から選んだ点。無ければ null */
  here: Point | null
  /** 絞り込んでいる半径（km）。無ければ null */
  radiusKm: number | null
  /** 選べる半径（km） */
  steps: readonly number[]
  /** 現在位置を取りに行く。取れたら親が持つ */
  onHere: () => Promise<Point | null>
  /** いま見えている地図のまんなかを、絞り込みの中心にする */
  onPickCenter: (point: Point) => void
  /** 半径を選ぶ。同じものをもう一度選んだら外す */
  onRadius: (km: number | null) => void
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const infoRef = useRef<any>(null)
  const [gate, setGate] = useState<Gate>('loading')
  const ready = gate === 'ready'

  // 中心の印と、その半径の輪。位置そのものは親が持つ
  const hereRef = useRef<any>(null)
  const circleRef = useRef<any>(null)
  const [locating, setLocating] = useState(false)
  const [hereError, setHereError] = useState<string | null>(null)

  /** 地図を広く見る。一覧を読むときは邪魔なので、押したときだけ広げる */
  const [tall, setTall] = useState(false)

  /**
   * ピンを立てる場所。
   *
   * ここで毎回新しい配列を作ると、下の useEffect が描き直しのたびに走り、
   * そのたびに地図が全ピンの入る位置まで引き戻される。現在位置へ寄せても
   * 日本全体に戻ってしまっていたのはこれが原因。
   */
  const pinned = useMemo(
    () => places.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number'),
    [places]
  )

  /** 最後に地図を合わせたピンの組。同じなら動かさない */
  const fittedRef = useRef('')

  useEffect(() => {
    let alive = true

    const start = async () => {
      // 鍵をもらう。ここで1回ぶん数えられる（上限に達していれば断られる）
      const res = await fetch('/api/maps/key', { method: 'POST' }).catch(() => null)
      if (!alive) return

      if (!res || !res.ok) {
        setGate(res?.status === 429 ? 'over' : 'off')
        return
      }

      const { key } = (await res.json()) as { key?: string }
      if (!alive) return
      if (!key) {
        setGate('off')
        return
      }

      try {
        await loadMaps(key)
      } catch {
        if (alive) setGate('failed')
        return
      }

      if (!alive || !boxRef.current) return
      mapRef.current ??= new window.google.maps.Map(boxRef.current, {
        center: CENTER_JP,
        zoom: 5,
        styles: DARK_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      })
      infoRef.current ??= new window.google.maps.InfoWindow()
      setGate('ready')
    }

    void start()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!ready || !mapRef.current) return

    for (const marker of markersRef.current) marker.setMap(null)
    markersRef.current = []

    const bounds = new window.google.maps.LatLngBounds()

    for (const place of pinned) {
      const visited = isVisited(place)
      const closed = isClosed(place)
      // 閉店した店は灰色にして小さくする。消しはしない。
      // 地図から消すと「あそこは無くなった」ことも分からなくなる
      const color = closed ? '#6b7c8d' : '#22d3ee'
      const marker = new window.google.maps.Marker({
        map: mapRef.current,
        position: { lat: place.lat as number, lng: place.lng as number },
        title: place.name,
        zIndex: closed ? 1 : 2,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: closed ? 5 : 7,
          // 行った場所は塗りつぶし、行きたい場所は輪郭だけ
          fillColor: color,
          fillOpacity: visited ? 0.95 : 0.15,
          strokeColor: color,
          strokeWeight: 2,
        },
      })

      marker.addListener('click', () => {
        infoRef.current.setContent(
          `<div style="color:#0e1420;font-size:12px;line-height:1.5">
             <strong>${escapeHtml(place.name)}</strong><br />
             ${escapeHtml(placeKindLabel(place.kind))}${place.area ? ` / ${escapeHtml(place.area)}` : ''}
             ${visited ? '<br />行った' : ''}
             ${closed ? `<br /><span style="color:#b91c1c">${escapeHtml(statusLabel(place.business_status) ?? '')}</span>` : ''}
           </div>`
        )
        infoRef.current.open({ map: mapRef.current, anchor: marker })
      })

      markersRef.current.push(marker)
      bounds.extend(marker.getPosition())
    }

    // 地図を動かすのは、出すピンの組が変わったときだけ。同じ組のまま
    // 動かすと、指で寄せた位置や現在位置への移動を上書きしてしまう
    const signature = pinned.map((p) => p.id).join(',')
    if (signature === fittedRef.current) return
    fittedRef.current = signature

    // 半径で絞っているあいだは、その輪に合わせる（下の useEffect が行う）。
    // ピンに合わせると、近くに1軒しか無いときに町内まで寄りすぎる
    if (radiusKm) return

    if (pinned.length === 1) {
      mapRef.current.setCenter(bounds.getCenter())
      mapRef.current.setZoom(16)
    } else if (pinned.length > 1) {
      mapRef.current.fitBounds(bounds, 48)
    }
  }, [ready, pinned, radiusKm])

  /**
   * 中心の印と、半径の輪。
   *
   * 半径を選んだら、その輪がちょうど収まるところまで寄せる。ピンの数に
   * よらず同じ広さになるので、「10km ぶんを見る」が毎回同じ見え方になる。
   */
  useEffect(() => {
    if (!ready || !mapRef.current) return

    hereRef.current?.setMap(null)
    hereRef.current = null
    circleRef.current?.setMap(null)
    circleRef.current = null

    if (!here) return

    hereRef.current = new window.google.maps.Marker({
      map: mapRef.current,
      position: here,
      title: '絞り込みの中心',
      zIndex: 999,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#ffffff',
        fillOpacity: 1,
        strokeColor: '#22d3ee',
        strokeWeight: 4,
      },
    })

    if (!radiusKm) return

    circleRef.current = new window.google.maps.Circle({
      map: mapRef.current,
      center: here,
      radius: radiusKm * 1000,
      strokeColor: '#22d3ee',
      strokeOpacity: 0.7,
      strokeWeight: 1.5,
      fillColor: '#22d3ee',
      fillOpacity: 0.06,
      clickable: false,
    })

    mapRef.current.fitBounds(circleRef.current.getBounds(), 16)
    // 輪に合わせ直したので、ピンの組が同じでも次は合わせ直してよい
    fittedRef.current = ''
  }, [ready, here, radiusKm])

  /**
   * 現在位置へ寄せる。
   *
   * 端末の位置情報を使う（Google の API は呼ばないので、回数も課金も増えない）。
   * 押したときだけ取りに行き、追いかけ続けない。電池を使ううえ、
   * 見ているあいだ地図が勝手に動くのは邪魔になる。
   */
  const goToHere = async () => {
    if (!ready || !mapRef.current) return

    tapFeedback()
    setLocating(true)
    setHereError(null)

    const point = await onHere()
    setLocating(false)

    if (!point) {
      setHereError('現在位置を取れませんでした（位置情報の許可を確認してください）')
      return
    }

    mapRef.current.setCenter(point)
    // 半径を選んでいるときは、上の輪の処理が広さを決める
    if (!radiusKm) mapRef.current.setZoom(15)
  }

  /** いま見えている地図のまんなかを中心にする。現在位置が使えなくても絞れる */
  const pickCenter = () => {
    if (!ready || !mapRef.current) return
    tapFeedback()
    setHereError(null)
    const point = mapRef.current.getCenter()
    onPickCenter({ lat: point.lat(), lng: point.lng() })
  }

  if (gate === 'off') {
    return (
      <Card>
        <div className="eyebrow">地図</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-dim">
          Google マップの鍵を設定すると、ここに地図が出ます。
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
          鍵が無いあいだも、各場所の「地図で開く」から Google マップを開けます。
        </p>
      </Card>
    )
  }

  if (gate === 'over') {
    return (
      <Card>
        <div className="eyebrow">地図</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-dim">
          今日はここまでにしておきます。
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
          課金が出ないよう、1日に地図を開ける回数に上限を置いています。
          明朝また出ます。各場所の「地図で開く」は使えます。
        </p>
      </Card>
    )
  }

  if (gate === 'failed') {
    return (
      <Card>
        <div className="eyebrow">地図</div>
        <p className="mt-2 text-[13px] text-fg-dim">地図を読み込めませんでした。</p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
          鍵の制限（参照元・API）を確かめてください。各場所の「地図で開く」は使えます。
        </p>
      </Card>
    )
  }

  return (
    <div>
      <div className="relative">
        <div
          ref={boxRef}
          className={`w-full overflow-hidden rounded-2xl border border-line transition-[height] ${
            tall ? 'h-[460px]' : 'h-[300px]'
          }`}
        />

        {/* 半径は地図の見え方そのものを決めるので、地図の上に置く。
            絞り込みの帯に混ぜると、横に長くなって届きにくくなる */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div
            role="group"
            aria-label="半径"
            className="glass pointer-events-auto flex items-center gap-1 rounded-full border border-line p-1"
          >
            <span className="px-2 text-[10px] tracking-widest text-fg-mute">半径</span>
            {steps.map((km) => {
              const on = radiusKm === km
              return (
                <button
                  key={km}
                  type="button"
                  aria-pressed={on}
                  disabled={!ready}
                  onClick={() => {
                    tapFeedback()
                    setHereError(null)
                    onRadius(on ? null : km)
                  }}
                  className={`tnum h-8 rounded-full px-2.5 text-[12px] transition-colors disabled:opacity-40 ${
                    on ? 'bg-marine text-ink font-semibold' : 'text-fg-dim hover:text-marine'
                  }`}
                >
                  {km}
                </button>
              )
            })}
          </div>

          {/* いま地図に出ているピンの数。絞り込みがどれだけ効いたかが分かる */}
          <span className="glass pointer-events-auto tnum shrink-0 rounded-full border border-line px-2.5 py-1.5 text-[11px] text-fg-dim">
            {pinned.length} 件
          </span>
        </div>

        {/* 操作はすべて同じ大きさの丸にそろえ、右下にまとめる */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-2">
          <button
            type="button"
            aria-label="地図を広げる"
            aria-pressed={tall}
            title={tall ? '地図を元の高さに戻す' : '地図を広げる'}
            onClick={() => {
              tapFeedback()
              setTall((on) => !on)
            }}
            className={`glass inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
              tall
                ? 'border-marine/60 text-marine'
                : 'border-line text-fg-dim hover:border-marine/60 hover:text-marine'
            }`}
          >
            <IconExpand size={17} />
          </button>

          {/* 現在位置が使えないときや、行き先のまわりを見たいときに使う。
              地図を動かしてから押すと、そこが絞り込みの中心になる */}
          <button
            type="button"
            aria-label="いま見えている地図のまんなかを中心にする"
            title="いま見えている地図のまんなかを中心にする"
            disabled={!ready}
            onClick={pickCenter}
            className="glass inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-fg-dim transition-colors hover:border-marine/60 hover:text-marine disabled:opacity-40"
          >
            <IconPin size={17} />
          </button>

          <button
            type="button"
            aria-label="現在位置に戻る"
            title="現在位置に戻る"
            disabled={!ready || locating}
            onClick={() => void goToHere()}
            className={`glass inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
              locating
                ? 'border-marine/60 text-marine'
                : 'border-line text-fg-dim hover:border-marine/60 hover:text-marine'
            }`}
          >
            <IconTarget size={17} />
          </button>
        </div>
      </div>

      {hereError ? <p className="mt-1.5 text-[11px] text-fg-mute">{hereError}</p> : null}
    </div>
  )
}

/** 吹き出しは HTML を組むので、名前やメモをそのまま入れない */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
