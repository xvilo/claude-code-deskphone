// Simulates dialing an extension without a phone: Asterisk sends a 2 s tone
// into the call, so a working setup logs the greeting, then whisper's take on
// the tone (usually nothing, answered with "Sorry, I didn't catch that").
// Needs the deskphone-test dialplan context.
const [ext = '101'] = process.argv.slice(2)
const base = (process.env.DESKPHONE_ARI_URL ?? 'http://127.0.0.1:8088/ari').split(',')[0].trim()
const auth = `Basic ${Buffer.from(`${process.env.DESKPHONE_ARI_USER ?? 'deskphone'}:${process.env.DESKPHONE_ARI_PASSWORD ?? 'deskphone'}`).toString('base64')}`

const params = new URLSearchParams({ endpoint: 'Local/fake@deskphone-test/n', app: 'deskphone', appArgs: `inbound,${ext}` })
const res = await fetch(`${base}/channels?${params}`, { method: 'POST', headers: { Authorization: auth } })
console.log(res.ok ? `calling ext ${ext} via ${base}` : `failed: ${res.status} ${await res.text()}`)
