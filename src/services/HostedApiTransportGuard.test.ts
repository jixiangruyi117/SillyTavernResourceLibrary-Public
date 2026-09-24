import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('self-hosted image transport boundaries', () => {
  it('does not contain account endpoints or a fixed deployment origin', async () => {
    const source = await readFile(new URL('../core/HostedApiTransport.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/\/api\/auth|HOSTED_API_ORIGIN|https:\/\//u)
    expect(source).toContain('selfHostedImageUpload')
    expect(source).toContain('selfHostedImageDelete')
  })

  it('keeps shared hosted image service routes out of the image service', async () => {
    const source = await readFile(
      new URL('./FrontendWorkshopImageHostingService.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(/\/api\/image-hosting|uploadBlobShared|hostedApiFetch/u)
    expect(source).toContain('uploadBlobSelfHosted')
  })
})
