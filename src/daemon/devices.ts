import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type Device = { name: string; password: string }

export const DEVICES_FILE = process.env.DESKPHONE_PHONES_FILE ?? join(homedir(), '.config', 'deskphone', 'phones.json')
// Accounts in asterisk/config/pjsip.conf; Asterisk refuses to change them over ARI.
export const STATIC_DEVICES = ['phone']
const NAME = /^[a-z][a-z0-9_]{0,31}$/

export function checkName(name: string): string | null {
  if (!NAME.test(name)) return 'use lowercase letters, digits and underscores, starting with a letter'
  if (STATIC_DEVICES.includes(name)) return `${name} is defined in pjsip.conf`
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
    return this.list()
  }

  list(): Device[] {
    return [...this.devices]
  }

  async add(name: string): Promise<Device> {
    const problem = checkName(name)
    if (problem) throw new Error(problem)
    if (this.devices.some(d => d.name === name)) throw new Error(`${name} already exists`)
    const device = { name, password: randomBytes(12).toString('hex') }
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

  private async save(): Promise<void> {
    const tmp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    await writeFile(tmp, `${JSON.stringify(this.devices)}\n`, { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}
