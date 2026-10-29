import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SavedVoicemail } from './registry.ts'

export const VOICEMAIL_FILE = process.env.DESKPHONE_VOICEMAIL_FILE ?? join(homedir(), '.config', 'deskphone', 'voicemail.json')

export class VoicemailStore {
  private readonly file: string
  private writing: Promise<void> = Promise.resolve()

  constructor(file = VOICEMAIL_FILE) {
    this.file = file
  }

  async load(): Promise<SavedVoicemail[]> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  }

  // Chained so an older snapshot never lands after a newer one, and the
  // temp file plus rename means a crash mid-write keeps the previous file.
  save(saved: SavedVoicemail[]): Promise<void> {
    const write = async () => {
      const tmp = `${this.file}.tmp`
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      await writeFile(tmp, `${JSON.stringify(saved)}\n`, { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, this.file)
    }
    this.writing = this.writing.then(write, write)
    return this.writing
  }
}
