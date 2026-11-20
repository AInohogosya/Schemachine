// ============================================================================
// SimWorld — Rapier 3D rigid-body world built from HardwareData.
//
// 2D -> 3D mapping: authored (x, y-down) becomes (x, -y, z); part angles
// (clockwise-positive on screen) become rotations about -Z. Screen-space
// "clockwise-positive" semantics are preserved for motors/limits so all
// existing circuits behave identically.
//
// Joints: weld = same rigid body (perfect rigidity, zero solver drag),
// pin/motor = native revolute impulse joints with manual velocity servo +
// manual angle limits, slider = custom kinematic projection (proven
// pattern) with optional rack-and-pinion drive. CCD is enabled on every
// dynamic body. Forces are applied as impulses each substep.
// ============================================================================

import RAPIER from '@dimforge/rapier3d-compat'
import type { HardwareData, HardwarePartData, JointData, ProjectData } from '../types'
import { MATERIALS, defaultMaterialFor, defaultFrictionAir, isCircleKind, partDepthOf } from './materials'
import { fluidForcesFor, type WaterRegion3D } from './fluids'
import { wingAccel, assistTorque, attitudeRecoveryAccel, LIFT_COEF } from './aero'
import { buildMeshData } from '../studio/meshdata'
import type { CustomMesh } from '../types'

export const SUBSTEPS = 4
export const WORLD_GRAVITY = 900 // px/s^2 (positive magnitude)
/** Reference air density for aerodynamic forces (mass units per px^3 scale). */
export const GAME_AIR_RHO = 4000
const MAX_LIN_VEL = 3000 // px/s
const MAX_ANG_VEL = 50 // rad/s
const TWO_PI = Math.PI * 2

let rapierReady: Promise<void> | null = null
export function ensureRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init()
  return rapierReady
}

// ---------------------------------------------------------------------------
// tiny quat/vec helpers (no three.js in physics)
// ---------------------------------------------------------------------------

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}
export interface Vec3 {
  x: number
  y: number
  z: number
}

export function quatZ(angle: number): Quat {
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }
}

export function quatY(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }
}

/** Y-axis (azimuth) angle of a quaternion. */
export function yAngleOf(q: Quat): number {
  return 2 * Math.atan2(q.y, q.w)
}

export function quatAxisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const s = Math.sin(angle / 2)
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) }
}

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

export function quatConj(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const t = quatMul(q, { x: v.x, y: v.y, z: v.z, w: 0 })
  const r = quatMul(t, quatConj(q))
  return { x: r.x, y: r.y, z: r.z }
}

/** Z rotation angle for (near-)planar bodies. */
export function zAngleOf(q: Quat): number {
  return 2 * Math.atan2(q.z, q.w)
}

