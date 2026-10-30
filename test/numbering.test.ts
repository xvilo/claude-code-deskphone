import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOSTED, STANDALONE } from '../src/daemon/mode.ts'
import { classify } from '../src/daemon/numbering.ts'

test('classifies standalone numbers', () => {
  assert.deepEqual(classify('100', STANDALONE), { kind: 'menu' })
  assert.deepEqual(classify('101', STANDALONE), { kind: 'session', ext: 101 })
  assert.deepEqual(classify('199', STANDALONE), { kind: 'session', ext: 199 })
  assert.deepEqual(classify('1001', STANDALONE), { kind: 'phone', number: 1001 })
  assert.deepEqual(classify('1999', STANDALONE), { kind: 'phone', number: 1999 })
})

test('classifies hosted numbers', () => {
  assert.deepEqual(classify('1002', HOSTED), { kind: 'session', ext: 1002 })
  assert.deepEqual(classify('9999', HOSTED), { kind: 'session', ext: 9999 })
  assert.deepEqual(classify('10000', HOSTED), { kind: 'phone', number: 10000 })
})

test('everything else is unknown', () => {
  for (const dialed of ['', '0', '99', '200', '2000', '01', '0101', '1a', '*', '100000']) {
    assert.deepEqual(classify(dialed, STANDALONE), { kind: 'unknown' }, dialed)
  }
})
