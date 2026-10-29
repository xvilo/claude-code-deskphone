import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { DAEMON_URL } from '../shared/config.ts'
import { findClaudePid } from '../shared/pid.ts'

const pid = findClaudePid()
let ext: number | null = null
let stream: AbortController | null = null

const mcp = new Server(
  { name: 'phone', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions: [
      'Deskphone lets the user talk to this session from an analog desk phone.',
      'Messages arrive as <channel source="phone" ext="..."> and are speech transcribed by whisper: expect missing punctuation and misheard words, and interpret them generously as the user\'s prompt.',
      'When the session is phone-enabled, your final message of each turn is read aloud over the phone, so keep it short, conversational and free of tables or long code; put details in files instead.',
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
      if (ext !== null) ext = (await daemon('/register', { pid, cwd: process.cwd(), ext })).ext
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
      properties: { ext: { type: 'number', description: 'Preferred extension between 101 and 199' } },
    },
  },
  {
    name: 'phone_unregister',
    description: 'Stop phone calls for this session and release its extension.',
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
        const preferred = (req.params.arguments as { ext?: number } | undefined)?.ext
        ext = (await daemon('/register', { pid, cwd: process.cwd(), ext: preferred ?? ext ?? undefined })).ext
        if (!stream) {
          stream = new AbortController()
          void listen(stream)
        }
        return text(`This session is on extension ${ext}. Pick up the phone and dial ${ext} to talk; it will ring when a turn finishes.`)
      }
      case 'phone_unregister': {
        stream?.abort()
        stream = null
        ext = null
        await daemon('/unregister', { pid })
        return text('Phone disabled for this session.')
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
