# Daemon Standalone Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the daemon so the hosted multi-user mode can be added without rewriting it, while the laptop setup behaves exactly as today.

**Architecture:** Step 1 of the hosted-hub design (§8). Pure pieces come out of `src/daemon/index.ts` into small modules (`mode`, `numbering`, `http`, `line`, `accounts`, `speech/`), every dialed number enters Stasis so the daemon decides what it is, phone-to-phone calls are handed back to a `[phone-to-phone]` dialplan context, message-waiting works per phone, and reply audio is synthesized before the phone is dialed. Standalone ranges (101–199, 1001+) and the macOS `say`/`whisper-cli` backends stay.

**Tech Stack:** Node ≥ 23.6 (type stripping: no enums, no parameter properties, `.ts` imports), `node:test`, Asterisk 22 ARI, Docker for the smoke test.

**Spec:** `docs/superpowers/specs/2026-10-29-hosted-hub-design.md` (sections "Calls I made", 2, 8)

## Global Constraints

- No user-visible behaviour change in standalone mode: extensions 101–199, `100#` menu, phones 1001+, `say` + `whisper-cli`, PIN while the Mac is locked, pid-based pruning.
- Node type stripping only: no `enum`, no constructor parameter properties, relative imports end in `.ts`.
- Comments only for a non-obvious *why*; match the existing terse style.
- Conventional Commits; check the GPG key with `gpg-connect-agent 'keyinfo --list' /bye 2>/dev/null | awk '$7==1 {found=1} END {exit !found}'` and use `git commit --no-gpg-sign` when it exits non-zero. Never trigger a passphrase prompt.
- `asterisk/config/` stays the single source of Asterisk config; the Flux repo mirrors `extensions.conf`/`pjsip.conf` (Task 10).
- RTP range stays 10000–10019 in this step (widening is deployment work, spec §5/§6).

## Review Focus

1. A dialed number that is neither 100, a session, nor a phone (e.g. `0`, `99`, `2000`, `01` with a leading zero) must end in a congestion tone, never a hang Stasis channel — Task 1 (`classify` unknown cases) and Task 6 (`hangupWith('congestion')`).
2. An inbound call from an endpoint the daemon does not know (e.g. a `Local/` channel from `npm run fake-call` without the fake-caller flag) must be hung up, not answered — Task 6 test `rejects a caller that is not a phone`.
3. A keypress during a pre-generated greeting must still skip to the beep — Task 7 keeps `play()` honouring `call.skipping`; verified with `npm run fake-call` and a real phone.
4. The desk phone (static account, no password known to the daemon) must appear in `/phones` and be callable at 1001 without being pushed to Asterisk — Task 5 test `does not push the static desk phone`.
5. Two outbound callbacks to *different* phones must not block each other, but two to the same phone must be serialised — Task 4 tests.

---

### Task 1: `mode.ts` and `numbering.ts`

**Files:**
- Create: `src/daemon/mode.ts`
- Create: `src/daemon/numbering.ts`
- Modify: `src/daemon/registry.ts:17-21,112-124` (ranges from `mode.ts`, `MENU_EXT`)
- Modify: `src/daemon/devices.ts:10-13,66-70` (ranges from `mode.ts`)
- Modify: `src/daemon/index.ts:13,154` (`MENU_EXT`)
- Test: `test/numbering.test.ts`

**Interfaces:**
- Produces (`mode.ts`): `type Range = { first: number; last: number }`, `type Ranges = { sessions: Range; phones: Range }`, `const MENU_EXT = 100`, `const STANDALONE: Ranges = { sessions: { first: 101, last: 199 }, phones: { first: 1001, last: 1999 } }`, `const HOSTED: Ranges = { sessions: { first: 101, last: 9999 }, phones: { first: 10000, last: 99999 } }`, `const RANGES: Ranges = STANDALONE` (step 3 switches it on `DESKPHONE_MODE`).
- Produces (`numbering.ts`): `type Dialed = { kind: 'menu' } | { kind: 'session'; ext: number } | { kind: 'phone'; number: number } | { kind: 'unknown' }`, `function classify(dialed: string, ranges: Ranges): Dialed`.
- Produces (`registry.ts`): `new Registry(range: Range = RANGES.sessions)`; `VOICEMAIL_EXT`, `FIRST_EXT`, `LAST_EXT` are removed.
- Produces (`devices.ts`): `DESK_PHONE = { name: 'phone', number: RANGES.phones.first }`; numbers allocated from `RANGES.phones.first + 1` to `RANGES.phones.last`.

- [ ] **Step 1: Write the failing test**

