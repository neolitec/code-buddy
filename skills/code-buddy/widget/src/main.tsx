import { createRoot } from 'react-dom/client'
import App from './App'
import { PAGE_CSS, WIDGET_CSS } from './styles'

const HOST = 'code-buddy-widget'
const FIGTREE =
  'https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,600;0,700;1,400&display=swap'

function mount() {
  if (document.querySelector(HOST)) return
  const host = document.createElement(HOST)
  host.setAttribute('data-code-buddy', '')
  document.body.append(host)

  const pageStyle = document.createElement('style')
  pageStyle.setAttribute('data-code-buddy', '')
  pageStyle.textContent = PAGE_CSS
  document.head.append(pageStyle)

  // Fonts declared in a shadow root are ignored: Figtree loads in the page.
  // Offline or blocked by the app's CSP, the widget falls back to system-ui.
  const font = document.createElement('link')
  font.setAttribute('data-code-buddy', '')
  font.rel = 'stylesheet'
  font.href = FIGTREE
  document.head.append(font)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS
  const container = document.createElement('div')
  shadow.append(style, container)
  createRoot(container).render(<App root={document.body} />)
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
