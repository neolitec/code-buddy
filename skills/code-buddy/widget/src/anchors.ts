import {
  type ReviewAnchor,
  type ReviewArea,
  type ReviewBox,
  type ReviewElement,
  type ReviewNode,
  normaliseQuote,
} from './domain'

const HEADINGS = 'h1, h2, h3'
const WIDGET = '[data-code-buddy]'
/** Text that is code or a control's value, never part of what the reader reads. */
const UNREAD = 'script, style, template, noscript, select, textarea'

interface TextIndex {
  nodes: { node: Text; start: number }[]
  /** Normalised page text. */
  text: string
  /** Raw offset of every normalised character. */
  rawOffsets: number[]
}

/** Block-level by default, for a `display` the page's CSS leaves empty. */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'CAPTION',
  'DD',
  'DETAILS',
  'DIALOG',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
])

function isBlock(element: Element): boolean {
  const display = getComputedStyle(element).display
  if (!display) return BLOCK_TAGS.has(element.tagName)
  return !display.startsWith('inline') && display !== 'contents' && display !== 'none'
}

/** The block `node` sits in, inside `root`; `blocks` caches each element's answer. */
function blockOf(root: Element, node: Text, blocks: Map<Element, boolean>): Element {
  for (let element = node.parentElement; element && element !== root;) {
    let block = blocks.get(element)
    if (block === undefined) {
      block = isBlock(element)
      blocks.set(element, block)
    }
    if (block) return element
    element = element.parentElement
  }
  return root
}

/**
 * The page's text as written in the DOM, with a line break between blocks and
 * at every `<br>`, so a quote across elements reads as two words, not one.
 */
function indexText(root: Element): TextIndex {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node instanceof Element && node.matches(UNREAD)
          ? NodeFilter.FILTER_REJECT
          : (node instanceof Element ? node : node.parentElement)?.closest(WIDGET)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
    },
  )
  const nodes: TextIndex['nodes'] = []
  const blocks = new Map<Element, boolean>()
  let block: Element | undefined
  let raw = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.tagName === 'BR') raw += '\n'
      continue
    }
    if (!(node instanceof Text)) continue
    const current = blockOf(root, node, blocks)
    if (block && current !== block) raw += '\n'
    block = current
    nodes.push({ node, start: raw.length })
    raw += node.textContent ?? ''
  }

  let text = ''
  const rawOffsets: number[] = []
  let pendingSpace = false
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i)
    if (/\s/.test(char)) {
      pendingSpace = text.length > 0
      continue
    }
    if (pendingSpace) {
      text += ' '
      rawOffsets.push(i)
      pendingSpace = false
    }
    text += char
    rawOffsets.push(i)
  }
  return { nodes, text, rawOffsets }
}

function locate(index: TextIndex, rawOffset: number): [Text, number] {
  let match = index.nodes[0]
  if (!match) throw new Error('code-buddy: the page has no text to anchor to')
  for (const entry of index.nodes) {
    if (entry.start > rawOffset) break
    match = entry
  }
  return [match.node, rawOffset - match.start]
}

function rawOffsetAt(index: TextIndex, offset: number): number {
  const raw = index.rawOffsets[offset]
  if (raw === undefined)
    throw new RangeError(`code-buddy: offset ${offset} is outside the page text`)
  return raw
}

function rangeOf(index: TextIndex, start: number, end: number): Range {
  const range = document.createRange()
  const [startNode, startOffset] = locate(index, rawOffsetAt(index, start))
  const [endNode, endOffset] = locate(index, rawOffsetAt(index, end - 1))
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset + 1)
  return range
}

/** Where a boundary point falls in the normalised page text. */
function textOffset(index: TextIndex, container: Node, offset: number): number {
  const entry = index.nodes.find(({ node }) => node === container)
  let raw: number | undefined
  if (entry) {
    raw = entry.start + offset
  } else {
    // A boundary between elements: the first text after it.
    const point = document.createRange()
    point.setStart(container, offset)
    raw = index.nodes.find(({ node }) => point.comparePoint(node, 0) >= 0)?.start
  }
  if (raw === undefined) return index.text.length
  const at = index.rawOffsets.findIndex((rawOffset) => rawOffset >= raw)
  return at === -1 ? index.text.length : at
}

function occurrencesOf(text: string, quote: string): number[] {
  const found: number[] = []
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    found.push(at)
  }
  return found
}

