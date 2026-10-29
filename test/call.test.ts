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

test('collects keypad digits up to the terminator, without skipping ahead', async () => {
  const { call } = startedCall()
  const pending = call.collectDigits({ timeoutMs: 1000 })
  for (const d of ['1', '2', '3', '4', '#']) call.keypress(d)
  assert.equal(await pending, '1234')
  assert.equal(call.skipping, true, 'typing interrupts the spoken prompt')
})

test('stops collecting at the maximum length or on timeout', async () => {
  const { call } = startedCall()
  const full = call.collectDigits({ max: 3, timeoutMs: 1000 })
  for (const d of ['9', '8', '7', '6']) call.keypress(d)
  assert.equal(await full, '987')
  assert.equal(await call.collectDigits({ timeoutMs: 30 }), null)
})

test('speechOrKeys returns keys as soon as they are complete', async () => {
  const { call } = startedCall()
  const answer = call.speechOrKeys({ noSpeechTimeoutMs: 2000 }, { max: 1 })
  setTimeout(() => call.keypress('2'), 20)
  assert.deepEqual(await answer, { keys: '2' })
})
