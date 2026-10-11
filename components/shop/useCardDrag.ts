'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { tapFeedback } from '@/lib/haptics'
import { moveItem } from '@/lib/sortable'

/**
 * 札を長押しして並べ替える（0063）。
 *
 * 電話で使うので、HTML の draggable は使えない（指での操作に反応しない）。
 * ポインタの位置を自分で見て、重なった札と入れ替える。
 *
 * 押してすぐ持ち上げない。一覧は縦に長く、触れた指はたいてい画面を送るため。
 * その場で少し待ったときだけ持ち上げる（iPhone のホーム画面と同じ間合い）。
 *
 * 持ち上げたあとは画面を送らせない。touchmove を止めるしかないので、
 * 持ち上がった時点で passive でない聞き手を足す。CSS の touch-action は
 * 指が触れたあとに変えても、その指の操作には効かない。
 */

/** 持ち上がるまでの間。短いと画面を送るたびに持ち上がる */
const HOLD_MS = 320

/** 持ち上がる前にこれだけ動いたら、画面を送るつもりだったとみなす */
const SLIP_PX = 8

export function useCardDrag({
  ids,
  onDrop,
}: {
  /** いま並んでいる順。親から渡し直されたら、こちらの手元も合わせる */
  ids: string[]
  /** 離したときの並び。変わっていなければ呼ばない */
  onDrop: (nextIds: string[]) => void
}) {
  const [order, setOrder] = useState(ids)
  const [dragId, setDragId] = useState<string | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const orderRef = useRef(order)
  orderRef.current = order

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fromRef = useRef<{ x: number; y: number; mouse: boolean } | null>(null)
  /** 並べ替えた直後かどうか。離したあとに続く click を無視するのに使う */
  const draggedRef = useRef(false)
  const blockRef = useRef<((e: TouchEvent) => void) | null>(null)

  // 親から新しい並びが届いたら合わせる（保存のあとや、品が増えたとき）
  useEffect(() => setOrder(ids), [ids])

  const stopBlocking = useCallback(() => {
    if (!blockRef.current) return
    document.removeEventListener('touchmove', blockRef.current)
    blockRef.current = null
  }, [])

  const cancelHold = useCallback(() => {
    if (holdRef.current) clearTimeout(holdRef.current)
    holdRef.current = null
  }, [])

  /** 指が乗っている札と入れ替える */
  const hoverAt = useCallback((x: number, y: number, id: string) => {
    const grid = gridRef.current
    if (!grid) return

    for (const el of grid.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const overId = el.dataset.cardId
      if (!overId || overId === id) continue

      const box = el.getBoundingClientRect()
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue

      const held = orderRef.current
      const from = held.indexOf(id)
      const to = held.indexOf(overId)
      if (from < 0 || to < 0) return
      tapFeedback()
      setOrder(moveItem(held, from, to))
      return
    }
  }, [])

  /** 持ち上げる。指のときだけ、画面を送るのを止める */
  const begin = useCallback((id: string, block: boolean) => {
    tapFeedback()
    if (block) {
      const prevent = (event: TouchEvent) => event.preventDefault()
      document.addEventListener('touchmove', prevent, { passive: false })
      blockRef.current = prevent
    }
    setDragId(id)
  }, [])

  // 持ち上げているあいだだけ、画面ぜんぶで指を追う。札の外へ出ても離せる
  useEffect(() => {
    if (!dragId) return

    const move = (e: PointerEvent) => hoverAt(e.clientX, e.clientY, dragId)
    const end = () => {
      stopBlocking()
      setDragId(null)
      // 離した直後の click を1回ぶん無視する。持ち上げたまま指を戻して
      // 離すと、札を押したことになって編集が開いてしまう
      draggedRef.current = true
      setTimeout(() => (draggedRef.current = false), 300)
      onDrop(orderRef.current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragId, hoverAt, onDrop, stopBlocking])

  useEffect(() => stopBlocking, [stopBlocking])

  const handlers = useCallback(
    (id: string) => ({
      'data-card-id': id,
      // 画像やリンクは、ブラウザが自前で引きずろうとする。こちらの操作を
      // 横取りされるので断る
      draggable: false,
      onDragStart: (e: ReactDragEvent) => e.preventDefault(),
      onPointerDown: (e: ReactPointerEvent) => {
        // 右クリックや、ペンの消しゴム側では始めない
        if (e.button !== 0) return
        fromRef.current = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' }
        cancelHold()
        // マウスは待たせない。押してすぐ引きずるのが普通で、待っているあいだに
        // 動いてしまい、いつまでも持ち上がらない。指と違って画面を送る操作と
        // 紛れないので、少し動いた時点で持ち上げる
        if (e.pointerType === 'mouse') return
        holdRef.current = setTimeout(() => begin(id, true), HOLD_MS)
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (dragId || !fromRef.current) return
        const slipped =
          Math.abs(e.clientX - fromRef.current.x) > SLIP_PX ||
          Math.abs(e.clientY - fromRef.current.y) > SLIP_PX
        if (!slipped) return
        // 指のときは画面を送るつもりだったとみなして取りやめる
        if (fromRef.current.mouse) begin(id, false)
        else cancelHold()
      },
      onPointerUp: cancelHold,
      onPointerCancel: cancelHold,
    }),
    [begin, cancelHold, dragId]
  )

  return {
    /** 並べ替えに使う入れ物。ここの中から札を探す */
    gridRef,
    /** いま画面に出す順 */
    order,
    /** 持ち上げている札 */
    dragId,
    /** 札に広げる属性 */
    handlers,
    /** 並べ替えた直後か。札の click を通すかどうかの判断に使う */
    justDragged: () => draggedRef.current,
  }
}
