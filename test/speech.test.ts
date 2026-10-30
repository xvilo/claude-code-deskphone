import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseLanguage, guessLanguage, preferredLanguages } from '../src/daemon/speech/language.ts'
import { parseVoices, pickVoice } from '../src/daemon/speech/say.ts'

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

test('trusts a confident detection in any language', () => {
  assert.deepEqual(chooseLanguage({ fr: 0.99, en: 0.01 }, ['en']), { language: 'fr', confident: true })
  assert.deepEqual(chooseLanguage({ 'zh-Hans': 0.95 }, ['en']), { language: 'zh', confident: true })
})

test('falls back to a language in play when unsure', () => {
  assert.deepEqual(chooseLanguage({ fi: 0.59, nl: 0.09, de: 0.08 }, ['en', 'nl']), { language: 'nl', confident: false })
  assert.deepEqual(chooseLanguage({ pl: 0.37, en: 0.21, es: 0.07 }, ['nl', 'en']), { language: 'en', confident: false })
  assert.deepEqual(chooseLanguage({ it: 0.4, ro: 0.35 }, ['nl', 'en']), { language: 'nl', confident: false })
  assert.deepEqual(chooseLanguage({}, ['en']), { language: 'en', confident: false })
})

test('ranks the session hint, whisper and configured voices before the default voice', () => {
  const env = { DESKPHONE_VOICE_LANGUAGE: 'en', DESKPHONE_VOICE_DE: 'Anna', DESKPHONE_LANGUAGE: 'nl' }
  assert.deepEqual(preferredLanguages('fr', env), ['fr', 'nl', 'de', 'en'])
  assert.deepEqual(preferredLanguages(null, { DESKPHONE_LANGUAGE: 'auto' }), ['en'])
  assert.deepEqual(preferredLanguages('en', {}), ['en'])
})

test('guessLanguage uses the injected detector', async () => {
  const guess = await guessLanguage('Gepusht.', 'nl', async () => ({ nl: 0.95 }))
  assert.deepEqual(guess, { language: 'nl', confident: true })
  const fallback = await guessLanguage('Ok.', 'nl', async () => ({ pl: 0.4, nl: 0.3 }))
  assert.deepEqual(fallback, { language: 'nl', confident: false })
})
