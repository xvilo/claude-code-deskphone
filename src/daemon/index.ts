import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { Asterisk, type AriEvent } from './ari.ts'
import { Call } from './call.ts'
import { isScreenLocked } from './lock.ts'
import { describePermission, parseDecision, type Decision } from './permission.ts'
import { phrases } from './phrases.ts'
import { PinGuard } from './pin.ts'
import { answerText, parseKeyedChoice, parseSpokenChoice, speakQuestion, type Choice, type Question } from './questions.ts'
import { latestRecap } from './recap.ts'
import { Registry, VOICEMAIL_EXT, type Session } from './registry.ts'
import { proseOf, toSpeech } from './speech-text.ts'
import { transcribe } from './stt.ts'
import { detectLanguage, synthesize, tone } from './tts.ts'
import { VoicemailStore } from './voicemail-store.ts'
import { PhoneRouter, toEndpoint } from './phones.ts'
import { DeviceStore, STATIC_DEVICES } from './devices.ts'

const HTTP_PORT = Number(process.env.DESKPHONE_PORT ?? 7788)
const RING_SECONDS = Number(process.env.DESKPHONE_RING_SECONDS ?? 30)
const REPLY_WAIT_MS = Number(process.env.DESKPHONE_REPLY_WAIT_MS ?? 8000)
const OUTBOUND_PREFIX = 'deskphone-out-'

const registry = new Registry()
const voicemailStore = new VoicemailStore()
const devices = new DeviceStore()
const asterisk = new Asterisk(event => void onEvent(event))
const beep = tone()
const pins = new PinGuard()
const PIN_ATTEMPTS = 3
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

type OutboundCall = { answered: (call: Call) => Promise<void>; missed: () => void }
const outbound = new Map<string, OutboundCall>()
const phones = new PhoneRouter()
const calls = new Map<string, Call>()

// Outbound calls are serialized so two finishing sessions never ring the
// single analog line at the same time.
let line: Promise<unknown> = Promise.resolve()
function onLine<T>(task: () => Promise<T>): Promise<T> {
  const next = line.then(task, task)
  line = next.catch(() => {})
  return next
}

async function say(call: Call, text: string, session?: Session): Promise<void> {
  if (call.closed || call.skipping) return
  await call.play(await synthesize(text, session))
}

// The beep always plays, even right after a keypress cut the speech short.
async function beepAndListen(call: Call, noSpeechTimeoutMs: number): Promise<Buffer | null> {
  call.resume()
  await call.play(beep)
  return call.listen({ noSpeechTimeoutMs })
}

// While this Mac is locked, prompts and approvals need the PIN, once per call.
async function unlock(call: Call): Promise<boolean> {
  if (call.authorized || !(await isScreenLocked())) return true
  if (!(await pins.stored())) {
    await say(call, 'This Mac is locked and has no PIN set.')
    return false
  }
  for (let attempt = 0; attempt < PIN_ATTEMPTS && !call.closed; attempt++) {
    if (pins.lockedOut()) break
    const digits = call.collectDigits()
    call.resume()
    await say(call, attempt ? 'Try again, then press hash.' : 'This Mac is locked. Enter your PIN, then press hash.')
    const entered = await digits
    if (entered === null) break
    const result = await pins.check(entered)
    if (result === 'ok') {
      log('PIN accepted')
      call.authorized = true
      call.resume()
      await say(call, 'Thanks.')
      return true
    }
    log(`PIN rejected (${result})`)
    if (result !== 'wrong') break
    call.resume()
    await say(call, 'Wrong PIN.')
  }
  if (pins.lockedOut()) {
    call.resume()
    await say(call, 'Too many wrong PINs. Try again later.')
  }
  return false
}

