# Deskphone goes hosted: multi-user hub on kube0

## Context

Today deskphone is single-user: a Node daemon on Sem's MacBook talks to an Asterisk on kube0 over ARI, speaks with macOS `say`, transcribes with whisper-cli, and hands out extensions 101–199 to Claude Code sessions and numbers 1001+ to phones. It only works while the laptop is awake, and nobody else can use it.

The goal is a hosted service at **phone.sem.computer** where friends sign in with SSO, link their own Claude Code sessions and phones, and call each other, while the current laptop setup keeps working as a self-hosted option.

### Decisions made with the user (2026-10-29)

- **Multi-user service.** Each user has their own account, phones and Claude sessions.
- **Numbering, one shared space.** Claude sessions: 101–9999 (globally unique). Phones: 10000 and up. Max 10 active sessions per user (≈990 users in theory). Sessions can be disconnected from the web UI and auto-disconnect after 1 hour of inactivity. Standalone mode keeps 101–199 / 1001+.
- **Friends.** Phone-to-phone calls only between friends (mutual accept) or the same owner; otherwise rejected. Friends are added **by handle**; on first login the user picks a handle (prefilled from SSO `preferred_username`, unique). Handles are the only searchable identity; emails stay private.
- **OIDC login** via `https://sso.ods-ops.net` (client_id/secret supplied later). Anyone who can log in may register.
- **Plugin login: device flow.** `/phone` shows a short code and URL; the user approves in the browser; the plugin receives a long-lived token.
- **Plugin default** `DESKPHONE_URL=https://phone.sem.computer`; any other URL (e.g. `http://127.0.0.1:7788`) is self-hosted/standalone and needs no token.
- **Speech, hosted:** whisper.cpp (CPU) for speech-to-text. TTS: **Azure AI Speech neural voices** (free tier ≈500k chars/month, Dutch Fenna/Maarten) with **Piper** (CPU, free) as fallback. All reply audio is **generated before the phone is dialed**, so playback starts the moment the user picks up (today synthesis happens after answer and can take up to ~10 s).
- **Stack:** Hub API in Symfony 8.1 / PHP 8.4 / Doctrine / Postgres 16 (Zalando operator), FrankenPHP image, GitHub Actions → ghcr.io/xvilo, Helm charts as OCI to ghcr.io/xvilo/charts, Flux on kube0. Frontend: separate **Vue 3 + Vite + TypeScript SPA**.
- **Repos:** this repo (`claude-to-phone`) keeps the daemon, plugin and a new `charts/deskphone/` chart that bundles Asterisk by default (`asterisk.enabled=false` + external ARI as the alternative). New sister repo **`/Users/xvilo/projects/deskphone-hub`** with `api/` (Symfony), `web/` (Vue) and `charts/deskphone-hub/`.
- **Deploy to kube0**, namespace `deskphone`, keeping Asterisk's SIP identity `deskphone.sem.computer`, MetalLB IP `172.16.255.250` and UDP 15060, so existing phones keep working.

### Calls I made (not discussed; say so if wrong)

