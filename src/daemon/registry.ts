export type PhoneEvent = { type: 'prompt'; text: string; ext: number }
export type Voicemail = { text: string; at: number; lang: string }
export type SavedVoicemail = { pid: number; ext: number; cwd: string; voicemail: Voicemail[] }

export type Session = {
  pid: number
  ext: number
  cwd: string
  voicemail: Voicemail[]
  lastReply: Voicemail | null
  transcriptPath: string | null
  language: string | null
  outbox: PhoneEvent[]
  listener: ((event: PhoneEvent) => void) | null
}

export const VOICEMAIL_EXT = 100
export const FIRST_EXT = 101
export const LAST_EXT = 199

export class Registry {
  private byPid = new Map<number, Session>()
  // Restored from disk for sessions that haven't re-registered since the restart.
  private orphans: Session[] = []

  register(pid: number, cwd: string, preferredExt?: number): Session {
    const existing = this.byPid.get(pid)
    if (existing) return existing
    // cwd guards against a reused pid after a reboot.
    const orphan = this.orphans.findIndex(o => o.pid === pid && o.cwd === cwd)
    const voicemail = orphan === -1 ? [] : this.orphans.splice(orphan, 1)[0].voicemail
    const ext = this.allocate(preferredExt)
    const session = newSession(pid, ext, cwd, voicemail)
    this.byPid.set(pid, session)
    return session
  }

  restore(saved: SavedVoicemail[]): void {
    for (const { pid, ext, cwd, voicemail } of saved) {
      if (voicemail?.length) this.orphans.push(newSession(pid, ext, cwd, voicemail))
    }
  }

  snapshot(): SavedVoicemail[] {
    return this.withVoicemail().map(({ pid, ext, cwd, voicemail }) => ({ pid, ext, cwd, voicemail }))
  }

  isLive(session: Session): boolean {
    return this.byPid.get(session.pid) === session
  }

  unregister(pid: number): boolean {
    return this.byPid.delete(pid)
  }

  // Drops sessions whose Claude process has exited, freeing their extension.
  // Their voicemail stays playable on the voicemail extension.
  prune(isAlive: (pid: number) => boolean): Session[] {
    const dead = [...this.byPid.values()].filter(s => !isAlive(s.pid))
    for (const session of dead) {
      this.byPid.delete(session.pid)
      if (session.voicemail.length) this.orphans.push(session)
    }
    return dead
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
    return this.withVoicemail().reduce((n, s) => n + s.voicemail.length, 0)
  }

  // Removes and returns the oldest message across all sessions, including
  // ones whose session never came back after a restart.
  takeOldestVoicemail(): { session: Session; message: Voicemail } | null {
    this.orphans = this.orphans.filter(o => o.voicemail.length)
    let oldest: Session | null = null
    for (const session of this.withVoicemail()) {
      if (!oldest || session.voicemail[0].at < oldest.voicemail[0].at) oldest = session
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

  private withVoicemail(): Session[] {
    return [...this.byPid.values(), ...this.orphans].filter(s => s.voicemail.length)
  }

  private allocate(preferred?: number): number {
    const taken = new Set([...this.byPid.values()].map(s => s.ext))
    if (preferred && preferred >= FIRST_EXT && preferred <= LAST_EXT && !taken.has(preferred)) return preferred
    for (let ext = FIRST_EXT; ext <= LAST_EXT; ext++) if (!taken.has(ext)) return ext
    throw new Error('all extensions are in use')
  }
}

function newSession(pid: number, ext: number, cwd: string, voicemail: Voicemail[]): Session {
  return { pid, ext, cwd, voicemail, lastReply: null, transcriptPath: null, language: null, outbox: [], listener: null }
}