async function captureAndDeliver(call: Call, session: Session, noSpeechTimeoutMs: number): Promise<boolean> {
  if (!(await unlock(call))) {
    call.resume()
    await say(call, 'Okay, bye.')
    await call.hangup()
    return false
  }
  const audio = await beepAndListen(call, noSpeechTimeoutMs)
  if (!audio) {
    const { frames, peakRms } = call.lastListen
    log(`ext ${session.ext} heard nothing: ${frames} audio frames, peak level ${peakRms} (threshold ${process.env.DESKPHONE_VAD_THRESHOLD ?? 500})${call.closed ? ', caller hung up' : ''}`)
    return false
  }
  const text = await transcribe(audio)
  if (!text) {
    await say(call, "Sorry, I didn't catch that.")
    return false
  }
  const delivered = registry.deliver(session, { type: 'prompt', text, ext: session.ext })
  log(`ext ${session.ext} heard${delivered ? '' : ' (session not connected, queued)'}:`, text)
  await say(call, 'Got it.')
  return true
}

function voicemailChanged(): void {
  void asterisk.setMessageWaiting(registry.voicemailCount())
  voicemailStore.save(registry.snapshot()).catch(err => log('saving voicemail failed:', (err as Error).message))
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function pruneSessions(): void {
  const dead = registry.prune(isAlive)
  for (const session of dead) log(`ext ${session.ext}: pid ${session.pid} exited, unregistered`)
  if (dead.length) voicemailChanged()
}

async function pushDevices(): Promise<void> {
  for (const device of devices.list()) {
    await asterisk.addDevice(device.name, device.password).catch(err => log(`adding phone ${device.name} failed:`, (err as Error).message))
  }
}

function onAsteriskConnect(): void {
  voicemailChanged()
  void pushDevices()
}

async function handleInbound(call: Call, ext: number): Promise<void> {
  pruneSessions()
  if (ext === VOICEMAIL_EXT) return playVoicemail(call)
  const session = registry.byExt(ext)
  if (!session) {
    await say(call, `There is no Claude session on extension ${ext}.`)
    return
  }
  if (session.voicemail.length) {
    while (session.voicemail.length && !call.closed && !call.skipping) {
      const message = session.voicemail.shift()!
      await say(call, message.text, session)
      if (call.closed) session.voicemail.unshift(message)
    }
    voicemailChanged()
  } else {
    // Played replies were just heard, so only recap when there were none.
    const recap = await recapFor(session)
    const intro = phrases(recap?.lang ?? 'en').extension(ext, basename(session.cwd))
    await say(call, `Claude, ${intro}.${recap ? ` ${recap.text}` : ''}`)
  }
  await captureAndDeliver(call, session, 15000)
}

// Claude Code's own recap when it's newer than the last reply, else the reply.
async function recapFor(session: Session): Promise<{ text: string; lang: string } | null> {
  const recap = session.transcriptPath ? await latestRecap(session.transcriptPath) : null
  if (recap && (!session.lastReply || recap.at > session.lastReply.at)) {
    const lang = await detectLanguage(proseOf(recap.text), session.language)
    return { text: `${phrases(lang).recap} ${toSpeech(recap.text, undefined, lang)}`, lang }
  }
  const last = session.lastReply
  return last ? { text: `${phrases(last.lang).lastTime} ${last.text}`, lang: last.lang } : null
}

// Every missed reply across all sessions, oldest first, each with a chance
// to answer that session before moving on.
async function playVoicemail(call: Call): Promise<void> {
  const count = registry.voicemailCount()
  if (!count) return say(call, 'No new messages.')
  await say(call, count === 1 ? 'One new message.' : `${count} new messages.`)
  for (let next; !call.closed && (next = registry.takeOldestVoicemail()); ) {
    const { session, message } = next
    await say(call, `${phrases(message.lang).extension(session.ext, basename(session.cwd))}. ${message.text}`)
    if (call.closed) {
      session.voicemail.unshift(message)
      break
    }
    voicemailChanged()
    // A session that never came back after a restart has nobody to answer.
    if (registry.isLive(session)) await captureAndDeliver(call, session, REPLY_WAIT_MS)
  }
  voicemailChanged()
  await say(call, 'No more messages.')
}

// A reply can finish while the call that asked for it is still saying
// "Got it", and ringing a busy line fails at once.
async function lineFree(timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (calls.size > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 500))
}

