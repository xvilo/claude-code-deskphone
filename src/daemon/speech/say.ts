import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../../shared/run.ts'
import { toPhonePcm } from './ffmpeg.ts'

// Empty means `say` uses the system voice from System Settings > Accessibility
// > Spoken Content, which is the only way to get a Siri voice out of `say`.
const VOICE = process.env.DESKPHONE_VOICE ?? ''
const VOICE_LANGUAGE = process.env.DESKPHONE_VOICE_LANGUAGE ?? 'en'

export type Voice = { name: string; locale: string }

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

export async function speakWithSay(text: string, lang: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'deskphone-tts-'))
  const aiff = join(dir, 'speech.aiff')
  try {
    const voice = await voiceFor(lang)
    await run('say', [...(voice ? ['-v', voice] : []), '-o', aiff, text])
    return await toPhonePcm(aiff)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
