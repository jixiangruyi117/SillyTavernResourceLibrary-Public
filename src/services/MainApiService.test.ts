import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MainApiService } from './MainApiService'
import type { LocalCredentialRepository } from './LocalCredentialStore'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class MemoryCredentialStore implements LocalCredentialRepository {
  readonly values = new Map<string, string>()
  async save(identifier: string, secret: string) {
    this.values.set(identifier, secret)
  }
  async read(identifier: string) {
    return this.values.get(identifier) ?? ''
  }
  async clear(identifier: string) {
    this.values.delete(identifier)
  }
}

describe('MainApiService', () => {
  it('reports partial stream text before unexpected EOF and marks the reply incomplete', async () => {
    const service = new MainApiService()
    const onText = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    )
    const result = await service.completeWithUsage(
      [{ role: 'user', content: 'hello' }],
      { url: 'https://example.com', model: 'test', stream: true },
      { onText },
    )
    expect(onText).toHaveBeenCalledWith('partial')
    expect(result).toMatchObject({ text: 'partial', finishReason: 'incomplete' })
  })
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('imports a complete profile state and keeps its selected profile', () => {
    const service = new MainApiService()
    const imported = service.importProfilesState({
      activeProfileId: 'remote',
      profiles: [
        {
          id: 'remote',
          name: '远端',
          protocol: 'openai-compatible',
          url: 'https://api.example.com/v1',
          apiKey: 'secret',
          model: 'test',
          stream: false,
          reasoningEffort: 'auto',
          temperature: 0.7,
          topP: 1,
          maxTokens: 0,
          frequencyPenalty: 0,
          presencePenalty: 0,
        },
      ],
    })

    expect(imported.activeProfileId).toBe('remote')
    expect(service.getConfig().apiKey).toBe('secret')
  })

  it('moves a legacy plaintext API key into protected storage and rehydrates it', async () => {
    localStorage.setItem(
      'srl.mainApi.profiles.v2',
      JSON.stringify({
        activeProfileId: 'default',
        profiles: [
          {
            id: 'default',
            name: '主 API',
            protocol: 'openai-compatible',
            url: 'https://api.example.com/v1',
            apiKey: 'legacy-secret',
            model: 'example-model',
          },
        ],
      }),
    )
    const credentials = new MemoryCredentialStore()
    const first = new MainApiService(credentials)

    await first.initializeCredentials()

    expect(credentials.values.get('main-api:default')).toBe('legacy-secret')
    expect(localStorage.getItem('srl.mainApi.profiles.v2')).not.toContain('legacy-secret')
    expect(localStorage.getItem('srl.mainApi.config.v1')).toBeNull()

    const reopened = new MainApiService(credentials)
    await reopened.initializeCredentials()
    expect(reopened.getConfig().apiKey).toBe('legacy-secret')
  })

  it('keeps session-only API keys out of persistent storage', async () => {
    const credentials = new MemoryCredentialStore()
    const service = new MainApiService(credentials)
    await service.initializeCredentials()
    service.saveProfile({
      ...service.getActiveProfile(),
      apiKey: 'temporary-secret',
      credentialPersistence: 'session',
    })
    await service.awaitCredentialWrites()

    expect(service.getConfig().apiKey).toBe('temporary-secret')
    expect(credentials.values.size).toBe(0)
    expect(localStorage.getItem('srl.mainApi.profiles.v2')).not.toContain('temporary-secret')
  })

  it('does not delete legacy plaintext when protected migration fails', async () => {
    localStorage.setItem(
      'srl.mainApi.config.v1',
      JSON.stringify({
        protocol: 'openai-compatible',
        url: 'https://api.example.com/v1',
        apiKey: 'keep-on-failure',
      }),
    )
    const credentials = new MemoryCredentialStore()
    credentials.save = async () => {
      throw new Error('device store unavailable')
    }
    const service = new MainApiService(credentials)

    await expect(service.initializeCredentials()).rejects.toThrow('device store unavailable')
    expect(localStorage.getItem('srl.mainApi.config.v1')).toContain('keep-on-failure')
    expect(service.getConfig().apiKey).toBe('keep-on-failure')
  })

  it('uses an OpenAI-compatible chat-completions endpoint and parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()
    service.saveConfig({
      protocol: 'openai-compatible',
      url: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'example-model',
      stream: false,
      reasoningEffort: 'low',
      temperature: 0.4,
      topP: 0.8,
      maxTokens: 393216,
      frequencyPenalty: 0.2,
      presencePenalty: -0.1,
    })

    await expect(service.complete([{ role: 'user', content: 'hello' }])).resolves.toBe('OK')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/chat/completions')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'example-model',
      temperature: 0.4,
      top_p: 0.8,
      max_tokens: 393216,
      reasoning_effort: 'low',
    })
  })

  it('returns provider token usage and falls back to a marked estimate when absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '完成' } }],
            usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '继续完成' } }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()
    const config = {
      ...service.getConfig(),
      url: 'https://api.example.com/v1',
      model: 'usage-model',
    }

    await expect(
      service.completeWithUsage([{ role: 'user', content: '生成状态栏' }], config),
    ).resolves.toMatchObject({
      text: '完成',
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        source: 'provider',
      },
    })
    const estimated = await service.completeWithUsage(
      [{ role: 'user', content: '继续生成状态栏' }],
      config,
    )
    expect(estimated.usage.source).toBe('estimated')
    expect(estimated.usage.totalTokens).toBeGreaterThan(0)
  })

  it.each([false, true])('不把兼容接口内容数组中的推理拼进 JSON 正文 stream=%s', async (stream) => {
    const content = [
      { type: 'reasoning', text: '先分析范围' },
      { type: 'thinking', text: '再生成补丁' },
      { type: 'text', text: '{"edits":[]}' },
    ]
    const body = stream
      ? `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
      : JSON.stringify({ choices: [{ message: { content } }] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const service = new MainApiService()
    const result = await service.completeWithUsage([{ role: 'user', content: '修改' }], {
      ...service.getConfig(),
      url: 'https://api.example.com/v1',
      model: 'test',
      stream,
    })
    expect(JSON.parse(result.text)).toEqual({ edits: [] })
    expect(result.reasoning).toBe('先分析范围\n再生成补丁')
  })

  it.each(['openai-compatible', 'anthropic-compatible'] as const)(
    '保留 %s 的非流式和流式输出截断原因',
    async (protocol) => {
      const openai = protocol === 'openai-compatible'
      const body = openai
        ? { choices: [{ message: { content: '{' }, finish_reason: 'length' }] }
        : { content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens' }
      const events = openai
        ? [
            { choices: [{ delta: { content: '{' } }] },
            { choices: [{ delta: {}, finish_reason: 'length' }] },
          ]
        : [
            { type: 'content_block_delta', delta: { type: 'text_delta', text: '{' } },
            { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
          ]
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify(body)))
          .mockResolvedValueOnce(
            new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')),
          ),
      )
      const service = new MainApiService()
      const config = {
        ...service.getConfig(),
        url: 'https://api.example.com/v1',
        model: 'test',
        protocol,
        maxTokens: 128,
      }
      for (const stream of [false, true]) {
        await expect(
          service.completeWithUsage([{ role: 'user', content: '修改' }], { ...config, stream }),
        ).resolves.toMatchObject({ text: '{', finishReason: openai ? 'length' : 'max_tokens' })
      }
    },
  )

  it('只返回 Provider 明确提供的非流式 reasoning 字段', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '完成', reasoning_content: '先核对结构，再生成补丁。' } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              { type: 'thinking', thinking: '先确认写入范围。' },
              { type: 'text', text: '完成' },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()
    const base = { ...service.getConfig(), url: 'https://api.example.com/v1', model: 'reasoning' }

    await expect(
      service.completeWithUsage([{ role: 'user', content: '修改' }], base),
    ).resolves.toMatchObject({ text: '完成', reasoning: '先核对结构，再生成补丁。' })
    await expect(
      service.completeWithUsage([{ role: 'user', content: '修改' }], {
        ...base,
        protocol: 'anthropic-compatible',
        maxTokens: 2048,
      }),
    ).resolves.toMatchObject({ text: '完成', reasoning: '先确认写入范围。' })
  })

  it('allows a longer timeout for one generation without changing the saved API profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const service = new MainApiService()
    const config = {
      ...service.getConfig(),
      url: 'https://api.example.com/v1',
      model: 'slow-model',
    }

    await expect(
      service.completeWithUsage([{ role: 'user', content: 'hello' }], config, {
        timeoutMs: 300_000,
      }),
    ).resolves.toMatchObject({ text: 'OK' })

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 300_000)
    expect(service.getConfig()).not.toHaveProperty('timeoutMs')
  })

  it('passes caller cancellation to the in-flight provider fetch', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('cancelled', 'AbortError')),
              { once: true },
            )
          }),
      ),
    )
    const service = new MainApiService()
    const pending = service.complete(
      [{ role: 'user', content: '分析' }],
      { ...service.getConfig(), url: 'https://api.example.com/v1', model: 'cancel-model' },
      { signal: controller.signal },
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('translates reference images for OpenAI-compatible vision models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()
    const config = {
      ...service.getConfig(),
      url: 'https://api.example.com/v1',
      model: 'vision-model',
    }

    await service.complete(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '只参考配色' },
            { type: 'image', dataUrl: 'data:image/png;base64,AAAA' },
          ],
        },
      ],
      config,
    )

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: unknown[] }>
    }
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: '只参考配色' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' },
      },
    ])
  })

  it('uses automatic token limits by default and parses an OpenAI-compatible stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"先检查"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"你"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"好"}}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()
    service.saveConfig({
      ...service.getConfig(),
      url: 'https://api.example.com/v1',
      model: 'stream-model',
      stream: true,
      maxTokens: 0,
    })

    await expect(
      service.completeWithUsage([{ role: 'user', content: 'hello' }]),
    ).resolves.toMatchObject({ text: '你好', reasoning: '先检查' })
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<
      string,
      unknown
    >
    expect(body.stream).toBe(true)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('pulls and normalizes available models from the configured models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'model-b', owned_by: 'example' },
            { id: 'model-a', name: 'Model A' },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()

    await expect(
      service.listModels({
        ...service.getConfig(),
        url: 'https://api.example.com/v1/chat/completions',
        apiKey: 'secret',
      }),
    ).resolves.toEqual([
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'model-b' },
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/models')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret',
    )
  })

  it('parses Anthropic-compatible text deltas and requires an explicit token limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          [
            'event: content_block_delta',
            'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"先确认"}}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"完"}}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"成"}}',
            '',
          ].join('\n'),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()
    const config = {
      ...service.getConfig(),
      protocol: 'anthropic-compatible' as const,
      url: 'https://api.example.com/v1',
      model: 'claude-example',
      stream: true,
      maxTokens: 2048,
    }

    await expect(
      service.completeWithUsage([{ role: 'user', content: 'hello' }], config),
    ).resolves.toMatchObject({ text: '完成', reasoning: '先确认' })
    await expect(
      service.complete([{ role: 'user', content: 'hello' }], { ...config, maxTokens: 0 }),
    ).rejects.toThrow('Anthropic Messages 协议要求')
  })

  it('translates reference images for Anthropic-compatible vision models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: '完成' }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = new MainApiService()

    await service.complete(
      [
        { role: 'system', content: '设计状态栏' },
        {
          role: 'user',
          content: [
            { type: 'text', text: '参考结构' },
            { type: 'image', dataUrl: 'data:image/webp;base64,AQID' },
          ],
        },
      ],
      {
        ...service.getConfig(),
        protocol: 'anthropic-compatible',
        url: 'https://api.example.com/v1',
        model: 'claude-vision',
        maxTokens: 2048,
      },
    )

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: unknown[] }>
    }
    expect(body.messages[0]?.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: 'AQID' },
    })
  })

  it('migrates the old single config and keeps multiple named profiles', () => {
    localStorage.setItem(
      'srl.mainApi.config.v1',
      JSON.stringify({
        protocol: 'openai-compatible',
        url: 'https://old.example.com/v1',
        model: 'old-model',
      }),
    )
    const service = new MainApiService()

    expect(service.getActiveProfile()).toMatchObject({
      name: '原主 API',
      url: 'https://old.example.com/v1',
    })

    const second = service.createProfile('绘图接口')
    service.saveProfile({
      ...second,
      url: 'https://new.example.com/v1',
      model: 'new-model',
    })
    service.setActiveProfile(second.id)

    expect(service.getProfiles()).toHaveLength(2)
    expect(service.getConfig()).toMatchObject({
      url: 'https://new.example.com/v1',
      model: 'new-model',
      maxTokens: 0,
      stream: false,
      reasoningEffort: 'auto',
    })
  })

  it('migrates the former 4096 default to automatic without changing newer profiles', () => {
    localStorage.setItem(
      'srl.mainApi.profiles.v2',
      JSON.stringify({
        activeProfileId: 'legacy',
        profiles: [
          {
            id: 'legacy',
            name: '旧配置',
            protocol: 'openai-compatible',
            url: 'https://api.example.com/v1',
            apiKey: '',
            model: 'example-model',
            temperature: 0.7,
            topP: 1,
            maxTokens: 4096,
            frequencyPenalty: 0,
            presencePenalty: 0,
          },
        ],
      }),
    )

    expect(new MainApiService().getConfig().maxTokens).toBe(0)
  })

  it('does not allow deleting the last API profile', () => {
    const service = new MainApiService()
    const only = service.getActiveProfile()

    expect(() => service.deleteProfile(only.id)).toThrow('至少保留一个')
  })
})