// Rings the phone for a session. answered runs once it's picked up; missed
// runs when it isn't (or the caller gives up via signal) and supplies the result.
function callPhone<T>(
  session: Session,
  answered: (call: Call) => Promise<T>,
  missed: (reason: string) => T,
  signal?: AbortSignal,
): Promise<T> {
  return onLine(async () => {
    await lineFree()
    if (signal?.aborted) return missed('cancelled')
    return new Promise<T>(resolve => {
      const callId = randomBytes(6).toString('hex')
      const channelId = OUTBOUND_PREFIX + callId
      const giveUp = (reason: string) => {
        if (!outbound.has(callId)) return
        clearTimeout(timer)
        outbound.delete(callId)
        signal?.removeEventListener('abort', cancel)
        void asterisk.hangup(channelId)
        resolve(missed(reason))
      }
      const cancel = () => giveUp('cancelled')
      const timer = setTimeout(() => giveUp('no answer'), (RING_SECONDS + 10) * 1000)
      signal?.addEventListener('abort', cancel, { once: true })

      outbound.set(callId, {
        missed: () => giveUp('no answer'),
        answered: async call => {
          clearTimeout(timer)
          outbound.delete(callId)
          signal?.removeEventListener('abort', cancel)
          let result: T | undefined
          try {
            result = await answered(call)
          } finally {
            resolve(result as T)
          }
        },
      })

      asterisk.originate(phones.target(session.phone), channelId, session.ext, callId, RING_SECONDS).catch(err => giveUp(`originate failed (${err.message})`))
    })
  })
}

function ring(session: Session, text: string, lang: string): Promise<void> {
  return callPhone(
    session,
    async call => {
      await say(call, text, session)
      const replied = await captureAndDeliver(call, session, REPLY_WAIT_MS)
      if (!replied) await say(call, 'Okay, bye.')
    },
    reason => {
      registry.leaveVoicemail(session, text, lang)
      voicemailChanged()
      log(`ext ${session.ext}: ${reason}, left voicemail (${registry.voicemailCount()} waiting)`)
    },
  )
}

// Asks by phone whether Claude may go ahead. null leaves the decision to the
// prompt on screen: no answer, an unclear answer, or answered there first.
// Claude's multiple-choice questions, one after another. null if any goes
// unanswered, so the dialog stays on screen.
async function askQuestions(session: Session, questions: Question[], signal: AbortSignal): Promise<Record<string, string> | null> {
  const lang = await detectLanguage(questions.map(q => q.question).join(' '), session.language)
  const phrase = phrases(lang)
  return callPhone<Record<string, string> | null>(
    session,
    async call => {
      await say(call, `${phrase.extension(session.ext, basename(session.cwd))}, ${phrase.questions(questions.length)}`)
      const answers: Record<string, string> = {}
      for (const q of questions) {
        call.resume()
        await say(call, speakQuestion(q, lang))
        if (!(await unlock(call))) break
        call.resume()
        await call.play(beep)
        const input = await call.speechOrKeys({ noSpeechTimeoutMs: REPLY_WAIT_MS }, q.multiSelect ? { terminator: '#', max: 9 } : { max: 1 })
        let choice: Choice | null = null
        if (input && 'keys' in input) choice = parseKeyedChoice(input.keys, q)
        else if (input) choice = parseSpokenChoice(await transcribe(input.audio), q)
        call.resume()
        if (!choice) {
          await say(call, "I'll leave it on screen.")
          log(`ext ${session.ext}: question unanswered, left on screen`)
          return null
        }
        answers[q.question] = answerText(choice, q)
        await say(call, `Got it: ${answers[q.question]}.`)
      }
      if (Object.keys(answers).length < questions.length) return null
      log(`ext ${session.ext}: answered ${questions.length} question(s) by phone`)
      return answers
    },
    reason => {
      log(`ext ${session.ext}: question call ${reason}, left on screen`)
      return null
    },
    signal,
  )
}

