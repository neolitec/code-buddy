import type { ReviewComment } from './domain'
import { elementFromAnchor, rangeFromAnchor } from './anchors'

export const HIGHLIGHT_NAME = 'code-buddy'
export const ACTIVE_HIGHLIGHT_NAME = 'code-buddy-active'

function highlightsApi() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined
}

export function paintHighlights(
  root: Element,
  comments: ReviewComment[],
  activeId?: string,
): void {
  const highlights = highlightsApi()
  if (!highlights) return
  const ranges: Range[] = []
  const active: Range[] = []
  comments
    .filter((comment) => comment.status === 'open')
    .forEach((comment) => {
      const range = rangeFromAnchor(root, comment)
      if (!range) return
      ;(comment.id === activeId ? active : ranges).push(range)
    })
  highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
  highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(...active))
}

export function clearHighlights(): void {
  highlightsApi()?.delete(HIGHLIGHT_NAME)
  highlightsApi()?.delete(ACTIVE_HIGHLIGHT_NAME)
}

export function scrollToComment(root: Element, comment: ReviewComment): void {
  const range = rangeFromAnchor(root, comment)
  const target =
    elementFromAnchor(root, comment) ??
    range?.startContainer.parentElement ??
    (comment.section
      ? Array.from(root.querySelectorAll('h1, h2, h3')).find(
          (heading) => heading.textContent?.trim() === comment.section,
        )
      : undefined)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
