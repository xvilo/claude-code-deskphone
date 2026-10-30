import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { run } from '../../shared/run.ts'
import { pcmToWav16k } from './ffmpeg.ts'

const MODEL = process.env.DESKPHONE_WHISPER_MODEL ?? resolve(import.meta.dirname, '../../../models/ggml-small.bin')
const LANGUAGE = process.env.DESKPHONE_LANGUAGE ?? 'auto'
const WHISPER = process.env.DESKPHONE_WHISPER_BIN ?? 'whisper-cli'

export async function transcribeWithWhisperCli(pcm: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deskphone-stt-'))
  const wav = join(dir, 'in.wav')
  try {
    await pcmToWav16k(pcm, wav)
    const out = await run(WHISPER, ['-m', MODEL, '-f', wav, '-l', LANGUAGE, '-nt', '-np'])
    return cleanTranscript(out.toString('utf8'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Whisper emits bracketed annotations like [BLANK_AUDIO] or (music) for
// non-speech, which should never reach Claude as a prompt.
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