function askPermission(session: Session, request: string, signal: AbortSignal): Promise<Decision> {
  return callPhone<Decision>(
    session,
    async call => {
      await say(call, `Extension ${session.ext}, ${basename(session.cwd)}, needs permission to ${request}. Say yes to allow, or no to deny.`)
      if (!(await unlock(call))) {
        call.resume()
        await say(call, "I'll leave it on screen.")
        return null
      }
      const audio = await beepAndListen(call, REPLY_WAIT_MS)
      const decision = audio ? parseDecision(await transcribe(audio)) : null
      await say(call, decision === 'allow' ? 'Allowed.' : decision === 'deny' ? 'Denied.' : "I'll leave it on screen.")
      log(`ext ${session.ext}: permission to ${request}: ${decision ?? 'no decision'}`)
      return decision
    },
    reason => {
      log(`ext ${session.ext}: permission call ${reason}, left on screen`)
      return null
    },
    signal,
  )
}

async function runCall(channelId: string, channelName: string, direction: string, arg: string): Promise<void> {
  let call: Call | undefined
  try {
    if (direction === 'inbound') {
      phones.used(channelName)
      await asterisk.answer(channelId)
    }
    call = new Call(() => asterisk.teardown(channelId))
    calls.set(channelId, call)
    await asterisk.attachMedia(channelId, call.attach)
    if (direction === 'inbound') {
      log(`inbound call to ext ${arg}`)
      await handleInbound(call, Number(arg))
    } else {
      await outbound.get(arg)?.answered(call)
    }
  } catch (err) {
    log('call failed:', (err as Error).message)
    if (call) await say(call, 'Something went wrong on the laptop.').catch(() => {})
  } finally {
    calls.delete(channelId)
    if (call) await call.hangup()
    else await asterisk.teardown(channelId)
  }
}

