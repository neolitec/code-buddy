import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  coveredBy,
  elementFromAnchor,
  holderOf,
  rangesFromAnchors,
  rectFromArea,
  startRect,
} from './anchors'
import type { ReviewArea, ReviewBox, ReviewComment } from './domain'
import { RAINBOW_PERIOD } from './styles'
import { Icon } from './ui'

const WIDGET = '[data-code-buddy]'

type Box = ReviewBox

const boxOf = (element: Element): Box => {
  const { top, left, width, height } = element.getBoundingClientRect()
  return { top, left, width, height }
}

const sameBox = (a?: Box, b?: Box) =>
  !!a &&
  !!b &&
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.height === b.height

/**
 * `measure(find(root, comments))`, kept in step with the page: `find` runs
 * again when the page changes (nodes, text, attributes such as the padding a
 * docked panel adds), `measure` alone on scroll and resize, once per frame.
 */
function useTracked<Found, Measured>(
  root: Element,
  comments: ReviewComment[],
  find: (root: Element, comments: ReviewComment[]) => Found,
  measure: (found: Found) => Measured[],
): Measured[] {
  const [measured, setMeasured] = useState<Measured[]>([])
  useEffect(() => {
    let found: { value: Found } | undefined
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!found) found = { value: find(root, comments) }
        setMeasured(measure(found.value))
      })
    }
    const changed = () => {
      found = undefined
      update()
    }
    update()
    const observer = new MutationObserver(changed)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [root, comments, find, measure])
  return measured
}

interface Mark extends Box {
  comment: ReviewComment
}

function findElements(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment) => {
    if (comment.status !== 'open') return []
    const element = elementFromAnchor(root, comment)
    return element ? [{ comment, element }] : []
  })
}

function measureElements(found: ReturnType<typeof findElements>): Mark[] {
  return found.map(({ comment, element }) => ({ comment, ...boxOf(element) }))
}

/**
 * Frames around the elements that open comments point at, until Claude
 * resolves their thread; a bubble on each opens the comment's thread.
 */
export function ElementMarks({
  root,
  comments,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  const marks = useTracked(root, comments, findElements, measureElements)

  return (
    <>
      {marks.map(({ comment, top, left, width, height }) => (
        <div key={comment.id} className="cb-mark" style={{ top, left, width, height }}>
          <button
            type="button"
            className="cb-quote-pin cb-mark-pin cb-live"
            aria-label={`Open the comment on <${comment.element?.tag ?? 'element'}>`}
            title={comment.body}
            onClick={() => onOpen(comment)}
          >
            <Icon name="chat" />
          </button>
        </div>
      ))}
    </>
  )
}

function findAreas(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment) => {
    const { area } = comment
    return comment.status === 'open' && area
      ? [{ comment, area, holder: holderOf(root, area) }]
      : []
  })
}

function measureAreas(found: ReturnType<typeof findAreas>): Mark[] {
  return found.map(({ comment, area, holder }) => ({
    comment,
    ...rectFromArea(area, holder),
  }))
}

/**
 * Frames around the areas open comments were drawn on, as around an element,
 * until Claude resolves their thread; a bubble on each opens its thread.
 */
export function AreaMarks({
  root,
  comments,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  const marks = useTracked(root, comments, findAreas, measureAreas)

  return (
    <>
      {marks.map(({ comment, top, left, width, height }) => (
        <div
          key={comment.id}
          className="cb-mark cb-mark--area"
          data-testid="cb-area-mark"
          style={{ top, left, width, height }}
        >
          <button
            type="button"
            className="cb-quote-pin cb-mark-pin cb-live"
            aria-label="Open the comment on the drawn area"
            title={comment.body}
            onClick={() => onOpen(comment)}
          >
            <Icon name="frame" />
          </button>
        </div>
      ))}
    </>
  )
}

interface QuotePin {
  comment: ReviewComment
  top: number
  left: number
  /** One box per line of the quote, behind its text. */
  lines: Box[]
}

/** The boxes of the text `range` covers, line by line: not those of the elements it spans. */
function lineBoxes(range: Range): Box[] {
  const ancestor = range.commonAncestorContainer
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  if (ancestor instanceof Text) texts.push(ancestor)
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text && range.intersectsNode(walker.currentNode)) {
      texts.push(walker.currentNode)
    }
  }
  return texts.flatMap((text) => {
    const part = document.createRange()
    part.selectNodeContents(text)
    if (text === range.startContainer) part.setStart(text, range.startOffset)
    if (text === range.endContainer) part.setEnd(text, range.endOffset)
    return Array.from(part.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map(({ top, left, width, height }) => ({ top, left, width, height }))
  })
}

/** The ranges of the open comments on a text, read from the page's text once. */
function findQuotes(root: Element, comments: ReviewComment[]) {
  const quoted = comments.filter(
    (comment) => comment.status === 'open' && !comment.element && comment.quote,
  )
  const ranges = rangesFromAnchors(root, quoted)
  return quoted.flatMap((comment, i) => {
    const range = ranges[i]
    return range ? [{ comment, range }] : []
  })
}

