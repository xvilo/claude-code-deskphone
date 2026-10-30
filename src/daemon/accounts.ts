import { DESK_PHONE, type Device, type DeviceStore } from './devices.ts'
import { phoneOfChannel } from './phones.ts'

export type Account = { username: string; number: number; label: string; ownerId: string; password: string | null }

export interface AccountSource {
  list(): Account[]
  byUsername(username: string): Account | null
  byNumber(number: number): Account | null
  byEndpoint(endpoint: string): Account | null
  primaryOf(ownerId: string): Account | null
}

export const LOCAL_OWNER = 'local'

function toAccount(device: Device): Account {
  return { username: device.name, number: device.number, label: device.name, ownerId: LOCAL_OWNER, password: device.password }
}

export class FileAccounts implements AccountSource {
  private readonly store: DeviceStore
  private readonly deskPhone: Account

  constructor(store: DeviceStore, deskPhone: { name: string; number: number } = DESK_PHONE) {
    this.store = store
    this.deskPhone = { username: deskPhone.name, number: deskPhone.number, label: deskPhone.name, ownerId: LOCAL_OWNER, password: null }
  }

  list(): Account[] {
    return [this.deskPhone, ...this.store.list().map(toAccount)]
  }

  byUsername(username: string): Account | null {
    return this.list().find(a => a.username === username) ?? null
  }

  byNumber(number: number): Account | null {
    return this.list().find(a => a.number === number) ?? null
  }

  byEndpoint(endpoint: string): Account | null {
    const named = phoneOfChannel(endpoint) ?? endpoint
    if (named.includes('/') && !named.startsWith('PJSIP/')) return null
    return this.byUsername(named.replace(/^PJSIP\//, ''))
  }

  primaryOf(ownerId: string): Account | null {
    return ownerId === LOCAL_OWNER ? this.deskPhone : null
  }

  async add(label: string): Promise<Account> {
    return toAccount(await this.store.add(label))
  }

  async remove(username: string): Promise<boolean> {
    return this.store.remove(username)
  }

  async pushTo(
    asterisk: { addDevice(username: string, password: string, number: number, label: string): Promise<void> },
    onError?: (username: string, err: Error) => void,
  ): Promise<void> {
    for (const { username, password, number, label } of this.list()) {
      if (password === null) continue
      await asterisk.addDevice(username, password, number, label).catch(err => onError?.(username, err as Error))
    }
  }
}
