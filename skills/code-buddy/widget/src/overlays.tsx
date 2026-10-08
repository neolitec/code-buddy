import { useEffect, useState } from 'react'
import { elementFromAnchor, rangesFromAnchors, startRect } from './anchors'
import type { ReviewComment } from './domain'
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
  id: string
  index: number
}

function findElements(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment, index) => {
    if (comment.status !== 'open') return []
    const element = elementFromAnchor(root, comment)
    return element ? [{ id: comment.id, index: index + 1, element }] : []
  })
}

function measureElements(found: ReturnType<typeof findElements>): Mark[] {
  return found.map(({ id, index, element }) => ({ id, index, ...boxOf(element) }))
}

/** Numbered frames around the elements that open comments point at. */
export function ElementMarks({
  root,
  comments,
  activeId,
}: {
  root: Element
  comments: ReviewComment[]
  activeId?: string | undefined
}) {
  const marks = useTracked(root, comments, findElements, measureElements)

  return (
    <>
      {marks.map((mark) => (
        <div
          key={mark.id}
          className={`cb-mark ${mark.id === activeId ? 'cb-mark--active' : ''}`}
          style={{
            top: mark.top,
            left: mark.left,
            width: mark.width,
            height: mark.height,
          }}
        >
          <span className="cb-pin">{mark.index}</span>
        </div>
      ))}
    </>
  )
}

interface QuotePin {
  comment: ReviewComment
  top: number
  left: number
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

/** Width of a bubble and its gap: the next one on the same spot sits beside it. */
const PIN_STEP = 26

/** Where each quote starts, where its Comment button was. */
function measureQuotes(found: ReturnType<typeof findQuotes>): QuotePin[] {
  const pins: QuotePin[] = []
  for (const { comment, range } of found) {
    const { top, left, height } = startRect(range)
    if (!height) continue
    const stacked = pins.filter((pin) => pin.top === top && pin.left === left).length
    pins.push({ comment, top, left: left + stacked * PIN_STEP })
  }
  return pins
}

/** A bubble above the start of each commented text, which opens the comment's thread. */
export function QuoteBubbles({
  root,
  comments,
  activeId,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  activeId?: string | undefined
  onOpen: (comment: ReviewComment) => void
}) {
  const pins = useTracked(root, comments, findQuotes, measureQuotes)

  return (
    <>
      {pins.map(({ comment, top, left }) => (
        <button
          key={comment.id}
          type="button"
          className={`cb-quote-pin cb-live ${comment.id === activeId ? 'cb-quote-pin--active' : ''}`}
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
