import type { ReviewAnchor, ReviewComment } from './domain'
import { elementFromAnchor, rangeFromAnchor, rangesFromAnchors } from './anchors'

export const HIGHLIGHT_NAME = 'code-buddy'
export const ACTIVE_HIGHLIGHT_NAME = 'code-buddy-active'
/** The text the comment being written is about, until it is saved. */
export const DRAFT_HIGHLIGHT_NAME = 'code-buddy-draft'

function highlightsApi() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined
}

export function paintHighlights(
  root: Element,
  comments: ReviewComment[],
  activeId?: string,
  draft?: ReviewAnchor,
): void {
  const highlights = highlightsApi()
  if (!highlights) return
  const open = comments.filter((comment) => comment.status === 'open')
  const [drafted, ...found] = rangesFromAnchors(root, [
    draft ?? { section: '', quote: '', occurrence: 0 },
    ...open,
  ])
  const ranges: Range[] = []
  const active: Range[] = []
  open.forEach((comment, i) => {
    const range = found[i]
    if (range) (comment.id === activeId ? active : ranges).push(range)
  })
  highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
  highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(...active))
  highlights.set(DRAFT_HIGHLIGHT_NAME, drafted ? new Highlight(drafted) : new Highlight())
}

export function clearHighlights(): void {
  highlightsApi()?.delete(HIGHLIGHT_NAME)
  highlightsApi()?.delete(ACTIVE_HIGHLIGHT_NAME)
  highlightsApi()?.delete(DRAFT_HIGHLIGHT_NAME)
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