- **SIP username = phone number by default** (`10042`), display name chosen by the user; globally unique, no name clashes between users. The hub stores a `sip_username` column so the one-off import can keep `phone`, `laptop` and `sems_iphone` with their current passwords: your three devices need **no reconfiguration**.
- **SIP credentials stored as digest HA1** (`md5(username:deskphone:password)`, realm fixed to `deskphone`) and pushed to Asterisk as `auth_type=md5`; the hub never keeps plaintext. Passwords are shown once at creation/reset.
- **Session identity in hosted mode = (plugin token, Claude pid).** Each machine does its own device login, so the token identifies the install; hostnames are display-only.
- **PIN:** the hub stores and verifies it (argon2id) and keeps lockout counters; the daemon never sees the hash. PIN is asked when the session's Mac is locked (the plugin reports lock state, since `lock.ts` can only run on the Mac) or when the user turns on "always ask" in settings.
- **Phone→phone audio stays in Asterisk.** Every dialed number enters Stasis; the daemon authorizes, sets caller ID, then `continue`s the channel into a `[phone-to-phone]` dialplan context that `Dial()`s the callee. No media WebSocket for phone calls. This replaces the `DESKPHONE_<number>` global-variable trick added today.
- **RTP range grows to 10000–10099** (10 streams isn't enough for several users; a phone→phone call uses two). The router port-forward must be widened by hand.
- **Models are baked into the daemon image** (whisper `ggml-small-q5_1`, two Piper voices): no init container, no dependency on Hugging Face being up. whisper runs as a **sidecar** (`whisper-server`, model stays resident) in the daemon pod.
- **Standalone mode is untouched in behaviour**: 101–199 / 1001+, macOS `say` + whisper-cli, pid-based pruning, `phone` static in `asterisk/config/pjsip.conf`. It gains only the new dialplan (everything through Stasis) because that's one code path.
- **SPA is served by the hub image** (Vite `dist/` copied into `api/public/`, catch-all route). Two public paths: `/` and `/api/*` → hub, `/rt/*` → daemon.
- **Two charts:** `claude-to-phone/charts/deskphone` (daemon + bundled or external Asterisk, owns the `/rt` Ingress) and `deskphone-hub/charts/deskphone-hub` (api+web, owns the `/` Ingress and the certificate). Same host, shared TLS secret name.
- **Internal APIs** use one shared service token. The daemon's live under `/internal/*` (not `/rt`), so the Ingress never routes them; the hub's `/api/internal/*` additionally rejects any request carrying `X-Forwarded-For` (in-cluster calls never have it).

## 1. Hub API (`/Users/xvilo/projects/deskphone-hub/api`)

Symfony 8.1, PHP 8.4, Doctrine ORM 3, Postgres 16, FrankenPHP image modelled on `/Users/xvilo/projects/dmarc-pass/Dockerfile`; PHPUnit strict + DAMA, PHPStan level 9 (`phpstan-symfony`, `-doctrine`, `-phpunit`), UUIDv7 ids, `final readonly` services, attribute routes, `#[MapRequestPayload]` DTOs, small `Api/Presenter/*` classes (no serializer magic). Conventions copied from dmarc-pass and `/Users/xvilo/projects/of-stash-syncer/.claude/CLAUDE.md`.

### Data model (one migration, hand-finished after `doctrine:migrations:diff`)

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `email` (unique), `handle` (unique, `^[a-z0-9_]{3,32}$`), `display_name`, `language` (null=auto), `default_phone_id`, `pin_hash`, `pin_always`, `pin_failures`, `pin_locked_until`, `created_at`, `last_login_at` | `handle` NULL until onboarding completes; `/api/*` except `/api/me` and onboarding returns 409 `handle_required` until set |
| `oidc_identities` | `user_id`, `issuer`, `subject` | `UNIQUE(issuer, subject)`; match on `(iss, sub)` only, never link by email silently |
| `friendships` | `user_a_id < user_b_id` (CHECK), `requested_by_id`, `status` pending/accepted, `accepted_at` | `UNIQUE(a,b)`; decline/cancel/remove = DELETE |
| `phones` | `user_id`, `name`, `number` (unique, from `SEQUENCE phone_number_seq START 10000`, never reused), `sip_username` (unique, default = number), `sip_realm`, `sip_ha1` | max 10 per user; HA1 pushed to Asterisk as `auth_type=md5` |
| `plugin_tokens` | `user_id`, `token_hash` (sha256, unique), `label` (hostname), `last_used_at`, `revoked_at` | secret `dp_<base64url 32 bytes>`, shown once |
| `device_codes` | `device_code_hash`, `user_code` (`XXXX-XXXX` from 20 consonants), `hostname`, `status` pending/approved/denied/consumed, `user_id`, `expires_at` (10 min) | approve requires a signed-in click on a page showing the hostname |
| `sessions` | Symfony `PdoSessionHandler` table | lets the hub run >1 replica |

Live Claude sessions and voicemail stay in the daemon (memory + file), as today.

### OIDC login (hand-rolled code flow, `api/src/Security/Oidc/`)
`OidcDiscovery` (cached `.well-known` + JWKS), `OidcClient` (auth URL with PKCE S256 + state + nonce; code exchange `client_secret_post`; id_token validation with `web-token/jwt-library`: iss, aud, exp/iat ±60 s, nonce), `OidcUserProvisioner` (find-or-create by `(iss, sub)`; email already taken by another sub → 409), `OidcAuthenticator` on `GET /api/auth/callback`. Session cookie `dp_session`, `SameSite=Lax` (needed for the callback), `PdoSessionHandler`. Unauthenticated `/api/*` → 401 JSON with `login_url`. CSRF for the JSON API: `ApiRequestOriginListener` requires `Sec-Fetch-Site: same-origin|none` and `Content-Type: application/json` on unsafe methods. Dev: `DevLoginAuthenticator` behind `DEV_LOGIN_ENABLED=1` (OIDC creds arrive later). Env: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `DEFAULT_URI`.

### Endpoints
- Auth: `GET /api/auth/login?next=`, `GET /api/auth/callback`, `POST /api/auth/logout`.
- Me: `GET /api/me` (`handle`, `pin_set`, `pin_always`, `language`, `default_phone_id`, `max_sessions: 10`), `PATCH /api/me`, `PUT /api/me/handle` (onboarding, once), `PUT|DELETE /api/me/pin`.
- Friends: `GET /api/friends` (friends/incoming/outgoing), `POST /api/friends/requests {handle}` (reverse pending → auto-accept), `POST /api/friends/requests/{id}/accept`, `DELETE /api/friends/requests/{id}`, `DELETE /api/friends/{userId}`.
- Phones: `GET /api/phones` (daemon state merged best-effort), `POST /api/phones {name}` → SIP credentials shown once (`username`, `password`, `server`, `port 15060`, `udp`), `POST /api/phones/{id}/reset-password`, `DELETE /api/phones/{id}`. After each change the hub pokes the daemon (`POST /internal/phones/sync`).
- Sessions (proxied to daemon): `GET /api/sessions`, `DELETE /api/sessions/{ext}`; 503 `daemon_unavailable`.
- Tokens: `GET /api/tokens`, `DELETE /api/tokens/{id}` (revoke, pushed to daemon).
- Device login (stateless, rate-limited): `POST /api/device/start {hostname}` → `user_code`, `device_code`, `verification_url(_complete)`, `interval 5`; `POST /api/device/poll {device_code}` → pending | approved+token (once) | denied | expired | slow_down; `POST /api/device/revoke`. Approval (signed in): `GET /api/device/{user_code}`, `POST …/approve|deny`.
- Internal (service token, rejects `X-Forwarded-For`): `GET /api/internal/phones` (username, number, realm, ha1, owner, display_name), `POST /api/internal/tokens/verify` → `{token_id, user_id, handle, language, pin_set, pin_always, default_phone, phones, max_sessions}`, `POST /api/internal/calls/authorize {caller_endpoint, dialed}`, `POST /api/internal/users/{id}/pin/verify`, `GET /api/internal/users/{id}`.
- Rate limits (`symfony/rate-limiter`, DBAL storage): device start 5/min/IP, poll 20/min/code, code lookup 10/min/user; `SYMFONY_TRUSTED_PROXIES` must be right behind ingress.

### Call authorization (`CallAuthorizer`, mirrored by the daemon's `hub.ts`)
Caller = PJSIP endpoint of the inbound channel (= `sip_username`) → owner U.

| Dialed | Rule |
|---|---|
| unknown endpoint | deny, congestion |
| `100` | menu scoped to U (PIN first if applicable) |
| `101–9999` | allowed only if the session's owner is U; otherwise "There is no Claude session on extension N" (no enumeration) |
| `≥10000` | allowed if callee owner is U or friendship accepted; else "That number can't be reached" |
| anything else | congestion |

The hub resolves caller → user and does the owner/friend check for ≥10000; the daemon checks session ownership itself (extensions live only in its memory). If the hub is unreachable: own sessions and own phones still work from the daemon's cached phone list; friend calls fail closed. Callbacks ring: the session's pinned phone (must be owned) → the user's last-used phone → `default_phone` → first owned phone. Never a friend's phone.

### Repo skeleton
```
deskphone-hub/
  compose.yaml                      # postgres:16-alpine (+ optional api); PHP normally via `symfony serve`
  .github/workflows/{ci,build,chart}.yml   # phpstan+phpunit(+postgres service)+vue-tsc+vitest; image ghcr.io/xvilo/deskphone-hub; OCI chart
  api/  Dockerfile (base → builder → web-builder node:24 → runtime, non-root :8080), composer.json, phpunit.dist.xml, phpstan.dist.neon,
        config/packages/{framework,security,doctrine,doctrine_migrations,cache,rate_limiter,monolog}.yaml, migrations/,
        src/{Entity,Repository,Enum,Dto,Api/Presenter,Controller/{Api,Internal},Security/{Oidc,Internal,Dev},Service,Daemon,EventListener,Command}/,
        src/Controller/SpaController.php (catch-all → index.html), src/DataFixtures/AppFixtures.php (alice/bob, friendship, phones, PIN, dev token),
        tests/{Functional/Api,Functional/Internal,Unit,Support}/
  web/  (section 4)
  charts/deskphone-hub/  (section 5)
```
Services: `DeviceLoginService`, `UserCodeGenerator`, `PluginTokenService`, `FriendshipService`, `PhoneService` + `SipCredentialFactory`, `PinService` (named `pin` hasher), `CallAuthorizer`, `Daemon/DaemonClient` (http-client, 2 s timeout, `NullDaemonClient`/`FakeDaemonClient` for tests), `PurgeDeviceCodesCommand`, `ImportPhoneCommand` (one-off: explicit username + password → HA1).

## 2. Daemon (`/Users/xvilo/projects/claude-to-phone/src/daemon`)

Things in today's code the hosted mode must change (verified): one global `line` promise serialises *all* callbacks and `lineFree()` waits for `calls.size === 0` (`index.ts`); `PhoneRouter.lastUsed` is global (`phones.ts`); `pruneSessions()` probes local pids; `runCall` answers every inbound channel before classifying (ringback needs an unanswered channel); `sorcery.conf` lists `config` before `memory`, so a static `[phone]` would shadow a dynamic one; MWI is hard-wired to `PJSIP_AOR(phone,…)`; the RTP range is 10 streams.

### New modules
| File | Purpose |
|---|---|
| `mode.ts` | `MODE = DESKPHONE_MODE ?? (DESKPHONE_HUB_URL ? 'hosted' : 'standalone')`; ranges: sessions `101–9999` / `101–199`, phones `≥10000` / `1001+`; `MAX_SESSIONS_PER_USER=10`, `SESSION_IDLE_MS=60 min` (0 in standalone); bind `0.0.0.0` / `127.0.0.1` |
| `numbering.ts` | pure `classify(dialed) → menu \| session \| phone \| unknown` per mode (unit-tested) |
| `hub.ts` | hub client with service token: `verifyToken` (cache 60 s, serve stale ≤10 min if hub down), `listPhones`, `authorizeCall` (cache 30 s), `verifyPin`, `getUser`; 3 s timeouts, typed errors |
| `accounts.ts` | `AccountSource` interface: `FileAccounts` (wraps `DeviceStore` + `DESK_PHONE`, owner `local`) and `HubAccounts` (full resync on ARI connect, on hub poke, every 10 min; diff → `addDevice`/`removeDevice`) |
| `auth.ts` | request auth: plugin routes need `Authorization: Bearer dp_…` → `hub.verifyToken`; `/internal/*` needs the service token (constant-time compare); standalone allows everything on loopback |
| `http.ts` | the `createServer` block moved out of `index.ts`: route table, accepts both `/rt/x` and `/x`, SSE helper that can end a stream with a final `{"type":"disconnected","reason":"idle"\|"user"\|"revoked"}`, `GET /healthz` |
| `line.ts` | per-endpoint busy/serialisation replacing `onLine`/`lineFree`/`calls` |
| `speech/` | `index.ts` facade (`synthesize`, `transcribe`, `detectLanguage`), backends `say.ts` (today's tts.ts), `piper.ts`, `azure.ts` (REST `…tts.speech.microsoft.com/cognitiveservices/v1`, SSML, output `raw-8khz-16bit-mono-pcm` so no ffmpeg; voice map per language, e.g. `nl` → `nl-NL-FennaNeural`, `en` → `en-GB-SoniaNeural`; on error/429 → Piper), `whisper-cli.ts` (today's stt.ts), `whisper-server.ts` (`POST /inference`, model resident), `language.ts` (`chooseLanguage`/`preferredLanguages` unchanged; hypotheses from osascript on macOS, `tinyld` elsewhere), `ffmpeg.ts` |
| `../shared/lock.ts`, `../shared/credentials.ts`, `../shared/run.ts` | `isScreenLocked()` moved so the channel server can report it; token file handling; `run()` |

### Modified
- `registry.ts`: `Session.key` (`${tokenId}:${pid}` hosted, `${pid}` standalone), `owner`, `host`, `lastActivity`; constructor takes the ext range + per-owner cap (`register` throws `TooManySessions`); owner-scoped `list/voicemailCount/takeOldestVoicemail`; `touch()`, `expireIdle()` (frees ext, voicemail → orphans, delivers `disconnected` to the listener first); `prune(isAlive)` stays for standalone. `SavedVoicemail` gains `key, owner, host`.
- `ari.ts`: delete `setNumber`; `originate(endpoint, channelId, appArgs, callerId, timeout)`; add `setVariable`, `continueInDialplan(channelId, context, exten)`, `hangupWith(channelId, reason)`; `setMessageWaiting(endpoint, count)` passes `MWI_ENDPOINT` as a channel variable; `addDevice(username, ha1, number, label)` pushes `auth_type=md5`, `realm=deskphone`, `callerid="label" <number>`; keep `DEVICE_ENDPOINT/AOR` constants as the single source (no pjsip templates in hosted mode), AOR `maximum_expiration=3600`.
- `index.ts` becomes the composition root: `handleInbound` → resolve caller account from `channel.name` (unknown → hang up `rejected`) → `classify(dialed)` → **menu** (answer, attach media, owner-scoped `voicemailMenu`), **session** (missing or other owner → "There is no Claude session on extension N"), **phone** (`authorizeCall`; allowed → set `CALLERID(name)`/`(num)` → `continueInDialplan('phone-to-phone', calleeUsername)`; denied → answer + "That number can't be reached"). Callbacks: `phones.target(owner, pinned)` → `line.serialize(endpoint, …)`; **synthesize the whole reply (and the greeting) before `originate`**, then play immediately on answer. PIN: `pins.check(owner, digits)` via hub; asked when the session's reported lock state is locked/stale or the user has `pin_always`. `voicemailChanged()` NOTIFYs each of the owner's endpoints. Timer: `pruneSessions()` (standalone) or `expireIdle()` (hosted) every 30 s; `touch()` on register/stop/permission/events connect/inbound call.
- `pin.ts`: `PinGuard` interface; `FilePinGuard` (today) and `HubPinGuard`. `menu.ts`: unchanged, callers pass the owner-filtered list. `phones.ts`: per-owner `lastUsed`. `devices.ts`: standalone-only, unchanged. `lock.ts`: hosted `LockState` map fed by `POST /lock {host, locked}`, stale >2 min = locked.
- Delete the `DESKPHONE_<number>` globals, `_1XXX`/`_1XX` dialplan patterns, global `line`/`calls`.

### HTTP API (daemon)
Plugin (`/rt/*`, Bearer): `POST /register {host,pid,cwd,ext?,phone?}` → `{ext,phone}` (409 `session_limit`), `POST /unregister`, `POST /stop`, `POST /permission`, `POST /questions`, `GET /events?host&pid` (SSE), `GET /session?host&pid` (for the prompt hook), `GET /status` (own sessions), `GET /phones` (own phones + Asterisk state), `POST /lock`. Internal (`/internal/*`, service token, **not** under `/rt`): `GET /internal/users/{id}/sessions`, `DELETE /internal/users/{id}/sessions/{ext}`, `POST /internal/phones/sync`, `POST /internal/tokens/{id}/revoke`, `GET /internal/phones/state`. Open: `GET /healthz`.

### Asterisk config (`asterisk/config/`, copied into `charts/deskphone/files/asterisk/` by CI)
- `extensions.conf`: `[from-phone] exten => _X.,1,Stasis(deskphone,inbound,${EXTEN})` + congestion fallthrough; `[phone-to-phone] exten => _X.,1,Dial(PJSIP/${EXTEN},30)` then `Hangup()` (reached only via the daemon's `continue`); `[deskphone-mwi]` uses `${MWI_ENDPOINT}` with the endpoint-name form of `PJSIPNotify` (smoke-tested; fallback = URI form via `PJSIP_AOR(${MWI_ENDPOINT},contact)` + a no-auth `[deskphone-system]` `default_outbound_endpoint`); `[deskphone-test]` unchanged.
- `pjsip.conf`: hosted variant has transport + `[global] default_realm=deskphone` and **no accounts**; standalone keeps `[phone]`. `render.sh` makes `PHONE_PASSWORD` optional. `sorcery.conf` unchanged. `rtp.conf` range from values (default 10000–10099). `ari.conf`: add `channelvars=DESKPHONE_AS` (fake-caller for the smoke test, honoured only with `DESKPHONE_TRUST_FAKE_CALLER=1`).
- In-cluster the daemon reaches ARI via the ClusterIP service; the public `/ari` + `/media` Ingress goes away after cutover.

### Daemon image (`Dockerfile` at repo root, linux/amd64)
Stages: `whisper` (build `whisper-cli` + `whisper-server` from a pinned whisper.cpp tag, AVX2 — confirm kube0 CPUs), `piper` (release tarball `piper_linux_x86_64`), `models` (download + sha256-check `ggml-small-q5_1.bin`, `nl_BE-nathalie-medium`, `en_GB-alba-medium`), runtime `node:24-bookworm-slim` + static ffmpeg + `libgomp1` + `tini`, `npm ci --omit=dev`, `USER node`, `CMD node src/daemon/index.ts`. Same image runs the `whisper-server` sidecar.

### Tests
Unit (node:test): `numbering`, `registry` (key identity, owner scoping, cap, `expireIdle` emits `disconnected`), `line`, `authorize` (decision table against a stub hub), `menu` per owner, `http` (prefix stripping, 401 without Bearer, service-token gate, SSE terminal event, `/healthz`), `hub` (cache TTL, stale-serve), `speech-language` (tinyld adapter), `config` precedence, `channel-events`. Integration smoke (`scripts/smoke-asterisk.sh` + `scripts/hub-stub.ts`, also in CI): throwaway `andrius/asterisk:22.10.1` with the hosted config → daemon pushes fixture accounts (md5 auth) → fake inbound `10001` from a friend is `continue`d, from a stranger is rejected → MWI NOTIFY reaches a fixture endpoint.

## 3. Plugin: channel server, hooks, CLI

- `src/shared/config.ts` → `loadConfig()`: `DESKPHONE_URL` set → that URL, token from `DESKPHONE_TOKEN` or `~/.config/deskphone/credentials.json` when its `hub` matches, **no token → standalone**; else credentials file; else default `https://phone.sem.computer` (hosted, not logged in). `daemonBase = url + '/rt'`, `hubBase = url + '/api'`. Sync reads so hooks stay cheap; file 0600.
- `src/shared/device-login.ts`: `startLogin(hostname)` → `POST /api/device/start`; `pollLogin()` every `interval` s until approved/denied/expired; `saveCredentials()`. Also exposed as `npm run login` (`src/cli/login.ts`).
- `src/channel/server.ts`: send `host` + `pid` + Bearer on every call; `phone_register` without a token starts the device flow and returns "Open <url>, enter <code>, then run /phone again" while polling in the background; new `phone_login`/`phone_logout` tools; `phone_device_*` tools are dropped in hosted mode (web UI) and kept for standalone; `listen()` stops (and clears `ext`) on a `disconnected` event or 401, retries only on network errors; 409 at the cap names the web UI; lock reporting every 5 s (hosted); best-effort `/unregister` on SIGTERM. `src/channel/events.ts` extracts the SSE parsing/loop decision for tests.
- Hooks (`stop`, `permission`, `prompt`): `loadConfig()`, Bearer, `host`+`pid`; `prompt.ts` uses `GET /session` with a 2.5 s timeout (TLS). All failures stay silent, as today.
- `scripts/claude-phone` unchanged; docs: new `docs/hosted.md` (sign in, device login, phones, friends, numbering), updates to `configuration.md`, `asterisk.md`, `phone.md`, `how-it-works.md`, `skills/phone/SKILL.md` (login step, 101–9999).

## 4. Web SPA (`deskphone-hub/web`)

Vite `vue-ts` template, `vue-router`, TypeScript, vitest + jsdom, eslint flat config. No Pinia (module-scoped composables `useMe()`, `usePolling()`), no Tailwind (plain CSS tokens like dmarc-pass, dark default). `vite.config.ts` proxies `/api` → :8080 and `/rt` → :7788 in dev; the Docker build writes `dist/` into `api/public/`.

- `src/api/client.ts`: fetch wrapper, `credentials: same-origin`, JSON, typed `ApiError`, 401 → clear me → `/login?next=…`.
- Router guard loads `/api/me` once; no handle yet → `/welcome` (choose handle); `/device?code=` survives the SSO round trip via `next`.
- Pages → API: `/login`; `/welcome` (`PUT /api/me/handle`); `/` dashboard (me, sessions, phones); `/sessions` (list, disconnect; polls 5 s); `/phones` (list with online dot, add → `SecretReveal` shown once, delete, reset password); `/friends` (friends, incoming, outgoing; request by handle; accept/decline/remove); `/device` (approve/deny, shows hostname + code, states pending/approved/denied/expired); `/settings` (handle, language, PIN set/clear + "always ask", tokens list/revoke).
- Components: `AppShell`, `PageHeader`, `EmptyState`, `ErrorBanner`, `Toast`, `ConfirmDialog` (`<dialog>`), `OnlineDot`, `SecretReveal`, `CodeInput` (normalises to `ABCD-EFGH`), `PinForm`, `LanguageSelect`, `RelativeTime`. i18n en/nl via a tiny `t()`.
- Tests: `client.test.ts`, `device-code.test.ts`, `use-me.test.ts`; CI runs `vue-tsc --noEmit && vitest run && vite build`.

## 5. Charts and CI

### `deskphone-hub/charts/deskphone-hub` (api + SPA in one image)
Copy structure/helpers from `/Users/xvilo/projects/dmarc-pass/charts/dmarc-pass/` (`_helpers.tpl` with `envValue` literal-or-`valueFrom`, `deployment-web.yaml` migrations initContainer, `ingress.yaml`). Templates: `deployment-api.yaml` (replicas 1, initContainer `doctrine:migrations:migrate -n --allow-no-migration`, probes on `/api/health`), `service-api.yaml`, `ingress.yaml` (host → `/` Prefix; carries the `cert-manager.io/cluster-issuer` annotation), `serviceaccount.yaml`, `values.schema.json`. Values: `image`, `imagePullSecrets`, `nodeSelector`, `resources`, `ingress{host, className, annotations, tls{secretName}}`, `database{host,name,serverVersion,user{},password{}}`, `app{secret{}, defaultUri, trustedProxies}`, `oidc{issuer, clientId{}, clientSecret{}}`, `daemon{url, token{}}`, `extraEnv`.

### `claude-to-phone/charts/deskphone` (daemon + Asterisk)
Templates: `deployment-daemon.yaml` (daemon + `whisper-server` sidecar, PVC for voicemail state, env from values, `/rt` prefix, bind 0.0.0.0, `/healthz` probes, Recreate), `service-daemon.yaml`, `ingress-daemon.yaml` (host → `/rt`, SSE annotations `proxy-read-timeout/send-timeout 3600`, `proxy-buffering off`; same `tls.secretName`, **no** cert-manager annotation), `pvc.yaml`; under `asterisk.enabled`: `deployment-asterisk.yaml` (image `andrius/asterisk:22.10.1_debian-trixie-ff36a97`, `render.sh` entrypoint, `checksum/config` annotation instead of the hand-bumped `config-revision`, nodeSelector on the L2-announcing amd64 nodes by **label**, not hostname), `configmap-asterisk.yaml` (`tpl (.Files.Get "files/asterisk/*.conf")` copied from `asterisk/config/` by CI so `asterisk/config/` stays the single source), `secret-asterisk.yaml` (ARI password, optional static `phone` password for the transition), `service-asterisk.yaml` (LoadBalancer, `externalTrafficPolicy: Local`, `metallb.io/loadBalancerIPs`, UDP SIP port + RTP range generated with `untilStep`), `service-asterisk-ari.yaml` (ClusterIP 8088), optional `ingress-asterisk.yaml` for public ARI/media (needed only while the laptop daemon still uses it). `asterisk.enabled=false` → `asterisk.external.{ariUrl,user,password{}}`. Values also: `mode` (`hosted`|`standalone`), `hub{url, token{}}`, `speech{tts, stt, whisper{model,threads,resources}, piper{default, perLanguage}, azure{key{}, region, voices}}`, `daemon.sessions{maxPerUser, idleMinutes}`, `daemon.ariApp`, `persistence`, `resources` (whisper small: request 1 CPU/2 Gi, limit 4 CPU/4 Gi).

### CI (GitHub Actions, copies of dmarc-pass `build.yml`/`chart.yml`)
- deskphone-hub: `ci.yml` (php 8.4 composer+phpstan+phpunit with postgres service; node 24 `vue-tsc`, `vitest`, `vite build`), `build.yml` → `ghcr.io/xvilo/deskphone-hub`, `chart.yml` on `v*` → `oci://ghcr.io/xvilo/charts/deskphone-hub`.
- claude-to-phone: `ci.yml` (`npm test` on Node 24 + the Asterisk smoke script), `build.yml` → `ghcr.io/xvilo/deskphone` (buildx cache; the whisper stage is slow), `chart.yml` (`helm lint`, copy `asterisk/config` into `charts/deskphone/files/asterisk/`, package, push).
- Versioning: semver tags per repo; chart version = app version = tag; Flux `OCIRepository.ref.semver: "0.1.x"`, `image.tag` explicit in the HelmRelease as today.

## 6. kube0 deployment (Flux repo `/Users/xvilo/projects/flux/clusters/kube0/deskphone/`)

Facts that shape it (from the Flux repo): root Kustomization `flux-system` applies `clusters/kube0` recursively with prune, so moving objects into child Kustomizations prunes them in the same reconcile; the `deskphone` Namespace must stay root-owned (`namespace.yaml` at top level). MetalLB announces from nodes labelled `node.kubernetes.io/microk8s-controlplane`; the `worker3-kube0` hostname pin will break with the planned node rename → use labels. The `deskphone.sem.computer-tls` Secret survives Ingress deletion, so re-creating the Ingress with the same `secretName` re-adopts the cert. No kubeconfig for kube0 on this machine right now (only team.blue contexts) → live checks happen after the user logs in.

```
deskphone/
├── kustomization.yaml           # namespace.yaml + 3 Flux Kustomizations (old asterisk-*.yaml dropped in phase 2)
├── namespace.yaml               # unchanged, root-owned
├── deskphone-database.yaml      # Kustomization → ./database, dependsOn postgres-operator, healthCheckExprs PostgresClusterStatus == Running (copy stonker-database.yaml)
├── deskphone-hub.yaml           # → ./hub, dependsOn deskphone-database, wait
├── deskphone-daemon.yaml        # → ./daemon, dependsOn deskphone-hub, wait
├── database/deskphone-postgresql.yaml   # acid.zalan.do postgresql deskphone-db, 1 instance, pg16, longhorn 5Gi, amd64 affinity
├── hub/  ghcr-pull-secret.yaml, deskphone-hub-secrets.yaml (APP_SECRET, OIDC_CLIENT_ID/SECRET), deskphone-shared-secret.yaml (DAEMON_TOKEN),
│         deskphone-hub-repository.yaml (OCIRepository), deskphone-hub-release.yaml (HelmRelease, values as in §5; DB creds from deskphone.deskphone-db.credentials.postgresql.acid.zalan.do)
└── daemon/ deskphone-asterisk-secret.yaml (ARI_PASSWORD + PHONE_PASSWORD reused from today, AZURE_SPEECH_KEY),
            deskphone-repository.yaml, deskphone-release.yaml (asterisk.enabled, externalAddress deskphone.sem.computer, IP 172.16.255.250, SIP 15060, RTP 10000–10099, staticPhone on until import)
```
Secrets stay plaintext `stringData`, per repo convention. Manual steps: DNS `phone.sem.computer A 82.168.148.253` before phase 1 (HTTP-01); router forward UDP 10000–10099 (was –10019) before phase 2.

### Rollout
- **Phase 0, prep:** tag/push `deskphone-hub v0.1.0` and `claude-to-phone v0.2.0` (images + charts); `helm template` both with the kube0 values; create the OIDC client at sso.ods-ops.net (redirect `https://phone.sem.computer/api/auth/callback`); DNS record; Azure Speech resource + key.
- **Phase 1, additive (no Asterisk impact):** commit namespace + database + hub Kustomizations next to the old asterisk files. Verify: `flux get ks`, `kubectl -n deskphone get postgresql`, SPA loads, OIDC login round-trips. Rollback = revert.
- **Phase 2, cutover (1–3 min SIP gap, pick a quiet moment, `flux suspend/resume ks flux-system` to control timing):** one commit removes `asterisk-config.yaml`, `asterisk-secret.yaml`, `asterisk-deployment.yaml` and adds `deskphone-daemon.yaml` + `daemon/`. Old Service frees `.250`, new `deskphone-asterisk` Service takes it (MetalLB requeues if it races). Names differ, so Helm never meets foreign objects. Verify `pjsip show contacts` shows the HT801 within 2 min; both daemons connect; **stop the laptop daemon right away** (or run it with a different `DESKPHONE_ARI_APP`) because two subscribers to the same Stasis app both get every call. Rollback = revert (old manifests return, HelmRelease uninstalls).
- **Phase 3, finish:** plugin → `https://phone.sem.computer` + device login; import the HT801 and the two softphones into the hub keeping usernames and passwords (`ImportPhoneCommand`; numbers become 10000/10001/10002, devices untouched), then `asterisk.staticPhone.enabled=false` and `asterisk.ingress.enabled=false` (public ARI closed). Housekeeping: no `asterisk*` remnants in the namespace.

Risks to keep in mind: Postgres is a single Longhorn volume (enable the operator's logical backups to SeaweedFS S3 before friends rely on it); SPA shares the origin with the API (strict CSP, HttpOnly cookie, `/rt` is Bearer-only and never serves HTML); Let's Encrypt duplicate-cert limit (only the hub Ingress requests the cert, `secretName`s stay stable); ingress-nginx reloads cut SSE/long-polls (plugin reconnects; the permission hold tolerates a retry); whisper `small` is ~1 GB RAM and seconds of CPU per utterance on the MS-01 (pass the user's language to skip auto-detect; `base` as fallback); friends' routers with SIP ALG (document "disable SIP ALG"); the daemon is a single pod (sessions re-register on restart, voicemail on the PVC).

## 7. Verification (end to end)
1. `npm test` in claude-to-phone; `phpunit` + `phpstan` + `vue-tsc`/`vitest` in deskphone-hub; smoke script green.
2. Local: `compose.yaml` in deskphone-hub (postgres, api with `DEV_LOGIN_ENABLED`, daemon, whisper sidecar, asterisk on :5060) — log in as alice, add a phone, register Zoiper against the LAN IP, run `/phone` with `DESKPHONE_URL=http://localhost:8080`, device-login, dial the extension, get the callback with pre-generated audio, dial bob's phone (friend → rings; after removing the friendship → rejected).
3. kube0, after each phase (§6): `flux get ks|hr`, `kubectl -n deskphone get postgresql`, `dig phone.sem.computer`, `curl -sI https://phone.sem.computer/` (LE cert), OIDC round trip, device login from the MacBook, `/phone` → ext in 101–9999 listed on `/sessions`, SSE stays open >2 min through nginx, HT801 + Zoiper online on `/phones`, `pjsip show contacts`, `svc deskphone-asterisk` has `.250`, call a session + permission prompt, friend call allowed/rejected, idle >1 h disappears, Disconnect button ends the session and the plugin stops re-registering, no `asterisk*` leftovers.

## 8. Order of work
1. **Daemon refactor in standalone mode** (no behaviour change): `http.ts`, `line.ts`, `numbering.ts`, `accounts.ts`/`FileAccounts`, `speech/` split, Stasis-for-everything dialplan + `phone-to-phone` context, generalized MWI, pre-generated audio; tests; ship as a normal release so the laptop setup keeps working.
2. **Hub API**: entities + migration, OIDC + dev login, handle onboarding, friends, phones (HA1), tokens + device flow, internal API, import command, tests, Dockerfile, CI.
3. **Daemon hosted mode**: `hub.ts`, `HubAccounts`, `auth.ts`, `HubPinGuard`, lock reporting, idle expiry, per-owner routing, Azure/Piper/whisper-server backends, `tinyld`; plugin device login + Bearer; smoke test; Dockerfile + CI.
4. **Web SPA**.
5. **Charts** (both) + `helm template` with kube0 values.
6. **kube0**: phases 0–3 from §6.
