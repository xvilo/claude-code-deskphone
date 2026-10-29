// Claude's multiple-choice questions (the AskUserQuestion tool), answered by
// voice or keypad. The hook allows the tool with `answers` filled in, which is
// what the on-screen dialog does.

export type Option = { label: string; description?: string }
export type Question = { question: string; header?: string; options: Option[]; multiSelect?: boolean }
export type Choice = { picked: number[] } | { text: string }

export function speakQuestion(q: Question): string {
  const options = q.options.map((o, i) => `${i + 1}: ${o.label}.`).join(' ')
  const how = q.multiSelect
    ? 'Say the numbers you want, or press them and then hash.'
    : 'Say a number, or press it on the keypad.'
  return `${q.question} ${options} ${how} Or just say your own answer.`
}

const WORDS: Record<string, number> = {
  one: 1, first: 1, een: 1,
  two: 2, second: 2, twee: 2,
  three: 3, third: 3, drie: 3,
  four: 4, fourth: 4, vier: 4,
  five: 5, fifth: 5, vijf: 5,
  six: 6, sixth: 6, zes: 6,
  seven: 7, seventh: 7, zeven: 7,
  eight: 8, eighth: 8, acht: 8,
  nine: 9, ninth: 9, negen: 9,
}
const CANCEL = /\b(never ?mind|cancel|skip|nothing|laat maar)\b/
const ALL = /\b(all|both|everything|alle|allebei)\b/

function numbers(text: string): number[] {
  const found: number[] = []
  for (const token of text.toLowerCase().match(/\d+|[a-z]+/g) ?? []) {
    const n = /^\d+$/.test(token) ? Number(token) : WORDS[token]
    if (n && !found.includes(n)) found.push(n)
  }
  return found
}

export function parseSpokenChoice(transcript: string, q: Question): Choice | null {
  const text = transcript.trim()
  if (!text || CANCEL.test(text.toLowerCase())) return null
  if (q.multiSelect && ALL.test(text.toLowerCase())) return { picked: q.options.map((_, i) => i + 1) }
  const picked = numbers(text).filter(n => n >= 1 && n <= q.options.length)
  if (picked.length) return { picked: q.multiSelect ? picked : picked.slice(0, 1) }
  return { text: text.replace(/[.!?]+$/, '') }
}

export function parseKeyedChoice(keys: string, q: Question): Choice | null {
  const picked = [...new Set([...keys].map(Number))].filter(n => n >= 1 && n <= q.options.length)
  if (!picked.length) return null
  return { picked: q.multiSelect ? picked : picked.slice(0, 1) }
}

export function answerText(choice: Choice, q: Question): string {
  return 'text' in choice ? choice.text : choice.picked.map(n => q.options[n - 1].label).join(', ')
}
