import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { getVisibleNodeIds, rewireEdgesForCollapse } from '../collapseFilter'
import type { EdgeData, NodeData } from '@/types'

const mkNode = (
  id: string,
  parentId?: string,
  collapsed?: boolean,
): Node<NodeData> => ({
  id,
  position: { x: 0, y: 0 },
  ...(parentId ? { parentId } : {}),
  data: {
    label: id,
    type: parentId ? 'server' : 'groupRect',
    status: 'online',
    services: [],
    ...(collapsed !== undefined ? { collapsed } : {}),
  },
})

const mkEdge = (id: string, source: string, target: string): Edge<EdgeData> => ({
  id,
  source,
  target,
})

describe('getVisibleNodeIds', () => {
  it('returns all nodes when nothing is collapsed', () => {
    const nodes = [
      mkNode('zone'),
      mkNode('child-a', 'zone'),
      mkNode('child-b', 'zone'),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone', 'child-a', 'child-b']))
  })

  it('hides direct children of a collapsed zone but keeps the zone itself', () => {
    const nodes = [
      mkNode('zone', undefined, true),
      mkNode('child-a', 'zone'),
      mkNode('child-b', 'zone'),
      mkNode('outside'),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone', 'outside']))
  })

  it('hides the entire subtree when an ancestor is collapsed (multi-level)', () => {
    const nodes = [
      mkNode('root', undefined, true),
      mkNode('mid', 'root', false), // expanded but parent collapsed → still hidden
      mkNode('leaf', 'mid'),
    ]
    const visible = getVisibleNodeIds(nodes)
    expect(visible.has('root')).toBe(true)
    expect(visible.has('mid')).toBe(false)
    expect(visible.has('leaf')).toBe(false)
  })

  it('hides only the nested subtree when an inner zone is collapsed', () => {
    const nodes = [
      mkNode('root', undefined, false),
      mkNode('inner', 'root', true),
      mkNode('leaf', 'inner'),
      mkNode('sibling', 'root'),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['root', 'inner', 'sibling']))
  })

  it('handles a zone with no children', () => {
    const nodes = [mkNode('empty-zone', undefined, true)]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['empty-zone']))
  })

  it('returns an empty set for empty input', () => {
    expect(getVisibleNodeIds([])).toEqual(new Set())
  })

  it('treats nodes with no custom_colors as expanded', () => {
    const nodes = [mkNode('zone'), mkNode('child', 'zone')]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone', 'child']))
  })

  it('is independent of insertion order (children declared before parent)', () => {
    const nodes = [
      mkNode('child', 'zone'),
      mkNode('zone', undefined, true),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone']))
  })
})

describe('rewireEdgesForCollapse', () => {
  it('keeps edges between two visible nodes unchanged (same reference)', () => {
    const nodes = [mkNode('a'), mkNode('b')]
    const edges = [mkEdge('e1', 'a', 'b')]
    const out = rewireEdgesForCollapse(edges, nodes, new Set(['a', 'b']))
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(edges[0])
  })

  it('reroutes a cross-boundary edge to the collapsed ancestor', () => {
    const nodes = [
      mkNode('zone', undefined, true),
      mkNode('leaf', 'zone'),
      mkNode('outside'),
    ]
    const visible = getVisibleNodeIds(nodes)
    const edges = [mkEdge('e1', 'outside', 'leaf')]
    const out = rewireEdgesForCollapse(edges, nodes, visible)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('outside')
    expect(out[0].target).toBe('zone')
    // Handle hints stripped when the endpoint moved.
    expect(out[0].sourceHandle).toBeNull()
    expect(out[0].targetHandle).toBeNull()
  })

  it('drops an edge between two siblings inside the same collapsed zone (self-loop)', () => {
    const nodes = [
      mkNode('zone', undefined, true),
      mkNode('a', 'zone'),
      mkNode('b', 'zone'),
    ]
    const visible = getVisibleNodeIds(nodes)
    const edges = [mkEdge('e1', 'a', 'b')]
    expect(rewireEdgesForCollapse(edges, nodes, visible)).toEqual([])
  })

  it('de-dupes multiple cross-boundary edges that rewire to the same pair', () => {
    // 20-device Zigbee mesh: many edges from outside coordinator to leaves
    // inside a collapsed zone should collapse to a single stub.
    const nodes = [
      mkNode('zone', undefined, true),
      mkNode('coord'),
      ...Array.from({ length: 5 }, (_, i) => mkNode(`leaf-${i}`, 'zone')),
    ]
    const visible = getVisibleNodeIds(nodes)
    const edges = Array.from({ length: 5 }, (_, i) =>
      mkEdge(`e-${i}`, 'coord', `leaf-${i}`),
    )
    const out = rewireEdgesForCollapse(edges, nodes, visible)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('coord')
    expect(out[0].target).toBe('zone')
  })

  it('walks the chain to the nearest visible ancestor (nested collapse)', () => {
    const nodes = [
      mkNode('root', undefined, true),
      mkNode('mid', 'root'),
      mkNode('leaf', 'mid'),
      mkNode('outside'),
    ]
    const visible = getVisibleNodeIds(nodes)
    const edges = [mkEdge('e1', 'outside', 'leaf')]
    const out = rewireEdgesForCollapse(edges, nodes, visible)
    expect(out[0].target).toBe('root')
  })

  it('drops an edge whose endpoint has no visible ancestor', () => {
    const nodes = [mkNode('orphan-parent', undefined, true)]
    const visible = new Set<string>() // nothing visible at all
    const edges = [mkEdge('e1', 'ghost', 'orphan-parent')]
    expect(rewireEdgesForCollapse(edges, nodes, visible)).toEqual([])
  })

  it('returns an empty array for empty input', () => {
    expect(rewireEdgesForCollapse([], [], new Set())).toEqual([])
  })
})
