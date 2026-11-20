// ============================================================================
// SimRunner3D — the shared 60 Hz event loop: circuit solver + Rapier 3D
// rigid-body physics in one tick.
//
//   1. publish electrical drive signals  (circuit -> motors / thrusters)
//   2. step the physics world            (substeps, joints, fluids, aero)
//   3. feed mechanical state back        (rotor speed -> generator back-EMF)
//   4. solve the circuit                 (voltages, currents, logic, sound)
//
// Same binding contract as the 2D runner: closing "Switch 1" anywhere
// closes it everywhere. Links resolve from EITHER side — a hardware part's
// `boundComponent` or a circuit component's `bindHardware`.
// ============================================================================

import type { CircuitComponentData, HardwarePartData, JointData, ProjectData } from '../types'
import { CircuitEngine } from '../circuit/engine'
import { SimWorld } from '../physics/world'
import { AudioKit } from './audio'

const norm = (name: string | undefined): string => (name ?? '').trim().toLowerCase()

/** Buzzer/speaker audio levels implied by the latest circuit runtime. */
export function circuitAudio(project: ProjectData, circuit: CircuitEngine): { volume: number; frequency: number } {
  let volume = 0
  let frequency = 440
  for (const c of project.circuit.components) {
    if (c.type !== 'buzzer' && c.type !== 'speaker') continue
    const st = circuit.runtime.states.get(c.id)
    if (st && (st.active ?? 0) > 0.02) {
      volume = Math.max(volume, st.active ?? 0)
      frequency = typeof st.frequency === 'number' && Number.isFinite(st.frequency)
        ? st.frequency
        : (c.props.frequency ?? 440)
    }
  }
  return { volume, frequency }
}

export class SimRunner3D {
  world: SimWorld
  circuit: CircuitEngine
  project: ProjectData
  /** Visual toggle state for unbound physical pads. */
  padVisual = new Map<string, boolean>()
  private padHeld = new Set<string>()
  private destroyed = false

  private constructor(project: ProjectData, circuit: CircuitEngine, world: SimWorld) {
    this.project = project
    this.circuit = circuit
    this.world = world
  }

  static async create(project: ProjectData, circuit: CircuitEngine): Promise<SimRunner3D> {
    // Adapt reverse (circuit-side) motor links onto CLONED joint defs so the
    // physics world sees one canonical boundComponent per motor joint while
    // the user's project data is never mutated.
    const adaptedJoints = project.hardware.joints.map((joint) => {
      if (joint.type !== 'motor' || joint.props.boundComponent) return joint
      const partNames = new Set([
        norm(project.hardware.parts.find((p) => p.id === joint.a)?.name),
        norm(project.hardware.parts.find((p) => p.id === joint.b)?.name),
      ])
      partNames.delete('')
      const match = project.circuit.components.find(
        (c) => (c.type === 'motor' || c.type === 'fan') && partNames.has(norm(c.props.bindHardware)),
      )
      if (!match) return joint
      return { ...joint, props: { ...joint.props, boundComponent: match.name } }
    })
    const worldProject: ProjectData = adaptedJoints === project.hardware.joints
      ? project
      : { ...project, hardware: { ...project.hardware, joints: adaptedJoints } }
    const world = await SimWorld.build(worldProject)
    return new SimRunner3D(project, circuit, world)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    try {
      AudioKit.setBuzzer(0, 440)
    } catch {
      /* audio context may already be closed */
    }
    this.padHeld.clear()
    try {
      this.world.world.free()
    } catch {
      /* native world may already be freed */
    }
  }

  /** Circuit components linked to a hardware part from either direction. */
  componentsForPart(part: HardwarePartData | undefined): CircuitComponentData[] {
    if (!part) return []
    const partName = norm(part.name)
    return this.project.circuit.components.filter((c) =>
      norm(c.name) === norm(part.props.boundComponent) || norm(c.props.bindHardware) === partName)
  }

  /** Circuit drive components for a motor/pin joint (name link or part link). */
  jointDriveComponents(joint: JointData): CircuitComponentData[] {
    const bound = norm(joint.props.boundComponent)
    if (bound) {
      return this.project.circuit.components.filter((c) => norm(c.name) === bound)
    }
    const partNames = new Set([norm(this.project.hardware.parts.find((p) => p.id === joint.a)?.name), norm(this.project.hardware.parts.find((p) => p.id === joint.b)?.name)])
    partNames.delete('')
    return this.project.circuit.components.filter((c) =>
      (c.type === 'motor' || c.type === 'fan') && partNames.has(norm(c.props.bindHardware)))
  }

  /** Back-EMF constant for a motor joint's bound circuit component. */
  keOf = (compName: string | undefined): number => {
    if (!compName) return 1
    const n = norm(compName)
    const c = this.project.circuit.components.find((x) => norm(x.name) === n)
    const ke = c?.props.ke
    return typeof ke === 'number' && Number.isFinite(ke) && ke > 0 ? ke : 1
  }

