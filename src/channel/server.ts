import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { DAEMON_URL } from '../shared/config.ts'
import { PHONE_STYLE } from '../shared/phone-style.ts'
import { findClaudePid } from '../shared/pid.ts'

const pid = findClaudePid()
let ext: number | null = null
let phone: string | undefined
let stream: AbortController | null = null

const mcp = new Server(
  { name: 'phone', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions: [
      'Deskphone lets the user talk to this session from an analog desk phone.',
      'Messages arrive as <channel source="phone" ext="..."> and are speech transcribed by whisper: expect missing punctuation and misheard words, and interpret them generously as the user\'s prompt.',
      `Once the session is phone-enabled: ${PHONE_STYLE}`,
      'Call phone_register when the user asks for a phone number or runs /phone, and tell them the extension to dial.',
    ].join(' '),
  },
)

async function daemon(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`deskphone daemon ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function forward(text: string, fromExt: number): Promise<void> {
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: { content: text, meta: { ext: String(fromExt) } },
  })
}

// Keeps the SSE stream open for as long as the session is registered,
// re-registering with the same extension if the daemon restarts.
async function listen(controller: AbortController): Promise<void> {
  while (!controller.signal.aborted) {
    try {
      if (ext !== null) ext = (await daemon('/register', { pid, cwd: process.cwd(), ext, phone })).ext
      const res = await fetch(`${DAEMON_URL}/events?pid=${pid}`, { signal: controller.signal })
      if (!res.ok || !res.body) throw new Error(`events: ${res.status}`)
      let buffer = ''
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = message.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
          if (!data) continue
          const event = JSON.parse(data)
          if (event.type === 'prompt') await forward(event.text, event.ext)
        }
      }
    } catch {
      if (controller.signal.aborted) return
    }
    await new Promise(r => setTimeout(r, 2000))
  }
}

const tools = [
  {
    name: 'phone_register',
    description: 'Give this Claude Code session a phone extension. The user can dial it to send a spoken prompt, and the phone rings with the reply when a turn finishes.',
    inputSchema: {
      type: 'object',
      properties: {
        ext: { type: 'number', description: 'Preferred extension between 101 and 199' },
        phone: { type: 'string', description: 'SIP account to always call back, e.g. "phone" or "softphone". Empty string clears it. Omit to call whichever phone was used last.' },
      },
    },
  },
  {
    name: 'phone_unregister',
    description: 'Stop phone calls for this session and release its extension.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'phone_device_add',
    description: 'Create a SIP account for another phone, such as a softphone on the laptop. Returns the username, password and server to enter in that phone, and the number other phones dial to reach it.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Account name: lowercase letters, digits and underscores, e.g. "softphone" or "laptop"' } },
      required: ['name'],
    },
  },
  {
    name: 'phone_device_remove',
    description: 'Delete a SIP account created with phone_device_add.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'phone_device_list',
    description: 'List the phones (SIP accounts), their numbers and whether each is registered.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'phone_status',
    description: 'List phone-enabled sessions and their extensions.',
    inputSchema: { type: 'object', properties: {} },
  },
]

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const text = (t: string) => ({ content: [{ type: 'text', text: t }] })
  try {
    switch (req.params.name) {
      case 'phone_register': {
        const args = req.params.arguments as { ext?: number; phone?: string } | undefined
        if (args?.phone !== undefined) phone = args.phone
        const registered = await daemon('/register', { pid, cwd: process.cwd(), ext: args?.ext ?? ext ?? undefined, phone })
        ext = registered.ext
        if (!stream) {
          stream = new AbortController()
          void listen(stream)
        }
        const target = registered.phone ? `${registered.phone} will ring` : 'the phone you used last will ring'
        return text(`This session is on extension ${ext}. Dial ${ext} to talk; ${target} when a turn finishes.`)
      }
      case 'phone_unregister': {
        stream?.abort()
        stream = null
        ext = null
        await daemon('/unregister', { pid })
        return text('Phone disabled for this session.')
      }
      case 'phone_device_add': {
        const { name } = req.params.arguments as { name: string }
        const device = await daemon('/phones', { name })
        return text(
          `Created phone "${device.name}", number ${device.number}. SIP username: ${device.username}, password: ${device.password}, server: ${device.server ?? 'your Asterisk'} (same port as the desk phone). ` +
            'Other phones reach it by dialing its number. Callbacks ring the phone used last; pin a session to it with phone_register phone="' + device.name + '".',
        )
      }
      case 'phone_device_remove': {
        const { name } = req.params.arguments as { name: string }
        const { removed } = await daemon('/phones/remove', { name })
        return text(removed ? `Removed phone "${name}".` : `There is no added phone called "${name}".`)
      }
      case 'phone_device_list': {
        const res = await fetch(`${DAEMON_URL}/phones`)
        return text(JSON.stringify(await res.json(), null, 2))
      }
      case 'phone_status': {
        const res = await fetch(`${DAEMON_URL}/status`)
        return text(JSON.stringify(await res.json(), null, 2))
      }
    }
    throw new Error(`unknown tool: ${req.params.name}`)
  } catch (err) {
    const message = (err as Error).message
    const hint = /fetch failed|ECONNREFUSED/.test(message) ? ' Is the daemon running? Start it with `npm run daemon` in the deskphone repo.' : ''
    return { ...text(`${message}${hint}`), isError: true }
  }
})

await mcp.connect(new StdioServerTransport())
