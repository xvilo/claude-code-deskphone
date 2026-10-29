const ARI_URLS = (process.env.DESKPHONE_ARI_URL ?? 'http://127.0.0.1:8088/ari').split(',').map(u => u.trim()).filter(Boolean)
const ARI_USER = process.env.DESKPHONE_ARI_USER ?? 'deskphone'
const ARI_PASSWORD = process.env.DESKPHONE_ARI_PASSWORD ?? 'deskphone'
export const APP = 'deskphone'
const RECONNECT_MS = 5000

const auth = `Basic ${Buffer.from(`${ARI_USER}:${ARI_PASSWORD}`).toString('base64')}`

export type AriEvent = {
  type: string
  args?: string[]
  digit?: string
  channel?: { id: string; name: string; state: string }
}

function toWebSocketUrl(base: string): string {
  return base.replace(/^http/, 'ws')
}

// Everything goes laptop → Asterisk: the events stream, REST calls and each
// call's media WebSocket. Asterisk never has to reach the laptop, so it works
// from behind any NAT, VPN or office firewall.
export class Asterisk {
  active: string | null = null
  private readonly onEvent: (event: AriEvent) => void

  constructor(onEvent: (event: AriEvent) => void) {
    this.onEvent = onEvent
  }

  // Tries each ARI in order (e.g. a public one first, the local container as
  // fallback) and holds the events stream of the first that accepts,
  // reconnecting from the top whenever it drops.
  async connect(log: (message: string) => void, onConnect: () => void): Promise<void> {
    let last: string | null | undefined
    for (;;) {
      for (const base of ARI_URLS) {
        const closed = await this.listen(base, () => {
          if (last !== base) log(`connected to Asterisk at ${base}`)
          last = base
          onConnect()
        })
        if (closed) break
      }
      if (!this.active && last !== null) {
        log('no Asterisk reachable, retrying')
        last = null
      }
      await new Promise(r => setTimeout(r, RECONNECT_MS))
    }
  }

  // Resolves true if the stream was up and later dropped, false if it never connected.
  private listen(base: string, opened: () => void): Promise<boolean> {
    return new Promise(resolve => {
      const params = new URLSearchParams({ app: APP, api_key: `${ARI_USER}:${ARI_PASSWORD}` })
      const ws = new WebSocket(`${toWebSocketUrl(base)}/events?${params}`)
      let wasOpen = false
      const giveUp = setTimeout(() => ws.close(), RECONNECT_MS)
      ws.addEventListener('open', () => {
        clearTimeout(giveUp)
        wasOpen = true
        this.active = base
        opened()
      })
      ws.addEventListener('message', message => {
        try {
          this.onEvent(JSON.parse(String(message.data)))
        } catch {}
      })
      ws.addEventListener('close', () => {
        if (this.active === base) this.active = null
        resolve(wasOpen)
      })
      ws.addEventListener('error', () => ws.close())
    })
  }

  private async request(method: string, path: string, params?: Record<string, string>, body?: unknown): Promise<any> {
    if (!this.active) throw new Error('no Asterisk reachable')
    const query = params ? `?${new URLSearchParams(params)}` : ''
    const res = await fetch(`${this.active}${path}${query}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`ARI ${method} ${path}: ${res.status} ${await res.text()}`)
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  answer(channelId: string): Promise<void> {
    return this.request('POST', `/channels/${channelId}/answer`)
  }

  async hangup(channelId: string): Promise<void> {
    await this.request('DELETE', `/channels/${channelId}`).catch(() => {})
  }

  // Removes everything attachMedia may have created, however far it got.
  async teardown(callerId: string): Promise<void> {
    await this.hangup(`${callerId}-media`)
    await this.hangup(callerId)
    await this.request('DELETE', `/bridges/${callerId}-bridge`).catch(() => {})
  }

  // The image lacks res_mwi_external, so the deskphone-mwi dialplan context
  // sends the phone a message-summary NOTIFY itself. The Local channel is
  // never answered and so never enters the app.
  async setMessageWaiting(count: number): Promise<void> {
    await this.request('POST', '/channels', { endpoint: `Local/${count}@deskphone-mwi`, app: APP, timeout: '5' }).catch(() => {})
  }

  async originate(endpoint: string, channelId: string, ext: number, callId: string, ringSeconds: number): Promise<void> {
    await this.request('POST', '/channels', {
      endpoint,
      app: APP,
      appArgs: `outbound,${callId}`,
      channelId,
      callerId: `"Claude ${ext}" <${ext}>`,
      timeout: String(ringSeconds),
    })
  }

  // Bridges the caller to a new WebSocket media channel that this daemon
  // dials into. The socket goes to onSocket before anything is awaited on it,
  // because Asterisk sends MEDIA_START the moment it connects.
  async attachMedia(callerId: string, onSocket: (ws: WebSocket) => void): Promise<void> {
    const mediaId = `${callerId}-media`
    const media = await this.request('POST', '/channels/externalMedia', {
      app: APP,
      channelId: mediaId,
      transport: 'websocket',
      encapsulation: 'none',
      connection_type: 'server',
      format: 'slin',
    })
    const connectionId: string =
      media?.channelvars?.MEDIA_WEBSOCKET_CONNECTION_ID ??
      (await this.request('GET', `/channels/${mediaId}/variable`, { variable: 'MEDIA_WEBSOCKET_CONNECTION_ID' })).value

    const ws = new WebSocket(`${toWebSocketUrl(this.active!).replace(/\/ari\/?$/, '')}/media/${connectionId}`)
    ws.binaryType = 'arraybuffer'
    onSocket(ws)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('media WebSocket failed to connect')), { once: true })
    })

    const bridgeId = `${callerId}-bridge`
    await this.request('POST', '/bridges', { type: 'mixing', bridgeId })
    await this.request('POST', `/bridges/${bridgeId}/addChannel`, { channel: `${callerId},${mediaId}` })
  }
}
