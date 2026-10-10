'use client'

import { type HierarchyRectangularNode, hierarchy, treemap } from 'd3-hierarchy'
import { select } from 'd3-selection'
import 'd3-transition'
import { type ZoomBehavior, type ZoomTransform, zoom as zoomBehavior, zoomIdentity } from 'd3-zoom'
import { ArrowRightIcon, ChevronRightIcon, MinusIcon, PlusIcon, ScanIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { share } from '@/components/breakdown-bars'
import { Button } from '@/components/ui/button'
import { drawn, FOCUS_PARAM, type MapNode, VIEW_PARAM } from '@/lib/money-map'
import { eur, frDate } from '@/lib/utils'

/*
 * The period as a map: every block as large as the net it weighs, nested from
 * the masses down to each movement, and read the way a map is, by zooming and
 * dragging rather than by clicking from level to level. Detail comes with the
 * zoom: a block is named once it is big enough on screen to hold its name, and
 * a movement shows its counterparty, its day and its amount as soon as it has
 * the room, without a pointer on it. Names keep their size on screen whatever
 * the zoom, like the names of a map.
 *
 * Drawn on a canvas: a long period holds thousands of movements, and a frame
 * is redrawn on every step of a pinch. Where the map looks lives in the URL,
 * rewritten without adding to the history, as a map's does: a reload or a
 * shared link lands on the same place.
 *
 * Like the strip, every block is copper and parted from its neighbour by a
 * gap, the gaps keeping their width on screen at any zoom. Each level down is
 * a step lighter, so a name says by its ground whether it is a mass, a
 * category or a movement. The movements a category leaves out are one neutral
 * block.
 */

type Laid = HierarchyRectangularNode<MapNode>

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Size {
  w: number
  h: number
}

interface Hover {
  node: Laid
  x: number
  y: number
}

/** The band that names a block, on screen. */
const HEADER = 36
/** A block is named once it is this big on screen: its band, and room under it. */
const NAMED = { w: 76, h: HEADER + 22 }
/** A movement carries two lines from this size, its amount alone from the smaller one. */
const LEAF = { two: { w: 76, h: 34 }, one: { w: 56, h: 17 } }
/** The gap around a block on screen, by depth: masses part wider than what they hold. */
const GAP = [0, 3, 2, 1]
const MOVE_MS = 450
/** What the path over a chosen block takes at the top of the frame. */
const PATH_H = 48

export function MoneyMap({ root }: { root: MapNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [hover, setHover] = useState<Hover | null>(null)
  // The block chosen by a click: framed, outlined, everything else dimmed.
  const [chosen, setChosen] = useState<Laid | null>(null)
  const hoverRef = useRef<Laid | null>(null)
  const chosenRef = useRef<Laid | null>(null)
  // The block chosen when the map opens, until the first layout finds it.
  const focusId = useRef<string | undefined>(undefined)

  const laidRef = useRef<Laid | null>(null)
  const transformRef = useRef<ZoomTransform>(zoomIdentity)
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const frame = useRef(0)
  // Where the map looks, in fractions of the frame: what survives a resize,
  // and what the URL carries. Read once from the URL, then kept here.
  const view = useRef<View | null>(null)
  const opened = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const paint = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const laid = laidRef.current
      if (!canvas || !laid) return
      const t = transformRef.current
      draw(canvas, laid, t, size, hoverRef.current, chosenRef.current)
    })
  }, [size])

  // Laid out again whenever the data or the frame changes; the view keeps
  // looking at the same place.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const laid = layout(root, size.w, size.h)
    laidRef.current = laid
    // Read from the address bar rather than from what the server rendered:
    // coming back to the page restores the render of its first visit, while
    // the address holds where the map was left.
    if (!opened.current) {
      opened.current = true
      const query = new URLSearchParams(window.location.search)
      view.current = parseView(query.get(VIEW_PARAM) ?? undefined)
      focusId.current = query.get(FOCUS_PARAM) ?? undefined
    }
    // The chosen block survives a new layout by its identity in the tree.
    const chosenId = chosenRef.current?.data.id ?? focusId.current
    // Read once: past the opening, letting go of a block is final.
    focusId.current = undefined
    const again = chosenId ? (laid.descendants().find((n) => n.data.id === chosenId) ?? null) : null
    chosenRef.current = again
    setChosen(again)
    hoverRef.current = null
    setHover(null)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)

    const maxK = deepest(laid)
    const behavior = zoomBehavior<HTMLCanvasElement, unknown>()
      .scaleExtent([1, maxK])
      .translateExtent([
        [0, 0],
        [size.w, size.h],
      ])
      .extent([
        [0, 0],
        [size.w, size.h],
      ])
      .clickDistance(4)
      // One finger on a map seen whole scrolls the page, as anywhere else on
      // it; zoomed in, it moves the map.
      .filter((event: Event) => {
        if (
          event.type === 'touchstart' &&
          (event as TouchEvent).touches.length === 1 &&
          transformRef.current.k === 1
        )
          return false
        const pointer = event as globalThis.MouseEvent
        return (!pointer.ctrlKey || event.type === 'wheel') && !pointer.button
      })
      .on('start', () => {
        hoverRef.current = null
        setHover(null)
      })
      .on('zoom', (e: { transform: ZoomTransform }) => {
        transformRef.current = e.transform
        canvas.style.touchAction = e.transform.k > 1 ? 'none' : 'pan-y'
        paint()
      })
      .on('end', (e: { transform: ZoomTransform }) => {
        view.current = toView(e.transform, size)
        writeView(view.current, chosenRef.current?.data.id)
      })
    zoomRef.current = behavior
    const selection = select(canvas)
    selection.call(behavior)
    // Held to the map's bounds, as every move is: a view read from a link
    // made at another width would otherwise show past the map's edge.
    const bounds: [[number, number], [number, number]] = [
      [0, 0],
      [size.w, size.h],
    ]
    selection.call(
      behavior.transform,
      behavior.constrain()(fromView(view.current, size, maxK), bounds, bounds),
    )
    canvas.style.touchAction = transformRef.current.k > 1 ? 'none' : 'pan-y'
    paint()
    return () => {
      selection.on('.zoom', null)
    }
  }, [root, size, paint])

  const move = (t: ZoomTransform) => {
    const canvas = canvasRef.current
    const behavior = zoomRef.current
    if (!canvas || !behavior) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // A transform set directly skips the map's bounds: held to them here, a
    // block on the edge is framed against the edge rather than against void.
    const bounds: [[number, number], [number, number]] = [
      [0, 0],
      [size.w, size.h],
    ]
    select(canvas)
      .transition()
      .duration(still ? 0 : MOVE_MS)
      .call(behavior.transform, behavior.constrain()(t, bounds, bounds))
  }
  // Choosing a block frames it whole and dims the rest; choosing the map
  // itself lets go of it and shows everything, and Escape only lets go.
  const choose = (n: Laid | null) => {
    const own = n && n.depth > 0 ? n : null
    chosenRef.current = own
    setChosen(own)
    writeView(view.current, own?.data.id)
    if (own) move(fitting(own, size, zoomRef.current?.scaleExtent()[1] ?? 1, PATH_H))
    else if (n) move(zoomIdentity)
    else paint()
    // The path goes with the choice: focus comes back to the map, not to the page.
    if (!own) canvasRef.current?.focus({ preventScroll: true })
  }
  const scaleBy = (factor: number) => {
    const canvas = canvasRef.current
    const behavior = zoomRef.current
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (canvas && behavior)
      select(canvas)
        .transition()
        .duration(still ? 0 : 200)
        .call(behavior.scaleBy, factor)
  }

  const onKey = (e: KeyboardEvent) => {
    const canvas = canvasRef.current
    const behavior = zoomRef.current
    if (!canvas || !behavior) return
    const step = 80 / transformRef.current.k
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const by = pan[e.key]
    if (by) select(canvas).call(behavior.translateBy, by[0], by[1])
    else if (e.key === '+' || e.key === '=') scaleBy(1.6)
    else if (e.key === '-') scaleBy(1 / 1.6)
    else if (e.key === '0') choose(laidRef.current)
    else return
    e.preventDefault()
  }

  const hitAt = (e: MouseEvent<HTMLCanvasElement>) => {
    const laid = laidRef.current
    if (!laid) return null
    const bounds = e.currentTarget.getBoundingClientRect()
    const [wx, wy] = transformRef.current.invert([e.clientX - bounds.left, e.clientY - bounds.top])
    return nodeAt(laid, wx, wy)
  }

  // A click that did not drag chooses the block under it: a mass, a
  // category or a movement alike, by its band or its body.
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const hit = hitAt(e)
    if (hit !== chosenRef.current) choose(hit)
  }

  // Pointed at with a mouse, a block lights up and says what it is. A drag is
  // not a pointing: the map moves under the pointer.
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse') return
    const hit = e.buttons ? null : hitAt(e)
    if (hit !== hoverRef.current) {
      hoverRef.current = hit
      paint()
    }
    setHover(hit ? { node: hit, x: e.clientX, y: e.clientY } : null)
  }
  const onPointerLeave = () => {
    hoverRef.current = null
    setHover(null)
    paint()
  }

  const kind = root.label === 'Tous les revenus' ? 'revenus' : 'dépenses'
  return (
    <div className="flex flex-col gap-3">
      {/* The frame is sized by CSS, not by the measure that follows: a map
          drawn again would otherwise shrink the page for a frame, and the
          browser would pull the scroll up with it. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape lets go of a block from anywhere in the map, its path included */}
      <div
        ref={wrapRef}
        className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-auto sm:h-[max(480px,72vh)]"
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !chosenRef.current) return
          e.preventDefault()
          choose(null)
        }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Carte des ${kind} : ${eur(root.net)}. Flèches pour se déplacer, plus et moins pour zoomer, zéro pour tout voir. Le classement donne les mêmes chiffres en liste.`}
          onKeyDown={onKey}
          onClick={onClick}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          className="block cursor-grab rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring active:cursor-grabbing"
          style={{ width: size.w, height: size.h }}
        />
        <div className="absolute right-2 bottom-2 flex flex-col gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="Zoomer" onClick={() => scaleBy(1.6)}>
            <PlusIcon />
          </Button>
          <Button variant="secondary" size="icon-sm" aria-label="Dézoomer" onClick={() => scaleBy(1 / 1.6)}>
            <MinusIcon />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Tout voir"
            onClick={() => choose(laidRef.current)}
          >
            <ScanIcon />
          </Button>
        </div>
        {chosen && <Path chosen={chosen} onChoose={choose} />}
        {hover && <HoverCard hover={hover} />}
      </div>
    </div>
  )
}

/**
 * The blocks, nested to the movements. A block that holds others keeps a band
 * above them for its name, as tall as the name needs at the zoom where the
 * block becomes big enough to be named: thinner before, it grows with the
 * zoom after, and the name never sits on what the block holds.
 */
function layout(root: MapNode, width: number, height: number): Laid {
  return treemap<MapNode>()
    .size([width, height])
    .paddingTop((n) => (n.depth === 0 ? 0 : HEADER / reveal(n)))(
    hierarchy(root, (n) => {
      const children = drawn(n.children)
      return children.length > 0 ? children : undefined
    })
      .sum((n) => (drawn(n.children).length > 0 ? 0 : n.net))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
  )
}

/** The zoom at which a block is big enough on screen to carry its name. */
function reveal(n: Laid): number {
  return Math.max(1, NAMED.w / (n.x1 - n.x0), NAMED.h / (n.y1 - n.y0))
}

/** How far the map zooms: until the smallest movement reads, within reason. */
function deepest(laid: Laid): number {
  let k = 4
  for (const leaf of laid.leaves()) {
    const w = leaf.x1 - leaf.x0
    const h = leaf.y1 - leaf.y0
    if (w > 0 && h > 0) k = Math.max(k, LEAF.two.w / w, LEAF.two.h / h)
  }
  return Math.min(k * 1.5, 20000)
}

function contains(n: Laid, x: number, y: number): boolean {
  return x >= n.x0 && x < n.x1 && y >= n.y0 && y < n.y1
}

/** The deepest block under a point of the map. */
function nodeAt(laid: Laid, x: number, y: number): Laid | null {
  let node: Laid | undefined = laid
  let found: Laid | null = null
  while (node) {
    found = node
    node = node.children?.find((c) => contains(c, x, y))
  }
  return found === laid ? null : found
}

/** The view that shows a block whole, under the `top` the path keeps for itself. */
function fitting(n: Laid, size: Size, maxK: number, top = 0): ZoomTransform {
  if (n.depth === 0) return zoomIdentity
  const w = n.x1 - n.x0
  const h = n.y1 - n.y0
  const room = size.h - top
  const k = Math.min(maxK, Math.max(1, Math.min(size.w / w, room / h) * 0.96))
  return zoomIdentity.translate(size.w / 2 - k * (n.x0 + w / 2), top + room / 2 - k * (n.y0 + h / 2)).scale(k)
}

type View = { cx: number; cy: number; k: number }

function parseView(at: string | undefined): View | null {
  const [cx, cy, k] = (at ?? '').split(',').map(Number)
  if (cx === undefined || cy === undefined || k === undefined) return null
  if (![cx, cy, k].every(Number.isFinite) || k < 1) return null
  return { cx, cy, k }
}

function toView(t: ZoomTransform, size: Size): View | null {
  if (t.k <= 1.001) return null
  const [x, y] = t.invert([size.w / 2, size.h / 2])
  return { cx: x / size.w, cy: y / size.h, k: t.k }
}

function fromView(v: View | null, size: Size, maxK: number): ZoomTransform {
  if (!v) return zoomIdentity
  const k = Math.min(v.k, maxK)
  return zoomIdentity.translate(size.w / 2 - k * v.cx * size.w, size.h / 2 - k * v.cy * size.h).scale(k)
}

/**
 * Where the map looks, and the block chosen on it, go to the URL in place:
 * moving a map is not a step back.
 */
function writeView(v: View | null, chosen: string | undefined) {
  const url = new URL(window.location.href)
  if (v) url.searchParams.set(VIEW_PARAM, `${v.cx.toFixed(4)},${v.cy.toFixed(4)},${v.k.toFixed(2)}`)
  else url.searchParams.delete(VIEW_PARAM)
  if (chosen) url.searchParams.set(FOCUS_PARAM, chosen)
  else url.searchParams.delete(FOCUS_PARAM)
  // No state of our own: given the router's, Next would take the call for its
  // own and keep the previous address for the way back.
  window.history.replaceState(null, '', url)
}

interface Palette {
  /** Copper by depth: a mass at full copper, what it holds a step lighter at each level. */
  copper: string[]
  seam: string
  rest: string
  ink: string
  restInk: string
  /** What dims the map around a chosen block. */
  dim: string
  /** What lifts a pointed block above its neighbours. */
  lift: string
  accent: string
  sans: string
  mono: string
}

let palette: Palette | null = null

/** The page's own tokens, read once: a canvas does not resolve CSS variables. */
function tokens(): Palette {
  if (palette) return palette
  const root = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  const v = (name: string) => root.getPropertyValue(name).trim()
  const copper = v('--chart-1')
  const background = v('--background')
  palette = {
    copper: [1, 0.88, 0.77, 0.68].map((t) => mix(copper, v('--foreground'), t)),
    seam: mix(copper, background, 0.45),
    rest: mix(v('--faint'), background, 0.5),
    ink: v('--primary-foreground'),
    restInk: v('--foreground'),
    dim: alpha(background, 0.66),
    accent: v('--primary'),
    lift: alpha(v('--foreground'), 0.18),
    sans: body.fontFamily,
    mono: body.getPropertyValue('--font-geist-mono').trim() || 'ui-monospace, monospace',
  }
  return palette
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${a})`
}

