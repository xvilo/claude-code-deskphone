import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findRecap } from '../src/daemon/recap.ts'

test('finds the newest away_summary in a transcript', () => {
  const lines = [
    { type: 'system', subtype: 'away_summary', content: 'old', timestamp: '2026-10-29T12:00:00.000Z' },
    { type: 'assistant', message: { content: 'mentions away_summary in text' } },
    { type: 'system', subtype: 'away_summary', content: 'new', timestamp: '2026-10-29T13:00:00.000Z' },
    { type: 'user', message: { content: 'hi' } },
  ]
  const recap = findRecap(lines.map(l => JSON.stringify(l)).join('\n') + '\n{"truncated')
  assert.deepEqual(recap, { text: 'new', at: Date.parse('2026-10-29T13:00:00.000Z') })
})

test('returns null without a recap', () => {
  assert.equal(findRecap('{"type":"user"}\n'), null)
})
