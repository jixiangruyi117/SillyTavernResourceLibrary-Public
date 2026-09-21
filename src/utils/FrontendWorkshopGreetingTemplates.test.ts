/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import archive from '../templates/FrontendWorkshopArchive.html?raw'
import observatory from '../templates/FrontendWorkshopObservatory.html?raw'

function run(source: string, read?: () => unknown, write?: (value: unknown) => Promise<void>) {
  document.documentElement.innerHTML = source
  const script = document.querySelector('script:not([type])')!.textContent!
  new Function('document', 'matchMedia', 'getChatMessages', 'setChatMessages', script)(
    document,
    () => ({ matches: true }),
    read,
    write,
  )
}

function click(selector: string) {
  document.querySelector<HTMLButtonElement>(selector)!.click()
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('greeting template interaction contracts', () => {
  it('keeps complete sample greetings usable when preview APIs exist without alternate swipes', () => {
    const write = vi.fn().mockResolvedValue(undefined)
    run(archive, () => [{ swipes: ['directory'] }], write)
    expect(document.querySelectorAll('.story')).toHaveLength(3)
    expect(document.querySelector('.story-preview')!.textContent!.length).toBeGreaterThan(180)
    click('#next-story')
    expect(document.querySelector('#story-title')!.textContent).toBe('旧街重逢')
    expect(document.querySelector('.story-preview')!.textContent).toContain('第七十三页')
    click('#previous-story')
    click('#previous-story')
    expect(document.querySelector('#story-title')!.textContent).toBe('未完成的约定')
    expect(document.querySelector<HTMLButtonElement>('#enter-story')!.hidden).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('also reads samples without host APIs and survives rapid wraparound', () => {
    run(archive)
    for (let i = 0; i < 20; i++) click('#next-story')
    expect(document.querySelector('.book-count')!.textContent).toBe('03 / 03')
    expect(document.querySelectorAll('.story[aria-pressed="true"]')).toHaveLength(1)
    expect(document.querySelector('.turning-page')).toBeNull()
  })

  it('reads the actual host text and switches only after the explicit enter action', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    run(archive, () => [{ swipes: ['directory', '真实第一段', '真实第二段'] }], write)
    click('#next-story')
    expect(document.querySelector('.story-preview')!.textContent).toBe('真实第二段')
    expect(write).not.toHaveBeenCalled()
    click('#enter-story')
    await Promise.resolve()
    expect(write).toHaveBeenCalledExactlyOnceWith([{ message_id: 0, swipe_id: 2 }])
  })

  it('switches the real alternate greeting directly when its list entry is clicked', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    run(archive, () => [{ swipes: ['directory', '真实第一段', '真实第二段'] }], write)
    click('.story:nth-child(2)')
    click('.story:nth-child(1)')
    await Promise.resolve()
    expect(write).toHaveBeenCalledExactlyOnceWith([{ message_id: 0, swipe_id: 2 }])
    expect(document.querySelector('.story-preview')!.textContent).toBe('真实第一段')
    expect(document.querySelector('.story:nth-child(2) strong')!.textContent).toBe('备用开场白 2')
  })

  it('does not switch a host greeting that changed after the directory was read', async () => {
    let swipes = ['directory', '原文']
    const write = vi.fn().mockResolvedValue(undefined)
    run(archive, () => [{ swipes }], write)
    swipes = ['directory', '新内容']
    click('#enter-story')
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
    expect(document.querySelector('.status')!.textContent).toContain('已变化')
    expect(document.querySelector<HTMLButtonElement>('#enter-story')!.disabled).toBe(false)
  })

  it('cycles spatial portraits and readable story cards without inventing MVU values', () => {
    run(observatory)
    click('[data-direction="1"]')
    expect(document.querySelector('#scene-count')!.textContent).toBe('02 / 03')
    expect(document.querySelector('.card[aria-hidden="false"]')!.getAttribute('data-scene')).toBe(
      '1',
    )
    click('#memory-next')
    expect(document.querySelector('.memory[aria-hidden="false"] h3')!.textContent).toBe(
      '凌晨的末班车',
    )
    click('#memory-previous')
    click('#memory-previous')
    expect(document.querySelector('#memory-status')!.textContent).toContain('03 / 03')
    expect(document.querySelector('[data-field="affection"]')!.textContent).toBe('—')
    expect(document.querySelector('.mvu-status')!.textContent).toContain('尚未连接')
  })

  it('enters a real alternate greeting from the observatory stack', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    run(observatory, () => [{ swipes: ['directory', '宿主第一封', '宿主第二封'] }], write)
    click('#memory-next')
    expect(document.querySelector('.memory[aria-hidden="false"] p')!.textContent).toBe('宿主第二封')
    expect(write).not.toHaveBeenCalled()
    click('#memory-enter')
    await Promise.resolve()
    expect(write).toHaveBeenCalledExactlyOnceWith([{ message_id: 0, swipe_id: 2 }])
  })
})
