// The debug panel: every comment as the widget holds it, for whoever works on
// Code Buddy. Only reachable behind CODE_BUDDY_DEBUG, so a release build drops
// this whole module: keep it free of top-level side effects.
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import { useAllComments } from './api'
import {
  type ReviewComment,
  type ReviewMessage,
  type ReviewProgress,
  isActive,
  isAsking,
  threadOf,
} from './domain'
import { IconButton } from './ui'

const DEBUG_CSS = `
.cb-debug { position: fixed; left: 16px; bottom: 16px; width: min(520px, calc(100vw - 32px)); max-height: min(80vh, 720px); display: flex; flex-direction: column; background: var(--cb-surface); color: var(--cb-text); border: 1px solid var(--cb-border); border-radius: 12px; box-shadow: 0 12px 32px rgba(19, 41, 75, .18); font-size: 12px; overflow: hidden; }
.cb-debug-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--cb-border); }
.cb-debug-head h2 { margin: 0; font-size: 13px; font-weight: 600; }
.cb-debug-hint { color: var(--cb-muted); font-weight: 400; }
.cb-debug-list { display: flex; gap: 4px; padding: 8px 14px; overflow-x: auto; border-bottom: 1px solid var(--cb-border); flex-shrink: 0; }
.cb-debug-list button { all: unset; cursor: pointer; padding: 2px 8px; border: 1px solid var(--cb-border); border-radius: 999px; white-space: nowrap; font-family: ui-monospace, monospace; }
.cb-debug-list button[aria-pressed="true"] { background: var(--cb-accent-weak); border-color: var(--cb-accent); color: var(--cb-accent-strong); }
.cb-debug-body { overflow: auto; padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.cb-debug-fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0; }
.cb-debug-fields dt { color: var(--cb-muted); }
.cb-debug-fields dd { margin: 0; font-family: ui-monospace, monospace; word-break: break-all; }
.cb-debug-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cb-debug-event { display: grid; grid-template-columns: 84px 1fr; gap: 8px; }
.cb-debug-event time { color: var(--cb-muted); font-family: ui-monospace, monospace; }
.cb-debug-event strong { font-weight: 600; }
.cb-debug-event p { margin: 2px 0 0; white-space: pre-wrap; }
.cb-debug-event--status strong { color: var(--cb-accent-strong); }
.cb-debug-event--failed strong { color: var(--cb-red); }
.cb-debug-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; background: var(--cb-surface-2); color: var(--cb-muted); font-family: ui-monospace, monospace; }
.cb-debug-raw summary { cursor: pointer; color: var(--cb-muted); }
.cb-debug-raw pre { margin: 6px 0 0; padding: 8px; background: var(--cb-surface-2); border-radius: 6px; overflow: auto; font-size: 11px; }
.cb-debug-empty { color: var(--cb-muted); }
`

// Shown or not: one switch shared by the header's toggle and the panel.
let shown = false
const listeners = new Set<() => void>()

export function toggleDebug() {
  shown = !shown
  listeners.forEach((listener) => listener())
}

function useShown() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => shown,
  )
}

/** Alt+Shift+D: by its key code, as macOS turns Alt+Shift+D into another character. */
const isShortcut = (event: KeyboardEvent) =>
  event.altKey &&
  event.shiftKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  event.code === 'KeyD'

/** The header's discreet switch for the panel. */
export function DebugToggle() {
  return (
    <IconButton
      icon="wrench"
      label="Debug panel (Alt+Shift+D)"
      aria-pressed={useShown()}
      onClick={toggleDebug}
    />
  )
}

type TimelineEvent =
  | { kind: 'status'; at: number; label: string; detail?: string }
  | { kind: 'message'; at: number; message: ReviewMessage }
  | { kind: 'step'; at: number; step: ReviewProgress }

const time = (at: string | undefined) => (at ? Date.parse(at) : NaN)

/** The whole conversation in order: status changes, messages and progress steps. */
export function timelineOf(comment: ReviewComment): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const status = (at: string | undefined, label: string, detail?: string) => {
    if (at)
      events.push({ kind: 'status', at: time(at), label, ...(detail ? { detail } : {}) })
  }
  status(comment.createdAt, 'created')
  for (const message of threadOf(comment)) {
    events.push({ kind: 'message', at: time(message.at), message })
  }
  status(comment.claimedAt, 'claimed')
  status(comment.askedAt, 'asking')
  const cancellation = comment.cancellation
  if (cancellation) {
    status(
      cancellation.at,
      'run cancelled',
      `${cancellation.steps} steps, changed: ${cancellation.changed.join(', ') || 'nothing'}`,
    )
  }
  status(comment.cancelledAt, 'cancelled')
  status(comment.resolvedAt, 'resolved')
  for (const step of comment.progress ?? [])
    events.push({ kind: 'step', at: step.at, step })
  // Stable: what shares a time keeps the order above.
  return events.toSorted((a, b) => a.at - b.at)
}

