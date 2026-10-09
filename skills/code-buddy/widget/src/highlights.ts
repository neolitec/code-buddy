import type { ReviewAnchor, ReviewComment } from './domain'
import { elementFromAnchor, rangeFromAnchor, scrollToArea } from './anchors'

/**
 * The text the comment being written is about, until it is saved. Saved, it
 * gets a rainbow (`QuoteBubbles`), which a highlight cannot draw.
 */
export const DRAFT_HIGHLIGHT_NAME = 'code-buddy-draft'

function highlightsApi() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined
}

export function paintHighlights(root: Element, draft?: ReviewAnchor): void {
  const highlights = highlightsApi()
  if (!highlights) return
  const drafted = draft && rangeFromAnchor(root, draft)
  highlights.set(DRAFT_HIGHLIGHT_NAME, drafted ? new Highlight(drafted) : new Highlight())
}

export function clearHighlights(): void {
  highlightsApi()?.delete(DRAFT_HIGHLIGHT_NAME)
}

export function scrollToComment(root: Element, comment: ReviewComment): void {
  if (comment.area) return scrollToArea(root, comment.area)
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