```ts
// test/numbering.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOSTED, STANDALONE } from '../src/daemon/mode.ts'
import { classify } from '../src/daemon/numbering.ts'

test('classifies standalone numbers', () => {
  assert.deepEqual(classify('100', STANDALONE), { kind: 'menu' })
  assert.deepEqual(classify('101', STANDALONE), { kind: 'session', ext: 101 })
  assert.deepEqual(classify('199', STANDALONE), { kind: 'session', ext: 199 })
  assert.deepEqual(classify('1001', STANDALONE), { kind: 'phone', number: 1001 })
  assert.deepEqual(classify('1999', STANDALONE), { kind: 'phone', number: 1999 })
})

test('classifies hosted numbers', () => {
  assert.deepEqual(classify('1002', HOSTED), { kind: 'session', ext: 1002 })
  assert.deepEqual(classify('9999', HOSTED), { kind: 'session', ext: 9999 })
  assert.deepEqual(classify('10000', HOSTED), { kind: 'phone', number: 10000 })
})

test('everything else is unknown', () => {
  for (const dialed of ['', '0', '99', '200', '2000', '01', '0101', '1a', '*', '100000']) {
    assert.deepEqual(classify(dialed, STANDALONE), { kind: 'unknown' }, dialed)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/numbering.test.ts`
Expected: FAIL, cannot find module `mode.ts`

- [ ] **Step 3: Implement `mode.ts` and `classify(dialed, ranges)` in `numbering.ts`**

`classify` accepts only `/^[1-9]\d*$/`; `MENU_EXT` first, then the session range, then the phone range.

- [ ] **Step 4: Point `registry.ts` and `devices.ts` at `mode.ts`**

`Registry` gets `private readonly range: Range` set in the constructor (default `RANGES.sessions`) and `allocate()` uses it; delete `VOICEMAIL_EXT`, `FIRST_EXT`, `LAST_EXT`. `devices.ts` imports `RANGES` for `DESK_PHONE.number` and `freeNumber()`. `index.ts` imports `MENU_EXT` from `mode.ts` instead of `VOICEMAIL_EXT`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all pass (existing registry/devices tests still assert 101, 150, 1002, 1003)

- [ ] **Step 6: Commit**

```bash
git add src/daemon/mode.ts src/daemon/numbering.ts src/daemon/registry.ts src/daemon/devices.ts src/daemon/index.ts test/numbering.test.ts
git commit -m "refactor: number ranges and dialed-number classification in one place"
```

---

### Task 2: `speech/` split

**Files:**
- Create: `src/shared/run.ts` (from `tts.ts:84-96`)
- Create: `src/daemon/speech/language.ts` (from `tts.ts:14-52`)
- Create: `src/daemon/speech/say.ts` (from `tts.ts:7-12,54-82,100-112`)
- Create: `src/daemon/speech/ffmpeg.ts`
- Create: `src/daemon/speech/whisper-cli.ts` (from `stt.ts`)
- Create: `src/daemon/speech/index.ts`
- Modify: `src/daemon/audio.ts` (add `tone`, from `tts.ts:114-121`)
- Delete: `src/daemon/tts.ts`, `src/daemon/stt.ts`
- Modify: `src/daemon/index.ts:15-16,31` (imports)
- Modify tests: `test/tts.test.ts` → rename to `test/speech.test.ts`, `test/vad.test.ts:5`, `test/speech-text.test.ts:4`

