import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proseOf, toSpeech } from '../src/daemon/speech-text.ts'
import { cleanTranscript } from '../src/daemon/speech/whisper-cli.ts'

test('strips markdown and code for speech', () => {
  const md = '## Done\n\nFixed **the bug** in `src/daemon/index.ts:42`.\n\n```ts\nconst x = 1\n```\n\n- See [docs](https://example.com/a/b)'
  assert.equal(toSpeech(md), 'Done\nFixed the bug in index.ts.\n(code on screen)\nSee docs')
})

test('speaks bare URLs as their host', () => {
  assert.equal(toSpeech('Open https://github.com/foo/bar now'), 'Open a link to github.com now')
})

test('truncates long text at a sentence boundary', () => {
  const text = toSpeech('First sentence here. '.repeat(20), 100)
  assert.ok(text.endsWith('here. The rest is on screen.'))
  assert.ok(text.length < 140)
})

test('speaks its own phrases in the reply language', () => {
  const md = 'Zie https://github.com/foo/bar\n\n```ts\nconst x = 1\n```'
  assert.equal(toSpeech(md, 900, 'nl'), 'Zie een link naar github.com\n(code op het scherm)')
  assert.ok(toSpeech('Eerste zin hier. '.repeat(20), 100, 'nl').endsWith('hier. De rest staat op het scherm.'))
})

test('falls back to English phrases for other languages', () => {
  assert.equal(toSpeech('```\nx\n```', 900, 'fr'), '(code on screen)')
})

test('leaves code and links out of language detection', () => {
  assert.equal(proseOf('Klaar `npm test` zie https://x.dev/a\n```ts\nconst x\n```').replace(/\s+/g, ' ').trim(), 'Klaar zie')
})

test('drops whisper non-speech annotations', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO]\n'), '')
  assert.equal(cleanTranscript(' Run the tests (coughs) please\n'), 'Run the tests please')
})
