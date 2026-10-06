import { describe, expect, it } from 'vitest'
import { getNodeAncestorPath, type FrontendWorkshopNode } from './FrontendWorkshopProject'

function node(id: string, children: FrontendWorkshopNode[] = []): FrontendWorkshopNode {
  return { id, kind: 'text', label: id, style: {}, children }
}

describe('getNodeAncestorPath', () => {
  it('为根元素返回页面下的单级路径', () => {
    expect(getNodeAncestorPath([node('文字')], '文字').map((item) => item.id)).toEqual(['文字'])
  })

  it('按从根到当前元素的顺序返回完整嵌套路径', () => {
    const text = node('文字')
    const blockB = node('区块 B', [text])
    const blockA = node('区块 A', [blockB])

    expect(getNodeAncestorPath([blockA], '文字').map((item) => item.id)).toEqual([
      '区块 A',
      '区块 B',
      '文字',
    ])
  })

  it('未命中节点不产生过期路径', () => {
    expect(getNodeAncestorPath([node('文字')], '不存在')).toEqual([])
  })
})