**Interfaces:**
- Produces (`shared/run.ts`): `function run(cmd: string, args: string[]): Promise<Buffer>` (unchanged body).
- Produces (`speech/language.ts`): `type Hypotheses = Record<string, number>`, `type Detector = (text: string) => Promise<Hypotheses>`, `type LanguageGuess = { language: string; confident: boolean }`, `chooseLanguage(hypotheses, preferred): LanguageGuess` and `preferredLanguages(hint, env): string[]` unchanged, `const macosDetector: Detector` (the osascript call), `guessLanguage(text: string, hint?: string | null, detector: Detector = macosDetector): Promise<LanguageGuess>`, `detectLanguage(text: string, hint?: string | null): Promise<string>`.
- Produces (`speech/say.ts`): `type Voice`, `parseVoices`, `pickVoice` unchanged; `speakWithSay(text: string, lang: string): Promise<Buffer>` returning phone PCM (voice choice as in today's `voiceFor`).
- Produces (`speech/ffmpeg.ts`): `toPhonePcm(inputPath: string): Promise<Buffer>` (band-pass 300–3400 Hz, s16le mono `SAMPLE_RATE`), `pcmToWav16k(pcm: Buffer, wavPath: string): Promise<void>`.
- Produces (`speech/whisper-cli.ts`): `transcribeWithWhisperCli(pcm: Buffer): Promise<string>`, `cleanTranscript(text: string): string` unchanged.
- Produces (`speech/index.ts`): `synthesize(text: string, session?: { language: string | null }): Promise<Buffer>` (language memory as today, then `speakWithSay`), `transcribe(pcm: Buffer): Promise<string>`, re-exports `detectLanguage`.
- Produces (`audio.ts`): `tone(freq = 880, ms = 180, amplitude = 6000): Buffer`.

- [ ] **Step 1: Add a test for the detector seam**

Append to `test/speech.test.ts` (the renamed `test/tts.test.ts`, imports updated to `../src/daemon/speech/language.ts` and `../src/daemon/speech/say.ts`):

```ts
test('guessLanguage uses the injected detector', async () => {
  const guess = await guessLanguage('Gepusht.', 'nl', async () => ({ nl: 0.95 }))
  assert.deepEqual(guess, { language: 'nl', confident: true })
  const fallback = await guessLanguage('Ok.', 'nl', async () => ({ pl: 0.4, nl: 0.3 }))
  assert.deepEqual(fallback, { language: 'nl', confident: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/speech.test.ts`
Expected: FAIL, cannot find module `speech/language.ts`

- [ ] **Step 3: Move the code**

Create the files listed above by moving code, not rewriting it. `index.ts` imports `synthesize, transcribe, detectLanguage` from `./speech/index.ts` and `tone` from `./audio.ts`. Fix `test/vad.test.ts` (`tone` from `audio.ts`) and `test/speech-text.test.ts` (`cleanTranscript` from `speech/whisper-cli.ts`).

- [ ] **Step 4: Run the suite and a syntax check**

Run: `npm test && node --check src/daemon/index.ts`
Expected: all pass; no references to `tts.ts`/`stt.ts` remain (`grep -rn "tts.ts\|stt.ts" src test scripts` prints nothing)

- [ ] **Step 5: Commit**

```bash
git add -A src/daemon/speech src/shared/run.ts src/daemon/audio.ts src/daemon/index.ts test
git rm -q src/daemon/tts.ts src/daemon/stt.ts
git commit -m "refactor: split speech into language, say, whisper and ffmpeg modules"
```

---

### Task 3: `http.ts` helpers

**Files:**
- Create: `src/daemon/http.ts`
- Modify: `src/daemon/index.ts:403-412,414-415,484-496` (use the helpers)
- Test: `test/http.test.ts`

**Interfaces:**
- Produces: `const PATH_PREFIX = '/rt'`; `stripPrefix(pathname: string): string`; `readJson(req: IncomingMessage): Promise<any>` and `send(res: ServerResponse, status: number, body: unknown): void` (moved from `index.ts`); `type Sse = { write(event: unknown): void; end(final?: unknown): void }`; `openSse(req: IncomingMessage, res: ServerResponse, onClose: () => void): Sse` (writes the headers and `: connected`, pings `: ping` every 15 s, clears the timer and calls `onClose` when the request closes; `end(final)` writes `data: <json>` then ends the response).

- [ ] **Step 1: Write the failing tests**

```ts
// test/http.test.ts
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { openSse, stripPrefix } from '../src/daemon/http.ts'

test('strips the /rt prefix and leaves other paths alone', () => {
  assert.equal(stripPrefix('/rt/register'), '/register')
  assert.equal(stripPrefix('/rt'), '/')
  assert.equal(stripPrefix('/register'), '/register')
  assert.equal(stripPrefix('/rtx'), '/rtx')
})

test('an SSE stream can be ended with a final event', async () => {
  const server = createServer((req, res) => {
    const sse = openSse(req, res, () => {})
    sse.write({ type: 'prompt', text: 'hi' })
    sse.end({ type: 'disconnected', reason: 'user' })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  const body = await (await fetch(`http://127.0.0.1:${port}/events`)).text()
  server.close()
  assert.match(body, /^: connected\n\n/)
  assert.ok(body.includes('data: {"type":"prompt","text":"hi"}\n\n'))
  assert.ok(body.endsWith('data: {"type":"disconnected","reason":"user"}\n\n'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/http.test.ts`
Expected: FAIL, cannot find module `http.ts`

- [ ] **Step 3: Implement `http.ts` and use it in `index.ts`**

In `index.ts`: `const url = new URL(req.url ?? '/', 'http://localhost'); const path = stripPrefix(url.pathname)` and match on `path`; the `/events` route becomes `const sse = openSse(req, res, detach-and-cleanup)` with `registry.attach(session, event => sse.write(event))`.

- [ ] **Step 4: Run the suite**

Run: `npm test && node --check src/daemon/index.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/daemon/http.ts src/daemon/index.ts test/http.test.ts
git commit -m "refactor: http helpers with /rt prefix and SSE end event"
```

---

### Task 4: `line.ts`, per-endpoint call serialisation

**Files:**
- Create: `src/daemon/line.ts`
- Modify: `src/daemon/index.ts:39-48,224-275,360-384` (replace `line`/`onLine`/`lineFree`; keep `calls` for DTMF routing only)
- Test: `test/line.test.ts`

**Interfaces:**
- Produces: `class Lines { hold(endpoint: string): () => void; busy(endpoint: string): boolean; whenFree(endpoint: string, timeoutMs?: number): Promise<void>; serialize<T>(endpoint: string, task: () => Promise<T>): Promise<T> }`. `hold` marks a call active and returns its release function (idempotent). `whenFree` resolves as soon as the endpoint has no active calls, or after `timeoutMs` (default 60 000). `serialize` runs tasks for the same endpoint one after another (a rejected task doesn't block the next) and tasks for different endpoints concurrently.
- Consumes: `phoneOfChannel(name)` from `src/daemon/phones.ts` to find the inbound endpoint; `phones.target(...)` for the outbound one.

- [ ] **Step 1: Write the failing tests**

```ts
// test/line.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Lines } from '../src/daemon/line.ts'

const tick = () => new Promise(r => setTimeout(r, 5))

test('serialises calls to the same endpoint and runs other endpoints concurrently', async () => {
  const lines = new Lines()
  const order: string[] = []
  const slow = (name: string) => async () => { order.push(`${name} start`); await tick(); order.push(`${name} end`) }
  await Promise.all([
    lines.serialize('PJSIP/phone', slow('a')),
    lines.serialize('PJSIP/phone', slow('b')),
    lines.serialize('PJSIP/laptop', slow('c')),
  ])
  assert.ok(order.indexOf('a end') < order.indexOf('b start'))
  assert.ok(order.indexOf('c start') < order.indexOf('a end'))
})

test('a failing task does not block the next one', async () => {
  const lines = new Lines()
  await assert.rejects(lines.serialize('PJSIP/phone', async () => { throw new Error('boom') }))
  assert.equal(await lines.serialize('PJSIP/phone', async () => 42), 42)
})

test('whenFree waits for the hold to be released, with a timeout', async () => {
  const lines = new Lines()
  const release = lines.hold('PJSIP/phone')
  assert.equal(lines.busy('PJSIP/phone'), true)
  let freed = false
  const waiting = lines.whenFree('PJSIP/phone').then(() => (freed = true))
  await tick()
  assert.equal(freed, false)
  release()
  release()
  await waiting
  assert.equal(lines.busy('PJSIP/phone'), false)
  const stuck = lines.hold('PJSIP/laptop')
  const started = Date.now()
  await lines.whenFree('PJSIP/laptop', 30)
  assert.ok(Date.now() - started >= 25)
  stuck()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/line.test.ts`
Expected: FAIL, cannot find module `line.ts`

- [ ] **Step 3: Implement `Lines` and wire it into `index.ts`**

`const lines = new Lines()`. In `runCall`, for inbound calls `const release = lines.hold(phoneOfChannel(channelName) ?? channelName)` and release in `finally`. `callPhone` becomes `lines.serialize(target, async () => { await lines.whenFree(target); ...originate... })` where `target = phones.target(session.phone)` is computed once; the outbound `Call` holds `target` from `answered` until it ends. Remove `line`, `onLine`, `lineFree` and the comment above them.

- [ ] **Step 4: Run the suite**

Run: `npm test && node --check src/daemon/index.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/daemon/line.ts src/daemon/index.ts test/line.test.ts
git commit -m "refactor: serialise calls per phone instead of one global line"
```

---

### Task 5: `accounts.ts` with `FileAccounts`

**Files:**
- Create: `src/daemon/accounts.ts`
- Modify: `src/daemon/index.ts:19,29,140-145,425-446` (use `accounts` instead of `devices` + `DESK_PHONE`)
- Test: `test/accounts.test.ts`

**Interfaces:**
- Produces: `type Account = { username: string; number: number; label: string; ownerId: string; password: string | null }` (`password: null` = static account in `pjsip.conf`, not pushed). `interface AccountSource { list(): Account[]; byUsername(username: string): Account | null; byNumber(number: number): Account | null; byEndpoint(endpoint: string): Account | null; primaryOf(ownerId: string): Account | null }` where `byEndpoint` accepts `'PJSIP/laptop'`, `'laptop'` or a channel name like `'PJSIP/laptop-0000001a'` (via `phoneOfChannel`). `const LOCAL_OWNER = 'local'`. `class FileAccounts implements AccountSource { constructor(store: DeviceStore, deskPhone?: { name: string; number: number }); add(label: string): Promise<Account>; remove(username: string): Promise<boolean>; pushTo(asterisk: { addDevice(username: string, password: string, number: number, label: string): Promise<void> }): Promise<void> }`. The desk phone is `{ username: 'phone', number: DESK_PHONE.number, label: 'phone', ownerId: 'local', password: null }` and is `primaryOf('local')`; dynamic devices map `name → username = label`.
- Consumes: `DeviceStore`, `DESK_PHONE` from `devices.ts`; `phoneOfChannel` from `phones.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/accounts.test.ts
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FileAccounts, LOCAL_OWNER } from '../src/daemon/accounts.ts'
import { DeviceStore } from '../src/daemon/devices.ts'

async function accounts() {
  const store = new DeviceStore(join(await mkdtemp(join(tmpdir(), 'deskphone-accounts-')), 'phones.json'))
  await store.load()
  return new FileAccounts(store)
}

test('the desk phone is the static primary account', async () => {
  const a = await accounts()
  assert.deepEqual(a.list().map(x => [x.username, x.number, x.password]), [['phone', 1001, null]])
  assert.equal(a.primaryOf(LOCAL_OWNER)?.username, 'phone')
  assert.equal(a.byEndpoint('PJSIP/phone-00000002')?.number, 1001)
  assert.equal(a.byEndpoint('Local/fake@deskphone-test-0001;1'), null)
})

test('added phones are numbered, found by number and endpoint, and removable', async () => {
  const a = await accounts()
  const laptop = await a.add('laptop')
  assert.equal(laptop.number, 1002)
  assert.equal(laptop.ownerId, LOCAL_OWNER)
  assert.equal(a.byNumber(1002)?.username, 'laptop')
  assert.equal(a.byEndpoint('laptop')?.label, 'laptop')
  assert.equal(await a.remove('laptop'), true)
  assert.equal(a.byNumber(1002), null)
})

test('does not push the static desk phone', async () => {
  const a = await accounts()
  await a.add('laptop')
  const pushed: string[] = []
  await a.pushTo({ addDevice: async (username, password, number, label) => { pushed.push(`${username}:${number}:${label}:${password.length}`) } })
  assert.deepEqual(pushed, ['laptop:1002:laptop:24'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/accounts.test.ts`
Expected: FAIL, cannot find module `accounts.ts`

- [ ] **Step 3: Implement `FileAccounts` and use it in `index.ts`**

`const accounts = new FileAccounts(devices)`; `pushDevices()` becomes `accounts.pushTo(asterisk)` (per-device `.catch` + log stays inside `pushTo` via a second optional `onError` parameter, or log inside `pushTo`: pick one and keep the log line `adding phone <name> failed:`). `/phones` GET maps `accounts.list()` to `{ name: username, number, state, static: password === null }`; POST `/phones` → `accounts.add(name)` then `asterisk.addDevice(...)`; `/phones/remove` → `accounts.remove(name)` then `asterisk.removeDevice(name)` (the `setNumber` call goes in Task 6).

- [ ] **Step 4: Run the suite**

Run: `npm test && node --check src/daemon/index.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/daemon/accounts.ts src/daemon/index.ts test/accounts.test.ts
git commit -m "refactor: phone accounts behind one interface"
```

---

### Task 6: Everything through Stasis; phone-to-phone by `continue`; MWI per phone

**Files:**
- Modify: `src/daemon/ari.ts:9-14,139-179` (`AriEvent.channel.channelvars`, remove `setNumber`, new calls)
- Modify: `asterisk/config/extensions.conf` (`[from-phone]`, `[phone-to-phone]`, `[deskphone-mwi]`)
- Modify: `asterisk/config/pjsip.conf:1-4` (drop `default_outbound_endpoint`)
- Modify: `asterisk/config/ari.conf` (`channelvars=DESKPHONE_AS`)
- Modify: `src/daemon/index.ts:120-123,152-159,360-401` (`voicemailChanged`, inbound classification, `onEvent`)
- Modify: `scripts/fake-call.ts` (`--as <username>` → `variables.DESKPHONE_AS`)
- Create: `src/daemon/inbound.ts`
- Test: `test/inbound.test.ts`

**Interfaces:**
- Produces (`ari.ts`): `AriEvent.channel` gains `channelvars?: Record<string, string>`; `setVariable(channelId: string, variable: string, value: string): Promise<void>` (`POST /channels/{id}/variable`); `continueInDialplan(channelId: string, context: string, extension: string): Promise<void>` (`POST /channels/{id}/continue?context&extension&priority=1`); `hangupWith(channelId: string, reason: 'normal' | 'busy' | 'congestion' | 'no_answer' | 'rejected'): Promise<void>` (`DELETE /channels/{id}?reason=`, errors swallowed like `hangup`); `setMessageWaiting(endpoint: string, count: number): Promise<void>` (originates `Local/${count}@deskphone-mwi` with body `{ variables: { MWI_ENDPOINT: endpoint } }`); `addDevice(username: string, password: string, number: number, label: string)` (callerid `"${label}" <${number}>`, no `setNumber`); `originate(endpoint: string, channelId: string, appArgs: string, callerId: string, timeoutSeconds: number)`. `setNumber` is deleted.
- Produces (`inbound.ts`): `type InboundPlan = { action: 'reject' } | { action: 'congestion' } | { action: 'answer'; dialed: Dialed } | { action: 'dial'; caller: Account; callee: Account }`; `planInbound(channelName: string, dialed: string, fakeCaller: string | undefined, accounts: AccountSource, ranges: Ranges, trustFakeCaller: boolean): InboundPlan`. Rules: caller = `accounts.byEndpoint(channelName)`, or `accounts.byUsername(fakeCaller)` when `trustFakeCaller` and `fakeCaller` is set; no caller → `reject`; `classify` unknown → `congestion`; `phone` → callee `accounts.byNumber(number)`; no callee → `congestion`; else `dial` (standalone: always allowed); `menu`/`session` → `answer`.
- Consumes: `classify`, `RANGES` (Task 1); `AccountSource`, `Account` (Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
// test/inbound.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Account, AccountSource } from '../src/daemon/accounts.ts'
import { planInbound } from '../src/daemon/inbound.ts'
import { STANDALONE } from '../src/daemon/mode.ts'

const phone: Account = { username: 'phone', number: 1001, label: 'Office', ownerId: 'local', password: null }
const laptop: Account = { username: 'laptop', number: 1002, label: 'laptop', ownerId: 'local', password: 'x' }
const accounts: AccountSource = {
  list: () => [phone, laptop],
  byUsername: u => [phone, laptop].find(a => a.username === u) ?? null,
  byNumber: n => [phone, laptop].find(a => a.number === n) ?? null,
  byEndpoint: e => [phone, laptop].find(a => e.startsWith(`PJSIP/${a.username}`)) ?? null,
  primaryOf: () => phone,
}

test('rejects a caller that is not a phone', () => {
  assert.deepEqual(planInbound('Local/fake@deskphone-test-0001;1', '101', undefined, accounts, STANDALONE, false), { action: 'reject' })
  assert.deepEqual(planInbound('Local/fake@deskphone-test-0001;1', '101', 'phone', accounts, STANDALONE, false), { action: 'reject' })
})

test('a trusted fake caller stands in for a phone', () => {
  assert.deepEqual(planInbound('Local/fake@deskphone-test-0001;1', '101', 'phone', accounts, STANDALONE, true), { action: 'answer', dialed: { kind: 'session', ext: 101 } })
})

test('menu and sessions are answered, phones are dialed, the rest is congestion', () => {
  assert.deepEqual(planInbound('PJSIP/phone-0000001a', '100', undefined, accounts, STANDALONE, false), { action: 'answer', dialed: { kind: 'menu' } })
  assert.deepEqual(planInbound('PJSIP/phone-0000001a', '1002', undefined, accounts, STANDALONE, false), { action: 'dial', caller: phone, callee: laptop })
  assert.deepEqual(planInbound('PJSIP/phone-0000001a', '1003', undefined, accounts, STANDALONE, false), { action: 'congestion' })
  assert.deepEqual(planInbound('PJSIP/phone-0000001a', '2000', undefined, accounts, STANDALONE, false), { action: 'congestion' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/inbound.test.ts`
Expected: FAIL, cannot find module `inbound.ts`

- [ ] **Step 3: Implement `planInbound` and the `ari.ts` changes**

- [ ] **Step 4: Rewrite the dialplan and ARI config**

`asterisk/config/extensions.conf`:

```
[from-phone]
exten => _X.,1,Stasis(deskphone,inbound,${EXTEN})
 same => n,Answer()
 same => n,Playtones(congestion)
 same => n,Wait(3)
 same => n,Hangup()

[phone-to-phone]
; Only reached when the daemon continues a caller here after allowing the
; call; it sets DIAL_ENDPOINT and the caller id first.
exten => _X.,1,Dial(PJSIP/${DIAL_ENDPOINT},30)
 same => n,Hangup()

[deskphone-test]   (unchanged)

[deskphone-mwi]
; Dialed by the daemon over ARI with the number of waiting replies as the
; extension and MWI_ENDPOINT set to the phone to notify.
exten => _X!,1,GotoIf($["${MWI_ENDPOINT}" = ""]?done)
 same => n,PJSIPNotify(${MWI_ENDPOINT},&Event=message-summary&Content-Type=application/simple-message-summary&Content=Messages-Waiting: ${IF($[${EXTEN} > 0]?yes:no)}&Content=Voice-Message: ${EXTEN}/0&Content=)
 same => n(done),Hangup()
```

Remove the `_1XXX` block and the `_1XX` pattern. `pjsip.conf`: delete `default_outbound_endpoint=phone` and its comment. `ari.conf [general]`: add `channelvars=DESKPHONE_AS`.

- [ ] **Step 5: Wire `index.ts`**

`onEvent` for `StasisStart` with `direction === 'inbound'` calls `handleInboundStart(channel, arg)`: `const plan = planInbound(channel.name, arg, channel.channelvars?.DESKPHONE_AS, accounts, RANGES, process.env.DESKPHONE_TRUST_FAKE_CALLER === '1')`; `reject` → `log` + `asterisk.hangupWith(id, 'rejected')`; `congestion` → `asterisk.hangupWith(id, 'congestion')`; `dial` → `setVariable('CALLERID(name)', caller.label)`, `setVariable('CALLERID(num)', String(caller.number))`, `setVariable('DIAL_ENDPOINT', callee.username)`, `continueInDialplan(id, 'phone-to-phone', String(callee.number))`, log `phone <caller.username> dials <callee.username>`; `answer` → `phones.used(channel.name)` then today's `runCall(...)` path (which answers, attaches media and runs `handleInbound(call, ext)`), where `handleInbound` keeps its `MENU_EXT`/session branches. `voicemailChanged()` notifies every account: `for (const a of accounts.list()) void asterisk.setMessageWaiting(a.username, registry.voicemailCount())`. `/phones/remove` no longer calls `setNumber`. `scripts/fake-call.ts`: parse `--as <username>` (default `phone`) and send `{ variables: { DESKPHONE_AS: as } }` as the JSON body of the originate.

- [ ] **Step 6: Run the suite and syntax checks**

Run: `npm test && node --check src/daemon/index.ts && node --check scripts/fake-call.ts && grep -rn setNumber src || true`
Expected: all pass; `grep` prints nothing

- [ ] **Step 7: Commit**

```bash
git add src/daemon asterisk/config scripts/fake-call.ts test/inbound.test.ts
git commit -m "feat: route every dialed number through the daemon" -m "Phone-to-phone calls are authorized by the daemon and handed back to a dialplan Dial(), replacing the DESKPHONE_<number> globals. Message waiting is sent per phone."
```

---

### Task 7: Pre-generated reply audio

**Files:**
- Modify: `src/daemon/index.ts:50-53,277-291,297-303,336-340`

**Interfaces:**
- Produces: `play(call: Call, pcm: Buffer): Promise<void>` (plays unless `call.closed || call.skipping`). `ring(session, text, lang)` synthesizes `text` before `callPhone`; `askQuestions` and `askPermission` synthesize their opening sentence before `callPhone`. `say()` stays for everything spoken after the call is up.

- [ ] **Step 1: Implement**

In `ring`: `const audio = await synthesize(text, session)` before `callPhone(...)`, then `await play(call, audio)` where `say(call, text, session)` was. Same shape for the first `say` in `askQuestions` and `askPermission`.

- [ ] **Step 2: Verify with the fake call against the running setup**

Run: start the daemon (`npm run daemon`) with the real Asterisk, register a session (`curl -XPOST localhost:7788/register -d '{"pid":1,"cwd":"/tmp/test"}'`), post a reply (`curl -XPOST localhost:7788/stop -d '{"pid":1,"text":"Pre-generated audio test, one two three."}'`).
Expected: the desk phone rings and the sentence starts within ~1 s of pick-up; pressing a key during it skips to the beep.

- [ ] **Step 3: Run the suite and commit**

```bash
npm test && node --check src/daemon/index.ts
git add src/daemon/index.ts
git commit -m "perf: synthesize the reply before dialing" -m "Playback starts the moment the phone is picked up instead of after up to ten seconds of synthesis."
```

---

### Task 8: Asterisk smoke test

**Files:**
- Create: `scripts/smoke-asterisk.sh`
- Modify: `package.json` (script `"smoke": "sh scripts/smoke-asterisk.sh"`)
- Modify: `asterisk/render.sh` (nothing required; `PHONE_PASSWORD` still set by the script)

**Interfaces:**
- Consumes: the daemon's `/phones` API (Task 5), `DESKPHONE_TRUST_FAKE_CALLER` (Task 6), `DESKPHONE_PHONES_FILE`, `DESKPHONE_VOICEMAIL_FILE`, `DESKPHONE_PORT`, `DESKPHONE_ARI_URL`, `DESKPHONE_ARI_PASSWORD`.

- [ ] **Step 1: Write the script**

`scripts/smoke-asterisk.sh` (`set -eu`, cleans up with `trap`): start `andrius/asterisk:22.10.1_debian-trixie-ff36a97` with `asterisk/config` + `asterisk/render.sh` mounted, `EXTERNAL_IP=127.0.0.1 SIP_PORT=5099 PHONE_PASSWORD=x ARI_PASSWORD=y`, ARI on `127.0.0.1:18088`; wait for `/ari/asterisk/info`; start the daemon in the background with a temp phones/voicemail file, `DESKPHONE_PORT=17788`, `DESKPHONE_TRUST_FAKE_CALLER=1`. None of the checks answers a call, so `say`/`whisper-cli` are never invoked and the script runs on Linux CI. Run `docker exec <container> asterisk -rx 'pjsip set logger on'` right after Asterisk is up so check 5 can grep the SIP trace. Then assert:
1. `POST localhost:17788/phones {"name":"laptop"}` → `GET /ari/endpoints/PJSIP/laptop` is 200 (device pushed, `md5`/`userpass` irrelevant here).
2. Originate `Local/fake@deskphone-test/n` with `app=deskphone`, `appArgs=inbound,1002`, body `{"variables":{"DESKPHONE_AS":"phone"}}`; within 5 s `docker logs` contains `Dial("Local/fake@deskphone-test` and `PJSIP/laptop,30` (the `continue` landed in `[phone-to-phone]`).
3. Same originate with `appArgs=inbound,2000` → daemon log contains `congestion` and the channel is gone within 5 s (`GET /ari/channels` lists none).
4. Originate without `DESKPHONE_AS` → daemon log contains `rejected`.
5. `POST localhost:17788/register {"pid":1,"cwd":"/tmp/a"}` then `POST /stop {"pid":1,"text":"hello"}` with no phone registered → within 15 s the voicemail file contains `hello` (no answer → voicemail), and `docker logs` shows the daemon originating `Local/1@deskphone-mwi` for both `phone` and `laptop` (two `MWI_ENDPOINT` executions in the dialplan trace). A real `NOTIFY` needs a registered contact, so the SIP trace is checked only for the absence of `PJSIPNotify` errors; the live check happens in Task 10. If the endpoint-name form of `PJSIPNotify` logs an error, switch `[deskphone-mwi]` to `PJSIPNotify(<${PJSIP_CONTACT(${PJSIP_AOR(${MWI_ENDPOINT},contact)},uri)}>,...)` and note it in the commit.
Exit non-zero with the offending log excerpt on any failed check.

- [ ] **Step 2: Run it**

Run: `npm run smoke`
Expected: `smoke: ok` and exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-asterisk.sh package.json asterisk/config
git commit -m "test: smoke-test routing and message waiting against a throwaway Asterisk"
```

---

### Task 9: CI and docs

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/how-it-works.md` ("A call", "Voicemail and message waiting", "Development"), `docs/asterisk.md` (dialplan note), `docs/phone.md` ("More phones": numbers are routed by the daemon), `docs/configuration.md` (`DESKPHONE_TRUST_FAKE_CALLER`)

- [ ] **Step 1: Write `ci.yml`**

On push and pull_request: `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 24`, `npm ci`, `npm test`; second job `smoke` on `ubuntu-latest` running `npm run smoke` (Docker is available there).

- [ ] **Step 2: Update the docs**

"A call" step 1: every dialed number enters `Stasis(deskphone,inbound,<number>)`; the daemon answers sessions and the menu, hands phone-to-phone calls to `[phone-to-phone]` with `DIAL_ENDPOINT`, and hangs up unknown numbers with congestion. "Voicemail and message waiting": NOTIFY per phone via `MWI_ENDPOINT`. "Development": `npm run smoke`, `npm run fake-call -- 101 --as laptop`, `DESKPHONE_TRUST_FAKE_CALLER=1`. Mention that reply audio is synthesized before dialing.

- [ ] **Step 3: Commit**

```bash
git add .github docs
git commit -m "docs: dialplan routing through the daemon, smoke test, CI"
```

---

### Task 10: Mirror the dialplan into the Flux repo

**Files:**
- Modify: `/Users/xvilo/projects/flux/clusters/kube0/deskphone/asterisk-config.yaml` (`extensions.conf` block = `asterisk/config/extensions.conf` verbatim, indented)
- Modify: `/Users/xvilo/projects/flux/clusters/kube0/deskphone/asterisk-secret.yaml` (drop `default_outbound_endpoint=phone`; add `channelvars=DESKPHONE_AS` to `ari.conf [general]`)
- Modify: `/Users/xvilo/projects/flux/clusters/kube0/deskphone/asterisk-deployment.yaml` (`deskphone/config-revision: "11"`)

**Interfaces:**
- Consumes: the final `asterisk/config/extensions.conf` from Task 6.

- [ ] **Step 1: Apply and validate**

Run: `cd /Users/xvilo/projects/flux && kubectl kustomize clusters/kube0/deskphone >/dev/null && echo ok`
Expected: `ok`

- [ ] **Step 2: Commit, then ask before pushing**

```bash
git add clusters/kube0/deskphone
git commit -m "deskphone: route every number through the daemon; MWI per phone"
```
Pushing deploys to the cluster and restarts Asterisk (1–2 min SIP gap). Confirm with Sem, then `git push origin main`, then restart the laptop daemon from the new `main`. Verify: dial `1002` from the desk phone (rings the laptop), `100#` menu, a session callback, stutter tone after a missed callback.
