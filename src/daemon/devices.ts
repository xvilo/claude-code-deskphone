import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type Device = { name: string; password: string; number: number }

export const DEVICES_FILE = process.env.DESKPHONE_PHONES_FILE ?? join(homedir(), '.config', 'deskphone', 'phones.json')
// The account in asterisk/config/pjsip.conf; Asterisk refuses to change it over ARI.
export const DESK_PHONE = { name: 'phone', number: 1001 }
// Phones call each other on these; sessions are 101-199 and voicemail 100.
export const FIRST_NUMBER = 1002
export const LAST_NUMBER = 1999
const NAME = /^[a-z][a-z0-9_]{0,31}$/

export function checkName(name: string): string | null {
  if (!NAME.test(name)) return 'use lowercase letters, digits and underscores, starting with a letter'
  if (name === DESK_PHONE.name) return `${name} is defined in pjsip.conf`
  return null
}

export class DeviceStore {
  private readonly file: string
  private devices: Device[] = []

  constructor(file = DEVICES_FILE) {
    this.file = file
  }

  async load(): Promise<Device[]> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      this.devices = Array.isArray(saved) ? saved : []
    } catch {
      this.devices = []
    }
    // Phones saved before they had numbers.
    const unnumbered = this.devices.filter(d => !d.number)
    for (const device of unnumbered) device.number = this.freeNumber()
    if (unnumbered.length) await this.save()
    return this.list()
  }

  list(): Device[] {
    return [...this.devices]
  }

  async add(name: string): Promise<Device> {
    const problem = checkName(name)
    if (problem) throw new Error(problem)
    if (this.devices.some(d => d.name === name)) throw new Error(`${name} already exists`)
    const device = { name, password: randomBytes(12).toString('hex'), number: this.freeNumber() }
    this.devices.push(device)
    await this.save()
    return device
  }

  async remove(name: string): Promise<boolean> {
    const before = this.devices.length
    this.devices = this.devices.filter(d => d.name !== name)
    if (this.devices.length === before) return false
    await this.save()
    return true
  }

  private freeNumber(): number {
    const taken = new Set(this.devices.map(d => d.number))
    for (let number = FIRST_NUMBER; number <= LAST_NUMBER; number++) if (!taken.has(number)) return number
    throw new Error('no phone numbers left')
  }

  private async save(): Promise<void> {
    const tmp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    await writeFile(tmp, `${JSON.stringify(this.devices)}\n`, { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}
