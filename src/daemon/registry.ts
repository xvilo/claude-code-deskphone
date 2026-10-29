export type PhoneEvent = { type: 'prompt'; text: string; ext: number }
export type Voicemail = { text: string; at: number; lang: string }

export type Session = {
  pid: number
  ext: number
  cwd: string
  voicemail: Voicemail[]
  lastReply: Voicemail | null
  transcriptPath: string | null
  outbox: PhoneEvent[]
  listener: ((event: PhoneEvent) => void) | null
}

export const VOICEMAIL_EXT = 100
export const FIRST_EXT = 101
export const LAST_EXT = 199

export class Registry {
  private byPid = new Map<number, Session>()

  register(pid: number, cwd: string, preferredExt?: number): Session {
    const existing = this.byPid.get(pid)
    if (existing) return existing
    const ext = this.allocate(preferredExt)
    const session: Session = { pid, ext, cwd, voicemail: [], lastReply: null, transcriptPath: null, outbox: [], listener: null }
    this.byPid.set(pid, session)
    return session
  }

  unregister(pid: number): boolean {
    return this.byPid.delete(pid)
  }

  get(pid: number): Session | undefined {
    return this.byPid.get(pid)
  }

  byExt(ext: number): Session | undefined {
    for (const session of this.byPid.values()) if (session.ext === ext) return session
    return undefined
  }

  list(): Session[] {
    return [...this.byPid.values()].sort((a, b) => a.ext - b.ext)
  }

  leaveVoicemail(session: Session, text: string, lang: string, at = Date.now()): void {
    session.voicemail.push({ text, at, lang })
  }

  voicemailCount(): number {
    return this.list().reduce((n, s) => n + s.voicemail.length, 0)
  }

  // Removes and returns the oldest message across all sessions.
  takeOldestVoicemail(): { session: Session; message: Voicemail } | null {
    let oldest: Session | null = null
    for (const session of this.byPid.values()) {
      if (session.voicemail.length && (!oldest || session.voicemail[0].at < oldest.voicemail[0].at)) oldest = session
    }
    return oldest ? { session: oldest, message: oldest.voicemail.shift()! } : null
  }

  deliver(session: Session, event: PhoneEvent): boolean {
    if (session.listener) session.listener(event)
    else session.outbox.push(event)
    return !!session.listener
  }

  attach(session: Session, listener: (event: PhoneEvent) => void): () => void {
    session.listener = listener
    for (const event of session.outbox.splice(0)) listener(event)
    return () => {
      if (session.listener === listener) session.listener = null
    }
  }

  private allocate(preferred?: number): number {
    const taken = new Set([...this.byPid.values()].map(s => s.ext))
    if (preferred && preferred >= FIRST_EXT && preferred <= LAST_EXT && !taken.has(preferred)) return preferred
    for (let ext = FIRST_EXT; ext <= LAST_EXT; ext++) if (!taken.has(ext)) return ext
    throw new Error('all extensions are in use')
  }
}
