import assert from 'node:assert/strict'
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { VoicemailStore } from '../src/daemon/voicemail-store.ts'

const saved = [{ pid: 1, ext: 101, cwd: '/a', voicemail: [{ text: 'hello', at: 1 }] }]

test('round-trips voicemail through a file only the owner can read', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'deskphone-')), 'nested')
  const file = join(dir, 'voicemail.json')
  await new VoicemailStore(file).save(saved)
  assert.deepEqual(await new VoicemailStore(file).load(), saved)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(dir), ['voicemail.json'])
})

test('the last of overlapping saves wins', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'deskphone-')), 'voicemail.json')
  const store = new VoicemailStore(file)
  await Promise.all([store.save(saved), store.save([])])
  assert.deepEqual(await store.load(), [])
})

test('loads nothing from a missing or unreadable file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deskphone-'))
  assert.deepEqual(await new VoicemailStore(join(dir, 'missing.json')).load(), [])
  assert.deepEqual(await new VoicemailStore(dir).load(), [])
})
