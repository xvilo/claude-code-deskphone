import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PinGuard, isValidPin, matchesHash, savePin } from '../src/daemon/pin.ts'

async function pinFile(pin: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'deskphone-')), 'pin')
  await savePin(pin, file)
  return file
}

test('stores only a salted hash, readable by the owner alone', async () => {
  const file = await pinFile('2468')
  const stored = await readFile(file, 'utf8')
  assert.ok(!stored.includes('2468'))
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal(await matchesHash('2468', stored), true)
  assert.equal(await matchesHash('2469', stored), false)
})

test('accepts 4 to 8 digits only', () => {
  assert.equal(isValidPin('1234'), true)
  assert.equal(isValidPin('123'), false)
  assert.equal(isValidPin('12a4'), false)
  assert.equal(isValidPin('123456789'), false)
})

test('locks out after five wrong PINs for fifteen minutes', async () => {
  let now = 0
  const guard = new PinGuard(await pinFile('1357'), () => now)
  for (let i = 0; i < 5; i++) assert.equal(await guard.check('0000'), 'wrong')
  assert.equal(await guard.check('1357'), 'locked-out')
  now += 15 * 60_000
  assert.equal(await guard.check('1357'), 'ok')
})

test('reports a missing PIN', async () => {
  assert.equal(await new PinGuard('/nonexistent/deskphone-pin').check('1234'), 'no-pin')
})
