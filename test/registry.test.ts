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
  registry.leaveVoicemail(a, 'a1', 'en', 1)
  registry.leaveVoicemail(b, 'b1', 'en', 2)
  registry.leaveVoicemail(a, 'a2', 'en', 3)
  assert.equal(registry.voicemailCount(), 3)
  const order = []
  for (let next; (next = registry.takeOldestVoicemail()); ) order.push(next.message.text)
  assert.deepEqual(order, ['a1', 'b1', 'a2'])
  assert.equal(registry.voicemailCount(), 0)
})

test('restored voicemail reattaches when its session registers again', () => {
  const before = new Registry()
  before.leaveVoicemail(before.register(1, '/a', 120), 'a1', 'en', 1)
  before.leaveVoicemail(before.register(2, '/b'), 'b1', 'en', 2)
  const after = new Registry()
  after.restore(before.snapshot())
  assert.equal(after.voicemailCount(), 2)
  const a = after.register(1, '/a', 120)
  assert.equal(a.ext, 120)
  assert.deepEqual(a.voicemail, [{ text: 'a1', at: 1, lang: 'en' }])
  assert.equal(after.voicemailCount(), 2)
  assert.equal(after.register(3, '/c').voicemail.length, 0)
})

test('voicemail from sessions that never return stays playable', () => {
  const before = new Registry()
  before.leaveVoicemail(before.register(1, '/a'), 'a1', 'en', 2)
  const after = new Registry()
  after.restore(before.snapshot())
  const b = after.register(1, '/elsewhere')
  after.leaveVoicemail(b, 'b1', 'en', 1)
  const first = after.takeOldestVoicemail()!
  assert.equal(first.message.text, 'b1')
  assert.equal(after.isLive(first.session), true)
  const second = after.takeOldestVoicemail()!
  assert.equal(second.message.text, 'a1')
  assert.equal(second.session.ext, 101)
  assert.equal(after.isLive(second.session), false)
  assert.equal(after.takeOldestVoicemail(), null)
  assert.deepEqual(after.snapshot(), [])
})

test('prunes sessions whose process exited and keeps their voicemail', () => {
  const registry = new Registry()
  const gone = registry.register(1, '/a', 103)
  registry.register(2, '/b')
  registry.leaveVoicemail(gone, 'missed', 'en', 1)
  assert.deepEqual(registry.prune(pid => pid !== 1).map(s => s.pid), [1])
  assert.equal(registry.byExt(103), undefined)
  assert.equal(registry.register(3, '/c', 103).ext, 103)
  assert.equal(registry.takeOldestVoicemail()?.message.text, 'missed')
})
