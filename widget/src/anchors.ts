import {
  type ReviewAnchor,
  type ReviewElement,
  normaliseQuote,
} from './domain'

const HEADINGS = 'h1, h2, h3'
const WIDGET = '[data-code-buddy]'

interface TextIndex {
  nodes: { node: Text; start: number }[]
  /** Normalised page text. */
  text: string
  /** Raw offset of every normalised character. */
  rawOffsets: number[]
}

function indexText(root: Element): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(WIDGET)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: TextIndex['nodes'] = []
  let raw = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: raw.length })
    raw += node.textContent ?? ''
  }

  let text = ''
  const rawOffsets: number[] = []
  let pendingSpace = false
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      pendingSpace = text.length > 0
      continue
    }
    if (pendingSpace) {
      text += ' '
      rawOffsets.push(i)
      pendingSpace = false
    }
    text += raw[i]
    rawOffsets.push(i)
  }
  return { nodes, text, rawOffsets }
}

function locate(index: TextIndex, rawOffset: number): [Text, number] {
  let match = index.nodes[0]
  for (const entry of index.nodes) {
    if (entry.start > rawOffset) break
    match = entry
  }
  return [match.node, rawOffset - match.start]
}

function rangeOf(index: TextIndex, start: number, end: number): Range {
  const range = document.createRange()
  const [startNode, startOffset] = locate(index, index.rawOffsets[start])
  const [endNode, endOffset] = locate(index, index.rawOffsets[end - 1])
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset + 1)
  return range
}

function occurrencesOf(text: string, quote: string): number[] {
  const found: number[] = []
  for (
    let at = text.indexOf(quote);
    at !== -1;
    at = text.indexOf(quote, at + 1)
  ) {
    found.push(at)
  }
  return found
}

function sectionOf(root: Element, range: Range): string {
  let section = ''
  root.querySelectorAll(HEADINGS).forEach((heading) => {
    if (heading.closest(WIDGET)) return
    const before =
      range.compareBoundaryPoints(Range.START_TO_START, rangeAround(heading)) >=
      0
    if (before) section = heading.textContent?.trim() ?? section
  })
  return section
}

function rangeAround(element: Element): Range {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range
}

/** Describes a user selection so it can be found again on a later render. */
export function anchorFromSelection(
  root: Element,
  selection: Selection
): ReviewAnchor | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element =
    container instanceof Element ? container : container.parentElement
  if (!root.contains(container) || element?.closest(WIDGET)) {
    return undefined
  }

  const quote = normaliseQuote(selection.toString())
  if (!quote) return undefined

  const index = indexText(root)
  const occurrences = occurrencesOf(index.text, quote)
  if (occurrences.length === 0) return undefined

  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const selectionStart = normaliseQuote(prefix.toString()).length
  const distances = occurrences.map((at) => Math.abs(at - selectionStart))
  const occurrence = distances.indexOf(Math.min(...distances))

  return { quote, occurrence, section: sectionOf(root, range) }
}

/** Finds the live Range for a stored anchor, if its quote is still on the page. */
export function rangeFromAnchor(
  root: Element,
  anchor: ReviewAnchor
): Range | undefined {
  if (!anchor.quote) return undefined
  const index = indexText(root)
  const occurrences = occurrencesOf(index.text, anchor.quote)
  const start = occurrences[anchor.occurrence] ?? occurrences[0]
  if (start === undefined) return undefined
  return rangeOf(index, start, start + anchor.quote.length)
}

function step(element: Element): string {
  const testId = element.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`
  if (element.id) return `#${CSS.escape(element.id)}`
  const tag = element.tagName.toLowerCase()
  const parent = element.parentElement
  if (!parent) return tag
  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName
  )
  return siblings.length > 1
    ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`
    : tag
}

function selectorFor(root: Element, element: Element): string {
  const steps: string[] = []
  for (let node: Element | null = element; node && node !== root;) {
    steps.unshift(step(node))
    if (steps[0].startsWith('[') || steps[0].startsWith('#')) break
    node = node.parentElement
  }
  return steps.join(' > ')
}

/** Describes a pointed-at element so it can be found and understood later. */
export function anchorFromElement(
  root: Element,
  element: Element
): ReviewAnchor {
  const anchor: ReviewElement = {
    selector: selectorFor(root, element),
    tag: element.tagName.toLowerCase(),
    text: normaliseQuote(element.textContent ?? '').slice(0, 200),
    html: normaliseQuote(element.outerHTML).slice(0, 600),
  }
  return {
    quote: '',
    occurrence: 0,
    section: sectionOf(root, rangeAround(element)),
    element: anchor,
  }
}

export function elementFromAnchor(
  root: Element,
  anchor: ReviewAnchor
): Element | undefined {
  if (!anchor.element) return undefined
  try {
    return root.querySelector(anchor.element.selector) ?? undefined
  } catch {
    return undefined
  }
}
