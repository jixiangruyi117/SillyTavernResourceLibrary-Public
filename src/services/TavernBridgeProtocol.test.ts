import { describe, expect, it } from 'vitest'

import { bridgeInvitation, isTavernEnvelope, tavernEnvelope } from './TavernBridgeProtocol'

describe('TavernBridgeProtocol', () => {
  it('validates versioned envelopes', () => {
    expect(isTavernEnvelope(tavernEnvelope('hello'))).toBe(true)
    expect(isTavernEnvelope({ ...tavernEnvelope('hello'), version: 99 })).toBe(false)
  })

  it('accepts only complete six-digit invitations with an HTTP origin', () => {
    expect(
      bridgeInvitation(
        'https://srl.example.test/?srlBridge=channel&pair=123456&stOrigin=http%3A%2F%2F127.0.0.1%3A8000',
      ),
    ).toEqual({
      channel: 'channel',
      pairCode: '123456',
      tavernOrigin: 'http://127.0.0.1:8000',
    })
    expect(bridgeInvitation('https://srl.example.test/?srlBridge=x&pair=12')).toBeNull()
  })

  it('accepts device relay resume invitations with a same-origin relay endpoint', () => {
    expect(
      bridgeInvitation(
        'https://srl.example.test/?srlBridge=relay-AB23CD45&pair=123456&stOrigin=http%3A%2F%2F127.0.0.1%3A8000&relayBase=http%3A%2F%2F127.0.0.1%3A8000%2Fapi%2Fplugins%2Fsrl-bridge%2F&relayToken=token-1',
      ),
    ).toEqual({
      channel: 'relay-AB23CD45',
      pairCode: '123456',
      tavernOrigin: 'http://127.0.0.1:8000',
      relayBase: 'http://127.0.0.1:8000/api/plugins/srl-bridge/',
      participantToken: 'token-1',
    })
    expect(
      bridgeInvitation(
        'https://srl.example.test/?srlBridge=relay-AB23CD45&pair=123456&stOrigin=http%3A%2F%2F127.0.0.1%3A8000&relayBase=https%3A%2F%2Fevil.example%2F&relayToken=token-1',
      ),
    ).toBeNull()
  })
})