function Time({ at }: { at: number }) {
  if (Number.isNaN(at)) return <time>?</time>
  const iso = new Date(at).toISOString()
  return (
    <time dateTime={iso} title={iso}>
      {new Date(at).toLocaleTimeString(undefined, { hour12: false })}.
      {String(at % 1000).padStart(3, '0')}
    </time>
  )
}

function MessageEvent({ message }: { message: ReviewMessage }) {
  return (
    <div>
      <strong>{message.author}</strong>
      {message.question && <span className="cb-debug-tag">question</span>}
      {message.multiple && <span className="cb-debug-tag">multiple</span>}
      <p>{message.body}</p>
      {!!message.options?.length && (
        <p>
          options:{' '}
          {message.options
            .map((option) =>
              option.description
                ? `${option.label} (${option.description})`
                : option.label,
            )
            .join(' | ')}
        </p>
      )}
      {!!message.choices?.length && <p>choices: {message.choices.join(' | ')}</p>}
    </div>
  )
}

function StepEvent({ step }: { step: ReviewProgress }) {
  return (
    <div>
      <strong>{step.kind}</strong>
      {step.state && <span className="cb-debug-tag">{step.state}</span>}
      {step.id && <span className="cb-debug-tag">{step.id}</span>}
      {step.label && <p>{step.label}</p>}
      {step.error && <p>error: {step.error}</p>}
    </div>
  )
}

function Timeline({ comment }: { comment: ReviewComment }) {
  return (
    <ol className="cb-debug-timeline" aria-label="Conversation">
      {timelineOf(comment).map((event, index) => (
        <li
          // The timeline is rebuilt from the comment on every change: its order is its identity.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={`cb-debug-event cb-debug-event--${event.kind}${
            event.kind === 'step' && event.step.state === 'failed'
              ? ' cb-debug-event--failed'
              : ''
          }`}
        >
          <Time at={event.at} />
          {event.kind === 'status' ? (
            <div>
              <strong>{event.label}</strong>
              {event.detail && <p>{event.detail}</p>}
            </div>
          ) : event.kind === 'message' ? (
            <MessageEvent message={event.message} />
          ) : (
            <StepEvent step={event.step} />
          )}
        </li>
      ))}
    </ol>
  )
}

function Fields({ comment }: { comment: ReviewComment }) {
  const state = isAsking(comment)
    ? 'asking'
    : isActive(comment)
      ? comment.claimedAt
        ? 'claimed'
        : 'waiting'
      : comment.status === 'open'
        ? 'paused'
        : 'resolved'
  const rows: [string, string | undefined][] = [
    ['id', comment.id],
    ['state', state],
    ['status', comment.status],
    ['route', comment.route],
    ['url', comment.url],
    ['section', comment.section],
    ['quote', comment.quote && `${comment.quote} (#${comment.occurrence})`],
    ['element', comment.element?.selector],
    ['claimedAt', comment.claimedAt],
    ['askedAt', comment.askedAt],
    ['cancelledAt', comment.cancelledAt],
    ['resolvedAt', comment.resolvedAt],
  ]
  return (
    <dl className="cb-debug-fields">
      {rows
        .filter((row): row is [string, string] => !!row[1])
        .map(([name, value]) => (
          <Fragment key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  )
}

/**
 * The panel itself, toggled by DebugToggle or Alt+Shift+D. `held` is what the
 * widget holds; comments of other pages come from a list of its own.
 */
export function DebugPanel({
  held,
  current,
}: {
  held: ReviewComment[]
  current?: string
}) {
  const open = useShown()
  const [selected, setSelected] = useState<string>()
  const others = useAllComments(open)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return
      event.preventDefault()
      toggleDebug()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null
  const comments = [...held, ...others.comments].filter(
    (comment, index, list) =>
      list.findIndex((other) => other.id === comment.id) === index,
  )
  const comment =
    comments.find((entry) => entry.id === (selected ?? current)) ?? comments[0]

  return (
    <section className="cb-debug cb-live" data-testid="cb-debug" aria-label="Debug panel">
      <style>{DEBUG_CSS}</style>
      <header className="cb-debug-head">
        <h2>
          Debug <span className="cb-debug-hint">· {comments.length} comments</span>
        </h2>
        <IconButton icon="x" label="Close the debug panel" onClick={toggleDebug} />
      </header>
      {comments.length > 0 && (
        <nav className="cb-debug-list" aria-label="Comments">
          {comments.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === comment?.id}
              title={entry.body}
              onClick={() => setSelected(entry.id)}
            >
              {entry.id}
            </button>
          ))}
        </nav>
      )}
      <div className="cb-debug-body">
        {comment ? (
          <>
            <Fields comment={comment} />
            <Timeline comment={comment} />
            <details className="cb-debug-raw">
              <summary>Raw ReviewComment</summary>
              <pre>{JSON.stringify(comment, null, 2)}</pre>
            </details>
          </>
        ) : (
          <span className="cb-debug-empty">No comment yet.</span>
        )}
      </div>
    </section>
  )
}
