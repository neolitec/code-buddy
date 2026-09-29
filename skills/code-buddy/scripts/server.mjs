#!/usr/bin/env node
// server.mjs --project <dir>
// Serves the widget and its API to the project's dev app, and prints one line
// per comment needing attention (the manager reads them through Monitor):
// OPEN (backlog at start), NEW, FOLLOWUP, EDIT, RESOLVED, CANCELLED, DELETED.
// Only runs while /code-buddy is active: no server, no widget.
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { SKILL_DIR, WIDGET_VERSION, findProject } from './lib/project.mjs'
import { APP_ROUTE, createStore, isActive, normaliseQuote } from './lib/store.mjs'

const project = findProject()
if (!project) {
  console.error('no .code-buddy.json found; run /code-buddy:code-buddy init first')
  process.exit(2)
}
const { config } = project
const port = Number(process.env.CODE_BUDDY_PORT ?? config.port ?? 4599)
const pollMs = Number(process.env.CODE_BUDDY_POLL_MS ?? 1000)
const store = createStore(project)
const WIDGET = path.join(SKILL_DIR, 'widget', 'dist', 'widget.js')

const LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?$/
const allowedOrigins = new Set(config.devOrigins ?? [])

function corsHeaders(origin) {
  if (!origin || !(LOCAL_ORIGIN.test(origin) || allowedOrigins.has(origin))) {
    return {}
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    vary: 'origin',
  }
}

function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    ...headers,
    ...(json && { 'content-type': 'application/json' }),
    'cache-control': 'no-store',
  })
  res.end(json)
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 100_000) throw new Error('body too large')
  }
  return raw ? JSON.parse(raw) : {}
}

function sanitiseElement(element) {
  if (!element || typeof element.selector !== 'string') return undefined
  return {
    selector: element.selector.slice(0, 500),
    tag: String(element.tag ?? '').slice(0, 20),
    text: normaliseQuote(String(element.text ?? '')).slice(0, 200),
    html: normaliseQuote(String(element.html ?? '')).slice(0, 600),
  }
}

function sanitisePatch(input) {
  const patch = {}
  if (input.status === 'open' || input.status === 'resolved') {
    patch.status = input.status
  }
  if (typeof input.body === 'string' && input.body.trim()) {
    patch.body = input.body.trim()
  }
  if (typeof input.cancelled === 'boolean') patch.cancelled = input.cancelled
  if (typeof input.followUp === 'string' && input.followUp.trim()) {
    patch.followUp = input.followUp.trim()
  }
  if (typeof input.text === 'string' && input.text.trim()) {
    patch.text = input.text.trim()
  }
  return patch
}

async function handle(req, res) {
  const cors = corsHeaders(req.headers.origin)
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') return send(res, 204, undefined, cors)

  if (req.method === 'GET' && url.pathname === '/widget.js') {
    const source = await readFile(WIDGET, 'utf8')
    res.writeHead(200, {
      ...cors,
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    })
    return res.end(source)
  }

  if (url.pathname === '/api/health') {
    return send(
      res,
      200,
      { project: project.root, name: config.name, version: WIDGET_VERSION },
      cors,
    )
  }

  if (url.pathname === '/api/comments') {
    if (req.method === 'GET') {
      const route =
        url.searchParams.get('all') === '1' ? undefined : url.searchParams.get('route')
      if (route === null || route === '') {
        return send(res, 400, { error: 'route or all=1 is required' }, cors)
      }
      return send(res, 200, await store.list(route), cors)
    }
    if (req.method === 'POST') {
      const input = await readJson(req)
      const body = input.body?.trim()
      if (typeof input.route !== 'string' || !input.route || !body) {
        return send(res, 400, { error: 'route and body are required' }, cors)
      }
      const comment = await store.create({
        route: input.route.slice(0, 500),
        url: typeof input.url === 'string' ? input.url.slice(0, 2000) : undefined,
        body,
        section: String(input.section ?? '')
          .trim()
          .slice(0, 300),
        quote: normaliseQuote(String(input.quote ?? '')).slice(0, 2000),
        occurrence: Math.max(0, Math.floor(Number(input.occurrence) || 0)),
        element: sanitiseElement(input.element),
      })
      return send(res, 201, comment, cors)
    }
  }

  const match = url.pathname.match(/^\/api\/comments\/([\w-]+)$/)
  if (match) {
    if (req.method === 'PATCH') {
      const comment = await store.update(match[1], sanitisePatch(await readJson(req)))
      return comment
        ? send(res, 200, comment, cors)
        : send(res, 404, { error: 'not found' }, cors)
    }
    if (req.method === 'DELETE') {
      return (await store.remove(match[1]))
        ? send(res, 204, undefined, cors)
        : send(res, 404, { error: 'not found' }, cors)
    }
  }

  return send(res, 404, { error: 'not found' }, cors)
}

const seen = new Map()

function latestFollowUp(comment) {
  const last = comment.messages?.at(-1)
  return last?.author === 'reader' ? last.body : undefined
}

function describe(comment) {
  const where = comment.element
    ? `element=<${comment.element.tag}> "${comment.element.text.slice(0, 80)}"`
    : comment.quote
      ? `quote="${comment.quote.slice(0, 120)}"`
      : comment.route === APP_ROUTE
        ? 'app-level'
        : 'page-level'
  const section = comment.section ? ` section="${comment.section}"` : ''
  const url = comment.url ? ` url=${comment.url}` : ''
  const followUp = latestFollowUp(comment)
  const text = followUp
    ? `followup="${followUp}" messages=${comment.messages.length + 1}`
    : `body="${comment.body}"`
  return `${comment.id} route=${comment.route}${url}${section} ${where} ${text}`
}

async function tick(first) {
  let comments
  try {
    comments = await store.readAll()
  } catch {
    return
  }
  const current = new Set()
  for (const comment of comments) {
    if (!isActive(comment)) continue
    current.add(comment.id)
    const text = latestFollowUp(comment) ?? comment.body
    const previous = seen.get(comment.id)
    if (previous === undefined) {
      const kind = latestFollowUp(comment) ? 'FOLLOWUP' : first ? 'OPEN' : 'NEW'
      console.log(`${kind} ${describe(comment)}`)
    } else if (previous !== text) {
      console.log(`EDIT ${describe(comment)}`)
    }
    seen.set(comment.id, text)
  }
  for (const id of seen.keys()) {
    if (current.has(id)) continue
    const gone = comments.find((comment) => comment.id === id)
    console.log(
      !gone
        ? `DELETED ${id}`
        : gone.status === 'open'
          ? `CANCELLED ${id}`
          : `RESOLVED ${id}`,
    )
    seen.delete(id)
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) =>
    send(res, 500, { error: error.message }, corsHeaders(req.headers.origin)),
  )
})

server.on('error', async (error) => {
  if (error.code !== 'EADDRINUSE') throw error
  let owner = 'another program'
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
    owner =
      health.project === project.root
        ? 'another /code-buddy:code-buddy session for this project'
        : `the code-buddy server of ${health.project}`
  } catch {}
  console.log(`PORT_BUSY ${port} is used by ${owner}`)
  process.exit(3)
})

server.listen(port, '127.0.0.1', async () => {
  console.log(`READY http://127.0.0.1:${port} project=${project.root}`)
  await tick(true)
  setInterval(() => tick(false).catch(() => undefined), pollMs)
})
