export type Phrases = {
  codeOnScreen: string
  linkTo: (host: string) => string
  restOnScreen: string
  extension: (ext: number, project: string) => string
  recap: string
  lastTime: string
  questions: (count: number) => string
  pickOne: string
  pickMany: string
  ownAnswer: string
}

const en: Phrases = {
  codeOnScreen: '(code on screen)',
  linkTo: host => `a link to ${host}`,
  restOnScreen: 'The rest is on screen.',
  extension: (ext, project) => `Extension ${ext}, ${project}`,
  recap: 'Recap:',
  lastTime: 'Last time:',
  questions: count => (count === 1 ? 'has a question.' : `has ${count} questions.`),
  pickOne: 'Say a number, or press it on the keypad.',
  pickMany: 'Say the numbers you want, or press them and then hash.',
  ownAnswer: 'Or just say your own answer.',
}

const nl: Phrases = {
  codeOnScreen: '(code op het scherm)',
  linkTo: host => `een link naar ${host}`,
  restOnScreen: 'De rest staat op het scherm.',
  extension: (ext, project) => `Toestel ${ext}, ${project}`,
  recap: 'Samenvatting:',
  lastTime: 'Vorige keer:',
  questions: count => (count === 1 ? 'heeft een vraag.' : `heeft ${count} vragen.`),
  pickOne: 'Zeg een nummer, of toets het in.',
  pickMany: 'Zeg de nummers die je wilt, of toets ze in en druk dan op hekje.',
  ownAnswer: 'Of zeg gewoon je eigen antwoord.',
}

const table: Record<string, Phrases> = { en, nl }

export function phrases(lang: string): Phrases {
  return table[lang] ?? en
}
