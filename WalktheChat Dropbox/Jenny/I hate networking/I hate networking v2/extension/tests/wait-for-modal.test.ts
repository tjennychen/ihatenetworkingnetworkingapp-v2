/**
 * @jest-environment jsdom
 */

;(global as any).chrome = {
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  runtime: { onMessage: { addListener: jest.fn() } }
}

import { waitForModal } from '../content/linkedin'

describe('waitForModal', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('resolves true immediately when dialog already present', async () => {
    document.body.innerHTML = '<div role="dialog">modal</div>'
    const p = waitForModal(3000)
    jest.runAllTimers()
    await expect(p).resolves.toBe(true)
  })

  it('resolves false after timeout with no modal', async () => {
    document.body.innerHTML = ''
    const p = waitForModal(500)
    jest.runAllTimers()
    await expect(p).resolves.toBe(false)
  })
})