/** `a` weighted `t` against `b`, both hex. */
function mix(a: string, b: string, t: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  const ca = rgb(a)
  const cb = rgb(b)
  return `rgb(${ca.map((c, i) => Math.round(c * t + (cb[i] ?? 0) * (1 - t))).join(',')})`
}

function draw(
  canvas: HTMLCanvasElement,
  laid: Laid,
  t: ZoomTransform,
  size: Size,
  hovered: Laid | null,
  chosen: Laid | null,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const p = tokens()
  const dpr = canvas.width / size.w
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.w, size.h)
  const frame = { x: 0, y: 0, w: size.w, h: size.h }
  for (const child of laid.children ?? []) drawBlock(ctx, p, child, t, frame)

  // The chosen block keeps its light and the interface copper around it, the
  // rest of the map steps back. A pointed block wears the same line, thinner.
  if (chosen) {
    const r = intersect(screenRect(chosen, t), frame)
    const shows = r.w > 0 && r.h > 0
    ctx.fillStyle = p.dim
    ctx.beginPath()
    ctx.rect(0, 0, size.w, size.h)
    if (shows) ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fill('evenodd')
    if (shows) outline(ctx, p, r, 3)
  }
  if (hovered && hovered !== chosen) {
    const r = intersect(screenRect(hovered, t), frame)
    if (r.w > 0 && r.h > 0) {
      // Pointed at, the block also lifts: a ring alone is lost among the
      // copper of its neighbours.
      ctx.fillStyle = p.lift
      ctx.fillRect(r.x, r.y, r.w, r.h)
      outline(ctx, p, r, 1.5)
    }
  }
}

