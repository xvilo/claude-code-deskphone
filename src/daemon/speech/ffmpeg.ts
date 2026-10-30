import { writeFile } from 'node:fs/promises'
import { run } from '../../shared/run.ts'
import { SAMPLE_RATE } from '../audio.ts'

export function toPhonePcm(inputPath: string): Promise<Buffer> {
  return run('ffmpeg', ['-v', 'error', '-i', inputPath, '-af', 'highpass=f=300,lowpass=f=3400', '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'])
}

export async function pcmToWav16k(pcm: Buffer, wavPath: string): Promise<void> {
  const raw = `${wavPath}.raw`
  await writeFile(raw, pcm)
  await run('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', raw, '-ar', '16000', wavPath])
}
