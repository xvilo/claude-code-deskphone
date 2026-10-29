import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SAMPLE_RATE } from './audio.ts'

// Empty means `say` uses the system voice from System Settings > Accessibility
// > Spoken Content, which is the only way to get a Siri voice out of `say`.
const VOICE = process.env.DESKPHONE_VOICE ?? ''
const VOICE_LANGUAGE = process.env.DESKPHONE_VOICE_LANGUAGE ?? 'en'

export type Voice = { name: string; locale: string }

const DETECT_LANGUAGE = 'ObjC.import("NaturalLanguage"); function run(argv) { const r = $.NLLanguageRecognizer.alloc.init; r.processString(argv[0]); return JSON.stringify(ObjC.deepUnwrap(r.languageHypothesesWithMaximum(5))) }'

// Below this, short replies like "Ja." or "OK, done." often score highest in
// an unrelated language, so only languages already in play are considered.
const CONFIDENT = 0.8

export type LanguageGuess = { language: string; confident: boolean }

export function chooseLanguage(hypotheses: Record<string, number>, preferred: string[]): LanguageGuess {
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

async function guessLanguage(text: string, hint?: string | null): Promise<LanguageGuess> {
  const preferred = preferredLanguages(hint, process.env)
  try {
    const out = await run('osascript', ['-l', 'JavaScript', '-e', DETECT_LANGUAGE, text])
    return chooseLanguage(JSON.parse(String(out)), preferred)
  } catch {
    return { language: preferred[0], confident: false }
  }
}

export async function detectLanguage(text: string, hint?: string | null): Promise<string> {
  return (await guessLanguage(text, hint)).language
}

export function parseVoices(list: string): Voice[] {
  return list.split('\n').flatMap(line => {
    const m = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Z0-9]+)\s+#/)
    return m ? [{ name: m[1], locale: m[2] }] : []
  })
}

function quality(name: string): number {
  if (name.includes('(Premium)')) return 0
  if (name.includes('(Enhanced)')) return 1
  return name.includes('(') ? 3 : 2
}

export function pickVoice(lang: string, voices: Voice[]): string | null {
  const candidates = voices.filter(v => v.locale.startsWith(`${lang}_`))
  const home = `${lang}_${lang.toUpperCase()}`
  candidates.sort((a, b) => Number(b.locale === home) - Number(a.locale === home) || quality(a.name) - quality(b.name))
  return candidates[0]?.name ?? null
}

let installedVoices: Promise<Voice[]> | null = null

async function voiceFor(lang: string): Promise<string> {
  if (lang === VOICE_LANGUAGE) return VOICE
  const configured = process.env[`DESKPHONE_VOICE_${lang.toUpperCase()}`]
  if (configured) return configured
  installedVoices ??= run('say', ['-v', '?']).then(out => parseVoices(String(out)), () => [])
  return pickVoice(lang, await installedVoices) ?? VOICE
}

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', d => out.push(d))
    child.stderr.on('data', d => err.push(d))
    child.on('error', reject)
    child.on('close', code =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err)}`)),
    )
  })
}

// A session remembers its last confidently detected language, which then
// decides replies too short to tell, so "Ja." after a Dutch reply stays Dutch.
export async function synthesize(text: string, session?: { language: string | null }): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'deskphone-tts-'))
  const aiff = join(dir, 'speech.aiff')
  try {
    const guess = await guessLanguage(text, session?.language)
    if (session && guess.confident) session.language = guess.language
    const voice = await voiceFor(guess.language)
    await run('say', [...(voice ? ['-v', voice] : []), '-o', aiff, text])
    return await run('ffmpeg', ['-v', 'error', '-i', aiff, '-af', 'highpass=f=300,lowpass=f=3400', '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function tone(freq = 880, ms = 180, amplitude = 6000): Buffer {
  const samples = Math.floor((SAMPLE_RATE * ms) / 1000)
  const pcm = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)), i * 2)
  }
  return pcm
}

export { run }
