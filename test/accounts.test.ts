import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FileAccounts, LOCAL_OWNER } from '../src/daemon/accounts.ts'
import { DeviceStore } from '../src/daemon/devices.ts'

async function accounts() {
  const store = new DeviceStore(join(await mkdtemp(join(tmpdir(), 'deskphone-accounts-')), 'phones.json'))
  await store.load()
  return new FileAccounts(store)
}

test('the desk phone is the static primary account', async () => {
  const a = await accounts()
  assert.deepEqual(a.list().map(x => [x.username, x.number, x.password]), [['phone', 1001, null]])
  assert.equal(a.primaryOf(LOCAL_OWNER)?.username, 'phone')
  assert.equal(a.byEndpoint('PJSIP/phone-00000002')?.number, 1001)
  assert.equal(a.byEndpoint('Local/fake@deskphone-test-0001;1'), null)
})

test('added phones are numbered, found by number and endpoint, and removable', async () => {
  const a = await accounts()
  const laptop = await a.add('laptop')
  assert.equal(laptop.number, 1002)
  assert.equal(laptop.ownerId, LOCAL_OWNER)
  assert.equal(a.byNumber(1002)?.username, 'laptop')
  assert.equal(a.byEndpoint('laptop')?.label, 'laptop')
  assert.equal(await a.remove('laptop'), true)
  assert.equal(a.byNumber(1002), null)
})

test('does not push the static desk phone', async () => {
  const a = await accounts()
  await a.add('laptop')
  const pushed: string[] = []
  await a.pushTo({ addDevice: async (username, password, number, label) => { pushed.push(`${username}:${number}:${label}:${password.length}`) } })
  assert.deepEqual(pushed, ['laptop:1002:laptop:24'])
})
