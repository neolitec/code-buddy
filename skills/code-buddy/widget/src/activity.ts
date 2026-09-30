// How the widget words the agent's latest step. Pure, so it is tested alone.
import type { ReviewProgress } from './domain'

const RUNNING: Record<string, string> = {
  read: 'Reading',
  edit: 'Editing',
  multiedit: 'Editing',
  write: 'Writing',
  bash: 'Running',
  search: 'Searching',
  mcp: 'Calling',
  web: 'Browsing',
  skill: 'Using',
}

export function stepText(step: ReviewProgress): string {
  if (step.kind === 'thinking') return step.label || 'Thinking'
  return step.label
}

/** What the agent is doing now, in words; the widget draws the dots. */
export function activityOf(step: ReviewProgress | undefined): string {
  if (!step) return 'Claude is working on it'
  // The claim itself: "Using Started" said nothing.
  if (step.kind === 'start') return step.state === 'running' ? 'Starting' : 'Started'
  if (step.state === 'running') return `${RUNNING[step.kind] ?? 'Using'} ${step.label}`
  if (step.state === 'failed') return `${stepText(step)} failed`
  return stepText(step).replace(/…$/, '')
}

/** A failed step is over, whatever comes next: it gets no dots. */
export function isOngoing(step: ReviewProgress | undefined): boolean {
  return step?.state !== 'failed'
}

// A tool keeps its id from running to done, so finishing a step does not
// slide it out for a copy of itself.
export function stepKey(step: ReviewProgress | undefined): string {
  return step ? (step.id ?? `${step.at}-${step.kind}`) : 'none'
}
