import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerText, parseKeyedChoice, parseSpokenChoice, speakQuestion, type Question } from '../src/daemon/questions.ts'

const single: Question = {
  question: 'Which follow-up next?',
  options: [{ label: 'Adyen load race' }, { label: 'Major npm upgrades' }, { label: 'Sign commits' }, { label: 'Clean up worktree' }],
}
const multi: Question = { ...single, multiSelect: true }

test('reads the answering instructions in the question language', () => {
  const q: Question = { question: 'Welke eerst?', options: [{ label: 'Tests' }, { label: 'Docs' }] }
  assert.equal(speakQuestion(q, 'nl'), 'Welke eerst? 1: Tests. 2: Docs. Zeg een nummer, of toets het in. Of zeg gewoon je eigen antwoord.')
  assert.ok(speakQuestion(q).endsWith('Say a number, or press it on the keypad. Or just say your own answer.'))
})

test('picks spoken numbers as digits or words', () => {
  assert.deepEqual(parseSpokenChoice('Do 1.', single), { picked: [1] })
  assert.deepEqual(parseSpokenChoice('Option two please', single), { picked: [2] })
  assert.deepEqual(parseSpokenChoice('Do 1 and 3.', multi), { picked: [1, 3] })
  assert.deepEqual(parseSpokenChoice('one, two and four', multi), { picked: [1, 2, 4] })
  assert.deepEqual(parseSpokenChoice('all of them', multi), { picked: [1, 2, 3, 4] })
})

test('single choice keeps only the first pick; out of range is ignored', () => {
  assert.deepEqual(parseSpokenChoice('1 and 2', single), { picked: [1] })
  assert.deepEqual(parseSpokenChoice('9 and 2', single), { picked: [2] })
})

test('anything without a number is a free-text answer, unless cancelled', () => {
  assert.deepEqual(parseSpokenChoice('Look at the Stripe tests instead.', single), { text: 'Look at the Stripe tests instead' })
  assert.equal(parseSpokenChoice('never mind', single), null)
  assert.equal(parseSpokenChoice('', single), null)
})

test('keypad digits map to options', () => {
  assert.deepEqual(parseKeyedChoice('2', single), { picked: [2] })
  assert.deepEqual(parseKeyedChoice('313', multi), { picked: [3, 1] })
  assert.equal(parseKeyedChoice('9', single), null)
})

test('answers are option labels, comma separated for multi select', () => {
  assert.equal(answerText({ picked: [1, 3] }, multi), 'Adyen load race, Sign commits')
  assert.equal(answerText({ text: 'something else' }, single), 'something else')
})
