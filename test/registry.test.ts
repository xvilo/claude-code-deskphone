import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Registry, type PhoneEvent } from '../src/daemon/registry.ts'

test('allocates lowest free extension and honors preference', () => {
  const registry = new Registry()
  assert.equal(registry.register(1, '/a').ext, 101)
  assert.equal(registry.register(2, '/b', 150).ext, 150)
  assert.equal(registry.register(3, '/c', 101).ext, 102)
  assert.equal(registry.register(1, '/a').ext, 101)
  registry.unregister(1)
  assert.equal(registry.register(4, '/d').ext, 101)
  assert.equal(registry.byExt(150)?.pid, 2)
})

test('buffers events until a listener attaches', () => {
  const registry = new Registry()
  const session = registry.register(1, '/a')
  const event: PhoneEvent = { type: 'prompt', text: 'hi', ext: 101 }
  registry.deliver(session, event)
  const received: PhoneEvent[] = []
  const detach = registry.attach(session, e => received.push(e))
  registry.deliver(session, event)
  detach()
  registry.deliver(session, event)
  assert.equal(received.length, 2)
  assert.equal(session.outbox.length, 1)
})

test('keeps every voicemail and hands them out oldest first', () => {
  const registry = new Registry()
  const a = registry.register(1, '/a')
  const b = registry.register(2, '/b')
  registry.leaveVoicemail(a, 'a1', 1)
  registry.leaveVoicemail(b, 'b1', 2)
  registry.leaveVoicemail(a, 'a2', 3)
  assert.equal(registry.voicemailCount(), 3)
  const order = []
  for (let next; (next = registry.takeOldestVoicemail()); ) order.push(next.message.text)
  assert.deepEqual(order, ['a1', 'b1', 'a2'])
  assert.equal(registry.voicemailCount(), 0)
})