/**
 * The accent, which marks what is pointed at or chosen, drawn around the
 * block rather than on it: copper on copper would not read, so a dark hairline
 * parts the block from its ring.
 */
function outline(ctx: CanvasRenderingContext2D, p: Palette, r: Rect, width: number) {
  ctx.strokeStyle = p.ink
  ctx.lineWidth = 1
  ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1)
  const out = 1 + width / 2
  ctx.strokeStyle = p.accent
  ctx.lineWidth = width
  ctx.strokeRect(r.x - out, r.y - out, r.w + 2 * out, r.h + 2 * out)
}

/** A block on screen, inside its gap. */
function screenRect(n: Laid, t: ZoomTransform): Rect {
  const g = (GAP[Math.min(n.depth, GAP.length - 1)] ?? 1) / 2
  const x0 = t.applyX(n.x0)
  const y0 = t.applyY(n.y0)
  return { x: x0 + g, y: y0 + g, w: t.applyX(n.x1) - x0 - 2 * g, h: t.applyY(n.y1) - y0 - 2 * g }
}

function drawBlock(ctx: CanvasRenderingContext2D, p: Palette, n: Laid, t: ZoomTransform, clip: Rect) {
  const x0 = t.applyX(n.x0)
  const y0 = t.applyY(n.y0)
  const x1 = t.applyX(n.x1)
  const y1 = t.applyY(n.y1)
  if (x1 < clip.x || y1 < clip.y || x0 > clip.x + clip.w || y0 > clip.y + clip.h) return
  const g = (GAP[Math.min(n.depth, GAP.length - 1)] ?? 1) / 2
  const outer = screenRect(n, t)
  const r = intersect(outer, clip)
  if (r.w < 0.5 || r.h < 0.5) return

  if (!n.children) {
    ctx.fillStyle = n.data.level === 'rest' ? p.rest : shade(p, n)
    ctx.fillRect(r.x, r.y, r.w, r.h)
    leafLabel(ctx, p, n, r)
    return
  }
  ctx.fillStyle = p.seam
  ctx.fillRect(r.x, r.y, r.w, r.h)
  const band = intersect({ ...outer, h: (HEADER / reveal(n)) * t.k - g }, r)
  if (band.h > 0.5) {
    ctx.fillStyle = shade(p, n)
    ctx.fillRect(band.x, band.y, band.w, band.h)
  }
  // Named once its band has the room, at the top of what shows of it.
  if (band.h >= HEADER - 2 && band.w >= NAMED.w) {
    const parent = n.parent?.data.net ?? n.data.net
    text(
      ctx,
      p,
      n.data.label,
      [`${eur(n.data.net)} · ${share(n.data.net, parent)}`, eur(n.data.net)],
      band,
      p.ink,
    )
  }
  for (const child of n.children) drawBlock(ctx, p, child, t, r)
}

