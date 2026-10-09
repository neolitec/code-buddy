import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { timelineOf, toggleDebug } from '../src/debug'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

const conversation = comment({
  claimedAt: '2026-01-01T10:00:01.000Z',
  askedAt: '2026-01-01T10:00:05.000Z',
  messages: [
    {
      author: 'claude',
      body: 'Which size?',
      at: '2026-01-01T10:00:05.000Z',
      question: true,
      options: [{ label: '32px', description: 'Like the hero' }, { label: '40px' }],
    },
  ],
  progress: [
    {
      at: Date.parse('2026-01-01T10:00:02.000Z'),
      kind: 'read',
      label: 'App.tsx',
      id: 't1',
      state: 'done',
    },
    {
      at: Date.parse('2026-01-01T10:00:03.000Z'),
      kind: 'bash',
      label: 'npm test',
      id: 't2',
      state: 'failed',
      error: 'exit 1',
    },
  ],
})

// The panel's switch lives in the module: each test starts with it off.
afterEach(() => toggleDebug(false))

const label = (event: ReturnType<typeof timelineOf>[number]) =>
  event.kind === 'status'
    ? event.label
    : event.kind === 'message'
      ? `${event.message.author}: ${event.message.body}`
      : `${event.step.kind} ${event.step.state}`

test('the timeline puts status changes, messages and steps in order', () => {
  expect(timelineOf(conversation).map(label)).toEqual([
    'created',
    'reader: Make the title bigger',
    'claimed',
    'read done',
    'bash failed',
    'claude: Which size?',
    'asking',
  ])
})

test('the timeline keeps its order around a time that does not parse', () => {
  const cancelled = comment({
    messages: [
      { author: 'claude', body: 'Done', at: 'not a date' },
      { author: 'reader', body: 'Thanks', at: '2026-01-01T10:00:09.000Z' },
    ],
    claimedAt: '2026-01-01T10:00:01.000Z',
    cancelledAt: '2026-01-01T10:00:04.000Z',
    cancellation: { at: '2026-01-01T10:00:04.000Z', changed: ['src/App.tsx'], steps: 3 },
    resolvedAt: '2026-01-01T10:00:08.000Z',
  })
  const events = timelineOf(cancelled)
  expect(events.map(label)).toEqual([
    'created',
    'reader: Make the title bigger',
    'claimed',
    'run cancelled',
    'cancelled',
    'resolved',
    'reader: Thanks',
    'claude: Done',
  ])
  expect(events[3]).toMatchObject({ detail: '3 steps, changed: src/App.tsx' })
})

test('Alt+Shift+D shows the selected comment as the widget holds it', async () => {
  fakeServer([conversation])
  openThread('c1')
  renderWidget()
  await screen.findByText('Which size?')
  expect(screen.queryByTestId('cb-debug')).toBeNull()

  fireEvent.keyDown(window, { code: 'KeyD', key: 'Î', altKey: true, shiftKey: true })
  const panel = within(await screen.findByTestId('cb-debug'))
  expect(panel.getByText('asking', { selector: 'dd' })).toBeTruthy()
  expect(panel.getByText('options: 32px (Like the hero) | 40px')).toBeTruthy()
  expect(panel.getByText('error: exit 1')).toBeTruthy()
  expect(panel.getByText(/"askedAt": "2026-01-01T10:00:05.000Z"/)).toBeTruthy()

  fireEvent.click(panel.getByRole('button', { name: 'Close the debug panel' }))
  expect(screen.queryByTestId('cb-debug')).toBeNull()
})

test('the header toggle lists the comments of other pages too', async () => {
  fakeServer([comment(), comment({ id: 'c2', route: '/about', body: 'Elsewhere' })])
  openPanel()
  renderWidget()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Debug panel (Alt+Shift+D)' }),
  )

  const panel = within(await screen.findByTestId('cb-debug'))
  await waitFor(() => expect(panel.getByRole('button', { name: 'c2' })).toBeTruthy())
  fireEvent.click(panel.getByRole('button', { name: 'c2' }))
  expect(panel.getByText('/about', { selector: 'dd' })).toBeTruthy()
})

test('the open panel follows the comments as they change', async () => {
  const comments = [comment()]
  fakeServer(comments)
  openThread('c1')
  renderWidget()
  toggleDebug(true)
  const panel = within(await screen.findByTestId('cb-debug'))
  expect(panel.queryByText('claimed', { selector: 'dd' })).toBeNull()

  comments[0] = comment({ claimedAt: '2026-01-01T10:00:01.000Z' })
  window.dispatchEvent(new Event('code-buddy:changed'))
  expect(await panel.findByText('claimed', { selector: 'dd' })).toBeTruthy()
})

test('the shortcut leaves fields and other modifiers alone', async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()
  await screen.findAllByTestId('cb-summary')
  const shortcut = { code: 'KeyD', altKey: true, shiftKey: true }

  fireEvent.keyDown(window, { ...shortcut, metaKey: true })
  fireEvent.keyDown(window, { ...shortcut, ctrlKey: true })
  fireEvent.keyDown(window, { ...shortcut, repeat: true })
  const field = document.createElement('input')
  document.body.append(field)
  fireEvent.keyDown(field, shortcut)
  field.remove()
  expect(screen.queryByTestId('cb-debug')).toBeNull()

  fireEvent.keyDown(document.body, shortcut)
  expect(await screen.findByTestId('cb-debug')).toBeTruthy()
})
