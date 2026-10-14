import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME } from '../shared/api'

const allowedPaths = new Set<string>()

const key = (p: string): string => path.resolve(p).toLowerCase()

/** Only files the user explicitly imported can be streamed to the renderer. */
export function allowMediaPath(p: string): void {
  allowedPaths.add(key(p))
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.ts': 'video/mp2t'
}

/** Must run before the app's `ready` event. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = new URL(request.url).searchParams.get('path')
    if (!filePath || !allowedPaths.has(key(filePath))) {
      return new Response('Forbidden', { status: 403 })
    }

    let size: number
    try {
      size = (await fs.stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const headers: Record<string, string> = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes'
    }

    const range = parseRange(request.headers.get('range'), size)
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }

    if (range) {
      const [start, end] = range
      headers['Content-Length'] = String(end - start + 1)
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      return new Response(toWeb(createReadStream(filePath, { start, end })), { status: 206, headers })
    }

    headers['Content-Length'] = String(size)
    return new Response(toWeb(createReadStream(filePath)), { status: 200, headers })
  })
}

function toWeb(stream: Readable): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

function parseRange(header: string | null, size: number): [number, number] | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'

  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return 'invalid'
  return [start, end]
}