function shade(p: Palette, n: Laid): string {
  return p.copper[Math.min(n.depth, p.copper.length) - 1] ?? p.copper[0]!
}

function leafLabel(ctx: CanvasRenderingContext2D, p: Palette, n: Laid, r: Rect) {
  const node = n.data
  const ink = node.level === 'rest' ? p.restInk : p.ink
  const amount = eur(node.net)
  if (r.w >= LEAF.two.w && r.h >= LEAF.two.h) {
    const lead =
      node.level === 'movement' && node.date
        ? `${frDate(node.date)} · ${amount}`
        : `${amount} · ${share(node.net, n.parent?.data.net ?? node.net)}`
    text(ctx, p, node.label, [lead, amount], r, ink)
  } else if (r.w >= LEAF.one.w && r.h >= LEAF.one.h) {
    // One line: the amount whole on the right, the name shortened before it.
    ctx.fillStyle = ink
    ctx.font = `12px ${p.mono}`
    const aw = ctx.measureText(amount).width
    if (aw + 12 > r.w) return
    ctx.textAlign = 'right'
    ctx.fillText(amount, r.x + r.w - 6, r.y + 13)
    ctx.textAlign = 'left'
    ctx.font = `500 12.5px ${p.sans}`
    const name = fit(ctx, node.label, r.w - aw - 18)
    if (name) ctx.fillText(name, r.x + 6, r.y + 13)
  }
}

