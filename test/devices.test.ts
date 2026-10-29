import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
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
  assert.equal(added.number, 1002)
  assert.equal((await store.add('tablet')).number, 1003)
  assert.equal(await store.remove('tablet'), true)
  await assert.rejects(store.add('softphone'))
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await new DeviceStore(file).load(), [added])
  assert.equal(await store.remove('softphone'), true)
  assert.equal(await store.remove('softphone'), false)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [])
})

test('numbers phones saved before numbers existed, lowest free first', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'deskphone-devices-')), 'phones.json')
  await writeFile(file, JSON.stringify([{ name: 'old', password: 'x' }, { name: 'numbered', password: 'y', number: 1002 }]))
  const devices = await new DeviceStore(file).load()
  assert.deepEqual(devices.map(d => [d.name, d.number]), [['old', 1003], ['numbered', 1002]])
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].number, 1003)
})
