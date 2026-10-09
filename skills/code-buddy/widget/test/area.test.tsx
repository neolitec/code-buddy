import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { anchorFromArea, holderOf, rectFromArea } from '../src/anchors'
import type { ReviewArea, ReviewComment } from '../src/domain'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

/** Two cards in a section, a gap of 20px between them. */
const PAGE = `
  <h1 data-box="0,0,1000,60">Playground</h1>
  <section data-box="0,100,1000,400">
    <div data-box="20,120,400,200"><p data-box="30,130,300,40">Card A</p></div>
    <div data-box="20,340,400,140"><p data-box="30,350,300,40">Card B</p></div>
  </section>
`

/** happy-dom lays nothing out: each element's box is its `data-box` (left, top, width, height). */
function layout() {
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.getAttribute('data-box') ?? '')
        .split(',')
        .map(Number)
      return DOMRect.fromRect({ x, y, width, height })
    })
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
  onTestFinished(() => {
    box.mockRestore()
    scroll.mockRestore()
  })
}

function page() {
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  return root
}

/** Over the gap between the cards, and a little into each. */
const GAP = { left: 10, top: 300, width: 500, height: 60 }

test('an area records the element it lies in, and the blocks it cuts through', () => {
  layout()
  const root = page()

  const area = anchorFromArea(root, GAP).area

  expect(area?.within).toEqual({
    selector: 'section',
    tag: 'section',
    text: 'Card A Card B',
    box: { top: 0.5, left: 0.01, width: 0.5, height: 0.15 },
  })
  expect(area?.crosses.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1)',
    'section > div:nth-of-type(2)',
  ])
  expect(area?.covers).toEqual([])
  expect([area?.left, area?.top, area?.width, area?.height]).toEqual([10, 300, 500, 60])
})

test('an area records the outermost elements it covers', () => {
  layout()
  const root = page()

  const area = anchorFromArea(root, { left: 10, top: 110, width: 450, height: 380 }).area

  expect(area?.covers.map((node) => node.text)).toEqual(['Card A', 'Card B'])
  expect(area?.crosses).toEqual([])
})

test('an area follows the element it lies in when the layout changes', () => {
  layout()
  const root = page()
  const area = anchorFromArea(root, GAP).area
  if (!area) throw new Error('no area')

  // On a narrower window, the section moved down and halved.
  root.querySelector('section')?.setAttribute('data-box', '0,200,500,400')

  expect(rectFromArea(area, holderOf(root, area))).toEqual({
    left: 5,
    top: 400,
    width: 250,
    height: 60,
  })
})

test('an area whose element is gone stays where it was on the page', () => {
  layout()
  const root = page()
  const area = anchorFromArea(root, GAP).area
  if (!area) throw new Error('no area')

  root.querySelector('section')?.remove()

  expect(rectFromArea(area, holderOf(root, area))).toEqual(GAP)
})

/** The widget over the two cards. */
function renderCards(comments: ReviewComment[] = []) {
  layout()
  document.body.replaceChildren()
  const server = fakeServer(comments)
  renderWidget()
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  root.setAttribute('data-box', '0,0,1000,2000')
  root.innerHTML = PAGE
  return server
}

/** Drags from one corner to the other over the drawing layer. */
function drag(from: [number, number], to: [number, number]) {
  fireEvent.mouseDown(screen.getByTestId('cb-draw'), {
    button: 0,
    clientX: from[0],
    clientY: from[1],
  })
  fireEvent.mouseMove(document, { clientX: to[0], clientY: to[1] })
  fireEvent.mouseUp(document, { clientX: to[0], clientY: to[1] })
}

test('a drawn area is commented on, and stays outlined while the comment is written', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [510, 360])

  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  expect(screen.queryByTestId('cb-draw')).toBeNull()
  expect(screen.getByTestId('cb-area-chip').textContent).toBe(
    '500 × 60across <div> <div>',
  )
  await screen.findByTestId('cb-area')

  fireEvent.change(box, { target: { value: 'Tighten this gap' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  // Saved, the blue outline gives way to the rainbow frame of a comment in progress.
  await screen.findByTestId('cb-area-mark')
  expect(screen.queryByTestId('cb-area')).toBeNull()
})

test('the area goes to the server with what it covers', async () => {
  const comments: ReviewComment[] = []
  renderCards(comments)

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([510, 360], [10, 300])
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Tighten this gap' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(comments).toHaveLength(1))
  const area: Partial<ReviewArea> | undefined = comments[0]?.area
  expect(area).toMatchObject({
    top: 300,
    left: 10,
    width: 500,
    height: 60,
    within: { selector: 'section' },
    covers: [],
  })
  expect(area?.crosses).toHaveLength(2)
})

test('a slip of the mouse draws nothing, and Escape leaves the drawing', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [14, 303])

  expect(screen.getByTestId('cb-draw')).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByTestId('cb-draw')).toBeNull()
})

test('an area drawn from a page comment keeps what the reader wrote', async () => {
  renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'What should change?' }), {
    target: { value: 'Too much space' },
  })

  fireEvent.click(screen.getByRole('button', { name: 'Draw an area' }))
  drag([10, 300], [510, 360])

  await screen.findByTestId('cb-area-chip')
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })
      .value,
  ).toBe('Too much space')

  // Removed, the comment is about the page again.
  fireEvent.click(screen.getByRole('button', { name: 'Remove the area' }))
  expect(screen.queryByTestId('cb-area-chip')).toBeNull()
  expect(screen.getByRole('checkbox')).toBeTruthy()
})

const DRAWN: ReviewArea = {
  top: 300,
  left: 10,
  width: 500,
  height: 60,
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
  within: {
    selector: 'section',
    tag: 'section',
    text: 'Card A Card B',
    box: { top: 0.5, left: 0.01, width: 0.5, height: 0.15 },
  },
  covers: [],
  crosses: [],
}

test('an area is in progress until its thread is resolved', async () => {
  renderCards([
    comment({ id: 'c1', area: DRAWN }),
    comment({ id: 'c2', area: DRAWN, status: 'resolved' }),
  ])

  await waitFor(() => expect(screen.getAllByTestId('cb-area-mark')).toHaveLength(1))
  const mark = screen.getByTestId('cb-area-mark')
  expect([mark.style.left, mark.style.top, mark.style.width]).toEqual([
    '10px',
    '300px',
    '500px',
  ])
})

test("the area's chip in a resolved thread shows it again on the page", async () => {
  openPanel('page', 'c1')
  renderCards([comment({ area: DRAWN, status: 'resolved' })])

  // Nothing on the page for a resolved comment, until the reader asks.
  const chip = await screen.findByTestId('cb-area-chip')
  expect(screen.queryByTestId('cb-area')).toBeNull()
  fireEvent.mouseEnter(chip)
  await screen.findByTestId('cb-area')
  fireEvent.mouseLeave(chip)
  await waitFor(() => expect(screen.queryByTestId('cb-area')).toBeNull())

  fireEvent.click(chip)
  expect(window.scrollBy).toHaveBeenCalled()
  await screen.findByTestId('cb-area')
})
