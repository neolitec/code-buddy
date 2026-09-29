import { useEffect, useState } from 'react'
import { elementFromAnchor } from './anchors'
import type { ReviewComment } from './domain'

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

interface Mark extends Box {
  id: string
  index: number
}

function measure(root: Element, comments: ReviewComment[]): Mark[] {
  const marks: Mark[] = []
  comments.forEach((comment, index) => {
    if (comment.status !== 'open') return
    const element = elementFromAnchor(root, comment)
    if (element) marks.push({ id: comment.id, index: index + 1, ...boxOf(element) })
  })
  return marks
}

/** Numbered frames around the elements that open comments point at. */
export function ElementMarks({
  root,
  comments,
  activeId,
}: {
  root: Element
  comments: ReviewComment[]
  activeId?: string
}) {
  const [marks, setMarks] = useState<Mark[]>([])

  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setMarks(measure(root, comments)))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { childList: true, subtree: true, attributes: true })
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [root, comments])

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
