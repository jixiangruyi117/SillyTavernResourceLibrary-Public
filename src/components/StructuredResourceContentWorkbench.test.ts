/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import StructuredResourceContentWorkbench from './StructuredResourceContentWorkbench.vue'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'

const save = vi.hoisted(() => vi.fn())
vi.mock('../core/AppContainer', () => ({ resourceService: { saveStructuredContent: save } }))
vi.mock('../composables/UseConfirmDialog', () => ({
  chooseAction: vi.fn().mockResolvedValue('confirm'),
  confirmAction: vi.fn().mockResolvedValue(true),
}))
describe('standalone entry editing UI', () => {
  it('does not reuse the editor identity of a removed original WI entry for a newly created one', async () => {
    const content = { entries: { '7': { uid: 7, content: '旧条目', unknown: '不能带到新条目' } } }
    const resource = { id: 'r', type: RESOURCE_TYPE.WORLD_BOOK, contentHash: 'old' } as Resource
    const wrapper = mount(StructuredResourceContentWorkbench, { props: { resource, content } })
    try {
      await wrapper.get('button').trigger('click')
      await wrapper.get('.card-content-workbench__list li').findAll('button')[1]!.trigger('click')
      await flushPromises()
      await wrapper.get('.card-content-workbench__actions .is-primary').trigger('click')
      await flushPromises()
      await wrapper.get('textarea:not(.is-keys)').setValue('新条目')
      save.mockResolvedValueOnce(resource)
      expect(
        await (wrapper.vm as unknown as { prepareSave: () => Promise<boolean> }).prepareSave(),
      ).toBe(true)
      const edits = save.mock.lastCall![2]
      expect(edits).toEqual([
        expect.objectContaining({ operation: 'delete', targetKey: '0' }),
        expect.objectContaining({ operation: 'add', targetKey: '1' }),
      ])
    } finally {
      wrapper.unmount()
    }
  })
  it.each([RESOURCE_TYPE.WORLD_BOOK, RESOURCE_TYPE.REGEX])(
    'saves pending %s input through the shared form and version service',
    async (type) => {
      const content =
        type === RESOURCE_TYPE.WORLD_BOOK
          ? { entries: { '7': { uid: 7, content: '原正文', key: ['夜港'] } } }
          : {
              id: 'r',
              scriptName: '规则',
              findRegex: '/夜港/g',
              replaceString: '旧',
              placement: [2],
            }
      const resource = {
        id: 'r',
        type,
        contentHash: 'old',
        originalBlob: new Blob([JSON.stringify(content)]),
      } as Resource
      save.mockResolvedValueOnce({ ...resource, contentHash: 'new' })
      const wrapper = mount(StructuredResourceContentWorkbench, { props: { resource, content } })
      try {
        await wrapper.get('button').trigger('click')
        expect(wrapper.find('.card-content-workbench__tabs').exists()).toBe(false)
        expect(wrapper.find('.card-content-workbench__migration').exists()).toBe(false)
        await wrapper.get('.card-content-workbench__list button').trigger('click')
        await flushPromises()
        if (type === RESOURCE_TYPE.WORLD_BOOK)
          await wrapper.get('textarea:not(.is-keys)').setValue('新正文')
        else await wrapper.get('textarea').setValue('新替换')
        expect(wrapper.emitted('draft-change')?.at(-1)).toEqual([true])
        const exposed = wrapper.vm as unknown as { prepareSave: () => Promise<boolean> }
        expect(await exposed.prepareSave()).toBe(true)
        expect(save).toHaveBeenLastCalledWith(
          'r',
          'old',
          [
            expect.objectContaining({
              section: type === RESOURCE_TYPE.WORLD_BOOK ? 'worldBook' : 'regex',
              after: expect.objectContaining(
                type === RESOURCE_TYPE.WORLD_BOOK
                  ? { content: '新正文' }
                  : { replaceString: '新替换' },
              ),
              migrateToVersions: false,
            }),
          ],
          'global',
        )
        expect(wrapper.emitted('saved')?.at(-1)?.[0]).toMatchObject({ contentHash: 'new' })
        expect(wrapper.emitted('draft-change')?.at(-1)).toEqual([false])
      } finally {
        wrapper.unmount()
      }
    },
  )
  it('keeps an applied draft when saving fails and blocks invalid regex input', async () => {
    const content = { scriptName: '规则', findRegex: '/a/g', replaceString: 'b', placement: [2] }
    const wrapper = mount(StructuredResourceContentWorkbench, {
      props: {
        resource: { id: 'r', type: RESOURCE_TYPE.REGEX, contentHash: 'old' } as Resource,
        content,
      },
    })
    try {
      await wrapper.get('button').trigger('click')
      await wrapper.get('.card-content-workbench__list button').trigger('click')
      await flushPromises()
      await wrapper.get('input.is-code').setValue('')
      const exposed = wrapper.vm as unknown as { prepareSave: () => Promise<boolean> }
      expect(await exposed.prepareSave()).toBe(false)
      expect(wrapper.text()).toContain('请填写')
      await wrapper.get('input.is-code').setValue('/新/g')
      save.mockRejectedValueOnce(new Error('资源版本已变化'))
      expect(await exposed.prepareSave()).toBe(false)
      expect(wrapper.text()).toContain('资源版本已变化')
      expect(wrapper.emitted('saved')).toBeUndefined()
      expect(wrapper.emitted('draft-change')?.at(-1)).toEqual([true])
    } finally {
      wrapper.unmount()
    }
  })
})
