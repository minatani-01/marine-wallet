'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { tapFeedback } from '@/lib/haptics'
import { moveItem } from '@/lib/sortable'

/**
 * 札を掴んで並べ替える（0063）。
 *
 * 電話で使うので、HTML の draggable は使えない（指での操作に反応しない）。
 * ポインタの位置を自分で見る。
 *
 * 入れ替えのたびに DOM を組み替えない。組み替えると札が瞬間移動して、
 * 運んでいる最中にガタガタ跳ねる。掴んだときの置き場所を覚えておき、
 * 動かすのは transform だけにする。掴んだ札は指にそのまま付いてきて、
 * ほかの札は空いた場所へ滑って退く。離したところで初めて組み替えるが、
 * そのとき見えている位置と組み替えた後の位置が同じなので、何も動かない。
 *
 * 掴むまでの間は、指とマウスで変える。指は画面を送る操作と紛れるので少し
 * 待つ（iPhone のホーム画面と同じ間合い）。マウスは押してすぐ引きずるのが
 * 普通なので待たない。
 */

/** 指で持ち上がるまでの間。短いと画面を送るたびに持ち上がる */
const HOLD_MS = 320

/** 指はこれだけ動いたら画面送りとみなし、持ち上げるのをやめる */
const SLIP_PX = 6

/**
 * マウスはこれだけ動いてから引きずり始める。
 *
 * 押して開くだけのつもりでも、指先は数ピクセル動く。小さくすると、
 * 開きたいだけなのに札が持ち上がってしまう。
 */
const MOUSE_SLIP_PX = 12

/** 画面の端。ここまで運んだら、持ったまま画面を送る */
const EDGE_PX = 90

/** 自動で送る速さ（1コマあたり） */
const EDGE_STEP = 10

/** 退く札の動き。速すぎると追えず、遅いと重く感じる */
const SLIDE = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)'

/** 掴んだ時点での、札の置き場所。入れ替えの当たり判定にも使う */
type Slot = { left: number; top: number; width: number; height: number }

