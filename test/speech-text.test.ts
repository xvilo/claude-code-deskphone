import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toSpeech } from '../src/daemon/speech-text.ts'
import { cleanTranscript } from '../src/daemon/stt.ts'

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

test('drops whisper non-speech annotations', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO]\n'), '')
  assert.equal(cleanTranscript(' Run the tests (coughs) please\n'), 'Run the tests please')
})
