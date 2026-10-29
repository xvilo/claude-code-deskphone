import { FRAME_BYTES, SAMPLE_RATE } from './audio.ts'

const FRAME_MS = (FRAME_BYTES / 2 / SAMPLE_RATE) * 1000

export function rms(frame: Buffer): number {
  let sum = 0
  const samples = Math.floor(frame.length / 2)
  for (let i = 0; i < samples; i++) {
    const s = frame.readInt16LE(i * 2)
    sum += s * s
  }
  return samples ? Math.sqrt(sum / samples) : 0
}

export type VadOptions = {
  threshold?: number
  minSpeechMs?: number
  endSilenceMs?: number
  noSpeechTimeoutMs?: number
  maxMs?: number
}

export type VadResult = { kind: 'continue' } | { kind: 'done'; audio: Buffer } | { kind: 'silent' }

// Energy-based endpointing: the phone line is quiet enough that a fixed
// RMS threshold separates speech from line noise reliably.
export class Endpointer {
  private chunks: Buffer[] = []
  private elapsedMs = 0
  private speechMs = 0
  private silenceMs = 0
  frames = 0
  peakRms = 0
  private readonly opts: Required<VadOptions>

  constructor(opts: VadOptions = {}) {
    this.opts = {
      threshold: opts.threshold ?? Number(process.env.DESKPHONE_VAD_THRESHOLD ?? 500),
      minSpeechMs: opts.minSpeechMs ?? 200,
      endSilenceMs: opts.endSilenceMs ?? 1500,
      noSpeechTimeoutMs: opts.noSpeechTimeoutMs ?? 8000,
      maxMs: opts.maxMs ?? 60000,
    }
  }

  push(frame: Buffer): VadResult {
    const ms = (frame.length / FRAME_BYTES) * FRAME_MS
    this.elapsedMs += ms
    this.chunks.push(frame)
    this.frames++
    const level = rms(frame)
    this.peakRms = Math.max(this.peakRms, level)
    const speaking = this.speechMs >= this.opts.minSpeechMs

    if (level >= this.opts.threshold) {
      this.speechMs += ms
      this.silenceMs = 0
    } else if (speaking) {
      this.silenceMs += ms
    }

    if (!speaking && this.elapsedMs >= this.opts.noSpeechTimeoutMs) return { kind: 'silent' }
    if (speaking && (this.silenceMs >= this.opts.endSilenceMs || this.elapsedMs >= this.opts.maxMs)) {
      return { kind: 'done', audio: Buffer.concat(this.chunks) }
    }
    return { kind: 'continue' }
  }
}
