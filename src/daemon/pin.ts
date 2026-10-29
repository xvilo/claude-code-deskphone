import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const PIN_FILE = process.env.DESKPHONE_PIN_FILE ?? join(homedir(), '.config', 'deskphone', 'pin')
const KEY_BYTES = 32
const MAX_FAILURES = 5
const LOCKOUT_MS = 15 * 60_000

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${(await scrypt(pin, salt, KEY_BYTES)).toString('hex')}`
}

export async function matchesHash(pin: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.trim().split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = await scrypt(pin, Buffer.from(salt, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function savePin(pin: string, file = PIN_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${await hashPin(pin)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

export type PinCheck = 'ok' | 'wrong' | 'locked-out' | 'no-pin'

// Wrong guesses count across calls, so redialing doesn't reset them.
export class PinGuard {
  private failures = 0
  private lockedUntil = 0
  private readonly file: string
  private readonly now: () => number

  constructor(file = PIN_FILE, now = Date.now) {
    this.file = file
    this.now = now
  }

  async stored(): Promise<string | null> {
    try {
      return (await readFile(this.file, 'utf8')).trim() || null
    } catch {
      return null
    }
  }

  async check(pin: string): Promise<PinCheck> {
    const stored = await this.stored()
    if (!stored) return 'no-pin'
    if (this.now() < this.lockedUntil) return 'locked-out'
    if (await matchesHash(pin, stored)) {
      this.failures = 0
      return 'ok'
    }
    if (++this.failures >= MAX_FAILURES) {
      this.failures = 0
      this.lockedUntil = this.now() + LOCKOUT_MS
    }
    return 'wrong'
  }

  lockedOut(): boolean {
    return this.now() < this.lockedUntil
  }
}