function sectionOf(root: Element, range: Range): string {
  let section = ''
  root.querySelectorAll(HEADINGS).forEach((heading) => {
    if (heading.closest(WIDGET)) return
    const before =
      range.compareBoundaryPoints(Range.START_TO_START, rangeAround(heading)) >= 0
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
  selection: Selection,
): ReviewAnchor | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element = container instanceof Element ? container : container.parentElement
  if (!root.contains(container) || element?.closest(WIDGET)) {
    return undefined
  }

  // The quote is read from the page's own text, not from `selection.toString()`:
  // that one is the rendered text (uppercased by CSS, without hidden parts…),
  // which the page's text may not contain, and the anchor could not be found.
  const index = indexText(root)
  let start = textOffset(index, range.startContainer, range.startOffset)
  const end = textOffset(index, range.endContainer, range.endOffset)
  while (index.text.charAt(start) === ' ') start++
  const quote = normaliseQuote(index.text.slice(start, end))
  if (!quote) return undefined

  const occurrence = Math.max(0, occurrencesOf(index.text, quote).indexOf(start))

  return { quote, occurrence, section: sectionOf(root, range) }
}

/**
 * Where `range` starts on screen: its first character's box. The whole range's
 * box starts at its leftmost line, which is not the start once it wraps.
 */
export function startRect(range: Range): DOMRect {
  const start = range.cloneRange()
  start.collapse(true)
  const caret = start.getBoundingClientRect()
  return caret.height ? caret : range.getBoundingClientRect()
}

/** Where `quote` starts in the page text, ignoring spaces; ends after its last character. */
function looseMatches(index: TextIndex, quote: string): [number, number][] {
  const positions: number[] = []
  let compact = ''
  for (let i = 0; i < index.text.length; i++) {
    if (index.text.charAt(i) === ' ') continue
    compact += index.text.charAt(i)
    positions.push(i)
  }
  const wanted = quote.replaceAll(' ', '')
  if (!wanted) return []
  return occurrencesOf(compact, wanted).map((at) => [
    positions[at] ?? 0,
    (positions[at + wanted.length - 1] ?? 0) + 1,
  ])
}

function findAnchor(index: TextIndex, anchor: ReviewAnchor): Range | undefined {
  if (!anchor.quote) return undefined
  const occurrences = occurrencesOf(index.text, anchor.quote)
  const start = occurrences[anchor.occurrence] ?? occurrences[0]
  if (start !== undefined) return rangeOf(index, start, start + anchor.quote.length)
  // A line break between blocks depends on the layout (a span may be a block on a
  // phone only), and comments saved before it was indexed have none: match
  // without spaces rather than lose the comment.
  const loose = looseMatches(index, anchor.quote)
  const match = loose[anchor.occurrence] ?? loose[0]
  return match && rangeOf(index, match[0], match[1])
}

/** Finds the live Range for a stored anchor, if its quote is still on the page. */
export function rangeFromAnchor(root: Element, anchor: ReviewAnchor): Range | undefined {
  return rangesFromAnchors(root, [anchor])[0]
}

/** `rangeFromAnchor` for several anchors, reading the page's text once. */
export function rangesFromAnchors(
  root: Element,
  anchors: ReviewAnchor[],
): (Range | undefined)[] {
  if (!anchors.some((anchor) => anchor.quote)) return anchors.map(() => undefined)
  const index = indexText(root)
  return anchors.map((anchor) => findAnchor(index, anchor))
}

function step(element: Element): string {
  const testId = element.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`
  if (element.id) return `#${CSS.escape(element.id)}`
  const tag = element.tagName.toLowerCase()
  const parent = element.parentElement
  if (!parent) return tag
  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  )
  return siblings.length > 1
    ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`
    : tag
}

function selectorFor(root: Element, element: Element): string {
  const steps: string[] = []
  for (let node: Element | null = element; node && node !== root;) {
    const current = step(node)
    steps.unshift(current)
    if (current.startsWith('[') || current.startsWith('#')) break
    node = node.parentElement
  }
  return steps.join(' > ')
}

/** Describes a pointed-at element so it can be found and understood later. */
export function anchorFromElement(root: Element, element: Element): ReviewAnchor {
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
  anchor: ReviewAnchor,
): Element | undefined {
  if (!anchor.element) return undefined
  try {
    return root.querySelector(anchor.element.selector) ?? undefined
  } catch {
    return undefined
  }
}

/** The most elements an area records as covered, and as crossed. */
const MAX_COVERS = 10
const MAX_CROSSES = 6
/** A box this much past an edge still counts as inside: borders round. */
const SLACK = 1

const boxOf = (element: Element): ReviewBox => {
  const { top, left, width, height } = element.getBoundingClientRect()
  return { top, left, width, height }
}

const holds = (outer: ReviewBox, inner: ReviewBox) =>
  inner.left >= outer.left - SLACK &&
  inner.top >= outer.top - SLACK &&
  inner.left + inner.width <= outer.left + outer.width + SLACK &&
  inner.top + inner.height <= outer.top + outer.height + SLACK

const overlaps = (a: ReviewBox, b: ReviewBox) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height

/** The page's elements under `parent`: a `display: contents` one has no box, its children do. */
function laidOut(parent: Element): { element: Element; box: ReviewBox }[] {
  return Array.from(parent.children).flatMap((element) => {
    if (element.closest(WIDGET) || element.matches(UNREAD)) return []
    const box = boxOf(element)
    if (box.width && box.height) return [{ element, box }]
    return getComputedStyle(element).display === 'contents' ? laidOut(element) : []
  })
}

/** The smallest element under `root` that holds all of `rect`, `root` when none does. */
function elementHolding(root: Element, rect: ReviewBox): Element {
  let holder = root
  for (;;) {
    const child = laidOut(holder).find(({ box }) => holds(box, rect))
    if (!child) return holder
    holder = child.element
  }
}

/**
 * What `rect` covers in `holder`: the outermost elements wholly inside it, and
 * the children of `holder` it cuts through.
 */
export function elementsIn(holder: Element, rect: ReviewBox) {
  const covers: Element[] = []
  const crosses: Element[] = []
  const visit = (parent: Element) => {
    for (const { element, box } of laidOut(parent)) {
      if (covers.length >= MAX_COVERS) return
      if (holds(rect, box)) covers.push(element)
      else if (overlaps(rect, box)) {
        if (parent === holder && crosses.length < MAX_CROSSES) crosses.push(element)
        visit(element)
      }
    }
  }
  visit(holder)
  return { covers, crosses }
}

function nodeOf(root: Element, element: Element): ReviewNode {
  return {
    selector: selectorFor(root, element),
    tag: element.tagName.toLowerCase(),
    text: normaliseQuote(element.textContent ?? '').slice(0, 80),
  }
}

const round = (value: number, digits = 0) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

/**
 * Describes a rectangle drawn over the page, in viewport pixels: where it is
 * on the page, the element it lies in (to find it again on another layout),
 * and the elements it covers or cuts through (to find it in the code).
 */
export function anchorFromArea(root: Element, rect: ReviewBox): ReviewAnchor {
  const holder = elementHolding(root, rect)
  const { covers, crosses } = elementsIn(holder, rect)
  const box = boxOf(holder)
  const within =
    holder !== root && box.width && box.height
      ? {
          ...nodeOf(root, holder),
          box: {
            top: round((rect.top - box.top) / box.height, 4),
            left: round((rect.left - box.left) / box.width, 4),
            width: round(rect.width / box.width, 4),
            height: round(rect.height / box.height, 4),
          },
        }
      : undefined
  const area: ReviewArea = {
    top: round(rect.top + window.scrollY),
    left: round(rect.left + window.scrollX),
    width: round(rect.width),
    height: round(rect.height),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: round(window.scrollX),
      scrollY: round(window.scrollY),
    },
    ...(within ? { within } : {}),
    covers: covers.map((element) => nodeOf(root, element)),
    crosses: crosses.map((element) => nodeOf(root, element)),
  }
  return {
    quote: '',
    occurrence: 0,
    section: sectionOf(root, rangeAround(covers[0] ?? holder)),
    area,
  }
}

/** The element the area was drawn in, when it is on the page. */
export function holderOf(root: Element, area: ReviewArea): Element | undefined {
  if (!area.within) return undefined
  try {
    return root.querySelector(area.within.selector) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Where the area is now, in viewport pixels: in the element it was drawn in,
 * which may have moved or changed size since; else where it was on the page.
 */
export function rectFromArea(area: ReviewArea, holder?: Element): ReviewBox {
  const box = holder && boxOf(holder)
  if (area.within && box?.width && box.height) {
    const { top, left, width, height } = area.within.box
    return {
      top: box.top + top * box.height,
      left: box.left + left * box.width,
      width: width * box.width,
      height: height * box.height,
    }
  }
  return {
    top: area.top - window.scrollY,
    left: area.left - window.scrollX,
    width: area.width,
    height: area.height,
  }
}

/** Scrolls the page to the area: centred, or its top in view when it is taller than the window. */
export function scrollToArea(root: Element, area: ReviewArea): void {
  const rect = rectFromArea(area, holderOf(root, area))
  const margin = 40
  const top =
    rect.height > window.innerHeight - 2 * margin
      ? rect.top - margin
      : rect.top + rect.height / 2 - window.innerHeight / 2
  window.scrollBy({ top, behavior: 'smooth' })
}
