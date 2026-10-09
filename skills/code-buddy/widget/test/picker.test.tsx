import { act, fireEvent, render } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { ElementPicker } from '../src/overlays'

/** A page of a table's cells, laid side by side: happy-dom lays nothing out. */
function page() {
  const root = document.createElement('main')
  root.innerHTML = '<table><tr><td>One</td><td>Two</td></tr></table><p>Text</p>'
  document.body.append(root)
  const [first, second] = Array.from(root.querySelectorAll('td'))
  const boxes = new Map<Element | undefined, DOMRect>([
    [first, DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 30 })],
    [second, DOMRect.fromRect({ x: 110, y: 20, width: 80, height: 30 })],
  ])
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      return boxes.get(this) ?? DOMRect.fromRect()
    })
  let under: Element | null = null
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => under)
  onTestFinished(() => {
    box.mockRestore()
    root.remove()
  })
  /** The pointer moves over `element`. */
  const hover = (element: Element | undefined) => {
    under = element ?? null
    fireEvent.mouseMove(document)
  }
  return { root, first, second, boxes, hover }
}

const outline = () => document.querySelector<HTMLElement>('.cb-hover')

test('the outline glides to the next element rather than appearing anew', () => {
  const { root, first, second, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)

  act(() => hover(first))
  const shown = outline()
  act(() => hover(second))

  // The same outline, moved by its transform: a transition can carry it there.
  expect(outline()).toBe(shown)
  expect(shown?.style.transform).toBe('translate(110px, 20px)')
  expect(shown?.style.width).toBe('80px')
  expect(shown?.textContent).toBe('td')
  expect(shown?.hasAttribute('data-instant')).toBe(false)
})

test('after a scroll, the outline follows its element at once', () => {
  const { root, first, second, boxes, hover } = page()
  render(<ElementPicker root={root} onPick={() => {}} onCancel={() => {}} />)
  act(() => hover(first))

  boxes.set(first, DOMRect.fromRect({ x: 10, y: -40, width: 100, height: 30 }))
  act(() => {
    fireEvent.scroll(document)
  })

  expect(outline()?.style.transform).toBe('translate(10px, -40px)')
  expect(outline()?.hasAttribute('data-instant')).toBe(true)

  act(() => hover(second))
  expect(outline()?.hasAttribute('data-instant')).toBe(false)
})
