import { FRAME_BYTES } from './audio.ts'
import { Endpointer, type VadOptions } from './vad.ts'

const FRAME_INTERVAL_MS = 20
// The VAD measures time in received frames, so it never times out if the
// phone's audio isn't arriving at all.
const MEDIA_STALL_MS = 3000

export type ListenStats = { frames: number; peakRms: number }

export class Call {
  closed = false
  // Set by a keypress: speech is skipped until the next beep.
  skipping = false
  lastListen: ListenStats = { frames: 0, peakRms: 0 }
  readonly started: Promise<void>
  private frameListener: ((frame: Buffer) => void) | null = null
  private closeListeners: (() => void)[] = []
  private ws: WebSocket | null = null
  private readonly teardown: () => Promise<void>
  private resolveStarted!: () => void

  constructor(teardown: () => Promise<void>) {
    this.teardown = teardown
    this.started = new Promise(resolve => (this.resolveStarted = resolve))
    this.onClose(this.resolveStarted)
  }

  attach = (ws: WebSocket): void => {
    this.ws = ws
    ws.addEventListener('message', message => {
      if (typeof message.data === 'string') {
        if (message.data.includes('MEDIA_START')) this.resolveStarted()
      } else {
        this.frameListener?.(Buffer.from(message.data as ArrayBuffer))
      }
    })
    ws.addEventListener('close', () => this.markClosed())
  }

  async play(pcm: Buffer): Promise<void> {
    await this.started
    const start = Date.now()
    for (let offset = 0, i = 0; offset < pcm.length && !this.closed && !this.skipping; offset += FRAME_BYTES, i++) {
      const frame = Buffer.alloc(FRAME_BYTES)
      pcm.copy(frame, 0, offset, offset + FRAME_BYTES)
      this.ws?.send(frame)
      // Pace against wall-clock so timer drift doesn't accumulate and
      // overflow or starve Asterisk's media queue.
      const wait = start + (i + 1) * FRAME_INTERVAL_MS - Date.now()
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
    }
  }

  interrupt(): void {
    if (this.skipping || this.closed) return
    this.skipping = true
    // Drops what Asterisk has queued but not yet played.
    this.ws?.send('FLUSH_MEDIA')
  }

  resume(): void {
    this.skipping = false
  }

  listen(opts?: VadOptions): Promise<Buffer | null> {
    return new Promise(resolve => {
      const endpointer = new Endpointer(opts)
      const stall = setTimeout(() => finish(null), MEDIA_STALL_MS)
      const finish = (audio: Buffer | null) => {
        clearTimeout(stall)
        this.frameListener = null
        this.lastListen = { frames: endpointer.frames, peakRms: Math.round(endpointer.peakRms) }
        resolve(audio)
      }
      this.onClose(() => finish(null))
      this.frameListener = frame => {
        stall.refresh()
        const result = endpointer.push(frame)
        if (result.kind === 'done') finish(result.audio)
        else if (result.kind === 'silent') finish(null)
      }
    })
  }

  async hangup(): Promise<void> {
    this.markClosed()
    this.ws?.close()
    await this.teardown()
  }

  onClose(listener: () => void): void {
    if (this.closed) listener()
    else this.closeListeners.push(listener)
  }

  markClosed(): void {
    if (this.closed) return
    this.closed = true
    for (const listener of this.closeListeners.splice(0)) listener()
  }
}
