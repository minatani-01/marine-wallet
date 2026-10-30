'use client'

import { useEffect, useRef, useState } from 'react'

import { IconExpand, IconPin } from '@/components/icons'
import { Card } from '@/components/ui'
import { tapFeedback } from '@/lib/haptics'
import type { RentBuilding, RentPoint, RentStation } from '@/lib/rent'

/**
 * 賃貸さがしの地図（0075）。
 *
 * 駅ごとの徒歩圏を輪で描き、全部が重なったところを塗る。塗ったところが
 * 「どちらの駅からも歩ける場所」で、この画面の答えにあたる。
 *
 * 地図は places と同じ作りで、鍵はページに埋め込まずサーバーへ取りに行く
 * （回数を数えて上限で止めるため）。鍵が無い・上限に達したときは地図を
 * 出さないが、一覧は出るので探すこと自体は続けられる。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any
    __marineMapsLoader?: Promise<void>
  }
}

/** 暗い画面に合わせた地図の色。places と同じものを使う */
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

/** 駅の色。輪と番号で同じ色を使い、どの輪がどの駅か見分けられるようにする */
export const STATION_COLORS = ['#22d3ee', '#f0b840', '#a78bfa', '#2dd4bf', '#fb7185'] as const

/** 重なりの色。駅の色とは別にして、塗りが「答え」だと分かるようにする */
const AREA_COLOR = '#22d3ee'

const CENTER_JP = { lat: 35.681236, lng: 139.767125 }

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

