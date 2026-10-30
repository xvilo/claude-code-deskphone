import assert from 'node:assert/strict'
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
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  const body = await (await fetch(`http://127.0.0.1:${port}/events`)).text()
  server.close()
  assert.match(body, /^: connected\n\n/)
  assert.ok(body.includes('data: {"type":"prompt","text":"hi"}\n\n'))
  assert.ok(body.endsWith('data: {"type":"disconnected","reason":"user"}\n\n'))
})
