import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { NewReviewComment, ReviewComment, ReviewCommentPatch } from './domain'

const API = new URL('api/comments', new URL('.', import.meta.url)).href
const POLL_ACTIVE_MS = 3000
const POLL_IDLE_MS = 10000
const CHANGED = 'code-buddy:changed'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Headers, not an object spread: a spread drops the entries of a Headers or an array.
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  // The server is ours: its JSON has the shape the caller asks for.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

const changed = () => window.dispatchEvent(new Event(CHANGED))

function usePolledComments(url: string | undefined) {
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reachable, setReachable] = useState(true)

  const load = useCallback(async () => {
    if (!url) return
    try {
      setComments(await request<ReviewComment[]>(url))
      setReachable(true)
    } catch {
      setReachable(false)
    } finally {
      setLoaded(true)
    }
  }, [url])

  const hasOpen = comments.some((comment) => comment.status === 'open')

  useEffect(() => {
    if (!url) return undefined
    // load() never rejects: it records failures as `reachable: false`.
    const reload = () => void load()
    reload()
    const timer = setInterval(reload, hasOpen ? POLL_ACTIVE_MS : POLL_IDLE_MS)
    window.addEventListener(CHANGED, reload)
    return () => {
      clearInterval(timer)
      window.removeEventListener(CHANGED, reload)
    }
  }, [url, load, hasOpen])

  return { comments, loaded, reachable }
}

export function useComments(route: string) {
  return usePolledComments(`${API}?route=${encodeURIComponent(route)}`)
}

export function useAllComments(enabled: boolean) {
  return usePolledComments(enabled ? `${API}?all=1` : undefined)
}

export async function createComment(input: NewReviewComment): Promise<ReviewComment> {
  const comment = await request<ReviewComment>(API, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  changed()
  return comment
}

export async function updateComment(
  id: string,
  patch: ReviewCommentPatch,
): Promise<ReviewComment> {
  const comment = await request<ReviewComment>(`${API}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  changed()
  return comment
}

export async function deleteComment(id: string): Promise<void> {
  await request<void>(`${API}/${id}`, { method: 'DELETE' })
  changed()
}

const ROUTE_POLL_MS = 300

/** The page's path, following client-side navigation of any router. */
export function useRoute(): string {
  return useSyncExternalStore(
    (listener) => {
      const timer = setInterval(listener, ROUTE_POLL_MS)
      window.addEventListener('popstate', listener)
      return () => {
        clearInterval(timer)
        window.removeEventListener('popstate', listener)
      }
    },
    () => window.location.pathname,
  )
}
