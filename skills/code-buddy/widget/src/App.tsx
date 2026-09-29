import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { anchorFromElement, anchorFromSelection, elementFromAnchor } from './anchors'
import {
  createComment,
  deleteComment,
  updateComment,
  useAllComments,
  useComments,
  useRoute,
} from './api'
import {
  APP_ROUTE,
  type ReviewAnchor,
  type ReviewComment,
  isActive,
  threadOf,
} from './domain'
import { clearHighlights, paintHighlights, scrollToComment } from './highlights'
import { ElementMarks, ElementPicker, TargetOutline } from './overlays'
import {
  Button,
  Checkbox,
  Chip,
  type IconName,
  Icon,
  IconButton,
  Spinner,
  Textarea,
  Toasts,
  Toggle,
  toast,
} from './ui'
import buddy from './assets/buddy.webp'

const REPOSITORY = 'https://github.com/neolitec/code-buddy'

const PANEL_WIDTH = 380
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_RATIO = 0.8

const clampWidth = (value: number) =>
  Math.round(
    Math.min(Math.max(value, MIN_PANEL_WIDTH), window.innerWidth * MAX_PANEL_RATIO),
  )
const CENTER: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' }
const PENDING_CENTER_MS = 5000
const FLASH_MS = 1500
const UI_KEY = 'code-buddy:ui'
const CENTER_KEY = 'code-buddy:center'

type View = 'page' | 'all'
type StatusFilter = 'all' | 'open' | 'resolved'

const STATUS_CHIPS = {
  open: 'Open',
  claimed: 'In progress',
  resolved: 'Resolved',
} as const

const STEP_ICONS: Record<string, IconName> = {
  read: 'file-text',
  edit: 'pencil',
  write: 'file-plus',
  multiedit: 'pencil',
  bash: 'terminal',
  search: 'search',
  mcp: 'plug',
  web: 'globe',
  skill: 'lightning',
}

interface Draft extends ReviewAnchor {
  body: string
  app?: boolean
}

interface PendingCenter {
  anchor: ReviewAnchor
  path: string
  id?: string
}

interface UiState {
  open: boolean
  docked: boolean
  width: number
  view: View
  threadId?: string
  statusFilter: StatusFilter
}

const PAGE_LEVEL: ReviewAnchor = { quote: '', occurrence: 0, section: '' }

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names what it stored
function readSession<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    // Written by writeSession with the same key and type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

function writeSession(key: string, value: unknown) {
  try {
    if (value === undefined) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private mode); the panel then just forgets.
  }
}

function pagePath(url: string | undefined): string {
  if (!url) return ''
  const { pathname, search, hash } = new URL(url)
  return pathname + search + hash
}

function scopeLabel(comment: { route: string; url?: string }): string {
  return comment.route === APP_ROUTE
    ? 'Whole app'
    : `Whole page · ${pagePath(comment.url) || comment.route}`
}

function latestText(comment: ReviewComment): string {
  const last = comment.messages?.at(-1)
  return last?.author === 'reader' ? last.body : comment.body
}

const paused = (comment: ReviewComment) =>
  comment.status === 'open' && !!comment.cancelledAt

function statusOf(comment: ReviewComment): keyof typeof STATUS_CHIPS {
  if (comment.status === 'resolved') return 'resolved'
  return isActive(comment) && comment.claimedAt ? 'claimed' : 'open'
}

const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>, busy: boolean) => {
  if (event.nativeEvent.isComposing) return false
  if (event.key !== 'Enter' || event.shiftKey) return false
  event.preventDefault()
  if (!busy) event.currentTarget.form?.requestSubmit()
  return true
}