/** Under this luminance, the page is dark: a rainbow lightens it rather than tints it. */
const DARK = 0.4

/** The page's background, from the first of `body` and `html` that has one. */
function pageIsDark(): boolean {
  for (const element of [document.body, document.documentElement]) {
    const channels = getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.map(Number)
    const [r = 0, g = 0, b = 0, alpha = 1] = channels ?? []
    if (!channels || alpha === 0) continue
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < DARK
  }
  return false
}

/**
 * A layer in the page itself, over its content: the shadow root's stacking
 * context would blend the rainbow with the widget alone, and so tint the text
 * above it. Blended with the page, it colours the background and leaves dark
 * text dark (light text light, on a dark page).
 */
function usePageLayer() {
  const [layer] = useState(() => {
    const element = document.createElement('div')
    element.setAttribute('data-code-buddy', '')
    element.className = 'code-buddy-layer'
    return element
  })
  useEffect(() => {
    // Out of `body`, the root the marks watch: its changes would measure them again, and again.
    document.documentElement.append(layer)
    const theme = () => layer.toggleAttribute('data-dark', pageIsDark())
    theme()
    const observer = new MutationObserver(theme)
    for (const target of [document.documentElement, document.body]) {
      observer.observe(target, { attributes: true })
    }
    return () => {
      observer.disconnect()
      layer.remove()
    }
  }, [layer])
  return layer
}

/** Width of a bubble and its gap: the next one on the same spot sits beside it. */
const PIN_STEP = 26

/** Where each quote starts, where its Comment button was. */
function measureQuotes(found: ReturnType<typeof findQuotes>): QuotePin[] {
  const pins: QuotePin[] = []
  for (const { comment, range } of found) {
    const { top, left, height } = startRect(range)
    if (!height) continue
    const stacked = pins.filter((pin) => pin.top === top && pin.left === left).length
    pins.push({ comment, top, left: left + stacked * PIN_STEP, lines: lineBoxes(range) })
  }
  return pins
}

/**
 * A rainbow behind each commented text, until Claude resolves its thread, and a
 * bubble above its start, which opens the comment's thread.
 */
export function QuoteBubbles({
  root,
  comments,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  const pins = useTracked(root, comments, findQuotes, measureQuotes)
  const layer = usePageLayer()

  return (
    <>
      {createPortal(
        pins.flatMap(({ comment, lines }) =>
          lines.map((line) => (
            <div
              key={`${comment.id}:${line.top}:${line.left}`}
              className="code-buddy-quote-mark"
              style={{
                top: line.top,
                left: line.left,
                width: line.width,
                height: line.height,
              }}
            >
              {/* Laid from the viewport's corner, as every line's: they carry on from each other. */}
              <div style={{ left: -line.left - RAINBOW_PERIOD, top: -line.top }} />
            </div>
          )),
        ),
        layer,
      )}
      {pins.map(({ comment, top, left }) => (
        <button
          key={comment.id}
          type="button"
          className="cb-quote-pin cb-live"
          style={{ top, left }}
          aria-label={`Open the comment on “${comment.quote}”`}
          title={comment.body}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpen(comment)}
        >
          <Icon name="chat" />
        </button>
      ))}
    </>
  )
}

/** The box `measure` gives, once per frame, while it is on screen. */
function useOnScreen(measure: () => Box | undefined): Box | undefined {
  const [box, setBox] = useState<Box>()

  useEffect(() => {
    let frame = 0
    const track = () => {
      const next = measure()
      const onScreen =
        next &&
        next.width > 0 &&
        next.height > 0 &&
        next.top + next.height > 0 &&
        next.left + next.width > 0 &&
        next.top < window.innerHeight &&
        next.left < window.innerWidth
      setBox((current) =>
        !onScreen ? undefined : sameBox(current, next) ? current : next,
      )
      frame = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(frame)
  }, [measure])

  return box
}

function Outline({ box, area }: { box: Box | undefined; area?: boolean }) {
  if (!box) return null
  return (
    <div
      className={`cb-outline${area ? ' cb-outline--area' : ''}`}
      data-testid={area ? 'cb-area-target' : 'cb-target'}
      style={{
        top: box.top - 4,
        left: box.left - 4,
        width: box.width + 8,
        height: box.height + 8,
      }}
    />
  )
}

/** Outlines `element` while it is on screen, following scroll and layout. */
export function TargetOutline({ element }: { element: Element }) {
  const measure = useCallback(
    () => (element.isConnected ? boxOf(element) : undefined),
    [element],
  )
  return <Outline box={useOnScreen(measure)} />
}

/** Outlines a drawn area while it is on screen, in the element it was drawn in. */
export function AreaOutline({ root, area }: { root: Element; area: ReviewArea }) {
  const measure = useCallback(
    () => rectFromArea(area, holderOf(root, area)),
    [root, area],
  )
  return <Outline box={useOnScreen(measure)} area />
}

/** Dashed outline follows the pointer; a click picks the element, Escape cancels. */
export function ElementPicker({
  root,
  onPick,
  onCancel,
}: {
  root: Element
  onPick: (element: Element) => void
  onCancel: () => void
}) {
  const [hovered, setHovered] = useState<Element>()
  const [, setTick] = useState(0)

  useEffect(() => {
    const target = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)
      return element &&
        root.contains(element) &&
        element !== root &&
        !element.closest(WIDGET)
        ? element
        : undefined
    }
    const onMove = (event: MouseEvent) => setHovered(target(event))
    const onClick = (event: MouseEvent) => {
      const element = target(event)
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      onPick(element)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    const onScroll = () => setTick((tick) => tick + 1)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    document.documentElement.style.cursor = 'crosshair'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      document.documentElement.style.cursor = ''
    }
  }, [root, onPick, onCancel])

  const rect = hovered?.getBoundingClientRect()
  return (
    <>
      <div className="cb-hint">Click an element to comment on it. Escape cancels.</div>
      {rect && (
        <div
          className="cb-hover"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span>{hovered?.tagName.toLowerCase()}</span>
        </div>
      )}
    </>
  )
}

