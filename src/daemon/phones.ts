export const DEFAULT_PHONE = process.env.DESKPHONE_ENDPOINT ?? 'PJSIP/phone'
const FOLLOW_LAST = process.env.DESKPHONE_FOLLOW_LAST_PHONE !== 'false'

export function toEndpoint(phone: string): string {
  return phone.includes('/') ? phone : `PJSIP/${phone}`
}

// Asterisk names channels <tech>/<endpoint>-<sequence>.
export function phoneOfChannel(name: string): string | null {
  const dash = name.lastIndexOf('-')
  return name.includes('/') && dash > 0 ? name.slice(0, dash) : null
}

export class PhoneRouter {
  private lastUsed: string | null = null
  private readonly fallback: string
  private readonly followLast: boolean

  constructor(fallback = DEFAULT_PHONE, followLast = FOLLOW_LAST) {
    this.fallback = fallback
    this.followLast = followLast
  }

  used(channelName: string): void {
    this.lastUsed = phoneOfChannel(channelName) ?? this.lastUsed
  }

  target(pinned: string | null): string {
    return pinned ?? (this.followLast ? this.lastUsed : null) ?? this.fallback
  }
}
