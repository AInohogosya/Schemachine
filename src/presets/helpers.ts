// ============================================================================
// Preset builder helpers — concise DSL for authoring complete projects.
// ============================================================================

import type {
  CircuitComponentData,
  CircuitComponentType,
  CircuitProps,
  HardwarePartData,
  HardwarePartType,
  HardwareProps,
  JointData,
  JointProps,
  JointType,
  ProjectData,
} from '../types'
import { uid } from '../store'

export class PB {
  project: ProjectData

  constructor(name: string, groundY = 900) {
    this.project = {
      version: 1,
      name,
      groundY,
      circuit: { components: [], wires: [] },
      hardware: { parts: [], joints: [], meshes: [] },
    }
  }

  c(type: CircuitComponentType, name: string, x: number, y: number, props: CircuitProps = {}): CircuitComponentData {
    const comp: CircuitComponentData = { id: uid('c'), name, type, x, y, props }
    this.project.circuit.components.push(comp)
    return comp
  }

  w(a: CircuitComponentData, pinA: string, b: CircuitComponentData, pinB: string) {
    this.project.circuit.wires.push({ id: uid('w'), from: { componentId: a.id, pin: pinA }, to: { componentId: b.id, pin: pinB } })
  }

  p(
    kind: HardwarePartType,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    props: HardwareProps = {},
    angle = 0,
  ): HardwarePartData {
    const part: HardwarePartData = { id: uid('p'), name, kind, x, y, z: 0, angle, w, h, props }
    this.project.hardware.parts.push(part)
    return part
  }

  j(
    type: JointType,
    a: HardwarePartData,
    b: HardwarePartData,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    props: JointProps = {},
  ): JointData {
    const joint: JointData = { id: uid('j'), type, a: a.id, b: b.id, ax, ay, bx, by, props }
    this.project.hardware.joints.push(joint)
    return joint
  }

  /** Weld part b onto part a (b keeps its world pose). */
  weld(a: HardwarePartData, b: HardwarePartData): JointData {
    // anchor at b's center expressed in a-local coords
    const dx = b.x - a.x
    const dy = b.y - a.y
    const ca = Math.cos((-a.angle * Math.PI) / 180)
    const sa = Math.sin((-a.angle * Math.PI) / 180)
    return this.j('weld', a, b, dx * ca - dy * sa, dx * sa + dy * ca, 0, 0)
  }

  build(): ProjectData {
    return this.project
  }
}