/** Under this many pixels a side, a drag is a slip, not an area. */
const MIN_SIDE = 8

interface Point {
  x: number
  y: number
}

interface Drag {
  start: Point
  end: Point
  /** Where the pointer is in the viewport, to follow a scroll. */
  pointer: Point
}

/** The box between two corners on the page, in viewport pixels. */
function boxBetween(start: Point, end: Point): Box {
  const left = Math.min(start.x, end.x) - window.scrollX
  const top = Math.min(start.y, end.y) - window.scrollY
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/**
 * The reader drags a rectangle over the page; the rest of the page dims, and
 * the elements it covers are outlined as it grows. Scrolling while dragging
 * extends it past the window. Escape cancels.
 */
export function AreaDrawer({
  root,
  onDraw,
  onCancel,
}: {
  root: Element
  onDraw: (rect: Box) => void
  onCancel: () => void
}) {
  // Both corners on the page, not in the viewport: the page may scroll under the drag.
  const [drag, setDrag] = useState<Drag>()
  const latest = useRef<Drag>(undefined)
  const [covered, setCovered] = useState<Box[]>([])
  const box = drag && boxBetween(drag.start, drag.end)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const dragging = !!drag
  useEffect(() => {
    if (!dragging) return undefined
    const follow = (pointer: Point) => {
      const current = latest.current
      if (!current) return undefined
      const next = {
        start: current.start,
        end: { x: pointer.x + window.scrollX, y: pointer.y + window.scrollY },
        pointer,
      }
      latest.current = next
      setDrag(next)
      return next
    }
    const onMove = (event: MouseEvent) => follow({ x: event.clientX, y: event.clientY })
    const onScroll = () => latest.current && follow(latest.current.pointer)
    const onUp = (event: MouseEvent) => {
      const done = follow({ x: event.clientX, y: event.clientY })
      latest.current = undefined
      setDrag(undefined)
      const rect = done && boxBetween(done.start, done.end)
      if (rect && rect.width >= MIN_SIDE && rect.height >= MIN_SIDE) onDraw(rect)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [dragging, onDraw])

  // What the area will record, outlined as it grows: once per frame at most.
  const left = box?.left
  const top = box?.top
  const width = box?.width
  const height = box?.height
  const sized = left !== undefined && top !== undefined && !!width && !!height
  useEffect(() => {
    if (left === undefined || top === undefined || !width || !height) return undefined
    const frame = requestAnimationFrame(() => {
      setCovered(coveredBy(root, { left, top, width, height }).map(boxOf))
    })
    return () => cancelAnimationFrame(frame)
  }, [root, left, top, width, height])

  const start = (event: ReactMouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const pointer = { x: event.clientX, y: event.clientY }
    const point = { x: pointer.x + window.scrollX, y: pointer.y + window.scrollY }
    setCovered([])
    latest.current = { start: point, end: point, pointer }
    setDrag(latest.current)
  }

  return (
    <div className="cb-draw cb-live" data-testid="cb-draw" onMouseDown={start}>
      {!box && (
        <div className="cb-hint">
          Drag over the page to frame an area. Scroll to stretch it; Escape cancels.
        </div>
      )}
      {(sized ? covered : []).map((part) => (
        <div
          key={`${part.top}:${part.left}:${part.width}:${part.height}`}
          className="cb-draw-covered"
          style={{
            top: part.top,
            left: part.left,
            width: part.width,
            height: part.height,
          }}
        />
      ))}
      {box && (
        <div
          className="cb-draw-box"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        >
          <span>
            {Math.round(box.width)} × {Math.round(box.height)}
          </span>
        </div>
      )}
    </div>
  )
}
