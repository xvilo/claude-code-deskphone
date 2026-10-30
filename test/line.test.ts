import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Lines } from '../src/daemon/line.ts'

const tick = () => new Promise(r => setTimeout(r, 5))

test('serialises calls to the same endpoint and runs other endpoints concurrently', async () => {
  const lines = new Lines()
  const order: string[] = []
  const slow = (name: string) => async () => { order.push(`${name} start`); await tick(); order.push(`${name} end`) }
  await Promise.all([
    lines.serialize('PJSIP/phone', slow('a')),
    lines.serialize('PJSIP/phone', slow('b')),
    lines.serialize('PJSIP/laptop', slow('c')),
  ])
  assert.ok(order.indexOf('a end') < order.indexOf('b start'))
  assert.ok(order.indexOf('c start') < order.indexOf('a end'))
})

test('a failing task does not block the next one', async () => {
  const lines = new Lines()
  await assert.rejects(lines.serialize('PJSIP/phone', async () => { throw new Error('boom') }))
  assert.equal(await lines.serialize('PJSIP/phone', async () => 42), 42)
})

test('whenFree waits for the hold to be released, with a timeout', async () => {
  const lines = new Lines()
  const release = lines.hold('PJSIP/phone')
  assert.equal(lines.busy('PJSIP/phone'), true)
  let freed = false
  const waiting = lines.whenFree('PJSIP/phone').then(() => (freed = true))
  await tick()
  assert.equal(freed, false)
  release()
  release()
  await waiting
  assert.equal(lines.busy('PJSIP/phone'), false)
  const stuck = lines.hold('PJSIP/laptop')
  const started = Date.now()
  await lines.whenFree('PJSIP/laptop', 30)
  assert.ok(Date.now() - started >= 25)
  stuck()
})