export function normAngle(a: number): number {
  a = a % TWO_PI
  if (a > Math.PI) a -= TWO_PI
  if (a < -Math.PI) a += TWO_PI
  return a
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Authored 2D pose -> 3D world position. */
export function partWorldPos(p: HardwarePartData): Vec3 {
  return { x: p.x, y: -p.y, z: p.z ?? 0 }
}

/** Authored 2D angle (deg, CW+) -> 3D quaternion (about Z). */
export function partWorldQuat(p: HardwarePartData): Quat {
  return quatZ((-p.angle * Math.PI) / 180)
}

// ---------------------------------------------------------------------------

export interface SimJoint {
  def: JointData
  bodyA: RAPIER.RigidBody
  bodyB: RAPIER.RigidBody
  kind: JointData['type']
  joint: unknown
  /** Build-time z-angle of B relative to A. */
  buildDeltaZ: number
  /** Build-time y-angle of B relative to A (azimuth joints). */
  buildDeltaY: number
  /** Build-time world z-angle of B (pinion reference). */
  buildAngleB: number
  /** Motor drive voltage applied by the orchestrator (volts, signed). */
  driveV: number
  /** Generator feedback: rotor rad/s (screen-clockwise-positive). */
  rotorW: number
  /** Anchor local position in A's body frame (for hinged-body servos). */
  lA: Vec3
  /** Tracked servo rate for azimuth joints (rad/s) — the body's angvel is
   * eaten by the joint solver, so the ramp must track its own state. */
  servoRate: number
  /** Slider: build offset of B along the axis. */
  buildOffset: number
  /** Slider: build perpendicular offset (A-local). */
  buildPerp: Vec3
  /** Slider: axis in A-local coords. */
  axisLocal: Vec3
}

export interface PartFrame {
  body: RAPIER.RigidBody
  /** Local offset of the part origin in body frame. */
  lx: number
  ly: number
  lz: number
  /** Local orientation in body frame. */
  lq: Quat
  mass: number
  volume: number
  density: number
  /** Half extents for bounds/fluid sampling. */
  hx: number
  hy: number
  hz: number
}

export interface AeroEntry {
  frame: PartFrame
  partId: string
  chord: number
  thick: number
  /** Wingspan (extrusion depth) — lift scales with it. */
  span: number
  stability: number
}

export interface AssistEntry {
  body: RAPIER.RigidBody
  inertia: number
  strength: number
  /** Main wing incidence (rad, added to the body's z-angle). */
  incidence: number
  /** Main wing lift area (chord*thick*span factor). */
  area: number
  /** Latched while a powered airframe recovers from a steep nose-down attitude. */
  recovering: boolean
}

export interface ThrusterEntry {
  frame: PartFrame
  partId: string
  body: RAPIER.RigidBody
  localFacing: Vec3
  buildQuat: Quat
  force: number
  active: number
}

export interface PropellerEntry {
  frame: PartFrame
  partId: string
  body: RAPIER.RigidBody
  joint: SimJoint | null
  stator: RAPIER.RigidBody | null
  localFacing: Vec3
  buildQuat: Quat
  thrust: number
}

export interface EmitterEntry {
  partId: string
  body: RAPIER.RigidBody
  dirX: number
  dirY: number
  dirZ: number
  rate: number
  acc: number
}

export interface SliderDrive {
  joint: SimJoint
}

/** Propeller thrust acceleration scale (px/s^2 per thrust-unit per (rad/s)^2). */
export const PROPULSION_K = 90
/** Thruster acceleration scale (px/s^2 per force-unit at full activation). */
export const THRUSTER_K = 520
/** A powered assisted airframe enters attitude recovery below this pitch. */
export const RECOVERY_ENTER_PITCH = (-15 * Math.PI) / 180
/** Recovery releases once the aircraft is near level and no longer pitching quickly. */
export const RECOVERY_EXIT_PITCH = (-3 * Math.PI) / 180
export const RECOVERY_EXIT_RATE = 0.1 // rad/s

export class SimWorld {
  world!: RAPIER.World
  /** partId -> root rigid body. */
  bodies = new Map<string, RAPIER.RigidBody>()
  /** partId -> frame (for per-part poses). */
  frames = new Map<string, PartFrame>()
  /** body handle -> rigid body (for joint group walks). */
  byHandle = new Map<number, RAPIER.RigidBody>()
  /** body handle -> mass (tracked, unit-consistent). */
  masses = new Map<number, number>()
  joints: SimJoint[] = []
  waterRegions: WaterRegion3D[] = []
  emitters: EmitterEntry[] = []
  aero: AeroEntry[] = []
  assist: AssistEntry[] = []
  thrusters: ThrusterEntry[] = []
  propellers: PropellerEntry[] = []
  particles: RAPIER.RigidBody[] = []
  particleColliders: RAPIER.Collider[] = []
  /** The fixed ground slab collider, exposed for contact regressions. */
  groundCollider!: RAPIER.Collider
  groundY: number
  gravityScale = 1
  /** Debug: wing aero forces (one per wing, build order). vA = raw vx, ang = raw vy. */
  dbgAero: { fx: number; fy: number; m: number; area: number; ang: number; vA: number }[] = []

  private constructor() {
    this.groundY = 900
  }

  static async build(project: ProjectData): Promise<SimWorld> {
    await ensureRapier()
    const w = new SimWorld()
    w.groundY = project.groundY
    const hw = project.hardware
    w.world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 })
    w.world.timestep = 1 / 60 / SUBSTEPS

    // --- ground plane ---
    {
      // 600-thick slab: bodies can never tunnel past its middle, so the
      // contact solver always pushes them out the TOP face.
      const gb = w.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -w.groundY - 300, 0))
      w.groundCollider = w.world.createCollider(
        RAPIER.ColliderDesc.cuboid(6000, 300, 2000).setFriction(0.95).setRestitution(0),
        gb,
      )
    }

    // --- water regions (analytic volumes, no physics bodies) ---
    for (const part of hw.parts) {
      if (part.kind !== 'water') continue
      const depth = partDepthOf('water', part.props.depth)
      w.waterRegions.push({
        cx: part.x,
        cy: -part.y,
        cz: part.z ?? 0,
        hx: Math.max(5, part.w / 2),
        hy: Math.max(5, part.h / 2),
        hz: Math.max(30, depth / 2),
        density: part.props.density ?? 0.001,
        flowX: (part.props.flowX ?? 0) * 60,
        flowY: -(part.props.flowY ?? 0) * 60,
        flowZ: 0,
      })
    }

    const partsById = new Map(hw.parts.map((p) => [p.id, p]))

    // --- weld groups -> one rigid body with N colliders ---
    const weldParent = new Map<string, string>()
    const wfind = (k: string): string => {
      let p = weldParent.get(k)
      if (p === undefined) {
        weldParent.set(k, k)
        return k
      }
      while (weldParent.get(p) !== p) p = weldParent.get(p) as string
      return p
    }
    for (const part of hw.parts) {
      if (part.kind === 'water') continue
      wfind(part.id)
    }
    for (const jd of hw.joints) {
      if (jd.type !== 'weld') continue
      if (!partsById.has(jd.a) || !partsById.has(jd.b)) continue
      const ra = wfind(jd.a)
      const rb = wfind(jd.b)
      if (ra !== rb) weldParent.set(ra, rb)
    }
    const weldGroups = new Map<string, HardwarePartData[]>()
    for (const part of hw.parts) {
      if (part.kind === 'water') continue
      const r = wfind(part.id)
      const arr = weldGroups.get(r) ?? []
      arr.push(part)
      weldGroups.set(r, arr)
    }

    // --- collision groups: pin/motor-linked bodies never collide ---
    const linkParent = new Map<string, string>()
    const lfind = (k: string): string => {
      let p = linkParent.get(k)
      if (p === undefined) {
        linkParent.set(k, k)
        return k
      }
      while (linkParent.get(p) !== p) p = linkParent.get(p) as string
      return p
    }
    for (const [, members] of weldGroups) lfind(wfind(members[0].id))
    const linkedRoots = new Set<string>()
    for (const jd of hw.joints) {
      if (jd.type !== 'pin' && jd.type !== 'motor') continue
      if (!partsById.has(jd.a) || !partsById.has(jd.b)) continue
      const ra = lfind(wfind(jd.a))
      const rb = lfind(wfind(jd.b))
      if (ra !== rb) linkParent.set(ra, rb)
      linkedRoots.add(lfind(ra))
    }
    const linkBit = new Map<string, number>()
    let gi = 0
    for (const r of linkedRoots) linkBit.set(r, 1 << (1 + (gi++ % 13)))
    const PARTICLE_BIT = 1 << 15
    const ALL = 0xffff
    const groupsFor = (rootId: string): number => {
      const bit = linkBit.get(lfind(rootId))
      if (bit === undefined) return (ALL << 16) | ALL
      return (bit << 16) | (ALL & ~bit)
    }

    // --- bodies ---
    const meshCache = new Map<string, { positions: Float32Array; indices: Uint32Array }>()
    w.meshLib = new Map((hw.meshes ?? []).map((m) => [m.id, m]))
    for (const [, members] of weldGroups) {
      const first = members[0]
      const anyStatic = members.some((m) => m.props.isStatic === true)
      const fp = partWorldPos(first)
      const fq = partWorldQuat(first)
      const desc = anyStatic
        ? RAPIER.RigidBodyDesc.fixed().setTranslation(fp.x, fp.y, fp.z).setRotation(fq)
        : RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(fp.x, fp.y, fp.z)
            .setRotation(fq)
            .setLinearDamping(0.02)
            .setAngularDamping(0.08)
            .setCcdEnabled(true)
            .setCanSleep(false)
      const body = w.world.createRigidBody(desc)
      if (first.props.v0) {
        body.setLinvel({ x: first.props.v0.x, y: -first.props.v0.y, z: 0 }, true)
      }
      const fqConj = quatConj(fq)
      let totalMass = 0
      for (const m of members) {
        const mp = partWorldPos(m)
        const mq = partWorldQuat(m)
        // local frame relative to body frame
        const rel = { x: mp.x - fp.x, y: mp.y - fp.y, z: mp.z - fp.z }
        const local = rotateVec(fqConj, rel)
        const localQ = quatMul(fqConj, mq)
        const info = w.attachCollider(body, m, local, localQ, meshCache, groupsFor(wfind(m.id)))
        totalMass += info.mass
        const depth = partDepthOf(m.kind, m.props.depth)
        const frame: PartFrame = {
          body,
          lx: local.x,
          ly: local.y,
          lz: local.z,
          lq: localQ,
          mass: info.mass,
          volume: info.volume,
          density: info.density,
          hx: isCircleKind(m.kind) ? Math.max(2, (m.props.collisionR ?? m.w / 2)) : Math.max(2, m.w / 2),
          hy: isCircleKind(m.kind) ? Math.max(2, (m.props.collisionR ?? m.w / 2)) : Math.max(2, m.h / 2),
          hz: Math.max(2, depth / 2),
        }
        w.frames.set(m.id, frame)
        w.bodies.set(m.id, body)
        w.byHandle.set(body.handle, body)
      }
      w.masses.set(body.handle, totalMass)
    }

    // --- joints (revolute only; welds are compounds, sliders kinematic) ---
    for (const jd of hw.joints) {
      if (jd.type === 'weld') continue
      const sj = w.buildJoint(jd, partsById)
      if (sj) w.joints.push(sj)
    }

    // --- effects registry ---
    for (const part of hw.parts) {
      if (part.kind === 'water') continue
      const frame = w.frames.get(part.id)
      if (!frame) continue
      const body = frame.body
      const fdeg = part.angle + (part.props.direction ?? 0)
      const frad = (fdeg * Math.PI) / 180
      // 2D facing (y-down) -> 3D (y-up)
      const facingBase: Vec3 = { x: Math.cos(frad), y: -Math.sin(frad), z: 0 }
      const bq = body.rotation() as Quat
      const localFacing = rotateVec(quatConj(bq), facingBase)
      // Only MAIN wings generate aero: tail surfaces contributed nothing
      // but downforce in this arcade model (the assist handles stability).
      if (part.kind === 'wing' && !/tail/i.test(part.id) && !/tail/i.test(part.name)) {
        w.aero.push({
          frame,
          partId: part.id,
          chord: part.w,
          thick: part.h,
          span: partDepthOf('wing', part.props.depth),
          stability: 1.0,
        })
      }
      if (part.props.assist === true) {
        // The assist is a lift autopilot: it drives the MAIN WING's AoA
        // toward whatever value produces ~1.25g (a steady climb), so lift
        // stays bounded at any speed instead of exploding with v^2.
        const mainWing = [...weldGroups.get(wfind(part.id)) ?? []].find(
          (m) => m.kind === 'wing' && !/tail/i.test(m.id) && !/tail/i.test(m.name),
        )
        const incidence = mainWing ? (-mainWing.angle * Math.PI) / 180 : 0
        const wingArea = mainWing
          ? (mainWing.w * Math.max(mainWing.h, 8) * Math.max(0.4, partDepthOf('wing', mainWing.props.depth) / 60)) / 4000
          : 1
        w.assist.push({
          body,
          inertia: frame.mass * ((part.w * part.w + part.h * part.h) / 8) + 1,
          strength: 1,
          incidence,
          area: wingArea,
          recovering: false,
        })
      }
      if (part.kind === 'thruster') {
        w.thrusters.push({
          frame,
          partId: part.id,
          body,
          localFacing,
          buildQuat: { ...bq },
          force: part.props.force ?? 1.0,
          active: 0,
        })
      }
      if (part.kind === 'propeller') {
        const mj = w.joints.find((j) => j.kind === 'motor' && j.def.b === part.id) ?? null
        const stator = mj ? mj.bodyA : null
        const sq = stator ? ((stator.rotation() as Quat)) : bq
        w.propellers.push({
          frame,
          partId: part.id,
          body,
          joint: mj,
          stator,
          localFacing: rotateVec(quatConj(sq), facingBase),
          buildQuat: { ...sq },
          thrust: part.props.force ?? 1.2,
        })
      }
      if (part.kind === 'emitter') {
        w.emitters.push({
          partId: part.id,
          body,
          dirX: facingBase.x,
          dirY: facingBase.y,
          dirZ: 0,
          rate: part.props.rate ?? 8,
          acc: 0,
        })
      }
    }

    return w
  }

  // ------------------------------------------------------------------
  private attachCollider(
    body: RAPIER.RigidBody,
    m: HardwarePartData,
    local: Vec3,
    localQ: Quat,
    meshCache: Map<string, { positions: Float32Array; indices: Uint32Array }>,
    groups: number,
  ): { mass: number; volume: number; density: number } {
    const mat = MATERIALS[m.props.material ?? defaultMaterialFor(m.kind)] ?? MATERIALS.plastic
    const depth = partDepthOf(m.kind, m.props.depth)
    const meshId = m.props.meshId
    let desc: RAPIER.ColliderDesc
    let volume: number
    if (meshId) {
      const built = this.customMeshBuffers(meshId, meshCache)
      if (built) {
        const isStatic = m.props.isStatic === true
        if (isStatic) {
          try {
            desc = RAPIER.ColliderDesc.trimesh(built.positions, built.indices)
          } catch {
            const hull = RAPIER.ColliderDesc.convexHull(built.positions)
            desc = hull ?? RAPIER.ColliderDesc.cuboid(m.w / 2, m.h / 2, depth / 2)
          }
        } else {
          const hull = RAPIER.ColliderDesc.convexHull(built.positions)
          desc = hull ?? RAPIER.ColliderDesc.cuboid(m.w / 2, m.h / 2, depth / 2)
        }
        volume = boundingVolume(built.positions) * 0.6
      } else {
        desc = RAPIER.ColliderDesc.cuboid(Math.max(2, m.w / 2), Math.max(2, m.h / 2), Math.max(2, depth / 2))
        volume = m.w * m.h * depth
      }
    } else if (isCircleKind(m.kind)) {
      const rr = typeof m.props.collisionR === 'number' && m.props.collisionR > 4 ? m.props.collisionR : m.w / 2
      desc = RAPIER.ColliderDesc.cylinder(Math.max(2, depth / 2), Math.max(2, rr))
      // Rapier cylinders run along Y; rotate to Z (wheel axle).
      const rot = quatMul(localQ, quatAxisAngle(1, 0, 0, Math.PI / 2))
      desc.setRotation(rot)
      desc.setTranslation(local.x, local.y, local.z)
      desc.setDensity(mat.density).setFriction(mat.friction).setRestitution(mat.restitution)
      desc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      desc.setCollisionGroups(groups)
      this.world.createCollider(desc, body)
      volume = Math.PI * rr * rr * depth
      return { mass: mat.density * volume, volume, density: mat.density }
    } else {
      desc = RAPIER.ColliderDesc.cuboid(Math.max(2, m.w / 2), Math.max(2, m.h / 2), Math.max(2, depth / 2))
      volume = m.w * m.h * depth
    }
    desc.setTranslation(local.x, local.y, local.z)
    desc.setRotation(localQ)
    desc.setDensity(mat.density).setFriction(mat.friction).setRestitution(mat.restitution)
    desc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
    desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    desc.setCollisionGroups(groups)
    this.world.createCollider(desc, body)
    return { mass: mat.density * volume, volume, density: mat.density }
  }

  private customMeshBuffers(
    meshId: string,
    cache: Map<string, { positions: Float32Array; indices: Uint32Array }>,
  ): { positions: Float32Array; indices: Uint32Array } | null {
    const hit = cache.get(meshId)
    if (hit) return hit
    const spec: CustomMesh | undefined = this.meshLib.get(meshId)
    if (!spec) return null
    try {
      const data = buildMeshData(spec)
      if (data.positions.length < 9 || data.indices.length < 3) return null
      const out = { positions: data.positions, indices: data.indices }
      cache.set(meshId, out)
      return out
    } catch {
      return null
    }
  }

  private meshLib = new Map<string, CustomMesh>()

  // ------------------------------------------------------------------
  private buildJoint(jd: JointData, partsById: Map<string, HardwarePartData>): SimJoint | null {
    const bodyA = this.bodies.get(jd.a)
    const bodyB = this.bodies.get(jd.b)
    if (!bodyA || !bodyB) return null
    if (jd.a === jd.b || bodyA.handle === bodyB.handle) return null
    const pa = partsById.get(jd.a)
    const pb = partsById.get(jd.b)
    if (!pa || !pb) return null
    // anchor world positions at build (2D part-local offsets -> 3D world).
    // 2D rotation is clockwise-positive in y-down coords.
    const toWorld = (p: HardwarePartData, lx: number, ly: number): Vec3 => {
      const a = (p.angle * Math.PI) / 180
      const wx = p.x + lx * Math.cos(a) - ly * Math.sin(a)
      const wy2d = p.y + lx * Math.sin(a) + ly * Math.cos(a)
      return { x: wx, y: -wy2d, z: p.z ?? 0 }
    }
    const wA = toWorld(pa, jd.ax, jd.ay)
    const wB = toWorld(pb, jd.bx, jd.by)
    const qA = bodyA.rotation() as Quat
    const qB = bodyB.rotation() as Quat
    const tA = bodyA.translation()
    const tB = bodyB.translation()
    const toLocal = (q: Quat, t: { x: number; y: number; z: number }, wpt: Vec3): Vec3 => {
      const rel = { x: wpt.x - t.x, y: wpt.y - t.y, z: wpt.z - t.z }
      return rotateVec(quatConj(q), rel)
    }
    // Revolute constraints require coincident anchors. Hand-authored joints
    // (two clicked points) may be a few px apart, which would yank the
    // bodies together at simulation start. Build both local frames from the
    // STATOR's authored anchor: it is the intended hinge location, and the
    // motor servo already rotates the assembly around j.lA.
    const lA = toLocal(qA, tA, wA)
    const lB = toLocal(qB, tB, wA)

    let joint: unknown = null
    if (jd.type === 'pin' || jd.type === 'motor') {
      const axis = jd.props.axis3d === 'y' ? ({ x: 0, y: 1, z: 0 } as const) : ({ x: 0, y: 0, z: 1 } as const)
      const params = RAPIER.JointData.revolute(lA, lB, axis)
      try {
        joint = this.world.createImpulseJoint(params, bodyA, bodyB, true)
      } catch {
        joint = null
      }
    } else if (jd.type === 'slider') {
      // kinematic (no native joint): enforced per substep
      joint = null
    }
    const zA = zAngleOf(qA)
    const zB = zAngleOf(qB)
    const yA = yAngleOf(qA)
    const yB = yAngleOf(qB)
    const axisDeg = jd.props.axis ?? 90
    const axisRad = (axisDeg * Math.PI) / 180
    // 2D local (cos, sin, y-down) -> 3D local (x-right, y-up)
    const axisLocal: Vec3 = { x: Math.cos(axisRad), y: -Math.sin(axisRad), z: 0 }
    const axisW = rotateVec(qA, axisLocal)
    const rel = { x: tB.x - tA.x, y: tB.y - tA.y, z: tB.z - tA.z }
    const buildOffset = rel.x * axisW.x + rel.y * axisW.y + rel.z * axisW.z
    const perpW = {
      x: rel.x - axisW.x * buildOffset,
      y: rel.y - axisW.y * buildOffset,
      z: rel.z - axisW.z * buildOffset,
    }
    return {
      def: jd,
      bodyA,
      bodyB,
      kind: jd.type,
      joint,
      buildDeltaZ: normAngle(zB - zA),
      buildDeltaY: normAngle(yB - yA),
      buildAngleB: zB,
      lA,
      servoRate: 0,
      driveV: 0,
      rotorW: 0,
      buildOffset,
      buildPerp: rotateVec(quatConj(qA), perpW),
      axisLocal,
    }
  }

  /** Set motor drive voltage (volts, signed) for a motor joint by joint id. */
  setMotorDrive(jointId: string, volts: number) {
    const j = this.joints.find((x) => x.def.id === jointId)
    if (j && j.kind === 'motor') j.driveV = volts
  }

  /** Whether a propeller attached to this body is currently commanded on. */
  private isPropellerActive(body: RAPIER.RigidBody): boolean {
    return this.propellers.some(
      (p) => p.stator?.handle === body.handle && p.joint !== null && Math.abs(p.joint.driveV) >= 0.05,
    )
  }

  /** Read rotor speeds in rad/s (screen-clockwise-positive). Pin joints
   * with a bound component are generator rotors too. */
  readMotorSpeeds() {
    for (const j of this.joints) {
      if (j.kind !== 'motor' && j.kind !== 'pin') continue
      const w = j.bodyB.angvel()
      // Matter screen angle is clockwise-positive; Rapier +Z is CCW from
      // the camera, so negate for identical semantics.
      j.rotorW = -(w.z as number)
    }
  }

  /** World pose of a part (for rendering / tests). */
  partPose(partId: string): { x: number; y: number; z: number; q: Quat } | null {
    const f = this.frames.get(partId)
    if (!f) return null
    const t = f.body.translation()
    const q = f.body.rotation() as Quat
    const off = rotateVec(q, { x: f.lx, y: f.ly, z: f.lz })
    const pq = quatMul(q, f.lq)
    return { x: t.x + off.x, y: t.y + off.y, z: t.z + off.z, q: pq }
  }

  /** Live world position of a joint anchor (for gizmos). sideA selects a/b. */
  jointAnchorWorld(jd: JointData, sideA: boolean, parts: Map<string, HardwarePartData>): Vec3 | null {
    const part = sideA ? parts.get(jd.a) : parts.get(jd.b)
    if (!part) return null
    const pose = this.partPose(part.id)
    if (!pose) return null
    const lx = sideA ? jd.ax : jd.bx
    const ly = sideA ? jd.ay : jd.by
    const ang = zAngleOf(pose.q)
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    // 2D anchor (y-down) rotated by the part's screen angle, mapped to y-up.
    const rx = lx * ca + ly * sa
    const ry = lx * sa - ly * ca
    return { x: pose.x + rx, y: pose.y + ry, z: pose.z }
  }

  // ------------------------------------------------------------------
  /** One 60 Hz tick: effects + substeps + enforcement. */
  step(dtSeconds: number, keOf: (compName: string | undefined) => number) {
    this.world.gravity.y = -WORLD_GRAVITY * this.gravityScale
    this.spawnParticles(dtSeconds)
    const dt = dtSeconds / SUBSTEPS
    for (let s = 0; s < SUBSTEPS; s++) {
      this.applyForces(dt)
      this.enforceDrives(dt, keOf)
      this.world.step()
      this.enforceConstraints()
      this.clampVelocities()
    }
    this.mergeStillParticles()
  }

  private applyForces(dt: number) {
    const g = WORLD_GRAVITY * this.gravityScale
    this.dbgAero = []
    // --- fluids per part ---
    for (const [, f] of this.frames) {
      const p = this.partPoseByFrame(f)
      if (!p) continue
      const sample = partSample(f, p)
      const ff = fluidForcesFor(sample, this.waterRegions, g)
      if (ff.submerged <= 0.001 && ff.buoy <= 0.001) {
        // still apply drag-free pass
      }
      if (ff.submerged > 0.001 || ff.buoy > 0.001) {
        const b = f.body
        const m = f.mass
        // buoyancy (+Y, opposes gravity)
        this.applyImpulse(b, 0, m * g * ff.buoy * dt, 0)
        // viscous drag
        const v = b.linvel()
        const dk = 0.9 * ff.submerged * dt
        if (dk > 0) {
          this.applyImpulse(b, -v.x * m * dk, -v.y * m * dk, -v.z * m * dk)
        }
        // raceway current (Stokes)
        if (ff.entrain > 0.001) {
          const c = 6.0 * ff.submerged * dt
          this.applyImpulse(
            b,
            m * (ff.flowX - v.x) * c,
            m * (ff.flowY - v.y) * c,
            m * (ff.flowZ - v.z) * c,
          )
        }
        // angular damping in fluid
        const w = b.angvel()
        const ak = Math.min(0.5, 1.1 * ff.submerged * dt)
        if (ak > 0) b.setAngvel({ x: w.x * (1 - ak), y: w.y * (1 - ak), z: w.z * (1 - ak) }, true)
      }
    }
    // --- wings ---
    for (const a of this.aero) {
      const p = this.partPoseByFrame(a.frame)
      if (!p) continue
      const b = a.frame.body
      const v = b.linvel()
      // chord + normal from part orientation (planar XY)
      const ang = zAngleOf(p.q)
      const tx = Math.cos(ang)
      const ty = Math.sin(ang)
      const nx = -ty
      const ny = tx
      // Span-aware lift: lift scales with wingspan (depth) like real wings.
      // Drag stays profile-based (chord*thick) so big spans don't choke
      // the airframe — induced-drag scaling is folded into LIFT_COEF.
      const area = (a.chord * Math.max(a.thick, 8) * Math.max(0.4, a.span / 60)) / 4000
      const dragArea = (a.chord * Math.max(a.thick, 8)) / 4000
      const F = wingAccel({ tx, ty, nx, ny, vx: v.x, vy: v.y, area, dragArea })
      this.dbgAero.push({ fx: F.fx, fy: F.fy, m: this.masses.get(b.handle) ?? a.frame.mass, area, ang: v.y, vA: v.x })
      // Absolute force (reference air density), NOT scaled by the carrier's
      // mass: scaling by compound mass amplified small tails ~40x and
      // pinned the fuselage at the tail's equilibrium. Physical model: a
      // heavier plane needs bigger wings to fly.
      this.applyImpulse(b, F.fx * GAME_AIR_RHO * dt, F.fy * GAME_AIR_RHO * dt, 0)
      // pitch damping (strong: rotation must stay gentle for takeoff)
      const w = b.angvel()
      b.setAngvel({ x: w.x, y: w.y, z: w.z * (1 - Math.min(0.5, 1.0 * a.stability * dt)) }, true)
    }
    // --- flight assist (lift autopilot) ---
    for (const s of this.assist) {
      const v = s.body.linvel()
      const q = s.body.rotation() as Quat
      const b = s.body
      const w = b.angvel()
      const sp = Math.hypot(v.x, v.y)
      const pitch = zAngleOf(q)
      const pitchRate = w.z as number
      const powered = this.isPropellerActive(b)
      if (!powered) {
        s.recovering = false
      } else if (!s.recovering) {
        if (pitch < RECOVERY_ENTER_PITCH) s.recovering = true
      } else if (pitch > RECOVERY_EXIT_PITCH && Math.abs(pitchRate) < RECOVERY_EXIT_RATE) {
        s.recovering = false
      }

      if (sp >= 25) {
        // wing AoA = body z-angle + incidence - velocity angle (wrapped)
        let aoa = pitch + s.incidence - Math.atan2(v.y, v.x)
        while (aoa > Math.PI) aoa -= Math.PI * 2
        while (aoa < -Math.PI) aoa += Math.PI * 2
        // Adaptive target: the AoA that produces ~1.25g of lift at this speed
        // (clamped to a sane stall margin), so lift never explodes with v^2.
        const gAccel = WORLD_GRAVITY * this.gravityScale
        const liftNeeded = (1.25 * gAccel * b.mass()) / (LIFT_COEF * s.area * sp * sp * GAME_AIR_RHO)
        const aoaTarget = Math.asin(Math.min(0.5, Math.max(0.004, liftNeeded)))
        if (!s.recovering) {
          const tau = assistTorque(aoa - aoaTarget, pitchRate, Math.min(sp, 1200), s.strength) * s.inertia
          if (tau !== 0) this.applyTorqueZ(b, tau * dt)
          // pitch limiter: bound the climb/dive angle so the lift's vertical
          // component stays above 1g (a steep climb starves it and spirals)
          const lim = (18 * Math.PI) / 180
          const over = pitch - Math.max(-lim, Math.min(lim, pitch))
          if (over !== 0) {
            this.applyTorqueZ(b, (-over * 3.0 * Math.min(sp, 600) * s.inertia * dt))
          }
        }
        // roll damping about X (keep wings level)
        b.setAngvel({ x: (w.x as number) * (1 - Math.min(0.5, 2.0 * dt)), y: w.y, z: w.z }, true)
        // landing-gear shock absorption: damp only HARD impacts (slow falls
        // must decay naturally — damping them fakes a hover equilibrium)
        const t = s.body.translation()
        const groundW = -this.groundY
        if (t.y > groundW - 280 && t.y < groundW + 4 && v.y < -160) {
          b.setLinvel({ x: v.x, y: v.y * (1 - 0.5), z: v.z }, true)
        }
      }
      // Apply recovery after the assist's legacy angular-velocity update so
      // the servo torque is not overwritten. It remains independent of airspeed
      // and can recover the airframe before forward speed develops.
      if (s.recovering) {
        const alpha = attitudeRecoveryAccel(pitch, pitchRate, powered, true)
        if (alpha !== 0) {
          const inertia = Math.max(1, b.effectiveAngularInertia().m33)
          this.applyTorqueZ(b, alpha * inertia * dt)
        }
      }
    }
    // --- thrusters ---
    for (const t of this.thrusters) {
      if (t.active <= 0.01) continue
      const q = t.body.rotation() as Quat
      const dir = rotateVec(q, t.localFacing)
      const m = this.masses.get(t.body.handle) ?? 1
      const F = t.force * t.active * t.active * THRUSTER_K * m * dt
      const pp = this.frameWorldPos(t.frame)
      this.applyImpulseAt(t.body, dir.x * F, dir.y * F, dir.z * F, pp.x, pp.y, pp.z)
    }
    // --- propellers: F = k * w^2 along carrier facing ---
    for (const pr of this.propellers) {
      const wSpeed = pr.joint ? Math.abs(pr.joint.rotorW) : Math.abs(pr.body.angvel().z as number)
      if (wSpeed < 0.2) continue
      const carrier = pr.stator ?? pr.body
      const cq = carrier.rotation() as Quat
      const dir = rotateVec(cq, pr.localFacing)
      const m = this.masses.get(pr.body.handle) ?? 1
      const F = pr.thrust * wSpeed * wSpeed * PROPULSION_K * m * dt
      const pp = this.frameWorldPos(pr.frame)
      this.applyImpulseAt(pr.body, dir.x * F, dir.y * F, dir.z * F, pp.x, pp.y, pp.z)
    }
    // --- particles in fluids ---
    for (const pb of this.particles) {
      const t = pb.translation()
      const sample = {
        minX: t.x - 5, minY: t.y - 5, minZ: t.z - 5,
        maxX: t.x + 5, maxY: t.y + 5, maxZ: t.z + 5,
        volume: 500, density: 0.0006,
      }
      const ff = fluidForcesFor(sample, this.waterRegions, g)
      if (ff.submerged > 0.001) {
        const m = pb.mass()
        this.applyImpulse(pb, 0, m * g * ff.buoy * dt, 0)
        const v = pb.linvel()
        const dk = 1.4 * ff.submerged * dt
        this.applyImpulse(pb, -v.x * m * dk, -v.y * m * dk, -v.z * m * dk)
        if (ff.entrain > 0.001) {
          const c = 2.0 * ff.submerged * dt
          this.applyImpulse(pb, m * (ff.flowX - v.x) * c, m * (ff.flowY - v.y) * c, m * (ff.flowZ - v.z) * c)
        }
      }
    }
  }

  private frameWorldPos(f: PartFrame): Vec3 {
    const t = f.body.translation()
    const q = f.body.rotation() as Quat
    const off = rotateVec(q, { x: f.lx, y: f.ly, z: f.lz })
    return { x: t.x + off.x, y: t.y + off.y, z: t.z + off.z }
  }

  private partPoseByFrame(f: PartFrame): { x: number; y: number; z: number; q: Quat } | null {
    const t = f.body.translation()
    const q = f.body.rotation() as Quat
    const off = rotateVec(q, { x: f.lx, y: f.ly, z: f.lz })
    return { x: t.x + off.x, y: t.y + off.y, z: t.z + off.z, q: quatMul(q, f.lq) }
  }

  private applyImpulse(b: RAPIER.RigidBody, x: number, y: number, z: number) {
    if (b.isFixed()) return
    b.applyImpulse({ x, y, z }, true)
  }

  private applyImpulseAt(b: RAPIER.RigidBody, x: number, y: number, z: number, px: number, py: number, pz: number) {
    if (b.isFixed()) return
    b.applyImpulseAtPoint({ x, y, z }, { x: px, y: py, z: pz }, true)
  }

  /** Pure Z torque via an offset force pair (no torque API needed). */
  private applyTorqueZ(b: RAPIER.RigidBody, tauDt: number) {
    if (b.isFixed()) return
    const t = b.translation()
    const q = b.rotation() as Quat
    const rx = rotateVec(q, { x: 1, y: 0, z: 0 })
    const ry = rotateVec(q, { x: 0, y: 1, z: 0 })
    const d = 40
    const F = tauDt / (2 * d)
    this.applyImpulseAt(b, ry.x * F, ry.y * F, ry.z * F, t.x + rx.x * d, t.y + rx.y * d, t.z + rx.z * d)
    this.applyImpulseAt(b, -ry.x * F, -ry.y * F, -ry.z * F, t.x - rx.x * d, t.y - rx.y * d, t.z - rx.z * d)
  }

  // ------------------------------------------------------------------
  /** Motor servos run BEFORE the solver so contact impulses compose.
   * Pin joints with a boundComponent are driven too (wind/water rotors). */
  private enforceDrives(dt: number, keOf: (compName: string | undefined) => number) {
    for (const j of this.joints) {
      if (j.kind === 'motor' || j.kind === 'pin') this.enforceMotor(j, dt, keOf)
    }
  }

  /** Servo toward no-load speed V/ke with acceleration limiting. */
  private enforceMotor(j: SimJoint, dt: number, keOf: (compName: string | undefined) => number) {
    const b = j.bodyB
    if (b.isFixed()) return
    const V = j.driveV
    const ke = keOf(j.def.props.boundComponent)
    if (j.def.props.axis3d === 'y') {
      // Azimuth sweep about the vertical axis. Kinematic teleport of the
      // whole transitive joint group: the welded arm's inertia dominates the
      // turntable's, so both velocity and position servos on the turntable
      // alone get eaten by the joint solver — rotating the entire connected
      // assembly about the axis instead behaves like the real machine.
      if (Math.abs(V) < 0.05) {
        j.servoRate = 0
        return
      }
      const wNow = j.servoRate
      const target = clamp(V / Math.max(ke, 0.05), -42, 42)
      const maxAccel = j.def.props.maxAccel ?? 34
      const dwRate = clamp((target - wNow) * 0.25, -maxAccel * dt, maxAccel * dt)
      const newRate = wNow + dwRate
      j.servoRate = newRate
      const dY = newRate * dt
      const wv = b.angvel()
      const aW = b.translation()
      const dq = quatY(dY)
      for (const other of this.transitiveGroup(b)) {
        const t = other.translation()
        const rel = { x: t.x - aW.x, y: t.y - aW.y, z: t.z - aW.z }
        const nRel = rotateVec(dq, rel)
        other.setTranslation({ x: aW.x + nRel.x, y: aW.y + nRel.y, z: aW.z + nRel.z }, true)
        other.setRotation(quatMul(dq, other.rotation() as Quat), true)
      }
      b.setAngvel({ x: wv.x, y: newRate, z: wv.z }, true)
      return
    }
    // Screen-plane rotors: electrical drive + hydraulic flow, independent.
    // Kinematic servo: rotate about the joint hinge each substep. A velocity
    // servo on one body gets eaten by the joint solver when the connected
    // bodies' inertia dominates; teleporting the pose instead lets the
    // joint constraints carry the assembly, exactly like the real machine.
    const wNow = -(b.angvel().z as number) // screen-CW-positive
    let dw = 0
    if (Math.abs(V) >= 0.05) {
      // electrical drive (coasts otherwise)
      const target = clamp(V / Math.max(ke, 0.05) - 0.001 * wNow, -42, 42)
      const maxAccel = j.def.props.maxAccel ?? 34
      dw += clamp((target - wNow) * 0.25, -maxAccel * dt, maxAccel * dt)
    }
    // hydraulic drive: a rotor dipped in flow is dragged toward
    // flow-matching rim speed (undershot-wheel physics). This is what turns
    // the millrace/wind current into reliable rotation.
    const flow = this.rotorFlow(j)
    if (flow.frac > 0.03 && Math.abs(flow.vx) > 10) {
      const wFlow = clamp(-flow.vx / 70, -20, 20) // screen-CW-positive
      dw += clamp((wFlow - wNow) * 0.2, -10 * dt, 10 * dt)
    }
    if (dw !== 0) {
      const w = b.angvel()
      const newW = -(wNow + dw)
      const tA = j.bodyA.translation()
      const qA2 = j.bodyA.rotation() as Quat
      const aOff = rotateVec(qA2, j.lA)
      const aW = { x: tA.x + aOff.x, y: tA.y + aOff.y, z: tA.z + aOff.z }
      const t = b.translation()
      const rx = t.x - aW.x
      const ry = t.y - aW.y
      if (Math.hypot(rx, ry) > 1) {
        // HINGED BODY (real arm): kinematic rotation about the hinge across
        // the whole attached group — a velocity servo gets eaten by the
        // joint solver when gravity or the connected inertia dominates;
        // teleporting the group's pose survives it.
        const dq = quatZ(newW * dt)
        for (const other of this.transitiveGroup(b)) {
          const ot = other.translation()
          const oRel = { x: ot.x - aW.x, y: ot.y - aW.y, z: ot.z - aW.z }
          const nRel = rotateVec(dq, oRel)
          other.setTranslation({ x: aW.x + nRel.x, y: aW.y + nRel.y, z: aW.z + nRel.z }, true)
          other.setRotation(quatMul(dq, other.rotation() as Quat), true)
          other.setLinvel({ x: -newW * oRel.y, y: newW * oRel.x, z: 0 }, true)
          other.setAngvel({ x: w.x, y: w.y, z: newW }, true)
        }
      } else {
        // WHEEL AXLE (r=0): plain velocity servo — rolling friction needs
        // the impulse accumulation to drive vehicles.
        b.setAngvel({ x: w.x, y: w.y, z: newW }, true)
      }
    }
  }

  /** All rigid bodies transitively connected to `body` via pin/motor joints
   * (skipping fixed bodies — rotating those is a no-op). */
  private transitiveGroup(body: RAPIER.RigidBody): RAPIER.RigidBody[] {
    const seen = new Set<number>()
    const walk = (h: number) => {
      if (seen.has(h)) return
      seen.add(h)
      for (const j of this.joints) {
        if (j.kind !== 'pin' && j.kind !== 'motor') continue
        if (j.bodyA.handle === h) walk(j.bodyB.handle)
        else if (j.bodyB.handle === h) walk(j.bodyA.handle)
      }
    }
    walk(body.handle)
    const out: RAPIER.RigidBody[] = []
    for (const h of seen) {
      const b = this.byHandle.get(h)
      if (b && !b.isFixed()) out.push(b)
    }
    return out
  }

  /** Average flow sampled by a rotor body's parts (for hydraulic drive). */
  private rotorFlow(j: SimJoint): { vx: number; frac: number } {    let vx = 0
    let frac = 0
    for (const [, f] of this.frames) {
      if (f.body.handle !== j.bodyB.handle) continue
      const p = this.partPoseByFrame(f)
      if (!p) continue
      const sample = partSample(f, p)
      const ff = fluidForcesFor(sample, this.waterRegions, 1)
      if (ff.submerged > 0.01 && (ff.flowX !== 0 || ff.flowY !== 0)) {
        vx += ff.flowX * ff.submerged
        frac += ff.submerged
      }
    }
    return { vx: frac > 0 ? vx / Math.max(1e-9, frac) : 0, frac }
  }

  /** Kinematic constraints need post-solve poses. */
  private enforceConstraints() {
    for (const j of this.joints) {
      if (j.kind === 'slider') this.enforceSlider(j)
      if (j.kind === 'pin' || j.kind === 'motor') this.enforceAngleLimits(j)
    }
  }

  /** Clamp revolute joints with angular limits (screen-CW degrees). */
  private enforceAngleLimits(j: SimJoint) {
    const { minAngle, maxAngle } = j.def.props
    if (minAngle === undefined && maxAngle === undefined) return
    const b = j.bodyB
    const a = j.bodyA
    if (b.isFixed()) return
    const lo = ((minAngle ?? -1e9) * Math.PI) / 180
    const hi = ((maxAngle ?? 1e9) * Math.PI) / 180
    if (j.def.props.axis3d === 'y') {
      // Azimuth limits about the vertical axis (math-positive).
      const yA = yAngleOf(a.rotation() as Quat)
      const yB = yAngleOf(b.rotation() as Quat)
      const rel = normAngle(yB - yA - j.buildDeltaY)
      if (rel < lo || rel > hi) {
        const clamped = clamp(rel, lo, hi)
        b.setRotation(quatY(yA + j.buildDeltaY + clamped), true)
        const w = b.angvel()
        if ((rel < lo && w.y < 0) || (rel > hi && w.y > 0)) {
          b.setAngvel({ x: w.x, y: 0, z: w.z }, true)
        }
      }
      return
    }
    const zA = zAngleOf(a.rotation() as Quat)
    const zB = zAngleOf(b.rotation() as Quat)
    const rel = -normAngle(zB - zA - j.buildDeltaZ) // screen-CW-positive
    if (rel < lo || rel > hi) {
      const clamped = clamp(rel, lo, hi)
      const zBNew = zA + j.buildDeltaZ - clamped
      // Planar clamp (limited joints stay in-plane by design).
      b.setRotation(quatZ(zBNew), true)
      const w = b.angvel()
      const screenW = -(w.z as number)
      if ((rel < lo && screenW < 0) || (rel > hi && screenW > 0)) {
        b.setAngvel({ x: w.x, y: w.y, z: 0 }, true)
      }
    }
  }

  /** Project slider bodies onto their axis; rack-pinion drive when driveBy. */
  private enforceSlider(j: SimJoint) {
    const b = j.bodyB
    const a = j.bodyA
    if (b.isFixed()) return
    const tA = a.translation()
    const qA = a.rotation() as Quat
    const tB = b.translation()
    const axW = rotateVec(qA, j.axisLocal)
    const perpW = rotateVec(qA, j.buildPerp)
    const driveBy = j.def.props.driveBy
    if (driveBy) {
      const pinion = this.joints.find((x) => x.def.id === driveBy)
      if (pinion && pinion.kind === 'motor') {
        const ratio = j.def.props.ratio ?? 6
        const zP = zAngleOf(pinion.bodyB.rotation() as Quat)
        // screen-CW angle of the pinion times ratio = travel along axis
        const travel = -normAngle(zP - pinion.buildAngleB) * ratio
        const tx = tA.x + axW.x * (j.buildOffset + travel) + perpW.x
        const ty = tA.y + axW.y * (j.buildOffset + travel) + perpW.y
        const tz = tA.z + axW.z * (j.buildOffset + travel) + perpW.z
        const dt = 1 / 60 / SUBSTEPS
        const vx = clamp((tx - tB.x) / dt, -1800, 1800)
        const vy = clamp((ty - tB.y) / dt, -1800, 1800)
        const vz = clamp((tz - tB.z) / dt, -1800, 1800)
        b.setTranslation({ x: tx, y: ty, z: tz }, true)
        b.setLinvel({ x: vx, y: vy, z: vz }, true)
        b.setRotation(quatMul(qA, quatZ(j.buildDeltaZ)), true)
        b.setAngvel({ x: 0, y: 0, z: 0 }, true)
        return
      }
    }
    // Free slider: remove perpendicular error (soft prismatic joint).
    const rel = { x: tB.x - tA.x, y: tB.y - tA.y, z: tB.z - tA.z }
    const along = rel.x * axW.x + rel.y * axW.y + rel.z * axW.z
    b.setTranslation(
      { x: tB.x - (rel.x - axW.x * along), y: tB.y - (rel.y - axW.y * along), z: tB.z - (rel.z - axW.z * along) },
      true,
    )
    const va = a.linvel()
    const vb = b.linvel()
    const rvx = vb.x - va.x
    const rvy = vb.y - va.y
    const rvz = vb.z - va.z
    const vAlong = rvx * axW.x + rvy * axW.y + rvz * axW.z
    b.setLinvel({ x: va.x + axW.x * vAlong, y: va.y + axW.y * vAlong, z: va.z + axW.z * vAlong }, true)
  }

  private clampVelocities() {
    const clampBody = (b: RAPIER.RigidBody) => {
      if (b.isFixed()) return
      const v = b.linvel()
      const sp = Math.hypot(v.x, v.y, v.z)
      if (sp > MAX_LIN_VEL) {
        const k = MAX_LIN_VEL / sp
        b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true)
      }
      const w = b.angvel()
      const ws = Math.hypot(w.x, w.y, w.z)
      if (ws > MAX_ANG_VEL) {
        const k = MAX_ANG_VEL / ws
        b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true)
      }
    }
    for (const [, b] of this.bodies) clampBody(b)
    for (const pb of this.particles) clampBody(pb)
  }

  // ------------------------------------------------------------------
  // particles
  private stillCounts = new Map<number, number>()

  private emitterTip(em: EmitterEntry): Vec3 {
    const f = this.frames.get(em.partId)
    if (!f) return { x: 0, y: 0, z: 0 }
    const p = this.frameWorldPos(f)
    return { x: p.x + em.dirX * 26, y: p.y + em.dirY * 26, z: p.z + em.dirZ * 26 }
  }

  private removeParticleAt(i: number) {
    const b = this.particles[i]
    const c = this.particleColliders[i]
    this.stillCounts.delete(b.handle)
    try {
      this.world.removeCollider(c, true)
    } catch {
      /* ignore */
    }
    try {
      this.world.removeRigidBody(b)
    } catch {
      /* ignore */
    }
    this.particles.splice(i, 1)
    this.particleColliders.splice(i, 1)
  }

  private spawnParticles(dtSeconds: number) {
    for (const em of this.emitters) {
      em.acc += em.rate * dtSeconds
      let n = Math.floor(em.acc)
      em.acc -= n
      const tip = this.emitterTip(em)
      while (n-- > 0) {
        if (this.particles.length >= 240) {
          this.removeParticleAt(0)
          const nb = this.makeParticle(tip.x, tip.y, tip.z, em)
          if (nb) {
            this.particles.push(nb.body)
            this.particleColliders.push(nb.col)
          }
        } else {
          const nb = this.makeParticle(tip.x, tip.y, tip.z, em)
          if (nb) {
            this.particles.push(nb.body)
            this.particleColliders.push(nb.col)
          }
        }
      }
    }
    // cull strays
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const b = this.particles[i]
      const t = b.translation()
      if (t.y > 4000 || t.y < -6000 || Math.abs(t.x) > 9000 || Math.abs(t.z) > 9000) {
        this.removeParticleAt(i)
      }
    }
  }

  private makeParticle(x: number, y: number, z: number, em: EmitterEntry): { body: RAPIER.RigidBody; col: RAPIER.Collider } | null {
    try {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setLinearDamping(0.05)
          .setAngularDamping(0.4)
          .setCcdEnabled(true)
          .setCanSleep(false),
      )
      const vx = em.dirX * 140 + (Math.random() - 0.5) * 30
      const vy = em.dirY * 140 + (Math.random() - 0.5) * 30
      body.setLinvel({ x: vx, y: vy, z: 0 }, true)
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.ball(5)
          .setDensity(0.0006)
          .setFriction(0)
          .setRestitution(0.05)
          .setCollisionGroups((ParticleBit() << 16) | (0xffff & ~ParticleBit())),
        body,
      )
      return { body, col }
    } catch {
      return null
    }
  }

  /** Merge slow submerged droplets into the pool (bounds packed piles). */
  private mergeStillParticles() {
    if (this.particles.length === 0) return
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const b = this.particles[i]
      const v = b.linvel()
      if (Math.hypot(v.x, v.y, v.z) > 30) {
        this.stillCounts.delete(b.handle)
        continue
      }
      const t = b.translation()
      let submerged = false
      for (const r of this.waterRegions) {
        if (
          Math.abs(t.x - r.cx) < r.hx &&
          Math.abs(t.y - r.cy) < r.hy &&
          Math.abs(t.z - r.cz) < r.hz
        ) {
          // center inside counts when slow
          submerged = true
          break
        }
      }
      if (!submerged) {
        this.stillCounts.delete(b.handle)
        continue
      }
      const dwell = (this.stillCounts.get(b.handle) ?? 0) + 1
      if (dwell < 40) {
        this.stillCounts.set(b.handle, dwell)
        continue
      }
      this.removeParticleAt(i)
    }
  }
}

function ParticleBit(): number {
  return 1 << 15
}

function boundingVolume(positions: Float32Array): number {
  if (positions.length < 9) return 8000
  let x0 = Infinity
  let y0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let z1 = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  return Math.max(8, (x1 - x0) * (y1 - y0) * (z1 - z0))
}

function partSample(
  f: PartFrame,
  p: { x: number; y: number; z: number },
): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; volume: number; density: number } {
  // Exact world AABB of the oriented box extents.
  const q = quatMul(
    (f.body.rotation() as Quat),
    f.lq,
  )
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = rotateVec(q, { x: f.hx * sx, y: f.hy * sy, z: f.hz * sz })
        const wx = p.x + c.x
        const wy = p.y + c.y
        const wz = p.z + c.z
        if (wx < minX) minX = wx
        if (wx > maxX) maxX = wx
        if (wy < minY) minY = wy
        if (wy > maxY) maxY = wy
        if (wz < minZ) minZ = wz
        if (wz > maxZ) maxZ = wz
      }
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, volume: f.volume, density: f.density }
}
