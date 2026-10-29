import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SAMPLE_RATE } from './audio.ts'
import { run } from './tts.ts'

const MODEL = process.env.DESKPHONE_WHISPER_MODEL ?? resolve(import.meta.dirname, '../../models/ggml-small.bin')
const LANGUAGE = process.env.DESKPHONE_LANGUAGE ?? 'auto'
const WHISPER = process.env.DESKPHONE_WHISPER_BIN ?? 'whisper-cli'

export async function transcribe(pcm: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deskphone-stt-'))
  const raw = join(dir, 'in.raw')
  const wav = join(dir, 'in.wav')
  try {
    await writeFile(raw, pcm)
    await run('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', raw, '-ar', '16000', wav])
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
