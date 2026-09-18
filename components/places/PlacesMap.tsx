'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui'
import { isVisited, placeKindLabel } from '@/lib/places'
import type { Place } from '@/types'

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

export default function PlacesMap({ places }: { places: Place[] }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const infoRef = useRef<any>(null)
  const [gate, setGate] = useState<Gate>('loading')
  const ready = gate === 'ready'

  const pinned = places.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')

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
      const marker = new window.google.maps.Marker({
        map: mapRef.current,
        position: { lat: place.lat as number, lng: place.lng as number },
        title: place.name,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          // 行った場所は塗りつぶし、行きたい場所は輪郭だけ
          fillColor: '#22d3ee',
          fillOpacity: visited ? 0.95 : 0.15,
          strokeColor: '#22d3ee',
          strokeWeight: 2,
        },
      })

      marker.addListener('click', () => {
        infoRef.current.setContent(
          `<div style="color:#0e1420;font-size:12px;line-height:1.5">
             <strong>${escapeHtml(place.name)}</strong><br />
             ${escapeHtml(placeKindLabel(place.kind))}${place.area ? ` / ${escapeHtml(place.area)}` : ''}
             ${visited ? '<br />行った' : ''}
           </div>`
        )
        infoRef.current.open({ map: mapRef.current, anchor: marker })
      })

      markersRef.current.push(marker)
      bounds.extend(marker.getPosition())
    }

    if (pinned.length === 1) {
      mapRef.current.setCenter(bounds.getCenter())
      mapRef.current.setZoom(15)
    } else if (pinned.length > 1) {
      mapRef.current.fitBounds(bounds, 48)
    }
  }, [ready, pinned])

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
    <div
      ref={boxRef}
      className="h-[280px] w-full overflow-hidden rounded-2xl border border-line"
    />
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
