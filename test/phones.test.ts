import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PhoneRouter, phoneOfChannel, toEndpoint } from '../src/daemon/phones.ts'

test('reads the endpoint from a channel name', () => {
  assert.equal(phoneOfChannel('PJSIP/softphone-0000001a'), 'PJSIP/softphone')
  assert.equal(phoneOfChannel('PJSIP/desk-phone-00000002'), 'PJSIP/desk-phone')
  assert.equal(phoneOfChannel('nonsense'), null)
})

test('names without a technology are PJSIP endpoints', () => {
  assert.equal(toEndpoint('softphone'), 'PJSIP/softphone')
  assert.equal(toEndpoint('SIP/other'), 'SIP/other')
})

test('calls the pinned phone, else the last one used, else the default', () => {
  const router = new PhoneRouter('PJSIP/phone', true)
  assert.equal(router.target(null), 'PJSIP/phone')
  router.used('PJSIP/softphone-00000003')
  assert.equal(router.target(null), 'PJSIP/softphone')
  assert.equal(router.target('PJSIP/phone'), 'PJSIP/phone')
  assert.equal(new PhoneRouter('PJSIP/phone', false).target(null), 'PJSIP/phone')
})
