import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAmounts, formatAmount, formatDate } from '../shared/format.js'

test('amounts preserve integer precision above the JavaScript safe range', () => {
  assert.equal(formatAmount('9007199254740993'), '9.007.199.254.740.993')
  assert.equal(formatAmount('-26200000'), '-26.200.000')
  assert.equal(formatAmount(0n), '0')
  assert.equal(compareAmounts('9007199254740993', '9007199254740992'), 1)
  assert.equal(compareAmounts('-12', '-2'), -1)
  assert.equal(compareAmounts('00042', 42n), 0)
})

test('amount formatting rejects imprecise or malformed input', () => {
  for (const value of [9007199254740992, 1.5, '1.5', '', '1e6', null, undefined]) {
    assert.throws(() => formatAmount(value), TypeError)
  }
})

test('business dates retain their calendar day across time zones', () => {
  const originalTimezone = process.env.TZ
  try {
    for (const timezone of ['America/Santiago', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      process.env.TZ = timezone
      assert.equal(formatDate('2026-09-27'), '27-09-2026')
      assert.equal(formatDate('2024-02-29'), '29-02-2024')
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  }
})

test('date formatting rejects invalid calendar dates and timestamps', () => {
  for (const value of ['2026-02-29', '2026-13-01', '2026-9-27', '2026-09-27T00:00:00Z', null]) {
    assert.throws(() => formatDate(value), TypeError)
  }
})
