import type { IncomingMessage, ServerResponse } from 'node:http'

export const PATH_PREFIX = '/rt'

export function stripPrefix(pathname: string): string {
  if (pathname === PATH_PREFIX) return '/'
  return pathname.startsWith(`${PATH_PREFIX}/`) ? pathname.slice(PATH_PREFIX.length) : pathname
}

export async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export type Sse = { write(event: unknown): void; end(final?: unknown): void }

export function openSse(req: IncomingMessage, res: ServerResponse, onClose: () => void): Sse {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write(': connected\n\n')
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
  const stop = () => clearInterval(keepAlive)
  req.on('close', () => {
    stop()
    onClose()
  })
  res.on('close', stop)
  const write = (event: unknown) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  return {
    write,
    end(final) {
      stop()
      if (final !== undefined) write(final)
      res.end()
    },
  }
}
