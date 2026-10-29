import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SAMPLE_RATE } from './audio.ts'

// Empty means `say` uses the system voice from System Settings > Accessibility
// > Spoken Content, which is the only way to get a Siri voice out of `say`.
const VOICE = process.env.DESKPHONE_VOICE ?? ''

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

export async function synthesize(text: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'deskphone-tts-'))
  const aiff = join(dir, 'speech.aiff')
  try {
    await run('say', [...(VOICE ? ['-v', VOICE] : []), '-o', aiff, text])
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
