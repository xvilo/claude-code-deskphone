import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FRAME_BYTES } from '../src/daemon/audio.ts'
import { Call } from '../src/daemon/call.ts'

class FakeSocket extends EventTarget {
  sent: (Buffer | string)[] = []
  send(data: Buffer | string) {
    this.sent.push(data)
  }
  close() {}
}

function startedCall() {
  const ws = new FakeSocket()
  const call = new Call(async () => {})
  call.attach(ws as unknown as WebSocket)
  ws.dispatchEvent(new MessageEvent('message', { data: 'MEDIA_START connection_id:x format:slin' }))
  return { ws, call }
}

test('a keypress cuts playback short and flushes queued audio', async () => {
  const { ws, call } = startedCall()
  const tenSeconds = Buffer.alloc(FRAME_BYTES * 500)
  const startedAt = Date.now()
  setTimeout(() => call.interrupt(), 100)
  await call.play(tenSeconds)
  assert.ok(Date.now() - startedAt < 1000)
  assert.ok(ws.sent.includes('FLUSH_MEDIA'))

  const framesBefore = ws.sent.length
  await call.play(Buffer.alloc(FRAME_BYTES * 2))
  assert.equal(ws.sent.length, framesBefore, 'speech stays skipped until resumed')

  call.resume()
  await call.play(Buffer.alloc(FRAME_BYTES * 2))
  assert.equal(ws.sent.length, framesBefore + 2)
})
