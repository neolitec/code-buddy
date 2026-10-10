// The debug panel: every comment as the widget holds it, for whoever works on
// Code Buddy. Only reachable behind CODE_BUDDY_DEBUG, so a release build drops
// this whole module: keep it free of top-level side effects.
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import { useCommentHistory } from './api'
import type { ReviewComment, ReviewMessage, ReviewProgress } from './domain'
import { readSession, writeSession } from './session'
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
.cb-debug-id { border: 0; cursor: pointer; font-size: inherit; }
.cb-debug-id[aria-expanded="true"] { background: var(--cb-accent-weak); color: var(--cb-accent-strong); }
.cb-debug-call { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 2px; }
.cb-debug-call pre { margin: 0; padding: 6px 8px; background: var(--cb-surface-2); border-radius: 6px; overflow: auto; max-height: 240px; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
.cb-debug-call .cb-debug-error { color: var(--cb-red); }
.cb-debug-id:hover { color: var(--cb-accent-strong); }
.cb-debug-raw summary { cursor: pointer; color: var(--cb-muted); }
.cb-debug-raw pre { margin: 6px 0 0; padding: 8px; background: var(--cb-surface-2); border-radius: 6px; overflow: auto; font-size: 11px; }
.cb-debug-empty { color: var(--cb-muted); }
.cb-debug-runs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; color: var(--cb-muted); }
.cb-debug-run { border: 0; cursor: pointer; font-size: inherit; }
.cb-debug-run[aria-pressed="true"] { background: var(--cb-accent-weak); color: var(--cb-accent-strong); }
`

// Shown or not, and the raw JSON unfolded or not: shared by the header's toggle
// and the panel, and kept across reloads (hot ones included) like the panel's own.
const KEY = 'code-buddy:debug'

interface DebugState {
  open: boolean
  raw: boolean
}

// Read once per page load, on first use: never at the module's top level.
let debugState: DebugState | undefined
const listeners = new Set<() => void>()

const saved = () =>
  (debugState ??= readSession<DebugState>(KEY) ?? { open: false, raw: false })

function update(change: Partial<DebugState>) {
  debugState = { ...saved(), ...change }
  writeSession(KEY, debugState)
  listeners.forEach((listener) => listener())
}

/** Shows or hides the panel; flips it without `value`. */
export function toggleDebug(value = !saved().open) {
  update({ open: value })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const useShown = () => useSyncExternalStore(subscribe, () => saved().open)
const useRaw = () => useSyncExternalStore(subscribe, () => saved().raw)

/** Alt+Shift+D: by its key code, as macOS turns Alt+Shift+D into another character. */
const isShortcut = (event: KeyboardEvent) =>
  !event.repeat &&
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
      onClick={() => toggleDebug()}
    />
  )
}

type TimelineEvent =
  | { kind: 'status'; at: number; label: string; detail?: string; run?: string }
  | { kind: 'message'; at: number; message: ReviewMessage }
  | { kind: 'step'; at: number; step: ReviewProgress }

const time = (at: string | undefined) => (at ? Date.parse(at) : NaN)

const stepKeyOf = (step: ReviewProgress) => step.id ?? `${step.at}:${step.kind}`

/**
 * Every step of every run, from the history the panel polls, updated by the
 * live run's steps the widget may have received since.
 */
function stepsOf(comment: ReviewComment): ReviewProgress[] {
  const steps = new Map((comment.history ?? []).map((step) => [stepKeyOf(step), step]))
  for (const step of comment.progress ?? []) steps.set(stepKeyOf(step), step)
  return [...steps.values()]
}

/** The runs the comment had, in order: a claim starts each. */
export const runsOf = (comment: ReviewComment) => [
  ...new Set(comment.events.flatMap((event) => (event.run ? [event.run] : []))),
]

const runOf = (event: TimelineEvent) =>
  event.kind === 'status'
    ? event.run
    : event.kind === 'message'
      ? event.message.run
      : event.step.run

/**
 * The whole conversation in order: every move from the comment's events,
 * messages and progress steps. With `run`, only what belongs to that run.
 */
export function timelineOf(comment: ReviewComment, run?: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const event of comment.events) {
    events.push({
      kind: 'status',
      at: time(event.at),
      label: event.state,
      detail: `by ${event.by}`,
      ...(event.run ? { run: event.run } : {}),
    })
  }
  for (const message of comment.messages) {
    events.push({ kind: 'message', at: time(message.at), message })
  }
  const cancellation = comment.cancellation
  if (cancellation) {
    events.push({
      kind: 'status',
      at: time(cancellation.at),
      label: 'run cancelled',
      detail: `${cancellation.steps} steps, changed: ${cancellation.changed.join(', ') || 'nothing'}`,
      ...(cancellation.run ? { run: cancellation.run } : {}),
    })
  }
  for (const step of stepsOf(comment)) events.push({ kind: 'step', at: step.at, step })
  // Stable: what shares a time keeps the order above. A time that does not
  // parse goes last, as NaN would leave the sort's order undefined.
  const order = (event: TimelineEvent) => (Number.isNaN(event.at) ? Infinity : event.at)
  return events
    .filter((event) => run === undefined || runOf(event) === run)
    .toSorted((a, b) => order(a) - order(b))
}

/** A run's id: a click shows only that run in the timeline, another click all of them. */
function RunTag({
  run,
  selected,
  onSelect,
}: {
  run: string
  selected: string | undefined
  onSelect: (run: string | undefined) => void
}) {
  return (
    <button
      type="button"
      className="cb-debug-tag cb-debug-run"
      aria-pressed={selected === run}
      title={selected === run ? 'Show every run' : `Show run ${run} only`}
      onClick={() => onSelect(selected === run ? undefined : run)}
    >
      {run}
    </button>
  )
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

function MessageEvent({
  message,
  run,
  onRun,
}: {
  message: ReviewMessage
  run: string | undefined
  onRun: (run: string | undefined) => void
}) {
  return (
    <div>
      <strong>{message.author}</strong>
      <span className="cb-debug-tag">{message.id}</span>
      {message.run && <RunTag run={message.run} selected={run} onSelect={onRun} />}
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

interface ToolCall {
  transcript: string
  name: string
  input: unknown
  result?: string
  error?: boolean
}

/** The call as the server read it in Claude Code's transcripts; null when it could not. */
async function fetchToolCall(id: string): Promise<ToolCall | null> {
  try {
    const url = new URL(`api/debug/tool/${id}`, new URL('.', import.meta.url))
    const response = await fetch(url.href)
    // The server's JSON has the shape it answers with.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return response.ok ? ((await response.json()) as ToolCall) : null
  } catch {
    return null
  }
}

/** A tool call's id: a click unfolds what the agent sent and got back. */
function ToolId({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [call, setCall] = useState<ToolCall | null>()
  const toggle = () => {
    setOpen(!open)
    if (call === undefined) void fetchToolCall(id).then(setCall)
  }
  return (
    <>
      <button
        type="button"
        className="cb-debug-tag cb-debug-id"
        aria-expanded={open}
        title="Show what the agent sent and got back"
        onClick={toggle}
      >
        {id}
      </button>
      {open && (
        <div className="cb-debug-call">
          {call === undefined ? (
            <span className="cb-debug-empty">Reading the transcripts…</span>
          ) : call === null ? (
            <span className="cb-debug-empty">
              Not in Claude Code's transcripts of the last 7 days.
            </span>
          ) : (
            <>
              <span className="cb-debug-empty" title={call.transcript}>
                {call.name} · {call.transcript.split('/').at(-1)}
              </span>
              <pre>{JSON.stringify(call.input, null, 2)}</pre>
              {call.result !== undefined && (
                <pre className={call.error ? 'cb-debug-error' : undefined}>
                  {call.result}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

function StepEvent({ step }: { step: ReviewProgress }) {
  return (
    <div>
      <strong>{step.kind}</strong>
      {step.state && <span className="cb-debug-tag">{step.state}</span>}
      {step.run && <span className="cb-debug-tag">{step.run}</span>}
      {step.id && <ToolId id={step.id} />}
      {step.label && <p>{step.label}</p>}
      {step.error && <p>error: {step.error}</p>}
    </div>
  )
}

function Timeline({
  comment,
  run,
  onRun,
}: {
  comment: ReviewComment
  run: string | undefined
  onRun: (run: string | undefined) => void
}) {
  const runs = runsOf(comment)
  return (
    <>
      {runs.length > 0 && (
        <div className="cb-debug-runs" role="group" aria-label="Runs">
          Runs:
          {runs.map((id) => (
            <RunTag key={id} run={id} selected={run} onSelect={onRun} />
          ))}
        </div>
      )}
      <ol className="cb-debug-timeline" aria-label="Conversation">
        {timelineOf(comment, run).map((event, index) => (
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
                {event.run && <RunTag run={event.run} selected={run} onSelect={onRun} />}
                {event.detail && <p>{event.detail}</p>}
              </div>
            ) : event.kind === 'message' ? (
              <MessageEvent message={event.message} run={run} onRun={onRun} />
            ) : (
              <StepEvent step={event.step} />
            )}
          </li>
        ))}
      </ol>
    </>
  )
}

function Fields({ comment }: { comment: ReviewComment }) {
  const { anchor } = comment
  const rows: [string, string | undefined][] = [
    ['id', comment.id],
    ['state', comment.state],
    ['route', comment.route],
    ['url', comment.url],
    ['section', anchor.section],
    ['quote', anchor.quote && `${anchor.quote} (#${anchor.occurrence})`],
    ['element', anchor.element?.selector],
    ['createdAt', comment.createdAt],
    ['runs', runsOf(comment).join(', ')],
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
  const raw = useRaw()
  // Picked while the widget showed `current`: a thread opened since takes over.
  const [selected, setSelected] = useState<{ id: string; current?: string }>()
  // The run the timeline shows alone, for the comment it was picked on.
  const [run, setRun] = useState<{ comment: string; run: string }>()
  const others = useCommentHistory(open)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return
      // What the reader types in a field stays theirs: Alt+Shift+D is a character on macOS.
      const target = event.composedPath()[0]
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      toggleDebug()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null
  const histories = new Map(others.comments.map((entry) => [entry.id, entry.history]))
  const comments = [...held, ...others.comments]
    .filter(
      (comment, index, list) =>
        list.findIndex((other) => other.id === comment.id) === index,
    )
    .map((comment) => {
      const history = histories.get(comment.id)
      return history ? { ...comment, history } : comment
    })
  const comment =
    comments.find((entry) => entry.id === selected?.id && selected.current === current) ??
    comments.find((entry) => entry.id === current) ??
    comments[0]

  return (
    <section className="cb-debug cb-live" data-testid="cb-debug" aria-label="Debug panel">
      <style>{DEBUG_CSS}</style>
      <header className="cb-debug-head">
        <h2>
          Debug <span className="cb-debug-hint">· {comments.length} comments</span>
        </h2>
        <IconButton
          icon="x"
          label="Close the debug panel"
          onClick={() => toggleDebug(false)}
        />
      </header>
      {comments.length > 0 && (
        <nav className="cb-debug-list" aria-label="Comments">
          {comments.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === comment?.id}
              title={entry.messages[0]?.body}
              onClick={() =>
                setSelected({ id: entry.id, ...(current ? { current } : {}) })
              }
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
            <Timeline
              comment={comment}
              run={run?.comment === comment.id ? run.run : undefined}
              onRun={(picked) =>
                setRun(picked ? { comment: comment.id, run: picked } : undefined)
              }
            />
            <details
              className="cb-debug-raw"
              open={raw}
              onToggle={(event) => update({ raw: event.currentTarget.open })}
            >
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