export default function RentMap({
  stations,
  area,
  buildings,
  activeId,
  onSelect,
  onPick,
}: {
  stations: RentStation[]
  /** 全部の駅から徒歩圏内の範囲。無ければ塗らない */
  area: RentPoint[] | null
  buildings: RentBuilding[]
  activeId: string | null
  onSelect: (id: string) => void
  /** 地図を押して地点を足す。駅に無い場所（職場など）を入れるため */
  onPick: (point: RentPoint) => void
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const circlesRef = useRef<any[]>([])
  const pinsRef = useRef<any[]>([])
  const polygonRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const infoRef = useRef<any>(null)
  const pickingRef = useRef(false)

  const [gate, setGate] = useState<Gate>('loading')
  const [tall, setTall] = useState(false)
  const [picking, setPicking] = useState(false)
  const ready = gate === 'ready'

  // クリックの扱いだけ最新の値が要る。地図の listener は貼り直さない
  pickingRef.current = picking

  useEffect(() => {
    let alive = true

    const start = async () => {
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
        zoom: 11,
        styles: DARK_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      })
      infoRef.current ??= new window.google.maps.InfoWindow()
      mapRef.current.addListener('click', (e: any) => {
        if (!pickingRef.current) return
        setPicking(false)
        onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() })
      })
      setGate('ready')
    }

    void start()
    return () => {
      alive = false
    }
    // 地図は1度だけ作る。onPick は ref 越しに最新を見るので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 駅の輪と番号 */
  useEffect(() => {
    if (!ready || !mapRef.current) return

    for (const c of circlesRef.current) c.setMap(null)
    for (const p of pinsRef.current) p.setMap(null)
    circlesRef.current = []
    pinsRef.current = []

    stations.forEach((s, index) => {
      const color = STATION_COLORS[index % STATION_COLORS.length]
      circlesRef.current.push(
        new window.google.maps.Circle({
          map: mapRef.current,
          center: { lat: s.lat, lng: s.lng },
          radius: s.minutes * 80,
          strokeColor: color,
          strokeOpacity: 0.85,
          strokeWeight: 1.5,
          fillColor: color,
          fillOpacity: 0.04,
          clickable: false,
        })
      )
      pinsRef.current.push(
        new window.google.maps.Marker({
          map: mapRef.current,
          position: { lat: s.lat, lng: s.lng },
          title: `${s.name}（徒歩${s.minutes}分）`,
          zIndex: 1000,
          label: { text: String(index + 1), color: '#06121a', fontSize: '11px', fontWeight: '700' },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#06121a',
            strokeWeight: 2,
          },
        })
      )
    })

    // 駅を足したり分数を変えたときは、輪が全部入るところまで引く
    if (stations.length > 0) {
      const bounds = new window.google.maps.LatLngBounds()
      for (const c of circlesRef.current) bounds.union(c.getBounds())
      mapRef.current.fitBounds(bounds, 32)
    }
  }, [ready, stations])

  /** 重なりの塗り */
  useEffect(() => {
    if (!ready || !mapRef.current) return

    polygonRef.current?.setMap(null)
    polygonRef.current = null
    if (!area || area.length < 3) return

    polygonRef.current = new window.google.maps.Polygon({
      map: mapRef.current,
      paths: area,
      strokeColor: AREA_COLOR,
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: AREA_COLOR,
      fillOpacity: 0.18,
      clickable: false,
      zIndex: 2,
    })
  }, [ready, area])

  /** 建物 */
  useEffect(() => {
    if (!ready || !mapRef.current) return

    for (const m of markersRef.current.values()) m.setMap(null)
    markersRef.current.clear()

    for (const b of buildings) {
      const marker = new window.google.maps.Marker({
        map: mapRef.current,
        position: { lat: b.lat, lng: b.lng },
        title: b.name || '名前の分からない建物',
        zIndex: b.name ? 20 : 10,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 5,
          // 名前の分からない建物は輪郭だけにする。調べようがないので弱く出す
          fillColor: b.name ? '#f8fafc' : '#0e1420',
          fillOpacity: 1,
          strokeColor: b.name ? AREA_COLOR : '#64748b',
          strokeWeight: 2,
        },
      })
      marker.addListener('click', () => onSelect(b.id))
      markersRef.current.set(b.id, marker)
    }
  }, [ready, buildings, onSelect])

  /** 選んだ建物を目立たせ、吹き出しを出す */
  useEffect(() => {
    if (!ready || !mapRef.current) return

    for (const [id, marker] of markersRef.current) {
      const icon = marker.getIcon()
      marker.setIcon({ ...icon, scale: id === activeId ? 9 : 5 })
    }

    if (!activeId) {
      infoRef.current?.close()
      return
    }

    const marker = markersRef.current.get(activeId)
    const building = buildings.find((b) => b.id === activeId)
    if (!marker || !building) return

    const rows = stations
      .map((s) => {
        const w = building.walk[s.id]
        if (!w) return ''
        return `${escapeHtml(s.name)} 徒歩${w.minutes}分${w.measured ? '' : '（概算）'}`
      })
      .filter(Boolean)
      .join('<br />')

    infoRef.current.setContent(
      `<div style="color:#0e1420;font-size:12px;line-height:1.6">
         <strong>${escapeHtml(building.name || '名前の分からない建物')}</strong><br />
         ${rows}
       </div>`
    )
    infoRef.current.open({ map: mapRef.current, anchor: marker })
    marker.setZIndex(999)
  }, [ready, activeId, buildings, stations])

  if (gate === 'off' || gate === 'over' || gate === 'failed') {
    return (
      <Card>
        <div className="eyebrow">地図</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-dim">
          {gate === 'over'
            ? '今日はここまでにしておきます。'
            : gate === 'failed'
              ? '地図を読み込めませんでした。'
              : 'Google マップの鍵を設定すると、ここに地図が出ます。'}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">
          地図が無くても、駅を入れて建物を探すことはできます。
        </p>
      </Card>
    )
  }

  return (
    <div className="relative">
      <div
        ref={boxRef}
        className={`w-full overflow-hidden rounded-2xl border border-line transition-[height] ${
          tall ? 'h-[520px]' : 'h-[300px]'
        } ${picking ? 'cursor-crosshair' : ''}`}
      />

      {picking ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
          <span className="glass rounded-full border border-marine/60 px-3 py-1.5 text-[11px] text-marine">
            地図を押すと、その場所を1つの地点として足します
          </span>
        </div>
      ) : null}

      <div className="absolute right-3 bottom-3 flex flex-col gap-2">
        <button
          type="button"
          aria-label="地図を広げる"
          aria-pressed={tall}
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

        {/* 駅に無い場所（職場・実家）も条件に入れられるようにする */}
        <button
          type="button"
          aria-label="地図を押して地点を足す"
          aria-pressed={picking}
          disabled={!ready}
          onClick={() => {
            tapFeedback()
            setPicking((on) => !on)
          }}
          className={`glass inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
            picking
              ? 'border-marine/60 text-marine'
              : 'border-line text-fg-dim hover:border-marine/60 hover:text-marine'
          }`}
        >
          <IconPin size={17} />
        </button>
      </div>
    </div>
  )
}

/** 吹き出しは HTML を組むので、名前をそのまま入れない */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