export default function App({ root }: { root: Element }) {
  const route = useRoute()
  const [saved] = useState(() => readSession<UiState>(UI_KEY))
  const [open, setOpen] = useState(saved?.open ?? false)
  const [docked, setDocked] = useState(saved?.docked ?? false)
  const [width, setWidth] = useState(saved?.width ?? PANEL_WIDTH)
  const [view, setView] = useState<View>(saved?.view ?? 'page')
  const [threadId, setThreadId] = useState(saved?.threadId)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    saved?.statusFilter ?? 'open',
  )
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState<Draft>()
  const [activeId, setActiveId] = useState<string>()
  const [selectionButton, setSelectionButton] = useState<{
    top: number
    left: number
  }>()
  const [picking, setPicking] = useState(false)
  const [target, setTarget] = useState<Element>()
  const [pendingCenter, setPendingCenter] = useState(
    readSession<PendingCenter>(CENTER_KEY),
  )
  const [flash, setFlash] = useState<Element>()
  const [resend, setResend] = useState<{ id: string; body: string }>()
  const [followUp, setFollowUp] = useState<{ id: string; body: string }>()
  const [created, setCreated] = useState<ReviewComment>()
  const [busy, setBusy] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingAnchor = useRef<ReviewAnchor>(undefined)

  const page = useComments(route)
  const comments = page.comments
  const all = useAllComments(open && view === 'all')
  const watching = page.reachable

  useEffect(() => {
    writeSession(UI_KEY, { open, docked, width, view, threadId, statusFilter })
  }, [open, docked, width, view, threadId, statusFilter])

  useEffect(() => {
    const paint = () => paintHighlights(root, comments, activeId)
    paint()
    const observer = new MutationObserver(paint)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      clearHighlights()
    }
  }, [root, comments, activeId])

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection) return
      const anchor = anchorFromSelection(root, selection)
      if (!anchor) {
        setSelectionButton(undefined)
        return
      }
      pendingAnchor.current = anchor
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setSelectionButton({ top: rect.top - 40, left: rect.left })
    }
    const onScroll = () => setSelectionButton(undefined)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [root])

  // Floating: the panel floats over the page, which is left untouched. Docked: the page is squeezed.
  useEffect(() => {
    document.body.style.paddingRight = open && docked ? `${width}px` : ''
    return () => {
      document.body.style.paddingRight = ''
    }
  }, [open, docked, width])

  const toggleDocked = () => {
    setDocked(!docked)
    setWidth(docked ? PANEL_WIDTH : clampWidth(window.innerWidth / 2))
  }

  const resizeTo = (move: MouseEvent) => {
    setWidth(clampWidth(window.innerWidth - move.clientX))
  }

  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault()
    setDragging(true)
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', resizeTo)
      document.removeEventListener('mouseup', onUp)
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
    }
    document.documentElement.style.cursor = 'col-resize'
    document.documentElement.style.userSelect = 'none'
    document.addEventListener('mousemove', resizeTo)
    document.addEventListener('mouseup', onUp)
  }

  const spotlight = useCallback((element: Element, id?: string) => {
    element.scrollIntoView(CENTER)
    if (id) setActiveId(id)
    setFlash(element)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(undefined), FLASH_MS)
  }, [])

  useEffect(() => () => clearTimeout(flashTimer.current), [])

  useEffect(() => {
    if (!pendingCenter || route !== pendingCenter.path) return undefined
    const deadline = Date.now() + PENDING_CENTER_MS
    let frame = 0
    const attempt = () => {
      const element = elementFromAnchor(root, pendingCenter.anchor)
      if (element || Date.now() > deadline) {
        if (element) spotlight(element, pendingCenter.id)
        writeSession(CENTER_KEY, undefined)
        setPendingCenter(undefined)
        return
      }
      frame = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [pendingCenter, root, route, spotlight])

  const startDraft = useCallback((anchor: ReviewAnchor) => {
    setDraft({ ...anchor, body: '' })
    setView('page')
    setThreadId(undefined)
    setOpen(true)
    setPicking(false)
    setSelectionButton(undefined)
    window.getSelection()?.removeAllRanges()
  }, [])

  const pickElement = useCallback(
    (element: Element) => startDraft(anchorFromElement(root, element)),
    [root, startDraft],
  )

  const cancelPick = useCallback(() => setPicking(false), [])

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await task()
      return true
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Request failed', true)
      return false
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft?.body.trim()) return
    const { app, ...anchor } = draft
    await run(async () => {
      const comment = await createComment({
        ...anchor,
        route: app ? APP_ROUTE : route,
        url: window.location.href,
      })
      setCreated(comment)
      setDraft(undefined)
      setThreadId(comment.id)
      setActiveId(comment.id)
      toast('Comment saved')
    })
  }

  const jump = (comment: ReviewComment) => {
    setActiveId(comment.id)
    setThreadId(comment.id)
    scrollToComment(root, comment)
  }

  const thread = threadId
    ? (comments.find((comment) => comment.id === threadId) ??
      all.comments.find((comment) => comment.id === threadId) ??
      (created?.id === threadId ? created : undefined))
    : undefined

  const drafting = view === 'page' && !!draft

  // The page view lists only this page's comments: leaving a draft or a thread
  // for an empty one showed a blank panel, so fall back to the open comments.
  const backToList = () => {
    setThreadId(undefined)
    setDraft(undefined)
    if (view === 'page' && comments.length === 0) {
      setView('all')
      setStatusFilter('open')
    }
  }
  const outlined = target ?? flash

  const centerOn = (anchor: ReviewAnchor, id?: string) => {
    const element = elementFromAnchor(root, anchor)
    if (element) spotlight(element, id)
  }

  const goToPage = (href: string, anchor: ReviewAnchor, id?: string) => {
    const url = new URL(href, window.location.href)
    writeSession(CENTER_KEY, { anchor, path: url.pathname, id })
    window.location.assign(url.pathname + url.search)
  }

  /** `href` is the comment's page, visited first when it is not this one. */
  const elementChip = (anchor: ReviewAnchor, href?: string, id?: string) => {
    if (!anchor.element) return null
    const onThisPage = !href || new URL(href, window.location.href).pathname === route
    return (
      <span
        className="cb-element"
        title={anchor.element.selector}
        data-testid="cb-element"
        onMouseEnter={() =>
          setTarget(onThisPage ? elementFromAnchor(root, anchor) : undefined)
        }
        onMouseLeave={() => setTarget(undefined)}
        onClick={(event) => {
          event.stopPropagation()
          if (onThisPage) return centerOn(anchor, id)
          setTarget(undefined)
          goToPage(href, anchor, id)
        }}
      >
        <code>&lt;{anchor.element.tag}&gt;</code>
        <span>{anchor.element.text || anchor.element.selector}</span>
      </span>
    )
  }

  const anchorDetails = (comment: ReviewComment) => (
    <>
      {comment.section && <span className="cb-section">{comment.section}</span>}
      {comment.quote && <blockquote className="cb-quote">{comment.quote}</blockquote>}
      {elementChip(comment, pagePath(comment.url) || comment.route, comment.id)}
      {!comment.quote && !comment.element && (
        <span className="cb-section">{scopeLabel(comment)}</span>
      )}
    </>
  )

  const deleteButton = (comment: ReviewComment) =>
    !isActive(comment) && (
      <IconButton
        className="cb-delete"
        icon="trash"
        label="Delete this discussion"
        danger
        data-testid="cb-delete"
        onClick={(event) => {
          event.stopPropagation()
          if (comment.id === threadId) setThreadId(undefined)
          void run(() => deleteComment(comment.id))
        }}
      />
    )

  const renderItem = (comment: ReviewComment) => (
    <article
      key={comment.id}
      className={`cb-item ${comment.id === activeId ? 'cb-item--active' : ''}`}
      onClick={() => !thread && jump(comment)}
    >
      <div className="cb-item-top">
        <div>{anchorDetails(comment)}</div>
        {deleteButton(comment)}
      </div>
      <div className="cb-thread">
        {threadOf(comment).map((message, index, messages) =>
          message.author === 'claude' ? (
            // A thread only grows at its end: the index is a stable key.
            // oxlint-disable-next-line react/no-array-index-key
            <div key={index} className="cb-answer">
              {message.body}
            </div>
          ) : (
            // oxlint-disable-next-line react/no-array-index-key
            <p key={index}>
              {messages.length > 2 && index > 0 && <span className="cb-author">You</span>}
              {message.body}
            </p>
          ),
        )}
      </div>
      {isActive(comment) &&
        (comment.claimedAt || watching ? (
          <div className="cb-working" data-testid="cb-working">
            <Spinner />
            {comment.claimedAt ? 'Claude is working on it…' : 'Waiting for Claude…'}
          </div>
        ) : (
          <div className="cb-idle" data-testid="cb-unwatched">
            No Claude session is watching. Run /code-buddy:code-buddy.
          </div>
        ))}
      {isActive(comment) && !!comment.progress?.length && (
        <ol className="cb-steps" data-testid="cb-progress">
          {comment.progress.map((step) => (
            <li key={`${step.at}-${step.label}`}>
              <Icon name={STEP_ICONS[step.kind] ?? 'wrench'} />
              <span title={step.label}>{step.label}</span>
              <time>{new Date(step.at).toLocaleTimeString()}</time>
            </li>
          ))}
        </ol>
      )}
      {paused(comment) && (
        <div className="cb-stopped" data-testid="cb-cancelled">
          <strong>Claude was stopped.</strong>{' '}
          {comment.cancellation?.changed.length ? (
            <>
              It had already changed{' '}
              {comment.cancellation.changed.map((file, index) => (
                <Fragment key={file}>
                  {index > 0 && ', '}
                  <code>{file}</code>
                </Fragment>
              ))}
              . Those changes are still in the working tree.
            </>
          ) : comment.cancellation?.steps ? (
            `It had looked around (${comment.cancellation.steps} steps) but changed no file.`
          ) : (
            'It had not started yet.'
          )}
        </div>
      )}
      {paused(comment) && (
        <form
          className="cb-form"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            const body = (
              resend?.id === comment.id ? resend.body : latestText(comment)
            ).trim()
            if (!body) return
            void run(async () => {
              await updateComment(comment.id, { text: body, cancelled: false })
              setResend(undefined)
            })
          }}
        >
          <Textarea
            aria-label="Edit the comment before sending it again"
            value={resend?.id === comment.id ? resend.body : latestText(comment)}
            onChange={(event) => setResend({ id: comment.id, body: event.target.value })}
          />
          <div className="cb-actions">
            <Button small type="submit" icon="send" disabled={busy}>
              Send again
            </Button>
          </div>
        </form>
      )}
      <div className="cb-actions">
        {isActive(comment) ? (
          <Button
            small
            variant="secondary"
            data-testid="cb-cancel"
            onClick={(event) => {
              event.stopPropagation()
              void run(() => updateComment(comment.id, { cancelled: true }))
            }}
          >
            Cancel
          </Button>
        ) : (
          comment.status === 'open' && (
            <Button
              small
              variant="tertiary"
              onClick={(event) => {
                event.stopPropagation()
                void run(() => updateComment(comment.id, { status: 'resolved' }))
              }}
            >
              Resolve
            </Button>
          )
        )}
      </div>
      {comment.status === 'resolved' && thread?.id === comment.id && (
        <form
          className="cb-form"
          data-testid="cb-follow-up"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            const body = followUp?.id === comment.id ? followUp.body.trim() : ''
            if (!body) return
            void run(async () => {
              await updateComment(comment.id, { followUp: body })
              setFollowUp(undefined)
            })
          }}
        >
          <Textarea
            placeholder="Follow up…"
            value={followUp?.id === comment.id ? followUp.body : ''}
            onChange={(event) =>
              setFollowUp({ id: comment.id, body: event.target.value })
            }
            onKeyDown={(event) => submitOnEnter(event, busy)}
          />
          <div className="cb-actions">
            <Button
              small
              type="submit"
              icon="send"
              disabled={busy || !(followUp?.id === comment.id && followUp.body.trim())}
            >
              Send
            </Button>
          </div>
        </form>
      )}
    </article>
  )

  const renderSummary = (comment: ReviewComment, showPage: boolean) => {
    const status = statusOf(comment)
    const href =
      pagePath(comment.url) || (comment.route === APP_ROUTE ? '' : comment.route)
    const messages = threadOf(comment).length
    return (
      <article
        key={comment.id}
        data-testid="cb-summary"
        className={`cb-item cb-summary ${comment.status === 'resolved' ? 'cb-item--faded' : ''} ${comment.id === activeId ? 'cb-item--active' : ''}`}
        onClick={() => (showPage ? setThreadId(comment.id) : jump(comment))}
      >
        <div className="cb-summary-head">
          <Chip tone={status}>{STATUS_CHIPS[status]}</Chip>
          {!href ? (
            <span className="cb-label">Whole app</span>
          ) : showPage ? (
            <a
              className="cb-page"
              href={href}
              title={comment.url ?? href}
              onClick={(event) => event.stopPropagation()}
            >
              <span>{href}</span>
              <Icon name="external" />
            </a>
          ) : (
            <span className="cb-label" title={comment.section}>
              {comment.section}
            </span>
          )}
          <time dateTime={comment.createdAt}>
            {new Date(comment.createdAt).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </time>
          {deleteButton(comment)}
        </div>
        <p>{comment.body}</p>
        {messages > 2 && <span className="cb-author">{messages} messages</span>}
      </article>
    )
  }

  const filtered = all.comments
    .filter((comment) => statusFilter === 'all' || comment.status === statusFilter)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))

  const allCommentsView = (
    <>
      <Toggle
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />
      {!all.loaded ? (
        <Spinner size={24} />
      ) : filtered.length === 0 ? (
        <div className="cb-empty" data-testid="code-buddy-empty">
          <Button icon="plus" onClick={() => startDraft(PAGE_LEVEL)}>
            New comment
          </Button>
        </div>
      ) : (
        filtered.map((comment) => renderSummary(comment, true))
      )}
    </>
  )

  return (
    <div className="cb">
      <ElementMarks root={root} comments={comments} activeId={activeId} />
      {outlined && <TargetOutline element={outlined} />}
      {picking && (
        <ElementPicker root={root} onPick={pickElement} onCancel={cancelPick} />
      )}
      {selectionButton && (
        <Button
          small
          icon="chat"
          className="cb-selection cb-live"
          data-testid="cb-selection"
          style={{ top: selectionButton.top, left: selectionButton.left }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pendingAnchor.current && startDraft(pendingAnchor.current)}
        >
          Comment
        </Button>
      )}

      {!open && (
        <div className="cb-dock cb-live">
          <Button variant="secondary" icon="chat" onClick={() => startDraft(PAGE_LEVEL)}>
            Comment
          </Button>
          <Button
            icon={picking ? 'x' : 'cursor'}
            onClick={() => setPicking((value) => !value)}
          >
            {picking ? 'Cancel' : 'Point at element'}
          </Button>
        </div>
      )}

      {open && (
        <section
          className={`cb-panel cb-live ${docked ? 'cb-panel--docked' : ''}`}
          style={{ width }}
          data-testid="code-buddy-panel"
        >
          <div
            className="cb-resize"
            data-dragging={dragging || undefined}
            title="Drag to resize"
            onMouseDown={startResize}
          />
          <header className="cb-header">
            <div className="cb-title">
              {(thread || drafting) && (
                <IconButton
                  icon="arrow-left"
                  label="Back to the list"
                  onClick={backToList}
                />
              )}
              <h2>
                {drafting
                  ? 'New comment'
                  : thread
                    ? 'Comment'
                    : view === 'all'
                      ? 'All comments'
                      : 'Comments'}
              </h2>
            </div>
            <div className="cb-header-actions">
              {view !== 'all' && (
                <IconButton
                  icon="chats"
                  label="All comments"
                  onClick={() => {
                    setView('all')
                    setStatusFilter('open')
                    setThreadId(undefined)
                    setDraft(undefined)
                  }}
                />
              )}
              <IconButton
                icon="plus"
                label="New comment"
                disabled={drafting}
                onClick={() => startDraft(PAGE_LEVEL)}
              />
              <IconButton
                icon={docked ? 'collapse-horizontal' : 'expand-horizontal'}
                label={docked ? 'Narrow panel' : 'Widen panel to half the page'}
                onClick={toggleDocked}
              />
              <IconButton icon="x" label="Close" onClick={() => setOpen(false)} />
            </div>
          </header>
          <div className="cb-body">
            {view === 'all' && (thread ? renderItem(thread) : allCommentsView)}
            {drafting && (
              <form className="cb-form" onSubmit={submit}>
                {draft.section && <span className="cb-section">{draft.section}</span>}
                {draft.quote && (
                  <blockquote className="cb-quote">{draft.quote}</blockquote>
                )}
                {elementChip(draft)}
                {!draft.quote && !draft.element && (
                  <Checkbox
                    checked={!draft.app}
                    onChange={(checked) => setDraft({ ...draft, app: !checked })}
                  >
                    Linked to the current page ({pagePath(window.location.href)})
                  </Checkbox>
                )}
                <Textarea
                  autoFocus
                  placeholder="What should change?"
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  onKeyDown={(event) => {
                    if (submitOnEnter(event, busy)) return
                    if (event.key === 'Escape' && !draft.body.trim()) backToList()
                  }}
                />
                <div className="cb-actions">
                  <Button variant="secondary" onClick={backToList}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!draft.body.trim() || busy}>
                    Save
                  </Button>
                </div>
              </form>
            )}
            {view === 'page' && !drafting && thread && renderItem(thread)}
            {view === 'page' &&
              !drafting &&
              !thread &&
              comments
                .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((comment) => renderSummary(comment, false))}
          </div>
          <div className="cb-buddy-slot">
            <img className="cb-buddy" src={buddy} alt="" draggable={false} />
          </div>
          <footer className="cb-footer">
            v{CODE_BUDDY_VERSION} –{' '}
            <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
              Code Buddy
            </a>
          </footer>
        </section>
      )}
      <Toasts />
    </div>
  )
}
