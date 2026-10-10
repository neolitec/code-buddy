import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { elementFromAnchor, rangesFromAnchors, startRect } from './anchors'
import { type ReviewComment, wasResolved } from './domain'
import { RAINBOW_PERIOD } from './styles'
import { Icon } from './ui'

const WIDGET = '[data-code-buddy]'

interface Box {
  top: number
  left: number
  width: number
  height: number
}

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
    if (wasResolved(comment)) return []
    const element = elementFromAnchor(root, comment.anchor)
    return element ? [{ comment, element }] : []
  })
}

function measureElements(found: ReturnType<typeof findElements>): Mark[] {
  return found.map(({ comment, element }) => ({ comment, ...boxOf(element) }))
}

/**
 * Frames around the elements that open comments point at, until their thread
 * is first resolved: a follow-up, often about something else, does not bring
 * them back. A bubble on each opens the comment's thread.
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
            aria-label={`Open the comment on <${comment.anchor.element?.tag ?? 'element'}>`}
            title={comment.messages[0]?.body}
            onClick={() => onOpen(comment)}
          >
            <Icon name="chat" />
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

/** The ranges of the comments on a text never resolved, read from the page's text once. */
function findQuotes(root: Element, comments: ReviewComment[]) {
  const quoted = comments.filter(
    (comment) => !wasResolved(comment) && !comment.anchor.element && comment.anchor.quote,
  )
  const ranges = rangesFromAnchors(
    root,
    quoted.map((comment) => comment.anchor),
  )
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
 * A rainbow behind each commented text, until its thread is first resolved, and a
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
          aria-label={`Open the comment on “${comment.anchor.quote}”`}
          title={comment.messages[0]?.body}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpen(comment)}
        >
          <Icon name="chat" />
        </button>
      ))}
    </>
  )
}

/** Outlines `element` while it is on screen, following scroll and layout. */
export function TargetOutline({ element }: { element: Element }) {
  const [box, setBox] = useState<Box>()

  useEffect(() => {
    let frame = 0
    const track = () => {
      const next = element.isConnected ? boxOf(element) : undefined
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
  }, [element])

  if (!box) return null
  return (
    <div
      className="cb-outline"
      data-testid="cb-target"
      style={{
        top: box.top - 4,
        left: box.left - 4,
        width: box.width + 8,
        height: box.height + 8,
      }}
    />
  )
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
