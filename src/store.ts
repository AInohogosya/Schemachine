// ============================================================================
// SCHEMACHINE project store — single source of truth for project structure.
// Runtime values (solver / physics) live in their engines; this store holds
// editable data + UI selection state. React subscribes via useSyncExternalStore.
// ============================================================================

import type { CircuitComponentData, HardwarePartData, JointData, ProjectData } from './types'

export type ViewMode = 'schematic' | 'hardware' | 'sim' | 'studio'

export interface Selection {
  kind: 'none' | 'circuit' | 'wire' | 'part' | 'joint'
  id: string
}

export interface ToastMsg {
  id: number
  text: string
  kind: 'info' | 'warn' | 'error' | 'ok'
}

export interface CameraState {
  x: number
  y: number
  zoom: number
}

let uidCounter = 1
export function uid(prefix: string): string {
  uidCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

/** Produce a unique name like "LED 3" given a base and the existing names. */
export function uniqueName(base: string, existing: Set<string>): string {
  let i = 1
  for (;;) {
    const candidate = `${base} ${i}`
    if (!existing.has(candidate.toLowerCase())) return candidate
    i++
  }
}

export function existingNames(components: CircuitComponentData[], parts: HardwarePartData[]): Set<string> {
  const s = new Set<string>()
  for (const c of components) s.add(c.name.trim().toLowerCase())
  for (const p of parts) s.add(p.name.trim().toLowerCase())
  return s
}

type Listener = () => void

class Store {
  project: ProjectData
  view: ViewMode = 'schematic'
  selection: Selection = { kind: 'none', id: '' }
  /** Circuit placement palette choice (circuit type) or null. */
  circuitPlacement: string | null = null
  /** Hardware placement kind or null. */
  partPlacement: string | null = null
  /** Joint creation mode: null | armed with first anchor. */
  jointTool: { type: string; aId: string; ax: number; ay: number } | null = null
  toasts: ToastMsg[] = []
  /** Incremented whenever structural circuit data changes (engine rebuild). */
  circuitRev = 0
  /** Selected Part Studio mesh id. */
  studioMeshId: string | null = null
  /** Incremented whenever structural hardware data changes (world rebuild). */
  hardwareRev = 0
  /** Whether the simulation loop is running. */
  playing = false
  /** Incremented whenever the undo/redo stacks change (reactive UI). */
  historyRev = 0
  private undoStack: string[] = []
  private redoStack: string[] = []
  private lastTag = ''
  private lastTagTime = 0
  private listeners = new Set<Listener>()
  private toastId = 0

  constructor(project: ProjectData) {
    this.project = project
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  notify() {
    for (const fn of this.listeners) fn()
  }

  setView(v: ViewMode) {
    this.view = v
    this.selection = { kind: 'none', id: '' }
    this.circuitPlacement = null
    this.partPlacement = null
    this.jointTool = null
    this.notify()
  }

  setSelection(sel: Selection) {
    this.selection = sel
    this.notify()
  }

  toast(text: string, kind: ToastMsg['kind'] = 'info') {
    this.toastId += 1
    const id = this.toastId
    this.toasts = [...this.toasts.slice(-4), { id, text, kind }]
    this.notify()
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id)
      this.notify()
    }, 4200)
  }

  markCircuitDirty() {
    this.circuitRev++
    this.notify()
  }

  markHardwareDirty() {
    this.hardwareRev++
    this.notify()
  }

  // ------------------------------------------------------------- history
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Serializable snapshot of the current project (capture now, push later). */
  snapshot(): string {
    return JSON.stringify(this.project)
  }

  /**
   * Record an undo point BEFORE mutating the project. Project data mutates
   * in place, so this must run before the change is applied.
   * Consecutive calls with the same tag within a short window coalesce into
   * a single undo step (keeps slider/number-field edits from flooding it).
   */
  beginChange(tag = '') {
    const now = Date.now()
    if (tag && tag === this.lastTag && now - this.lastTagTime < 900) {
      this.lastTagTime = now
      return
    }
    this.lastTag = tag
    this.lastTagTime = now
    this.undoStack.push(this.snapshot())
    if (this.undoStack.length > 60) this.undoStack.shift()
    this.redoStack = []
    this.historyRev++
  }

  /** Push an already-captured snapshot (e.g. taken at drag start). */
  pushSnapshot(snapshot: string) {
    this.undoStack.push(snapshot)
    if (this.undoStack.length > 60) this.undoStack.shift()
    this.redoStack = []
    this.lastTag = ''
    this.historyRev++
  }

  undo() {
    const snap = this.undoStack.pop()
    if (!snap) return
    this.redoStack.push(this.snapshot())
    this.restore(snap)
  }

  redo() {
    const snap = this.redoStack.pop()
    if (!snap) return
    this.undoStack.push(this.snapshot())
    this.restore(snap)
  }

  private restore(snap: string) {
    try {
      this.project = JSON.parse(snap) as ProjectData
    } catch {
      return
    }
    this.selection = { kind: 'none', id: '' }
    this.circuitPlacement = null
    this.partPlacement = null
    this.jointTool = null
    this.lastTag = ''
    this.circuitRev++
    this.hardwareRev++
    this.historyRev++
    this.notify()
  }

  /** Find a part by id. */
  partById(id: string): HardwarePartData | undefined {
    return this.project.hardware.parts.find((p) => p.id === id)
  }

  /** Find a joint by id. */
  jointById(id: string): JointData | undefined {
    return this.project.hardware.joints.find((j) => j.id === id)
  }

  /** Find a circuit component by id. */
  circuitById(id: string): CircuitComponentData | undefined {
    return this.project.circuit.components.find((c) => c.id === id)
  }

  /** Delete currently selected item (with cascade cleanup). */
  deleteSelection() {
    const sel = this.selection
    const exists =
      (sel.kind === 'circuit' && Boolean(this.circuitById(sel.id))) ||
      (sel.kind === 'wire' && this.project.circuit.wires.some((w) => w.id === sel.id)) ||
      (sel.kind === 'part' && Boolean(this.partById(sel.id))) ||
      (sel.kind === 'joint' && Boolean(this.jointById(sel.id)))
    if (exists) this.beginChange(`delete:${sel.kind}:${sel.id}`)
    if (sel.kind === 'circuit') {
      this.project.circuit.components = this.project.circuit.components.filter((c) => c.id !== sel.id)
      this.project.circuit.wires = this.project.circuit.wires.filter(
        (w) => w.from.componentId !== sel.id && w.to.componentId !== sel.id,
      )
      this.markCircuitDirty()
    } else if (sel.kind === 'wire') {
      this.project.circuit.wires = this.project.circuit.wires.filter((w) => w.id !== sel.id)
      this.markCircuitDirty()
    } else if (sel.kind === 'part') {
      this.project.hardware.parts = this.project.hardware.parts.filter((p) => p.id !== sel.id)
      this.project.hardware.joints = this.project.hardware.joints.filter(
        (j) => j.a !== sel.id && j.b !== sel.id,
      )
      this.markHardwareDirty()
    } else if (sel.kind === 'joint') {
      this.project.hardware.joints = this.project.hardware.joints.filter((j) => j.id !== sel.id)
      this.markHardwareDirty()
    }
    this.selection = { kind: 'none', id: '' }
    this.notify()
  }

  /** Replace the whole project (load preset / load file). */
  loadProject(p: ProjectData) {
    this.beginChange('load')
    this.project = p
    this.selection = { kind: 'none', id: '' }
    this.circuitPlacement = null
    this.partPlacement = null
    this.jointTool = null
    this.studioMeshId = p.hardware.meshes[0]?.id ?? null
    this.circuitRev++
    this.hardwareRev++
    this.notify()
  }
}

export function emptyProject(name: string): ProjectData {
  return { version: 1, name, groundY: 900, circuit: { components: [], wires: [] }, hardware: { parts: [], joints: [], meshes: [] } }
}

// Initialized by main.tsx with a preset or blank project.
export let store: Store

export function initStore(project: ProjectData): Store {
  store = new Store(project)
  return store
}
