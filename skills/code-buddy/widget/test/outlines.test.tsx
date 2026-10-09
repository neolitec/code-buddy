import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget, stubHighlights } from './widget'

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
}

/** happy-dom lays nothing out: every element is a box on screen. */
function layout() {
  const box = DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 30 })
  const element = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue(box)
  const range = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(box)
  onTestFinished(() => {
    element.mockRestore()
    range.mockRestore()
  })
}

const marks = () => Array.from(document.querySelectorAll('.cb-mark'))

test('an element is in progress until its thread is resolved', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([
    comment({ id: 'c1', element: TITLE }),
    comment({ id: 'c2', element: TITLE, status: 'resolved' }),
  ])
  renderWidget()

  await waitFor(() => expect(marks()).toHaveLength(1))
  expect(marks()[0]?.textContent).toBe('1')
})

test('an element keeps its in-progress look once its thread is opened', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  openPanel()
  renderWidget()
  await waitFor(() => expect(marks()).toHaveLength(1))

  fireEvent.click(await screen.findByText('Make the title bigger'))

  await screen.findByTestId('cb-working')
  expect(marks().map((mark) => mark.className)).toEqual(['cb-mark'])
})

test('a text keeps its in-progress highlight once its thread is opened', async () => {
  const highlights = stubHighlights()
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: /Open the comment/ }))

  await screen.findByTestId('cb-working')
  await waitFor(() => expect(highlights.get('code-buddy')?.size).toBe(1))
  expect(highlights.has('code-buddy-active')).toBe(false)
})

/** The reader points at the page's title and starts a comment on it. */
async function pickTitle() {
  layout()
  document.body.replaceChildren()
  fakeServer([])
  renderWidget()
  const title = document.querySelector('h1')
  if (!title) throw new Error('no title')
  const pointed = vi.spyOn(document, 'elementFromPoint').mockReturnValue(title)
  onTestFinished(() => pointed.mockRestore())

  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  fireEvent.mouseMove(document, { clientX: 50, clientY: 110 })
  fireEvent.click(title, { clientX: 50, clientY: 110 })
  return screen.findByRole('textbox')
}

test('the picked element stays outlined while the comment is written', async () => {
  await pickTitle()

  await screen.findByTestId('cb-target')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByTestId('cb-target')).toBeNull())
})

test('the picked element turns in progress once its comment is saved', async () => {
  const box = await pickTitle()
  await screen.findByTestId('cb-target')

  fireEvent.change(box, { target: { value: 'Make the title bigger' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(marks()).toHaveLength(1))
  expect(screen.queryByTestId('cb-target')).toBeNull()
})
