import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { openSse, stripPrefix } from '../src/daemon/http.ts'

test('strips the /rt prefix and leaves other paths alone', () => {
  assert.equal(stripPrefix('/rt/register'), '/register')
  assert.equal(stripPrefix('/rt'), '/')
  assert.equal(stripPrefix('/register'), '/register')
  assert.equal(stripPrefix('/rtx'), '/rtx')
})

test('an SSE stream can be ended with a final event', async () => {
  const server = createServer((req, res) => {
    const sse = openSse(req, res, () => {})
    sse.write({ type: 'prompt', text: 'hi' })
    sse.end({ type: 'disconnected', reason: 'user' })
    sse.write({ type: 'late' })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/events`)).text()
    assert.match(body, /^: connected\n\n/)
    assert.ok(body.includes('data: {"type":"prompt","text":"hi"}\n\n'))
    assert.ok(body.endsWith('data: {"type":"disconnected","reason":"user"}\n\n'))
    assert.ok(!body.includes('late'))
  } finally {
    server.closeAllConnections()
    await new Promise(r => server.close(r))
  }
})

test('ending the stream stops the keep-alive timer', t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const writes: string[] = []
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead() {},
    write(chunk: string) {
      writes.push(chunk)
      return true
    },
    end() {
      this.writableEnded = true
    },
  }) as any
  const sse = openSse(new EventEmitter() as any, res, () => {})
  t.mock.timers.tick(15000)
  assert.equal(writes.filter(w => w === ': ping\n\n').length, 1)
  sse.end()
  t.mock.timers.tick(45000)
  assert.equal(writes.filter(w => w === ': ping\n\n').length, 1)
})