type Drag = {
  id: string
  /** 掴んだ時点の並び。画面に出す順はこれで固定する */
  base: string[]
  slots: Slot[]
  startX: number
  startY: number
  /** 掴んだ時点の送り位置。自動で送ったぶんを足し戻すのに使う */
  startScroll: number
  dx: number
  dy: number
  /** いま置こうとしている場所 */
  to: number
}

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
  const [drag, setDrag] = useState<Drag | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const orderRef = useRef(order)
  orderRef.current = order
  const dragRef = useRef<Drag | null>(drag)
  dragRef.current = drag

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

  /** 掴む。指のときだけ、画面を送るのを止める */
  const begin = useCallback((id: string, x: number, y: number, touch: boolean) => {
    const grid = gridRef.current
    if (!grid) return

    // 格子の左上からの距離で持つ。指の位置も同じ測り方にそろえる。
    // offsetLeft は「位置を持つ親」からの距離で、格子とは限らない
    const box = grid.getBoundingClientRect()
    const slots: Slot[] = []
    for (const el of grid.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const rect = el.getBoundingClientRect()
      slots.push({
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      })
    }

    const base = [...orderRef.current]
    const at = base.indexOf(id)
    if (at < 0 || slots.length !== base.length) return

    if (touch) {
      const prevent = (event: TouchEvent) => event.preventDefault()
      document.addEventListener('touchmove', prevent, { passive: false })
      blockRef.current = prevent
    }

    tapFeedback()
    setDrag({
      id,
      base,
      slots,
      startX: x,
      startY: y,
      startScroll: window.scrollY,
      dx: 0,
      dy: 0,
      to: at,
    })
  }, [])

  /** 指の位置から、置こうとしている場所を決める */
  const slotAt = useCallback((held: Drag, x: number, y: number) => {
    const grid = gridRef.current
    if (!grid) return held.to
    // 画面を送られても狂わないよう、そのつど格子の位置を取り直す
    const box = grid.getBoundingClientRect()
    const px = x - box.left
    const py = y - box.top

    let nearest = held.to
    let best = Infinity
    for (let index = 0; index < held.slots.length; index += 1) {
      const slot = held.slots[index]
      const inside =
        px >= slot.left &&
        px <= slot.left + slot.width &&
        py >= slot.top &&
        py <= slot.top + slot.height
      // 札の上にいればそこ。外に出ているときは、一番近いところへ寄せる
      if (inside) return index

      const cx = slot.left + slot.width / 2
      const cy = slot.top + slot.height / 2
      const distance = (px - cx) ** 2 + (py - cy) ** 2
      if (distance < best) {
        best = distance
        nearest = index
      }
    }
    return nearest
  }, [])

  // 掴んでいるあいだだけ、画面ぜんぶで指を追う。札の外へ出ても離せる。
  // 付け外しは掴んだときと離したときだけにする。動かすたびに付け直すと、
  // そのぶん取りこぼしやすくなる
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return

    /**
     * 指の位置を札に反映する。
     *
     * 縦は、画面を送ったぶんも足す。自動で送っているあいだ、指は同じ場所に
     * あるのに中身だけが動くので、足さないと札が指から離れていく。
     */
    const apply = (x: number, y: number) => {
      const held = dragRef.current
      if (!held) return
      const to = slotAt(held, x, y)
      if (to !== held.to) {
        tapFeedback()
        setOrder(moveItem(held.base, held.base.indexOf(held.id), to))
      }
      setDrag({
        ...held,
        dx: x - held.startX,
        dy: y - held.startY + (window.scrollY - held.startScroll),
        to,
      })
    }

    const at = { x: 0, y: 0 }
    const move = (e: PointerEvent) => {
      at.x = e.clientX
      at.y = e.clientY
      apply(e.clientX, e.clientY)
    }

    // 画面の端まで運んだら、持ったまま送る。送れないと、画面に出ていない
    // 場所へは動かせない
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (!dragRef.current) return
      const step = at.y < EDGE_PX ? -EDGE_STEP : at.y > window.innerHeight - EDGE_PX ? EDGE_STEP : 0
      if (step === 0) return
      const before = window.scrollY
      window.scrollBy(0, step)
      if (window.scrollY !== before) apply(at.x, at.y)
    }
    frame = requestAnimationFrame(tick)

    const end = () => {
      cancelAnimationFrame(frame)
      stopBlocking()
      const held = dragRef.current
      setDrag(null)

      // 元の場所へ戻して離したときは、押したものとして扱う。持ち上がった
      // だけで並びが変わっていないなら、開きたかったのだと見る。ここを
      // いつも無視にすると、編集を開くのに何度も押し直すことになる
      const moved = held ? held.to !== held.base.indexOf(held.id) : false
      if (moved) {
        draggedRef.current = true
        setTimeout(() => (draggedRef.current = false), 300)
      }
      onDrop(orderRef.current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, slotAt, onDrop, stopBlocking])

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
        const mouse = e.pointerType === 'mouse'
        fromRef.current = { x: e.clientX, y: e.clientY, mouse }
        cancelHold()
        if (mouse) return
        const { clientX, clientY } = e
        holdRef.current = setTimeout(() => begin(id, clientX, clientY, true), HOLD_MS)
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const from = fromRef.current
        if (dragRef.current || !from) return
        const limit = from.mouse ? MOUSE_SLIP_PX : SLIP_PX
        const slipped = Math.abs(e.clientX - from.x) > limit || Math.abs(e.clientY - from.y) > limit
        if (!slipped) return
        // マウスは引きずり始め。指は画面を送るつもりだったとみなして取りやめる
        if (from.mouse) begin(id, from.x, from.y, false)
        else cancelHold()
      },
      onPointerUp: cancelHold,
      onPointerCancel: cancelHold,
    }),
    [begin, cancelHold]
  )

  /**
   * 札に当てる位置。
   *
   * 掴んだ札は指について回り、ほかの札は空いた場所へ滑って退く。
   * 掴んでいないあいだは何も当てない（離した瞬間に戻る動きを出さない）。
   */
  const styleFor = useCallback(
    (id: string): CSSProperties | undefined => {
      if (!drag) return undefined

      if (id === drag.id) {
        return {
          // 少し持ち上げて傾ける。摘まんで浮かせている感じを出す
          transform: `translate3d(${drag.dx}px, ${drag.dy}px, 0) scale(1.06) rotate(1.5deg)`,
          transition: 'none',
          zIndex: 20,
        }
      }

      const was = drag.base.indexOf(id)
      const now = order.indexOf(id)
      if (was < 0 || now < 0 || was === now) return { transition: SLIDE }

      const from = drag.slots[was]
      const to = drag.slots[now]
      return {
        transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0)`,
        transition: SLIDE,
      }
    },
    [drag, order]
  )

  /** いま置こうとしている場所。点線で出して、どこへ入るかを見せる */
  const dropHint = drag ? drag.slots[drag.to] : null

  return {
    /** 並べ替えに使う入れ物。ここの中から札を探す */
    gridRef,
    /** 置き場所の枠。掴んでいないあいだは null */
    dropHint,
    /** 画面に出す順。掴んでいるあいだは組み替えない */
    shownOrder: drag ? drag.base : order,
    /** 掴んでいる札 */
    dragId: drag?.id ?? null,
    /** 札に広げる属性 */
    handlers,
    /** 札に当てる位置 */
    styleFor,
    /** 並べ替えた直後か。札の click を通すかどうかの判断に使う */
    justDragged: () => draggedRef.current,
  }
}
