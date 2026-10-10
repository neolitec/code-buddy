import { vi } from 'vitest'
import type { ReviewComment, ReviewCommentPatch } from '../src/domain'

export const PAGE = '/'

/** A comment on the page, open and not yet claimed: override what the test needs. */
export function comment(fields: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    route: PAGE,
    url: `http://localhost${PAGE}`,
    body: 'Make the title bigger',
    status: 'open',
    createdAt: '2026-01-01T10:00:00.000Z',
    section: '',
    quote: '',
    occurrence: 0,
    ...fields,
  }
}

/**
 * Stands in for the Code Buddy server: serves `comments`, adds the ones POSTed
 * and records each PATCH. `reachable: false` fails the page's list, as when no session runs.
 */
export function fakeServer(comments: ReviewComment[], { reachable = true } = {}) {
  const patches: { id: string; patch: ReviewCommentPatch }[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (init?.method === 'PATCH') {
      const id = url.pathname.split('/').at(-1) ?? ''
      const body = typeof init.body === 'string' ? init.body : ''
      // The widget sends a patch: the test reads it back as one.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const patch = JSON.parse(body) as ReviewCommentPatch
      patches.push({ id, patch })
      return Response.json(comments.find((entry) => entry.id === id))
    }
    if (init?.method === 'POST') {
      const body = typeof init.body === 'string' ? init.body : ''
      // The widget sends a new comment: the test reads it back as one.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const fields = JSON.parse(body) as Partial<ReviewComment>
      const created = comment({ id: `c${comments.length + 1}`, ...fields })
      comments.push(created)
      return Response.json(created)
    }
    if (!reachable && url.searchParams.has('route')) {
      return new Response(null, { status: 502 })
    }
    return Response.json(comments)
  })
  vi.stubGlobal('fetch', fetch)
  return { patches, fetch }
}

/** Opens the panel on a thread, as the reader left it. */
export function openThread(id: string, view: 'page' | 'all' = 'page') {
  openPanel(view, id)
}

/** Opens the panel on the list of `view`, or on a thread. */
export function openPanel(view: 'page' | 'all' = 'page', threadId?: string) {
  sessionStorage.setItem(
    'code-buddy:ui',
    JSON.stringify({ open: true, docked: false, width: 380, view, threadId }),
  )
}