async function onEvent(event: AriEvent): Promise<void> {
  const channel = event.channel
  if (!channel) return
  if (event.type === 'StasisStart') {
    // The media channels this daemon creates also enter the app, without args.
    const [direction, arg] = event.args ?? []
    if (direction === 'inbound' || direction === 'outbound') await runCall(channel.id, channel.name, direction, arg)
  } else if (event.type === 'ChannelDtmfReceived') {
    if (event.digit) calls.get(channel.id)?.keypress(event.digit)
  } else if (event.type === 'StasisEnd' || event.type === 'ChannelDestroyed') {
    calls.get(channel.id)?.markClosed()
    if (event.type === 'ChannelDestroyed' && channel.id.startsWith(OUTBOUND_PREFIX)) {
      outbound.get(channel.id.slice(OUTBOUND_PREFIX.length))?.missed()
    }
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (req.method === 'POST' && url.pathname === '/register') {
      const { pid, cwd, ext, phone } = await readJson(req)
      pruneSessions()
      const session = registry.register(Number(pid), String(cwd ?? ''), ext ? Number(ext) : undefined)
      if (phone !== undefined) session.phone = phone ? toEndpoint(String(phone)) : null
      log(`registered pid ${session.pid} as ext ${session.ext} (${session.cwd})${session.phone ? `, pinned to ${session.phone}` : ''}`)
      return send(res, 200, { ext: session.ext, phone: session.phone })
    }
    if (req.method === 'GET' && url.pathname === '/phones') {
      const names = [...STATIC_DEVICES, ...devices.list().map(d => d.name)]
      const phones = await Promise.all(names.map(async name => ({ name, state: await asterisk.deviceState(name), static: STATIC_DEVICES.includes(name) })))
      return send(res, 200, { phones, server: asterisk.active ? new URL(asterisk.active).hostname : null })
    }
    if (req.method === 'POST' && url.pathname === '/phones') {
      const device = await devices.add(String((await readJson(req)).name ?? ''))
      await asterisk.addDevice(device.name, device.password).catch(err => log(`adding phone ${device.name} failed:`, (err as Error).message))
      log(`added phone ${device.name}`)
      return send(res, 200, { ...device, username: device.name, server: asterisk.active ? new URL(asterisk.active).hostname : null })
    }
    if (req.method === 'POST' && url.pathname === '/phones/remove') {
      const name = String((await readJson(req)).name ?? '')
      const removed = await devices.remove(name)
      if (removed) {
        await asterisk.removeDevice(name)
        log(`removed phone ${name}`)
      }
      return send(res, 200, { removed })
    }
    if (req.method === 'POST' && url.pathname === '/unregister') {
      const { pid } = await readJson(req)
      const removed = registry.unregister(Number(pid))
      if (removed) voicemailChanged()
      return send(res, 200, { removed })
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      const { pid, text, transcript } = await readJson(req)
      const session = registry.get(Number(pid))
      if (!session) return send(res, 404, { error: 'session not registered' })
      const lang = await detectLanguage(proseOf(String(text ?? '')), session.language)
      const speech = toSpeech(String(text ?? ''), undefined, lang)
      if (!speech) return send(res, 200, { skipped: true })
      session.lastReply = { text: speech, at: Date.now(), lang }
      if (typeof transcript === 'string') session.transcriptPath = transcript
      log(`ext ${session.ext}: turn finished, ringing`)
      void ring(session, speech, lang)
      return send(res, 202, { ringing: session.ext })
    }
    if (req.method === 'POST' && url.pathname === '/permission') {
      const { pid, tool_name, tool_input } = await readJson(req)
      const session = registry.get(Number(pid))
      if (!session) return send(res, 404, { error: 'session not registered' })
      // The hook process ends when the prompt is answered on screen; stop ringing then.
      const answeredElsewhere = new AbortController()
      res.on('close', () => answeredElsewhere.abort())
      if (tool_name === 'AskUserQuestion' && Array.isArray(tool_input?.questions)) {
        log(`ext ${session.ext}: asking ${tool_input.questions.length} question(s)`)
        const answers = await askQuestions(session, tool_input.questions, answeredElsewhere.signal)
        if (!answers) return send(res, 200, { decision: null })
        return send(res, 200, { decision: 'allow', updatedInput: { ...tool_input, answers } })
      }
      const request = describePermission(String(tool_name ?? ''), tool_input ?? {})
      log(`ext ${session.ext}: asking permission to ${request}`)
      const decision = await askPermission(session, request, answeredElsewhere.signal)
      return send(res, 200, { decision })
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      const session = registry.get(Number(url.searchParams.get('pid')))
      if (!session) return send(res, 404, { error: 'session not registered' })
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
      const detach = registry.attach(session, event => res.write(`data: ${JSON.stringify(event)}\n\n`))
      req.on('close', () => {
        clearInterval(keepAlive)
        detach()
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      return send(res, 200, {
        asterisk: asterisk.active,
        sessions: registry.list().map(s => ({ pid: s.pid, ext: s.ext, cwd: s.cwd, phone: s.phone, voicemail: s.voicemail.length, connected: !!s.listener })),
      })
    }
    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 400, { error: (err as Error).message })
  }
})

registry.restore(await voicemailStore.load())
if (registry.voicemailCount()) log(`restored ${registry.voicemailCount()} voicemail message(s)`)
setInterval(pruneSessions, 30_000).unref()
httpServer.listen(HTTP_PORT, '127.0.0.1', () => log(`control API on http://127.0.0.1:${HTTP_PORT}`))
await devices.load()
void asterisk.connect(log, onAsteriskConnect)
