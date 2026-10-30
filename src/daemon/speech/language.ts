import { run } from '../../shared/run.ts'

export type Hypotheses = Record<string, number>
export type Detector = (text: string) => Promise<Hypotheses>

const DETECT_LANGUAGE = 'ObjC.import("NaturalLanguage"); function run(argv) { const r = $.NLLanguageRecognizer.alloc.init; r.processString(argv[0]); return JSON.stringify(ObjC.deepUnwrap(r.languageHypothesesWithMaximum(5))) }'

// Below this, short replies like "Ja." or "OK, done." often score highest in
// an unrelated language, so only languages already in play are considered.
const CONFIDENT = 0.8

export type LanguageGuess = { language: string; confident: boolean }

export function chooseLanguage(hypotheses: Hypotheses, preferred: string[]): LanguageGuess {
  const scores = new Map<string, number>()
  for (const [tag, p] of Object.entries(hypotheses)) {
    const lang = tag.split('-')[0]
    scores.set(lang, Math.max(scores.get(lang) ?? 0, p))
  }
  const [top] = [...scores].sort((a, b) => b[1] - a[1])
  if (top && top[1] >= CONFIDENT) return { language: top[0], confident: true }
  const best = preferred.reduce((a, b) => ((scores.get(b) ?? 0) > (scores.get(a) ?? 0) ? b : a))
  return { language: best, confident: false }
}

export function preferredLanguages(hint: string | null | undefined, env: NodeJS.ProcessEnv): string[] {
  const configured = Object.keys(env).flatMap(key => key.match(/^DESKPHONE_VOICE_([A-Z]{2,3})$/)?.[1].toLowerCase() ?? [])
  const whisper = env.DESKPHONE_LANGUAGE && env.DESKPHONE_LANGUAGE !== 'auto' ? [env.DESKPHONE_LANGUAGE] : []
  return [...new Set([...(hint ? [hint] : []), ...whisper, ...configured, env.DESKPHONE_VOICE_LANGUAGE ?? 'en'])]
}

export const macosDetector: Detector = async text =>
  JSON.parse(String(await run('osascript', ['-l', 'JavaScript', '-e', DETECT_LANGUAGE, text])))

export async function guessLanguage(text: string, hint?: string | null, detector: Detector = macosDetector): Promise<LanguageGuess> {
  const preferred = preferredLanguages(hint, process.env)
  try {
    return chooseLanguage(await detector(text), preferred)
  } catch {
    return { language: preferred[0], confident: false }
  }
}

export async function detectLanguage(text: string, hint?: string | null): Promise<string> {
  return (await guessLanguage(text, hint)).language
}
