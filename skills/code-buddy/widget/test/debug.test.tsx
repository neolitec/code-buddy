import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { timelineOf } from '../src/debug'
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

test('the timeline puts status changes, messages and steps in order', () => {
  const events = timelineOf(conversation).map((event) =>
    event.kind === 'status'
      ? event.label
      : event.kind === 'message'
        ? `${event.message.author}: ${event.message.body}`
        : `${event.step.kind} ${event.step.state}`,
  )
  expect(events).toEqual([
    'created',
    'reader: Make the title bigger',
    'claimed',
    'read done',
    'bash failed',
    'claude: Which size?',
    'asking',
  ])
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
  fireEvent.click(screen.getByRole('button', { name: 'Debug panel (Alt+Shift+D)' }))
})
