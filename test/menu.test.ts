import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeSessions } from '../src/daemon/menu.ts'
import { Registry } from '../src/daemon/registry.ts'

test('says so when no session is registered', () => {
  assert.equal(describeSessions([]), 'No Claude sessions are registered.')
})

test('names each session with its folder, connection and waiting messages', () => {
  const registry = new Registry()
  const a = registry.register(1, '/home/me/tags-backend')
  registry.register(2, '/home/me/deskphone')
  const c = registry.register(3, '/home/me/site')
  registry.attach(a, () => {})
  registry.leaveVoicemail(a, 'x', 'en')
  registry.leaveVoicemail(a, 'y', 'en')
  registry.leaveVoicemail(c, 'z', 'en')
  assert.equal(
    describeSessions(registry.list()),
    '3 sessions. Extension 101, tags-backend, connected, 2 messages waiting. Extension 102, deskphone, not connected, no messages. Extension 103, site, not connected, one message waiting.',
  )
})

test('a single session is announced as one', () => {
  const registry = new Registry()
  registry.register(1, '/work/a')
  assert.equal(describeSessions(registry.list()), 'One session. Extension 101, a, not connected, no messages.')
})
