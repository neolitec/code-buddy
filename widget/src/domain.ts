/** Route of a comment about the whole app; it is listed on every page. */
export const APP_ROUTE = '*'

export type ReviewCommentStatus = 'open' | 'resolved'

export interface ReviewElement {
  /** Selector from `body`, unique when it was recorded. */
  selector: string
  tag: string
  /** Visible text, normalised and truncated. */
  text: string
  /** Outer HTML, whitespace-collapsed and truncated, for a human reader. */
  html: string
}

export interface ReviewAnchor {
  /** Heading the quote sits under, for a human reader of the JSON file. */
  section: string
  /** Selected text, whitespace-normalised. Empty for a page-level comment. */
  quote: string
  /** Which occurrence of the quote on the page, when it appears several times. */
  occurrence: number
  /** Set when the reader pointed at an element instead of selecting text. */
  element?: ReviewElement
}

export interface ReviewProgress {
  at: number
  kind: string
  label: string
}

export interface ReviewMessage {
  author: 'reader' | 'claude'
  body: string
  at: string
}

export interface ReviewCancellation {
  at: string
  /** Files the cancelled agent had already written, relative to the repo. */
  changed: string[]
  steps: number
}

export interface ReviewComment extends ReviewAnchor {
  id: string
  route: string
  /** Full URL when the comment was written, query string and hash included. */
  url?: string
  body: string
  status: ReviewCommentStatus
  createdAt: string
  /** Latest answer from the agent; also the last `claude` message. */
  resolution?: string
  /** Exchange after the first question (`body`), oldest first. */
  messages?: ReviewMessage[]
  resolvedAt?: string
  /** Set by the agent when it starts working on the comment. */
  claimedAt?: string
  /** Set while an open comment's run is cancelled, until the reader re-sends it. */
  cancelledAt?: string
  /** Last cancelled run; kept after a re-send so the next agent sees it. */
  cancellation?: ReviewCancellation
  /** Latest tool calls of the agent working on it; never stored in the file. */
  progress?: ReviewProgress[]
}

export type NewReviewComment = Pick<
  ReviewComment,
  'route' | 'url' | 'body' | 'section' | 'quote' | 'occurrence' | 'element'
>

export type ReviewCommentPatch = Partial<
  Pick<ReviewComment, 'body' | 'status' | 'resolution'>
> & {
  /** true stops the current run; false re-sends the comment to a new agent. */
  cancelled?: boolean
  /** Reopens a resolved comment with the reader's next message. */
  followUp?: string
  /** With `cancelled: false`: replaces the reader's latest text before re-sending. */
  text?: string
}

/** The thread as a list, including the question and a legacy `resolution`. */
export function threadOf(comment: ReviewComment): ReviewMessage[] {
  const question: ReviewMessage = {
    author: 'reader',
    body: comment.body,
    at: comment.createdAt,
  }
  if (comment.messages?.length) return [question, ...comment.messages]
  return comment.resolution
    ? [
        question,
        {
          author: 'claude',
          body: comment.resolution,
          at: comment.resolvedAt ?? comment.createdAt,
        },
      ]
    : [question]
}

/** True for an open comment an agent should be working on. */
export function isActive(
  comment: Pick<ReviewComment, 'status' | 'cancelledAt'>
) {
  return comment.status === 'open' && !comment.cancelledAt
}

export function normaliseQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
