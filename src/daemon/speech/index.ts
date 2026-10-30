import { guessLanguage } from './language.ts'
import { speakWithSay } from './say.ts'
import { transcribeWithWhisperCli } from './whisper-cli.ts'

export { detectLanguage } from './language.ts'

// A session remembers its last confidently detected language, which then
// decides replies too short to tell, so "Ja." after a Dutch reply stays Dutch.
export async function synthesize(text: string, session?: { language: string | null }): Promise<Buffer> {
  const guess = await guessLanguage(text, session?.language)
  if (session && guess.confident) session.language = guess.language
  return speakWithSay(text, guess.language)
}

export function transcribe(pcm: Buffer): Promise<string> {
  return transcribeWithWhisperCli(pcm)
}
