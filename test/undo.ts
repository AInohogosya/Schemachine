// ============================================================================
// Store undo/redo regression checks (hardware + circuit editing history).
// Run with: npm run test:undo
// ============================================================================

import { emptyProject, initStore, uid } from '../src/store'
import type { HardwarePartData, JointData } from '../src/types'

let passes = 0
let failures = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passes++
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function part(name: string, x: number): HardwarePartData {
  return { id: uid('p'), name, kind: 'block', x, y: 800, z: 0, angle: 0, w: 40, h: 40, props: {} }
}

function joint(a: string, b: string): JointData {
  return { id: uid('j'), type: 'pin', a, b, ax: 0, ay: 0, bx: 0, by: 0, props: {} }
}

async function main() {
  // --- basic place -> undo -> redo ---
  {
    const store = initStore(emptyProject('Undo test'))
    store.beginChange('place')
    store.project.hardware.parts.push(part('Block 1', 100))
    store.markHardwareDirty()
    check('place registers an undo point', store.canUndo)
    check('nothing to redo after a fresh change', !store.canRedo)
    store.undo()
    check('undo removes the placed part', store.project.hardware.parts.length === 0)
    check('redo becomes available after undo', store.canRedo)
    store.redo()
    check('redo restores the placed part', store.project.hardware.parts.length === 1)
  }

  // --- coalescing: same tag within the window is one undo step ---
  {
    const store = initStore(emptyProject('Coalesce test'))
    const p = part('Block 1', 0)
    store.project.hardware.parts.push(p)
    store.beginChange(`nudge:${p.id}`)
    p.x += 5
    store.beginChange(`nudge:${p.id}`)
    p.x += 5
    store.beginChange(`nudge:${p.id}`)
    p.x += 5
    store.undo()
    check('coalesced nudges undo in one step', store.project.hardware.parts[0].x === 0, `x=${store.project.hardware.parts[0].x}`)
  }

  // --- distinct actions stay distinct undo steps ---
  {
    const store = initStore(emptyProject('Steps test'))
    store.beginChange('place:1')
    store.project.hardware.parts.push(part('Block 1', 0))
    store.beginChange('place:2')
    store.project.hardware.parts.push(part('Block 2', 100))
    store.undo()
    check('second placement undone first', store.project.hardware.parts.length === 1)
    store.undo()
    check('first placement undone second', store.project.hardware.parts.length === 0)
    store.redo()
    store.redo()
    check('redo replays both placements', store.project.hardware.parts.length === 2)
  }

  // --- deleteSelection records history ---
  {
    const store = initStore(emptyProject('Delete test'))
    const p = part('Block 1', 0)
    store.project.hardware.parts.push(p)
    store.setSelection({ kind: 'part', id: p.id })
    store.deleteSelection()
    check('delete removed the part', store.project.hardware.parts.length === 0)
    store.undo()
    check('undo restores the deleted part', store.project.hardware.parts.length === 1)
  }

  // --- deleting a part cascades joint cleanup, and undo restores both ---
  {
    const store = initStore(emptyProject('Cascade test'))
    const a = part('Block 1', 0)
    const b = part('Block 2', 100)
    store.project.hardware.parts.push(a, b)
    const j = joint(a.id, b.id)
    store.project.hardware.joints.push(j)
    store.setSelection({ kind: 'part', id: a.id })
    store.deleteSelection()
    check('cascade removed the joint', store.project.hardware.joints.length === 0)
    store.undo()
    check('undo restores part and joint', store.project.hardware.parts.length === 2 && store.project.hardware.joints.length === 1)
  }

  // --- drag snapshot pattern: pushSnapshot of captured pre-state ---
  {
    const store = initStore(emptyProject('Drag test'))
    const p = part('Block 1', 0)
    store.project.hardware.parts.push(p)
    const preSnap = store.snapshot()
    p.x = 250
    store.pushSnapshot(preSnap)
    store.undo()
    check('drag undo restores pre-drag position', store.project.hardware.parts[0].x === 0)
  }

  // --- loadProject is undoable ---
  {
    const store = initStore(emptyProject('Load test'))
    store.loadProject({ ...emptyProject('Replacement'), groundY: 800 })
    store.undo()
    check('undo restores the previous workspace', store.project.name === 'Load test' && store.project.groundY === 900)
  }

  // --- undo clears transient tools/selection ---
  {
    const store = initStore(emptyProject('State test'))
    const p = part('Block 1', 0)
    store.project.hardware.parts.push(p)
    store.setSelection({ kind: 'part', id: p.id })
    store.partPlacement = 'wheel'
    store.beginChange('place')
    store.project.hardware.parts.push(part('Block 2', 100))
    store.undo()
    check('undo clears selection', store.selection.kind === 'none')
    check('undo clears placement tool', store.partPlacement === null)
  }

  console.log(`\nundo: ${passes} passed, ${failures} failed`)
  if (failures > 0) throw new Error(`${failures} undo test(s) failed`)
}

main().catch((error) => {
  console.error(error)
  throw error
})