  /** Drive voltage for a motor joint's bound circuit component (last tick). */
  driveOf(compName: string | undefined): number {
    if (!compName) return 0
    const n = norm(compName)
    let sum = 0
    for (const c of this.project.circuit.components) {
      if (norm(c.name) !== n) continue
      const st = this.circuit.runtime.states.get(c.id)
      if (st && typeof st.voltage === 'number') sum += st.voltage
    }
    return sum
  }

  /** Drive voltage for a joint, resolving reverse (circuit-side) links. */
  driveForJoint(joint: JointData): number {
    const bound = norm(joint.props.boundComponent)
    if (bound) return this.driveOf(joint.props.boundComponent)
    let sum = 0
    for (const c of this.jointDriveComponents(joint)) {
      const st = this.circuit.runtime.states.get(c.id)
      if (st && typeof st.voltage === 'number') sum += st.voltage
    }
    return sum
  }

  /** Activation signal (0..1) of components bound under a name. */
  activeOf(compName: string | undefined): number {
    if (!compName) return 0
    const n = norm(compName)
    let best = 0
    for (const c of this.project.circuit.components) {
      if (norm(c.name) !== n) continue
      const st = this.circuit.runtime.states.get(c.id)
      if (st) best = Math.max(best, st.active ?? 0)
    }
    return best
  }

  /** Activation for a hardware part, resolving reverse (circuit-side) links. */
  activeForPart(part: HardwarePartData | undefined): number {
    let best = 0
    for (const c of this.componentsForPart(part)) {
      const st = this.circuit.runtime.states.get(c.id)
      if (st) best = Math.max(best, st.active ?? 0)
    }
    return best
  }

  step(now: number) {
    if (this.destroyed) return
    // 1. circuit -> mechanics
    for (const j of this.world.joints) {
      if (j.kind === 'motor') {
        j.driveV = this.driveForJoint(j.def)
      }
    }
    for (const t of this.world.thrusters) {
      const part = this.project.hardware.parts.find((p) => p.id === t.partId)
      t.active = this.activeForPart(part)
    }
    // 2. physics
    this.world.step(1 / 60, this.keOf)
    this.world.readMotorSpeeds()
    // 3. mechanics -> circuit (generator back-EMF inputs). BOTH pin and
    // motor joints publish: a pin-driven rotor (wind/water) is a generator.
    // Fans are also driven: external rotation produces fan back-EMF.
    for (const j of this.world.joints) {
      if (j.kind !== 'motor' && j.kind !== 'pin') continue
      if (!j.def.props.boundComponent && this.jointDriveComponents(j.def).length === 0) continue
      for (const c of this.jointDriveComponents(j.def)) {
        if (c.type === 'motor' || c.type === 'fan') {
          this.circuit.motorW.set(c.id, j.rotorW)
        }
      }
    }
    // 4. circuit solve
    this.circuit.tick(now)
    // 5. audio follows active buzzers and speakers
    this.syncAudio()
  }

  /** Publish buzzer/speaker audio from the latest circuit state. Safe to
   * call every frame — SimulationView uses it to keep audio correct while
   * physics is paused. Returns the applied audio state. */
  syncAudio(): { volume: number; frequency: number } {
    if (this.destroyed) return { volume: 0, frequency: 440 }
    const audio = circuitAudio(this.project, this.circuit)
    AudioKit.setBuzzer(audio.volume, audio.frequency)
    return audio
  }

  // ------------------------------------------------------------------
  // Physical interaction: clicks / holds on hardware pads & switches.
  // ------------------------------------------------------------------

  /** Press (or toggle) a physical part bound to circuit switches.
   * Push-switch holds are routed through the engine so keyboard, schematic
   * and physical sources combine with OR semantics. Slide switches stay
   * edge-triggered (one toggle per press). */
  pressPhysical(partId: string, pressed: boolean) {
    if (this.destroyed) return
    const part = this.project.hardware.parts.find((p) => p.id === partId)
    if (!part) return
    if (pressed) this.padHeld.add(partId)
    else this.padHeld.delete(partId)

    const comps = this.componentsForPart(part).filter(
      (c) => c.type === 'switchPush' || c.type === 'switchSlide',
    )
    if (comps.length === 0) {
      if (pressed) {
        const cur = this.padVisual.get(partId) ?? false
        this.padVisual.set(partId, !cur)
      }
      return
    }
    for (const c of comps) {
      if (c.type === 'switchPush') {
        this.circuit.holdPhysical(c.id, pressed, partId)
      } else if (pressed) {
        this.circuit.holdPhysical(c.id, true, partId)
      } else {
        this.circuit.releasePhysical(c.id, partId)
      }
    }
  }

  /** Whether a physical pad currently reads ON (for rendering). */
  padState(partId: string): boolean {
    const part = this.project.hardware.parts.find((p) => p.id === partId)
    for (const c of this.componentsForPart(part)) {
      if (c.type === 'switchPush' || c.type === 'switchSlide') return c.props.closed === true
    }
    return this.padVisual.get(partId) ?? false
  }
}
