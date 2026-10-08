import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { ReviewMessage } from '../src/domain'
import { comment, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

const question = (fields: Partial<ReviewMessage> = {}): ReviewMessage => ({
  author: 'claude',
  body: 'Which colour?',
  at: '2026-01-01T10:01:00.000Z',
  question: true,
  options: [{ label: 'Red' }, { label: 'Blue', description: 'Calmer' }],
  ...fields,
})

// The question's own button; the composer's below is labelled "Send" too.
const SEND_CHOICES = { selector: '.cb-ask button' }
const sendChoices = () => screen.getByText('Send', SEND_CHOICES)

/** Claude waits on the reader's answer to `asked`. */
const asking = (asked: ReviewMessage) =>
  comment({
    claimedAt: '2026-01-01T10:00:30.000Z',
    askedAt: asked.at,
    messages: [asked],
  })

test('a single choice answers at once, without the draft in the box', async () => {
  const server = fakeServer([asking(question())])
  openThread('c1')
  renderWidget()

  const box = await screen.findByPlaceholderText('Or answer in your own words…')
  fireEvent.change(box, { target: { value: 'still writing' } })
  fireEvent.click(screen.getByRole('button', { name: /Blue/ }))

  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { choices: ['Blue'] } }]),
  )
  expect(box).toHaveProperty('value', 'still writing')
})

test('a multiple choice ticks the options, then sends them', async () => {
  const server = fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('checkbox', { name: /Red/ })
  const blue = screen.getByRole('checkbox', { name: /Blue/ })
  const send = sendChoices()
  expect(send).toHaveProperty('disabled', true)

  fireEvent.click(red)
  fireEvent.click(blue)
  fireEvent.click(red)
  expect(red.getAttribute('aria-checked')).toBe('false')
  expect(blue.getAttribute('aria-checked')).toBe('true')
  expect(server.patches).toEqual([])

  fireEvent.click(send)
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { choices: ['Blue'] } }]),
  )
})

test('two quick clicks tick both options', async () => {
  fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('checkbox', { name: /Red/ })
  const blue = screen.getByRole('checkbox', { name: /Blue/ })
  // Both before React renders again, as two clicks in a row can land.
  act(() => {
    red.click()
    blue.click()
  })
  expect(red.getAttribute('aria-checked')).toBe('true')
  expect(blue.getAttribute('aria-checked')).toBe('true')
})

test('the typed text goes with the ticked options', async () => {
  const server = fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('checkbox', { name: /Red/ }))
  const box = screen.getByPlaceholderText('Or answer in your own words…')
  fireEvent.change(box, { target: { value: '  and a darker shade  ' } })
  fireEvent.click(sendChoices())

  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { choices: ['Red'], followUp: 'and a darker shade' } },
    ]),
  )
  await waitFor(() => expect(box).toHaveProperty('value', ''))
})

test('the composer sends the ticked options with its text', async () => {
  const server = fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('checkbox', { name: /Blue/ }))
  const box = screen.getByPlaceholderText('Or answer in your own words…')
  fireEvent.change(box, { target: { value: 'please' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { choices: ['Blue'], followUp: 'please' } },
    ]),
  )
})

test('the chosen options stay marked once answered', async () => {
  const asked = question({ multiple: true })
  fakeServer([
    comment({
      status: 'resolved',
      messages: [
        asked,
        {
          author: 'reader',
          body: 'Red, Blue',
          at: '2026-01-01T10:02:00.000Z',
          choices: ['Blue'],
        },
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:03:00.000Z' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('checkbox', { name: /Red/ })
  const blue = screen.getByRole('checkbox', { name: /Blue/ })
  expect(red.getAttribute('aria-checked')).toBe('false')
  expect(blue.getAttribute('aria-checked')).toBe('true')
  expect(red).toHaveProperty('disabled', true)
  expect(blue).toHaveProperty('disabled', true)
  expect(screen.queryByText('Send', SEND_CHOICES)).toBeNull()
})

test('the chosen single answer stays marked once answered', async () => {
  fakeServer([
    comment({
      status: 'resolved',
      messages: [
        question(),
        {
          author: 'reader',
          body: 'Red',
          at: '2026-01-01T10:02:00.000Z',
          choices: ['Red'],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('button', { name: /Red/ })
  const blue = screen.getByRole('button', { name: /Blue/ })
  expect(red.className).toContain('cb-option--on')
  expect(blue.className).not.toContain('cb-option--on')
  expect(red).toHaveProperty('disabled', true)
})
