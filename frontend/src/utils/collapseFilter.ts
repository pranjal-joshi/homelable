import type { Edge, Node } from '@xyflow/react'
import type { EdgeData, NodeData } from '@/types'

/**
 * Compute the set of node IDs that should be visible on the canvas given the
 * current collapse state of group/zone nodes.
 *
 * A node is hidden if any ancestor (via `parentId`) has
 * `data.custom_colors.collapsed === true`. Root nodes (no `parentId`) are
 * always visible.
 *
 * O(n) — builds a `parentId -> children[]` index once, then BFS from roots.
 */
export function getVisibleNodeIds(nodes: Node<NodeData>[]): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId) {
      const arr = childrenByParent.get(n.parentId)
      if (arr) arr.push(n.id)
      else childrenByParent.set(n.parentId, [n.id])
    }
  }

  // Fast lookup for collapse flag.
  const byId = new Map<string, Node<NodeData>>()
  for (const n of nodes) byId.set(n.id, n)

  const visible = new Set<string>()
  const queue: string[] = []
  for (const n of nodes) {
    if (!n.parentId) queue.push(n.id)
  }

  while (queue.length > 0) {
    const id = queue.shift()!
    visible.add(id)
    const node = byId.get(id)
    if (node && !node.data.collapsed) {
      const children = childrenByParent.get(id)
      if (children) queue.push(...children)
    }
  }

  return visible
}

/**
 * Rewire edges so that any endpoint inside a collapsed subtree is replaced
 * with the nearest visible ancestor (the collapsed zone the user actually
 * sees). Behaviour:
 *
 *  - Both endpoints visible → edge kept as-is.
 *  - One endpoint hidden    → endpoint replaced by its nearest visible
 *                             ancestor; edge surfaces as a "stub" on the
 *                             collapsed zone so the connection is not lost.
 *  - Both endpoints hidden under the *same* collapsed ancestor → dropped
 *                             (would be a self-loop on the zone).
 *  - Multiple original edges that rewire to the same (source, target) pair
 *    are de-duplicated; only the first is kept. Prevents a 20-device Zigbee
 *    mesh from rendering 20 stacked stub edges on the collapsed parent.
 *
 *  Edges with an endpoint whose ancestor chain never reaches a visible node
 *  (orphaned reference) are dropped.
 */
export function rewireEdgesForCollapse(
  edges: Edge<EdgeData>[],
  nodes: Node<NodeData>[],
  visibleIds: Set<string>,
): Edge<EdgeData>[] {
  const parentOf = new Map<string, string | undefined>()
  for (const n of nodes) parentOf.set(n.id, n.parentId)

  const nearestVisible = (id: string): string | null => {
    let cur: string | undefined = id
    // Walk up parentId chain until we hit a visible node or run out.
    while (cur !== undefined) {
      if (visibleIds.has(cur)) return cur
      cur = parentOf.get(cur)
    }
    return null
  }

  const seen = new Set<string>()
  const out: Edge<EdgeData>[] = []
  for (const e of edges) {
    const src = nearestVisible(e.source)
    const tgt = nearestVisible(e.target)
    if (src === null || tgt === null) continue
    if (src === tgt) continue
    const key = `${src}->${tgt}`
    if (seen.has(key)) continue
    seen.add(key)
    if (src === e.source && tgt === e.target) {
      out.push(e)
    } else {
      // Endpoint moved → strip handle hints that referred to the original
      // (hidden) node; let React Flow pick defaults on the visible ancestor.
      out.push({ ...e, source: src, target: tgt, sourceHandle: null, targetHandle: null })
    }
  }
  return out
}
