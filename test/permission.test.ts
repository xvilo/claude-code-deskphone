import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describePermission, parseDecision } from '../src/daemon/permission.ts'

test('describes common tools briefly', () => {
  assert.equal(describePermission('Read', { file_path: '/Users/me/app/src/StripeV3Add.js' }), 'read StripeV3Add.js')
  assert.equal(describePermission('Bash', { command: 'rm -rf node_modules', description: 'Remove node_modules directory' }), 'run a command: Remove node_modules directory')
  assert.equal(describePermission('WebFetch', { url: 'https://docs.stripe.com/js' }), 'fetch docs.stripe.com')
  assert.equal(describePermission('mcp__plugin_playwright__browser_click', {}), 'use plugin playwright browser click')
})

test('parses spoken decisions, with no taking precedence', () => {
  assert.equal(parseDecision('Yes.'), 'allow')
  assert.equal(parseDecision('Yeah, go ahead'), 'allow')
  assert.equal(parseDecision('No, don\'t allow that.'), 'deny')
  assert.equal(parseDecision('Ja hoor'), 'allow')
  assert.equal(parseDecision('Hmm, what?'), null)
  assert.equal(parseDecision('I know'), null)
})
