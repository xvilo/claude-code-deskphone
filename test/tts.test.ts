import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseVoices, pickVoice } from '../src/daemon/tts.ts'

const list = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Eddy (German (Germany)) de_DE    # Hallo! Ich heiße Eddy.',
  'Anna                de_DE    # Hallo! Ich heiße Anna.',
  'Ellen               nl_BE    # Hallo! Mijn naam is Ellen.',
  'Xander              nl_NL    # Hallo! Mijn naam is Xander.',
  'Claire (Premium)    nl_BE    # Hallo! Mijn naam is Claire.',
].join('\n')

test('parses names that contain spaces and parentheses', () => {
  assert.deepEqual(parseVoices(list)[1], { name: 'Eddy (German (Germany))', locale: 'de_DE' })
})

test('prefers the home locale, then the better quality voice', () => {
  const voices = parseVoices(list)
  assert.equal(pickVoice('nl', voices), 'Xander')
  assert.equal(pickVoice('de', voices), 'Anna')
  assert.equal(pickVoice('fr', voices), null)
})
