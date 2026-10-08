import { render } from '@testing-library/react'
import App from '../src/App'

/** The widget over a page of its own, as main.tsx mounts it (without the shadow root). */
export function renderWidget() {
  const page = document.createElement('main')
  page.innerHTML = '<h1>Playground</h1>'
  document.body.append(page)
  const view = render(<App root={page} />)
  return {
    ...view,
    unmount() {
      view.unmount()
      page.remove()
    },
  }
}