/**
 * A name over its figures, the longest figure that fits: the amount is the
 * last of them, and a name is shortened before an amount ever is.
 */
function text(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  name: string,
  figures: string[],
  r: Rect,
  ink: string,
) {
  const room = r.w - 14
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  ctx.font = `500 13px ${p.sans}`
  const first = fit(ctx, name, room)
  if (first) ctx.fillText(first, r.x + 7, r.y + 15)
  ctx.font = `12px ${p.mono}`
  const figure = figures.find((f) => ctx.measureText(f).width <= room)
  if (figure) ctx.fillText(figure, r.x + 7, r.y + 30)
}

/**
 * A name shortened to fit, or nothing when what would remain names nothing:
 * « Bi… » beside an amount reads as noise, the amount alone does not.
 */
function fit(ctx: CanvasRenderingContext2D, label: string, room: number): string {
  if (ctx.measureText(label).width <= room) return label
  let lo = 0
  let hi = label.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${label.slice(0, mid)}…`).width <= room) lo = mid
    else hi = mid - 1
  }
  return lo >= Math.min(4, label.length) ? `${label.slice(0, lo)}…` : ''
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y }
}

/**
 * Where the chosen block sits, inside the map, where the eye already is: each
 * step frames its own block, the first one the whole map, and the cross lets
 * go of the choice where it stands. The way to the ledger lives here too,
 * whatever the block: on the block itself it would vanish with a name too
 * long for it, and a chosen block keeps the same words it had before.
 */
function Path({ chosen, onChoose }: { chosen: Laid; onChoose: (n: Laid | null) => void }) {
  const steps = chosen.ancestors().reverse()
  const ledger = chosen.data.href
  return (
    <nav
      aria-label="Bloc choisi"
      className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-lg border border-border bg-popover/95 py-1 pr-1 pl-2.5 text-popover-foreground shadow-lg"
    >
      <ol className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {steps.map((n, i) => {
          const current = n === chosen
          return (
            <li key={n.data.id} className="flex min-w-0 items-baseline gap-1">
              {i > 0 && <ChevronRightIcon aria-hidden className="size-3 shrink-0 self-center text-faint" />}
              <button
                type="button"
                onClick={() => onChoose(n)}
                aria-current={current ? 'location' : undefined}
                className="flex min-w-0 items-baseline gap-1.5 rounded-sm px-0.5 text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current]:text-foreground"
              >
                <span className={current ? 'truncate font-medium' : 'truncate'}>{n.data.label}</span>
                {current && <span className="font-mono text-[12px] tabular">{eur(n.data.net)}</span>}
              </button>
            </li>
          )
        })}
      </ol>
      {ledger && (
        <Link
          href={chosen.data.href!}
          className="ml-2 flex shrink-0 items-center gap-1 rounded-sm border-l border-border pl-2.5 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Voir dans les mouvements
          <ArrowRightIcon className="size-3" />
        </Link>
      )}
      <Button variant="ghost" size="icon-xs" aria-label="Relâcher le bloc" onClick={() => onChoose(null)}>
        <XIcon />
      </Button>
    </nav>
  )
}

const TIP = { w: 232, h: 104 }

/** What a pointed block is, where it sits and what it weighs, by the pointer. */
function HoverCard({ hover }: { hover: Hover }) {
  const { node, x, y } = hover
  const data = node.data
  const parent = node.parent
  const path = node
    .ancestors()
    .slice(1, -1)
    .reverse()
    .map((a) => a.data.label)
    .join(' › ')
  const left = x + TIP.w + 20 > window.innerWidth ? x - TIP.w - 14 : x + 14
  const top = y + TIP.h + 24 > window.innerHeight ? y - TIP.h - 10 : y + 16
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-58 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
      style={{ left, top }}
    >
      {path && <p className="truncate text-[11px] text-faint">{path}</p>}
      <p className="truncate text-[13px] text-foreground">{data.label}</p>
      <p className="flex items-baseline gap-2 py-px text-xs">
        <span className="text-muted-foreground">
          {data.level === 'movement' && data.date
            ? frDate(data.date)
            : parent
              ? `${share(data.net, parent.data.net)} de ${parent.depth === 0 ? 'la période' : parent.data.label}`
              : ''}
        </span>
        <span className="ml-auto pl-3 font-mono font-semibold tabular">{eur(data.net)}</span>
      </p>
      {data.level === 'movement' ? (
        data.note && (
          <p className="mt-1 border-t border-border pt-1 text-[11px] text-muted-foreground">{data.note}</p>
        )
      ) : (
        <p className="mt-1 border-t border-border pt-1 text-[10.5px] text-faint">
          {data.count} mouvement{data.count > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
