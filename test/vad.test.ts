import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FRAME_BYTES, tone } from '../src/daemon/audio.ts'
import { Endpointer } from '../src/daemon/vad.ts'

const silence = Buffer.alloc(FRAME_BYTES)
const speech = tone(300, 20, 4000)

function feed(endpointer: Endpointer, frames: Buffer[]) {
  for (const frame of frames) {
    const result = endpointer.push(frame)
    if (result.kind !== 'continue') return result
  }
  return { kind: 'continue' as const }
}

test('ends utterance after trailing silence', () => {
  const frames = [...Array(25).fill(silence), ...Array(50).fill(speech), ...Array(100).fill(silence)]
  const result = feed(new Endpointer({ endSilenceMs: 1000 }), frames)
  assert.equal(result.kind, 'done')
  assert.equal((result as { audio: Buffer }).audio.length, (25 + 50 + 50) * FRAME_BYTES)
})

test('reports silence when nobody speaks', () => {
  assert.equal(feed(new Endpointer({ noSpeechTimeoutMs: 1000 }), Array(100).fill(silence)).kind, 'silent')
})

test('ignores a short click', () => {
  const frames = [speech, ...Array(100).fill(silence)]
  assert.equal(feed(new Endpointer({ noSpeechTimeoutMs: 1000 }), frames).kind, 'silent')
})
