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
  // A PIN was entered on this call, so it may send prompts and approvals.
  authorized = false
  private digitListener: ((digit: string) => void) | null = null
  private stopDigits: (() => void) | null = null
  private stopListening: (() => void) | null = null
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

  // Keys feed a running collectDigits; otherwise they skip ahead to the beep.
  keypress(digit: string): void {
    if (this.digitListener) this.digitListener(digit)
    else this.interrupt()
  }

  collectDigits({ max = 8, terminator = '#', timeoutMs = 10_000 } = {}): Promise<string | null> {
    return new Promise(resolve => {
      let digits = ''
      const finish = (result: string | null) => {
        clearTimeout(timer)
        this.digitListener = null
        this.stopDigits = null
        resolve(result)
      }
      this.stopDigits = () => finish(digits || null)
      const timer = setTimeout(() => finish(null), timeoutMs)
      this.onClose(() => finish(null))
      this.digitListener = digit => {
        // Typing shouldn't be talked over by the prompt asking for it.
        this.interrupt()
        timer.refresh()
        if (digit === terminator) return finish(digits)
        digits += digit
        if (digits.length >= max) finish(digits)
      }
    })
  }

  listen(opts?: VadOptions): Promise<Buffer | null> {
    return new Promise(resolve => {
      const endpointer = new Endpointer(opts)
      const stall = setTimeout(() => finish(null), MEDIA_STALL_MS)
      const finish = (audio: Buffer | null) => {
        clearTimeout(stall)
        this.frameListener = null
        this.stopListening = null
        this.lastListen = { frames: endpointer.frames, peakRms: Math.round(endpointer.peakRms) }
        resolve(audio)
      }
      this.stopListening = () => finish(null)
      this.onClose(() => finish(null))
      this.frameListener = frame => {
        stall.refresh()
        const result = endpointer.push(frame)
        if (result.kind === 'done') finish(result.audio)
        else if (result.kind === 'silent') finish(null)
      }
    })
  }

  // Whichever comes first: keys, or speech. Typing produces no audio, so the
  // keys keep their own timeout if speech times out first.
  async speechOrKeys(
    listen: VadOptions,
    keys: { max?: number; terminator?: string },
  ): Promise<{ keys: string } | { audio: Buffer } | null> {
    const typed = this.collectDigits({ ...keys, timeoutMs: listen.noSpeechTimeoutMs })
    const spoken = this.listen(listen)
    const first = await Promise.race([typed.then(k => ({ k })), spoken.then(a => ({ a }))])
    if ('k' in first && first.k) {
      this.stopListening?.()
      return { keys: first.k }
    }
    if ('a' in first && first.a) {
      this.stopDigits?.()
      return { audio: first.a }
    }
    const [k, a] = await Promise.all([typed, spoken])
    return k ? { keys: k } : a ? { audio: a } : null
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
