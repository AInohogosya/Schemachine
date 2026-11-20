// ============================================================================
// Circuit engine — owns the compiled network, keyboard switch bindings and
// the 60 Hz solve tick. UI and physics read `runtime` after each tick.
// ============================================================================

import type { CircuitComponentData, CircuitData, CircuitRuntime } from '../types'
import { applyProtection, compileCircuit, solveCircuit, type CompiledNetwork } from './solver'

export interface EngineOptions {
  tickHz?: number
}

export class CircuitEngine {
  net: CompiledNetwork
  runtime: CircuitRuntime
  /** Physically held key codes (e.code). */
  private pressed = new Set<string>()
  /** Previous pressed snapshot for edge detection (slide switches). */
  private prevPressed = new Set<string>()
  motorW = new Map<string, number>()
  /** compId -> pressed override for push buttons held by mouse */
  private mouseHeld = new Set<string>()
  private physicalHeld = new Map<string, Set<string>>()
  private authoredPush = new Map<string, boolean>()
  private effectivePush = new Map<string, boolean>()
  hz: number

  constructor(circuit: CircuitData, opts: EngineOptions = {}) {
    this.hz = opts.tickHz ?? 60
    this.net = compileCircuit(circuit)
    this.runtime = {
      pinVoltages: new Map(),
      wires: new Map(),
      states: new Map(),
      solved: false,
      warnings: [],
    }
  }

  /** Recompile after structural edits (components / wires added or removed). */
  rebuild(circuit: CircuitData) {
    // Preserve nonlinear + protection state across rebuilds where possible.
    const old = this.net
    this.net = compileCircuit(circuit)
    for (const [k, v] of old.nl) this.net.nl.set(k, v)
    for (const [k, v] of old.protection) this.net.protection.set(k, v)
    for (const id of old.blownFuses) this.net.blownFuses.add(id)
    for (const [id, state] of old.transient) {
      if (this.net.compById.has(id)) this.net.transient.set(id, { ...state })
    }
    this.net.lastNow = old.lastNow
    this.tick(performance.now())
  }

  setPressed(keys: Set<string>) {
    this.pressed = new Set(keys)
  }

  keyDown(code: string) {
    this.pressed.add(code)
    this.tick(performance.now())
  }

  keyUp(code: string) {
    this.pressed.delete(code)
    this.tick(performance.now())
  }

  isPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  holdMouse(compId: string, held: boolean) {
    if (held) this.mouseHeld.add(compId)
    else this.mouseHeld.delete(compId)
    this.tick(performance.now())
  }

  holdPhysical(compId: string, held = true, sourceId = compId) {
    const comp = this.componentById(compId)
    if (!comp || (comp.type !== 'switchPush' && comp.type !== 'switchSlide')) return
    let sources = this.physicalHeld.get(compId)
    if (held) {
      if (!sources) {
        sources = new Set<string>()
        this.physicalHeld.set(compId, sources)
      }
      if (comp.type === 'switchSlide' && sources.size === 0) comp.props.closed = !(comp.props.closed === true)
      sources.add(sourceId)
    } else if (sources) {
      sources.delete(sourceId)
      if (sources.size === 0) this.physicalHeld.delete(compId)
    }
    this.tick(performance.now())
  }

  releasePhysical(compId: string, sourceId = compId) {
    this.holdPhysical(compId, false, sourceId)
  }

  clearTransientInputs() {
    this.pressed.clear()
    this.prevPressed.clear()
    this.mouseHeld.clear()
    this.physicalHeld.clear()
    this.tick(performance.now())
  }

  /** Toggle a slide switch from code / UI. */
  toggleSlide(comp: CircuitComponentData) {
    comp.props.closed = !(comp.props.closed === true)
    this.tick(performance.now())
  }

  resetFuse(comp: CircuitComponentData) {
    this.net.blownFuses.delete(comp.id)
    comp.props.blown = false
    const current = this.componentById(comp.id)
    if (current) current.props.blown = false
    this.tick(performance.now(), false)
  }

  /** Apply keyboard mappings, then solve. */
  tick(now: number, protect = true) {
    const comps = this.net.circuit.components
    const prev = this.prevPressed
    const pushIds = new Set<string>()
    for (const c of comps) {
      if (c.type !== 'switchPush') continue
      pushIds.add(c.id)
      const effective = this.effectivePush.get(c.id)
      const current = c.props.closed === true
      if (effective === undefined || current !== effective) this.authoredPush.set(c.id, current)
    }
    for (const id of this.authoredPush.keys()) if (!pushIds.has(id)) this.authoredPush.delete(id)
    for (const id of this.effectivePush.keys()) if (!pushIds.has(id)) this.effectivePush.delete(id)

    for (const c of comps) {
      const key = c.props.key
      const isDown = key ? this.pressed.has(key) : false
      const wasDown = key ? prev.has(key) : false
      if (c.type === 'switchPush') {
        const closed = (this.authoredPush.get(c.id) ?? false) || isDown || this.mouseHeld.has(c.id) ||
          (this.physicalHeld.get(c.id)?.size ?? 0) > 0
        c.props.closed = closed
        this.effectivePush.set(c.id, closed)
      } else if (c.type === 'switchSlide' && key && isDown && !wasDown) {
        c.props.closed = !(c.props.closed === true)
      }
    }
    this.prevPressed = new Set(this.pressed)

    this.runtime = solveCircuit(this.net, { motorW: this.motorW, now })
    if (protect) applyProtection(this.net, this.runtime, now)
  }

  componentById(id: string): CircuitComponentData | undefined {
    return this.net.circuit.components.find((c) => c.id === id)
  }

  findByName(name: string): CircuitComponentData[] {
    const n = name.trim().toLowerCase()
    return this.net.circuit.components.filter((c) => c.name.trim().toLowerCase() === n)
  }
}
