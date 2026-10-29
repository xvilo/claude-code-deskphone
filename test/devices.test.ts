import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkName, DeviceStore } from '../src/daemon/devices.ts'

test('rejects bad names and the accounts in pjsip.conf', () => {
  assert.equal(checkName('softphone'), null)
  assert.ok(checkName('Soft Phone'))
  assert.ok(checkName('phone'))
})

test('adds, persists and removes devices with their own passwords', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'deskphone-devices-')), 'phones.json')
  const store = new DeviceStore(file)
  await store.load()
  const added = await store.add('softphone')
  assert.match(added.password, /^[0-9a-f]{24}$/)
  await assert.rejects(store.add('softphone'))
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await new DeviceStore(file).load(), [added])
  assert.equal(await store.remove('softphone'), true)
  assert.equal(await store.remove('softphone'), false)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [])
})
