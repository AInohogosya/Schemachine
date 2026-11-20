// ============================================================================
// Headless verification (3D): solver unit checks + full preset simulations
// against the Rapier rigid-body world. 3D world: x right, y UP, z toward
// viewer; authored 2D (x, y-down) maps to (x, -y). Screen-clockwise-positive
// semantics are preserved for motors/limits.
// Run with: npm run test:headless
// ============================================================================

import { PRESETS } from '../src/presets'
import { parseProjectFile, serializeProject } from '../src/ui/io'
import { partDepthOf } from '../src/physics/materials'
import { CircuitEngine } from '../src/circuit/engine'
import { COMPONENT_DEFS } from '../src/circuit/components'
import { evaluateGate } from '../src/circuit/solver'
import { SimRunner3D } from '../src/sim/runner3d'
import { zAngleOf, rotateVec, quatConj, quatMul } from '../src/physics/world'
import type { ImpulseJoint } from '@dimforge/rapier3d-compat'
import { parseStl, normalizeGeometry, f32ToBase64, u32ToBase64 } from '../src/studio/stl'
import { buildMeshData } from '../src/studio/meshdata'
import type { ProjectData } from '../src/types'

let failures = 0
let passes = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passes++
    console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function comp(p: ProjectData, name: string) {
  const c = p.circuit.components.find((x) => x.name === name)
  if (!c) throw new Error(`component missing: ${name}`)
  return c
}

function part(p: ProjectData, name: string) {
  const q = p.hardware.parts.find((x) => x.name === name)
  if (!q) throw new Error(`part missing: ${name}`)
  return q
}

async function step(runner: SimRunner3D, n: number) {
  for (let i = 0; i < n; i++) runner.step(performance.now())
}

function pose(runner: SimRunner3D, p: ProjectData, name: string) {
  const q = runner.world.partPose(part(p, name).id)
  if (!q) throw new Error(`no pose for ${name}`)
  return q
}

function motorW(runner: SimRunner3D, boundName: string): number {
  const n = boundName.trim().toLowerCase()
  for (const j of runner.world.joints) {
    if (j.kind !== 'motor' && j.kind !== 'pin') continue
    if ((j.def.props.boundComponent ?? '').trim().toLowerCase() === n) return j.rotorW
  }
  return 0
}

function norm(name: string) {
  return name.trim().toLowerCase()
}

/** Transitive weld groups: part id -> the set of parts sharing its rigid body. */
function weldGroups(p: ProjectData): Map<string, Set<string>> {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = parent.get(k) ?? k
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as string
    let cur = k
    while (parent.get(cur) !== undefined && parent.get(cur) !== r) {
      const next = parent.get(cur) as string
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  for (const q of p.hardware.parts) if (!parent.has(q.id)) parent.set(q.id, q.id)
  for (const j of p.hardware.joints) {
    if (j.type !== 'weld') continue
    const ra = find(j.a)
    const rb = find(j.b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const roots = new Map<string, Set<string>>()
  for (const q of p.hardware.parts) {
    const r = find(q.id)
    const set = roots.get(r) ?? new Set<string>()
    set.add(q.id)
    roots.set(r, set)
  }
  const byId = new Map<string, Set<string>>()
  for (const q of p.hardware.parts) byId.set(q.id, roots.get(find(q.id))!)
  return byId
}

// ---------------------------------------------------------------- solver
async function testSolver() {
  console.log('SOLVER')
  const proj: ProjectData = {
    version: 1,
    name: 't',
    groundY: 900,
    circuit: { components: [], wires: [] },
    hardware: { parts: [], joints: [], meshes: [] },
  }
  let id = 0
  const mk = (type: never, name: string, x: number, y: number, props: never = {} as never) => {
    const c = { id: `c${id++}`, name, type, x, y, props }
    proj.circuit.components.push(c as never)
    return c as unknown as { id: string }
  }
  const wire = (a: { id: string }, pa: string, b: { id: string }, pb: string) => {
    proj.circuit.wires.push({ id: `w${id++}`, from: { componentId: a.id, pin: pa }, to: { componentId: b.id, pin: pb } })
  }
  const batt = mk('battery' as never, 'B', 0, 0, { voltage: 9 } as never)
  const gnd = mk('ground' as never, 'G', 0, 0)
  const r1 = mk('resistor' as never, 'R1', 0, 0, { resistance: 1000 } as never)
  const r2 = mk('resistor' as never, 'R2', 0, 0, { resistance: 2000 } as never)
  const led = mk('led' as never, 'L', 0, 0, { forwardVoltage: 2, color: 'red' } as never)
  const sw = mk('switchSlide' as never, 'S', 0, 0, { closed: true } as never)
  wire(batt, '+', r1, 'A')
  wire(r1, 'B', r2, 'A')
  wire(r2, 'B', gnd, 'G')
  wire(batt, '-', gnd, 'G')
  wire(r1, 'B', sw, 'A')
  wire(sw, 'B', led, 'A')
  wire(led, 'K', gnd, 'G')

  const eng = new CircuitEngine(proj.circuit)
  eng.tick(1)
  const vTap = eng.runtime.pinVoltages.get(r1.id)?.get('B') ?? -1
  check('loaded divider tap near LED Vf', vTap > 1.7 && vTap < 2.4, `got ${vTap.toFixed(2)}V`)
  const ledSt = eng.runtime.states.get(led.id)
  check('LED lit through switch', (ledSt?.brightness ?? 0) > 0.15, `brightness ${ledSt?.brightness?.toFixed(2)}`)

  const swComp = proj.circuit.components.find((x) => x.id === sw.id)!
  ;(swComp.props as { closed: boolean }).closed = false
  eng.tick(2)
  const ledSt2 = eng.runtime.states.get(led.id)
  check('LED off when switch open', (ledSt2?.brightness ?? 1) < 0.01, `brightness ${ledSt2?.brightness?.toFixed(3)}`)

  check('AND gate', evaluateGate('AND', 5, 5) === true && evaluateGate('AND', 5, 0) === false)
  check('OR gate', evaluateGate('OR', 0, 5) === true && evaluateGate('OR', 0, 0) === false)
  check('NOT gate', evaluateGate('NOT', 5, 0) === false && evaluateGate('NOT', 0, 0) === true)
  check('NAND gate', evaluateGate('NAND', 5, 5) === false && evaluateGate('NAND', 5, 0) === true)
  check('NOR gate', evaluateGate('NOR', 0, 0) === true && evaluateGate('NOR', 5, 0) === false)
  check('XOR gate', evaluateGate('XOR', 5, 5) === false && evaluateGate('XOR', 5, 0) === true)
  check('XNOR gate', evaluateGate('XNOR', 0, 0) === true && evaluateGate('XNOR', 5, 0) === false)

  const proj2: ProjectData = {
    version: 1, name: 'short', groundY: 900,
    circuit: { components: [], wires: [] }, hardware: { parts: [], joints: [], meshes: [] },
  }
  const b2 = { id: 'b', name: 'B', type: 'battery', x: 0, y: 0, props: { voltage: 9, maxCurrent: 8 } }
  const g2 = { id: 'g', name: 'G', type: 'ground', x: 0, y: 0, props: {} }
  proj2.circuit.components.push(b2 as never, g2 as never)
  proj2.circuit.wires.push({ id: 'w', from: { componentId: 'b', pin: '+' }, to: { componentId: 'g', pin: 'G' } })
  proj2.circuit.wires.push({ id: 'w2', from: { componentId: 'b', pin: '-' }, to: { componentId: 'g', pin: 'G' } })
  const eng2 = new CircuitEngine(proj2.circuit)
  eng2.tick(100)
  const bst = eng2.runtime.states.get('b')
  check('dead short trips battery', bst?.tripped === true, `tripped=${bst?.tripped} I=${bst?.current?.toFixed(1)}A`)
  const wcur = eng2.runtime.wires.get('w')
  check('short wire flagged overload or zero after trip', (wcur?.overloaded === true) || Math.abs(wcur?.current ?? 0) < 0.01)
}

// ---------------------------------------------------------------- studio
async function testStudioMeshes() {
  console.log('STUDIO MESHES')
  // sculpted plate (indent + bulge) bound to a dynamic part
  const p: ProjectData = {
    version: 1, name: 'studio', groundY: 900,
    circuit: { components: [], wires: [] },
    hardware: { parts: [], joints: [], meshes: [] },
  }
  p.hardware.meshes.push({
    id: 'm1', name: 'Dented Plate', base: 'plate',
    w: 120, h: 80, depth: 24, segments: 14,
    ops: [
      { x: 0, y: 0, z: 12, radius: 30, strength: -12, falloff: 2 },
      { x: -30, y: 10, z: 12, radius: 20, strength: 9, falloff: 2 },
    ],
  })
  const data = buildMeshData(p.hardware.meshes[0])
  check('sculpted plate builds vertices', data.positions.length > 100, `${data.positions.length / 3} verts`)
  p.hardware.parts.push({
    id: 'p1', name: 'Sculpted', kind: 'block', x: 500, y: 500, z: 0,
    angle: 0, w: 120, h: 80, props: { meshId: 'm1' },
  })
  // STL blob (inline tetra) bound to a static part
  const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 60 0 0\nvertex 0 60 0\nendloop\nendfacet\n` +
    `facet normal 0 1 0\nouter loop\nvertex 0 0 0\nvertex 0 0 60\nvertex 60 0 0\nendloop\nendfacet\nendsolid t`
  const geo = normalizeGeometry(parseStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer), 100)
  check('inline STL parses', geo.indices.length >= 6, `${geo.indices.length / 3} tris`)
  p.hardware.meshes.push({
    id: 'm2', name: 'Tetra', base: 'plate',
    w: 100, h: 100, depth: 100, segments: 4, ops: [],
    stl: {
      positions: f32ToBase64(geo.positions),
      indices: u32ToBase64(geo.indices),
      vertexCount: geo.positions.length / 3,
      triangleCount: geo.indices.length / 3,
    },
  })
  p.hardware.parts.push({
    id: 'p2', name: 'Statue', kind: 'block', x: 700, y: 830, z: 0,
    angle: 0, w: 100, h: 100, props: { meshId: 'm2', isStatic: true },
  })
  const eng = new CircuitEngine(p.circuit)
  const runner = await SimRunner3D.create(p, eng)
  const y0 = runner.world.partPose('p1')!.y
  await step(runner, 240)
  const y1 = runner.world.partPose('p1')!.y
  check('sculpted part falls with convex collider', y1 < y0 - 50, `dy=${(y1 - y0).toFixed(0)}`)
  const st = runner.world.partPose('p2')!
  check('static STL part stays put', Math.abs(st.y - -830) < 2, `y=${st.y.toFixed(1)}`)
  runner.destroy()
}

// ---------------------------------------------------------------- structure
function testPresetStructure() {
  console.log('PRESET STRUCTURE AND BINDINGS')
  check('preset registry has the six advanced machines', PRESETS.length === 6 &&
    ['arcade', 'computer', 'cpu', 'humanoid', 'printer', 'quadruped'].every((id) => PRESETS.some((p) => p.id === id)),
    PRESETS.map((p) => p.id).join(', '))
  for (const preset of PRESETS) {
    const p = preset.build()
    const { components, wires } = p.circuit
    const { parts, joints, meshes } = p.hardware
    const unique = (values: string[]) => values.every((v) => v.length > 0) && new Set(values).size === values.length
    check(`${preset.id}: unique nonempty ids across all entities`,
      unique([...components, ...wires, ...parts, ...joints, ...meshes].map((v) => v.id)))
    check(`${preset.id}: unique nonempty binding names`,
      [components, parts, meshes].every((items) => unique(items.map((v) => norm(v.name)))))
    check(`${preset.id}: positive geometry everywhere`,
      parts.every((q) => Math.min(q.w, q.h) >= 4 && (q.props.depth ?? 1) > 0 && [q.x, q.y, q.z, q.angle].every(Number.isFinite)))
    const invalidWires = wires.filter((w) => ![w.from, w.to].every((end) => {
      const c = components.find((c) => c.id === end.componentId)
      return c && COMPONENT_DEFS[c.type].pins.some((pin) => pin.name === end.pin)
    }))
    check(`${preset.id}: wire endpoints exist in component pin definitions`, wires.length > 0 && invalidWires.length === 0,
      invalidWires.map((w) => w.id).join(', '))
    const componentNamed = (name: string) => components.find((c) => norm(c.name) === norm(name))
    const invalidBindings: string[] = []
    for (const q of parts) {
      const expected = q.kind === 'switchPad' ? ['switchPush', 'switchSlide'] : q.kind === 'ledBulb' ? ['led'] : q.kind === 'batteryPack' ? ['battery'] : []
      const c = q.props.boundComponent ? componentNamed(q.props.boundComponent) : undefined
      if ((q.props.boundComponent && !c) || (expected.length > 0 && (!c || !expected.includes(c.type)))) invalidBindings.push(q.name)
    }
    for (const c of components) {
      if (!c.props.bindHardware) continue
      const q = parts.find((q) => norm(q.name) === norm(c.props.bindHardware!))
      if (!q || norm(q.props.boundComponent ?? '') !== norm(c.name)) invalidBindings.push(c.name)
    }
    const motors = components.filter((c) => c.type === 'motor')
    const fans = components.filter((c) => c.type === 'fan')
    for (const j of joints) {
      if (!parts.some((q) => q.id === j.a) || !parts.some((q) => q.id === j.b) || j.a === j.b) invalidBindings.push(j.id)
      if ((j.type === 'motor' || j.props.boundComponent) && !['motor', 'fan'].includes(componentNamed(j.props.boundComponent ?? '')?.type ?? '')) invalidBindings.push(j.id)
    }
    check(`${preset.id}: hardware and joint bindings resolve with correct types`, invalidBindings.length === 0, invalidBindings.join(', '))
    check(`${preset.id}: every motor and fan circuit connects to a motor joint`,
      [...motors, ...fans].length > 0 &&
      [...motors, ...fans].every((c) => joints.some((j) => j.type === 'motor' && norm(j.props.boundComponent ?? '') === norm(c.name))))
    const invalidSliders = joints.filter((j) => j.type === 'slider').filter((j) => {
      const drive = joints.find((d) => d.id === j.props.driveBy)
      return !drive || drive.type !== 'motor' || componentNamed(drive.props.boundComponent ?? '')?.type !== 'motor' ||
        (drive.props.axis3d ?? 'z') !== 'z' || !Number.isFinite(j.props.axis) ||
        !Number.isFinite(j.props.ratio) || j.props.ratio === 0 ||
        !Number.isFinite(drive.props.minAngle) || !Number.isFinite(drive.props.maxAngle)
    })
    check(`${preset.id}: sliders reference bounded planar motor drives with finite nonzero ratios`, invalidSliders.length === 0,
      invalidSliders.map((j) => j.id).join(', '))
  }
}

// ---------------------------------------------------------------- 3D invariants
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function testPreset3DInvariants() {
  console.log('3D PRESET INVARIANTS')
  const cases: Record<string, { pair: [string, string]; z: [number, number]; carrier: string; switches: string[]; keys: string[] }> = {
    cpu: { pair: ['Heatsink Fan Blade 1', 'Heatsink Fan Cap'], z: [62, 74], carrier: 'Heatsink Fan Rotor', switches: ['ALU Power'], keys: [] },
    computer: { pair: ['Radiator A Blade 1', 'Radiator A Blade 2'], z: [-102, -62], carrier: 'Radiator A Hub', switches: ['Power Switch'], keys: [] },
    humanoid: { pair: ['Eye Left Bulb', 'Eye Right Bulb'], z: [-28, 28], carrier: 'Head Shell', switches: ['Robot Power'], keys: ['KeyT'] },
    quadruped: { pair: ['Camera Illuminator Bulb', 'Right Cheek Panel'], z: [0, 56 * 1.02], carrier: 'Hound Head', switches: ['Robot Power'], keys: ['KeyR'] },
    arcade: { pair: ['Exhaust Fan Blade 1', 'Exhaust Fan Blade 2'], z: [-69, 0], carrier: 'Exhaust Fan Hub', switches: ['Cabinet Power Switch'], keys: [] },
    printer: { pair: ['Tool Carriage Backplate', 'Hot End Glow Bulb'], z: [-36, 20], carrier: 'Tool Carriage', switches: ['Printer Power'], keys: ['KeyD'] },
  }
  check('3D regression cases cover the preset index', PRESETS.length === 6 &&
    canonicalJSON(PRESETS.map((s) => s.id).sort()) === canonicalJSON(Object.keys(cases).sort()))
  for (const preset of PRESETS) {
    const original = preset.build()
    const p = parseProjectFile(serializeProject(original))
    check(`${preset.id}: io preserves the entire project`,
      canonicalJSON(original) === canonicalJSON(p))
    const invalidGeometry: string[] = []
    for (const q of original.hardware.parts) {
      const depth = q.props.depth ?? partDepthOf(q.kind, undefined)
      if (![q.x, q.y, q.z, q.angle, q.w, q.h, depth].every(Number.isFinite) ||
        Math.min(q.w, q.h, depth) <= 0 ||
        (q.props.meshId !== undefined && !original.hardware.meshes.some((m) => m.id === q.props.meshId))) invalidGeometry.push(q.name)
    }
    check(`${preset.id}: finite positive geometry`, invalidGeometry.length === 0, invalidGeometry.join(', '))
    const spec = cases[preset.id]
    const groups = weldGroups(p)
    const carrierGroup = groups.get(part(p, spec.carrier).id)!
    check(`${preset.id}: depth pair are welded siblings of the moving carrier`,
      spec.pair.map((name) => part(p, name).id).every((id) => carrierGroup.has(id)))
    const [back, front] = spec.pair.map((name) => part(p, name))
    const clearance = front.z - back.z - (partDepthOf(back.kind, back.props.depth) + partDepthOf(front.kind, front.props.depth)) / 2
    check(`${preset.id}: named depth stations are separated`, back.z === spec.z[0] && front.z === spec.z[1] && clearance > 0,
      `${spec.pair.join(' / ')}; z=${back.z},${front.z}; clearance=${clearance}px`)
    const parts = new Map(p.hardware.parts.map((q) => [q.id, q]))
    const revolutes = p.hardware.joints.filter((j) => j.type === 'pin' || j.type === 'motor')
    const anchorErrors: string[] = []
    for (const j of revolutes) {
      const a = parts.get(j.a)
      const b = parts.get(j.b)
      if (!a || !b) {
        anchorErrors.push(j.id)
        continue
      }
      const anchor = (q: typeof a, x: number, y: number) => {
        const angle = q.angle * Math.PI / 180
        return { x: q.x + x * Math.cos(angle) - y * Math.sin(angle), y: -(q.y + x * Math.sin(angle) + y * Math.cos(angle)), z: q.z }
      }
      const wa = anchor(a, j.ax, j.ay)
      const wb = anchor(b, j.bx, j.by)
      const gap = Math.hypot(wa.x - wb.x, wa.y - wb.y, wa.z - wb.z)
      if (!(gap < 1e-6)) anchorErrors.push(`${a.name} / ${b.name}: ${gap}px`)
    }
    check(`${preset.id}: all authored revolute/motor anchors coincide in xyz`, revolutes.length > 0 && anchorErrors.length === 0,
      anchorErrors.join(', ') || `${revolutes.length} joints; tolerance=1e-6px; sliders excluded`)
    const eng = new CircuitEngine(p.circuit)
    const runner = await SimRunner3D.create(p, eng)
    try {
      let worstAnchor = 0
      for (const j of revolutes) {
        const built = runner.world.joints.find((s) => s.def.id === j.id)
        if (!built?.joint) {
          worstAnchor = Infinity
          continue
        }
        const native = built.joint as ImpulseJoint
        const a = rotateVec(built.bodyA.rotation(), native.anchor1())
        const b = rotateVec(built.bodyB.rotation(), native.anchor2())
        const ta = built.bodyA.translation()
        const tb = built.bodyB.translation()
        worstAnchor = Math.max(worstAnchor, Math.hypot(ta.x + a.x - tb.x - b.x, ta.y + a.y - tb.y - b.y, ta.z + a.z - tb.z - b.z))
      }
      check(`${preset.id}: native revolute/motor anchors coincide at build`, worstAnchor < 0.001, `max gap=${worstAnchor.toFixed(6)}px`)
      const start = spec.pair.map((name) => pose(runner, p, name))
      let worstDepth = 0
      let movement = 0
      const invalidPoses = new Set<string>()
      for (const name of spec.switches) comp(p, name).props.closed = true
      for (const key of spec.keys) eng.keyDown(key)
      for (let tick = 0; tick < 240; tick++) {
        await step(runner, 1)
        const carrier = pose(runner, p, spec.carrier)
        for (const [i, name] of spec.pair.entries()) {
          const q = pose(runner, p, name)
          const local = rotateVec(quatConj(carrier.q), { x: q.x - carrier.x, y: q.y - carrier.y, z: q.z - carrier.z })
          worstDepth = Math.max(worstDepth, Math.abs(local.z - (spec.z[i] - part(p, spec.carrier).z)))
          movement = Math.max(movement, Math.hypot(q.x - start[i].x, q.y - start[i].y, q.z - start[i].z))
        }
        for (const q of p.hardware.parts) {
          if (q.kind === 'water') continue
          const live = runner.world.partPose(q.id)
          const frame = runner.world.frames.get(q.id)
          if (!live || !frame || ![live.x, live.y, live.z, live.q.x, live.q.y, live.q.z, live.q.w,
            frame.hx, frame.hy, frame.hz, frame.volume, frame.mass].every(Number.isFinite) ||
            Math.min(frame.hx, frame.hy, frame.hz, frame.volume, frame.mass) <= 0 ||
            Math.abs(Math.hypot(live.q.x, live.q.y, live.q.z, live.q.w) - 1) > 0.001) invalidPoses.add(q.name)
        }
      }
      check(`${preset.id}: moving pair retains carrier-local depth over 240 steps`, worstDepth < 1 && movement > 1,
        `max depth error=${worstDepth.toFixed(4)}px; movement=${movement.toFixed(2)}px`)
      check(`${preset.id}: finite poses, unit quaternions and positive physics geometry throughout simulation`, invalidPoses.size === 0,
        [...invalidPoses].join(', '))
    } finally {
      runner.destroy()
    }
  }
}

// ---------------------------------------------------------------- robot circuits
async function testRobotCircuits() {
  console.log('ROBOT CIRCUITS')
  const robotIds = ['humanoid', 'quadruped']
  for (const id of robotIds) {
    const p = PRESETS.find((preset) => preset.id === id)!.build()
    const { components, wires } = p.circuit
    check(`${id}: rich mechanism with at least 100 authored parts`, p.hardware.parts.length >= 100, `${p.hardware.parts.length} parts`)
    const eng = new CircuitEngine(p.circuit)
    const pushes = components.filter((c) => c.type === 'switchPush')
    const masters = components.filter((c) => c.type === 'switchSlide' && /power/i.test(c.name))
    const lights = components.filter((c) => c.type === 'switchSlide' && /light|beacon/i.test(c.name))
    check(`${id}: master controls exist and lights default on`, masters.length > 0 && lights.length > 0 && lights.every((c) => c.props.closed === true))
    let now = 0
    const activate = (active: typeof pushes) => {
      eng.setPressed(new Set(active.flatMap((c) => c.props.key ? [c.props.key] : [])))
      for (const c of pushes) c.props.closed = active.includes(c)
      eng.tick(now += 20)
    }
    const motors = components.filter((c) => c.type === 'motor')
    const voltage = (c: typeof motors[number]) => eng.runtime.states.get(c.id)?.voltage ?? NaN
    const safe = () => eng.runtime.solved && eng.runtime.states.size === components.length &&
      [...eng.runtime.states.values()].every((s) => !s.overloaded && !s.tripped && !s.blown &&
        [s.voltage, s.current].every((v) => v === undefined || Number.isFinite(v))) &&
      eng.runtime.wires.size === wires.length && [...eng.runtime.wires.values()].every((w) => !w.overloaded && [w.current, w.vA, w.vB].every(Number.isFinite))
    for (const master of masters) master.props.closed = false
    let off = true
    for (const active of [[], ...pushes.map((c) => [c]), pushes]) {
      activate(active)
      off &&= motors.every((c) => Math.abs(voltage(c)) < 0.001) && safe()
    }
    check(`${id}: master off isolates all motor voltages for idle, single and all-push inputs`, off)
    for (const master of masters) master.props.closed = true
    activate([])
    check(`${id}: powered idle motors remain off and lamps are lit`, motors.every((c) => Math.abs(voltage(c)) < 0.001) &&
      components.filter((c) => c.type === 'led').every((c) => (eng.runtime.states.get(c.id)?.brightness ?? 0) > 0.1) && safe())
    const node = (componentId: string, pin: string) => eng.net.compById.get(componentId)!.pinNodes.get(pin)!
    const groups = new Map<string, typeof motors>()
    for (const motor of motors) {
      const key = `${node(motor.id, '+')}:${node(motor.id, '-')}`
      groups.set(key, [...(groups.get(key) ?? []), motor])
    }
    check(`${id}: at least three distinct motor terminal circuits`, groups.size >= 3, `${groups.size} independent circuits`)
    const covered = new Set<string>()
    for (const group of groups.values()) {
      const motor = group[0]
      const positive = pushes.filter((c) => node(c.id, 'B') === node(motor.id, '+'))
      const negative = pushes.filter((c) => node(c.id, 'B') === node(motor.id, '-'))
      const readings: number[] = []
      let independent = positive.length > 0 && negative.length > 0 && node(motor.id, '+') !== node(motor.id, '-')
      for (const [controls, sign] of [[positive, 1], [negative, -1]] as const) {
        for (const control of controls) {
          covered.add(control.id)
          activate([control])
          readings.push(voltage(motor))
          independent &&= group.every((c) => sign * voltage(c) > 1) &&
            motors.filter((c) => !group.includes(c)).every((c) => Math.abs(voltage(c)) < 0.001) && safe()
        }
      }
      check(`${id}: ${motor.name} forward/reverse inputs oppose voltage without cross-driving`, independent,
        readings.map((v) => `${v.toFixed(3)}V`).join(', '))
    }
    check(`${id}: every push control exercises a motor circuit`, pushes.length > 0 && covered.size === pushes.length)
    activate(pushes)
    let allSafe = true
    for (let tick = 0; tick < 60; tick++) {
      eng.tick(now += 20)
      allSafe &&= safe() && pushes.every((c) => eng.runtime.states.get(c.id)?.closed === true) &&
        motors.every((c) => Math.abs(voltage(c)) < 0.001) &&
        components.filter((c) => c.type === 'led').every((c) => (eng.runtime.states.get(c.id)?.brightness ?? 0) > 0.1)
    }
    check(`${id}: all push controls closed with default lights on cause no overloads, trips or blown fuses`, allSafe)
  }
}

// ---------------------------------------------------------------- mechanisms
async function testPresetMechanisms() {
  console.log('PRESET MECHANISMS')
  type Motion = { name: string; reference: string; motor: string; axis: 'x' | 'y' | 'rotationZ'; sign: number; keys: [string, string] }
  const cases: Record<string, Motion[]> = {
    humanoid: [
      { name: 'Left Hip Rotor', reference: 'Chest Core', motor: 'Left Hip Motor', axis: 'rotationZ', sign: -1, keys: ['ArrowUp', 'ArrowDown'] },
      { name: 'Right Hip Rotor', reference: 'Chest Core', motor: 'Right Hip Motor', axis: 'rotationZ', sign: -1, keys: ['KeyW', 'KeyS'] },
      { name: 'Left Knee Rotor', reference: 'Left Hip Rotor', motor: 'Left Knee Motor', axis: 'rotationZ', sign: 1, keys: ['KeyQ', 'KeyA'] },
    ],
    quadruped: [
      { name: 'Front Left Hip Rotor', reference: 'Hound Chassis', motor: 'Front Hip Motor', axis: 'rotationZ', sign: -1, keys: ['KeyW', 'KeyS'] },
      { name: 'Rear Right Knee Rotor', reference: 'Rear Right Hip Rotor', motor: 'Knee Motor', axis: 'rotationZ', sign: 1, keys: ['KeyQ', 'KeyA'] },
      { name: 'Hound Head', reference: 'Hound Chassis', motor: 'Neck Motor', axis: 'rotationZ', sign: -1, keys: ['KeyR', 'KeyF'] },
    ],
    printer: [
      { name: 'Tool Carriage', reference: 'Z Gantry Bridge', motor: 'X Drive Motor', axis: 'x', sign: 1, keys: ['KeyD', 'KeyA'] },
      { name: 'Z Gantry Bridge', reference: 'Printer Base', motor: 'Z Lift Motor', axis: 'y', sign: -1, keys: ['KeyW', 'KeyS'] },
    ],
  }
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
  for (const [id, motions] of Object.entries(cases)) {
    const p = PRESETS.find((preset) => preset.id === id)!.build()
    const eng = new CircuitEngine(p.circuit)
    const runner = await SimRunner3D.create(p, eng)
    try {
      for (const c of p.circuit.components) if (c.type === 'switchSlide' && /power/i.test(c.name)) c.props.closed = true
      // Rotation joints are sampled through the BUILT joint's own bodies so
      // whole-body motion (a shuffling robot) never pollutes the reading.
      const builtFor = (m: Motion) => {
        const jd = p.hardware.joints.find((j) => j.type === 'motor' && j.props.boundComponent === m.motor)!
        return runner.world.joints.find((j) => j.def.id === jd.id)!
      }
      const sample = (m: Motion) => {
        if (m.axis === 'rotationZ') {
          const built = builtFor(m)
          const relativeQ = quatMul(quatConj(built.bodyA.rotation()), built.bodyB.rotation())
          return { value: -wrap(zAngleOf(relativeQ) - built.buildDeltaZ), q: relativeQ }
        }
        const q = pose(runner, p, m.name)
        const parent = pose(runner, p, m.reference)
        const relativeQ = quatMul(quatConj(parent.q), q.q)
        const local = rotateVec(quatConj(parent.q), { x: q.x - parent.x, y: q.y - parent.y, z: q.z - parent.z })
        return { value: local[m.axis], q: relativeQ }
      }
      const initial = motions.map(sample)
      const previous = initial.map((s) => s)
      const travel = motions.map(() => 0)
      const forward = motions.map(() => 0)
      const peak = motions.map(() => 0)
      const reverseTicks = motions.map(() => 0)
      const maxJump = motions.map(() => 0)
      const movingTicks = motions.map(() => 0)
      const boundsOK = motions.map(() => true)
      for (let tick = 0; tick < 300; tick++) {
        if (tick === 0 || tick === 180) {
          eng.setPressed(new Set(motions.map((m) => m.keys[tick === 0 ? 0 : 1])))
          eng.tick(performance.now())
        }
        await step(runner, 1)
        for (const [i, m] of motions.entries()) {
          const rotating = m.axis === 'rotationZ'
          const current = sample(m)
          const delta = current.value - previous[i].value
          travel[i] += delta
          peak[i] = Math.max(peak[i], m.sign * travel[i])
          if (tick >= 180 && -m.sign * delta > (rotating ? 0.0001 : 0.001)) reverseTicks[i]++
          maxJump[i] = Math.max(maxJump[i], Math.abs(delta))
          if (tick < 180 && m.sign * delta > (rotating ? 0.0001 : 0.001)) movingTicks[i]++
          const joint = p.hardware.joints.find((j) => j.type === 'motor' && j.props.boundComponent === m.motor)!
          if (rotating && joint.props.minAngle !== undefined && joint.props.maxAngle !== undefined) {
            const angle = current.value * 180 / Math.PI
            boundsOK[i] &&= Number.isFinite(angle) && angle >= joint.props.minAngle - 1 && angle <= joint.props.maxAngle + 1
          }
          previous[i] = current
          if (tick === 179) forward[i] = travel[i]
        }
      }
      for (const [i, m] of motions.entries()) {
        const rotating = m.axis === 'rotationZ'
        const threshold = rotating ? 0.03 : 2
        check(`${id}: ${m.name} moves in commanded direction and reverses with simultaneous controls`,
          m.sign * forward[i] > threshold && peak[i] - m.sign * travel[i] > threshold && reverseTicks[i] >= 20,
          `forward=${forward[i].toFixed(4)}; return from peak=${(peak[i] - m.sign * travel[i]).toFixed(4)}${rotating ? 'rad' : 'px'}; reversing ticks=${reverseTicks[i]}`)
        check(`${id}: ${m.name} has continuous motion without snaps and respects motor limits over 300 steps`,
          boundsOK[i] && movingTicks[i] >= 30 && maxJump[i] < (rotating ? 0.08 : 4),
          `max step=${maxJump[i].toFixed(5)}; moving ticks=${movingTicks[i]}`)
      }
    } finally {
      runner.destroy()
    }
  }
}

// ---------------------------------------------------------------- ALU trainer
async function testAluTrainer() {
  console.log('ALU TRAINER PRESET')
  const p = PRESETS.find((preset) => preset.id === 'cpu')!.build()
  const eng = new CircuitEngine(p.circuit)
  eng.tick(1)
  check('power good LED lit at boot', (eng.runtime.states.get(comp(p, 'Power Good').id)?.brightness ?? 0) > 0.15)
  check('adder network solves cleanly', eng.runtime.solved && eng.runtime.warnings.length === 0, eng.runtime.warnings.join('; '))

  const gateCount = p.circuit.components.filter((c) => c.type === 'gate').length
  check('adder compiled from raw logic gates', gateCount >= 15, `${gateCount} gates`)

  const bit = (i: number) => eng.runtime.states.get(comp(p, `Sum Bit ${i}`).id)?.brightness ?? -1
  const carry = () => eng.runtime.states.get(comp(p, 'Carry Out').id)?.brightness ?? -1
  const setInputs = (a: number, b: number) => {
    for (let i = 0; i < 3; i++) {
      comp(p, `Input A${i}`).props.closed = (a & (1 << i)) !== 0
      comp(p, `Input B${i}`).props.closed = (b & (1 << i)) !== 0
    }
    eng.tick(performance.now())
  }
  const bright = (v: number) => v > 0.15
  const dark = (v: number) => v < 0.05
  const cases: [number, number][] = [[0, 0], [1, 2], [3, 3], [5, 5], [7, 7], [6, 1]]
  let adderOK = true
  const detail: string[] = []
  for (const [a, b] of cases) {
    setInputs(a, b)
    const sum = a + b
    const ok = [0, 1, 2].every((i) => (sum & (1 << i)) ? bright(bit(i)) : dark(bit(i)))
    const carryOK = sum > 7 ? bright(carry()) : dark(carry())
    if (!ok || !carryOK) detail.push(`${a}+${b}`)
    adderOK &&= ok && carryOK
  }
  check('ripple-carry adder produces the arithmetic sum for every tested pair', adderOK, detail.join(', ') || cases.map(([a, b]) => `${a}+${b}`).join(', '))

  setInputs(0, 0)
  const clockState = (t: number) => {
    eng.tick(t)
    return eng.runtime.states.get(comp(p, 'Clock Pulse').id)?.active ?? -1
  }
  const high = clockState(20)
  const low = clockState(320)
  check('board clock toggles the step LED', high > 0.2 && low < 0.1, `high=${high.toFixed(2)} low=${low.toFixed(2)}`)

  comp(p, 'ALU Power').props.closed = false
  eng.tick(performance.now())
  const fanOff = eng.runtime.states.get(comp(p, 'Heatsink Fan').id)?.voltage ?? 99
  check('master off silences the fan drive', Math.abs(fanOff) < 0.25, `${fanOff.toFixed(3)}V`)

  comp(p, 'ALU Power').props.closed = true
  eng.tick(performance.now())
  const runner = await SimRunner3D.create(p, eng)
  try {
    await step(runner, 240)
    const w = motorW(runner, 'Heatsink Fan')
    check('heatsink fan spins while powered', Math.abs(w) > 0.2, `w=${w.toFixed(2)} rad/s`)
  } finally {
    runner.destroy()
  }
}

// ---------------------------------------------------------------- gaming rig
async function testGamingRig() {
  console.log('GAMING RIG PRESET')
  const p = PRESETS.find((preset) => preset.id === 'computer')!.build()
  const eng = new CircuitEngine(p.circuit)
  eng.tick(1)
  for (const name of ['RGB Strip Red', 'RGB Strip Green', 'RGB Strip Blue', 'Power LED', 'Monitor LED']) {
    check(`${name} glows with power on`, (eng.runtime.states.get(comp(p, name).id)?.brightness ?? 0) > 0.15)
  }
  comp(p, 'Power Switch').props.closed = false
  eng.tick(performance.now())
  const radOff = eng.runtime.states.get(comp(p, 'Radiator Fan').id)?.voltage ?? 99
  const gpuOff = eng.runtime.states.get(comp(p, 'GPU Fan').id)?.voltage ?? 99
  comp(p, 'Power Switch').props.closed = true
  eng.tick(performance.now())
  const runner = await SimRunner3D.create(p, eng)
  try {
    await step(runner, 300)
    const rad = motorW(runner, 'Radiator Fan')
    const gpu = motorW(runner, 'GPU Fan')
    check('radiator fans spin', Math.abs(rad) > 0.2, `w=${rad.toFixed(2)} rad/s`)
    check('gpu fans spin', Math.abs(gpu) > 0.2, `w=${gpu.toFixed(2)} rad/s`)
    const tower = pose(runner, p, 'Tower Frame')
    check('static tower stays put on the desk', Math.abs(tower.y - -757) < 2 && Math.abs(tower.z) < 0.5, `y=${tower.y.toFixed(2)}`)
  } finally {
    runner.destroy()
  }
  comp(p, 'Lamp Switch').props.closed = false
  eng.tick(performance.now())
  const lampOff = eng.runtime.states.get(comp(p, 'Desk Lamp').id)?.brightness ?? 1
  check('lamp switch kills the desk lamp', lampOff < 0.05, `brightness=${lampOff.toFixed(3)}`)
}

// ---------------------------------------------------------------- arcade
async function testArcadeCabinet() {
  console.log('ARCADE CABINET PRESET')
  const p = PRESETS.find((preset) => preset.id === 'arcade')!.build()
  const eng = new CircuitEngine(p.circuit)
  eng.tick(1)
  for (const name of ['Marquee Light Left', 'Marquee Light Right']) {
    check(`${name} lit with cabinet powered`, (eng.runtime.states.get(comp(p, name).id)?.brightness ?? 0) > 0.15)
  }
  eng.keyDown('Space')
  eng.tick(performance.now())
  const fireLed = eng.runtime.states.get(comp(p, 'Fire LED').id)?.brightness ?? 0
  const speaker = eng.runtime.states.get(comp(p, 'Fire Speaker').id)
  check('fire button lights the lamp and drives the speaker', fireLed > 0.15 && (speaker?.active ?? 0) > 0.1,
    `led=${fireLed.toFixed(2)} speaker=${speaker?.active?.toFixed(2)}`)
  eng.keyUp('Space')
  eng.keyDown('Enter')
  eng.tick(performance.now())
  const buzzer = eng.runtime.states.get(comp(p, 'Start Chime').id)
  check('start button chimes the buzzer', (buzzer?.active ?? 0) > 0.1, `active=${buzzer?.active?.toFixed(2)}`)
  eng.keyUp('Enter')
  eng.keyDown('KeyC')
  eng.tick(performance.now())
  check('coin button credits the machine', (eng.runtime.states.get(comp(p, 'Credit LED').id)?.brightness ?? 0) > 0.15)
  eng.keyUp('KeyC')

  const runner = await SimRunner3D.create(p, eng)
  try {
    await step(runner, 240)
    const w = motorW(runner, 'Cabinet Exhaust Fan')
    check('roof exhaust fan spins', Math.abs(w) > 0.2, `w=${w.toFixed(2)} rad/s`)
    const cabinet = pose(runner, p, 'Cabinet Base')
    check('cabinet stays planted', Math.abs(cabinet.y - -960) < 2, `y=${cabinet.y.toFixed(2)}`)
  } finally {
    runner.destroy()
  }
}

// ---------------------------------------------------------------- printer
async function testPrinterPress() {
  console.log('3D PRINTER PRESET')
  const p = PRESETS.find((preset) => preset.id === 'printer')!.build()
  const eng = new CircuitEngine(p.circuit)
  eng.tick(1)
  for (const name of ['Hot End Heater', 'Bed Heater', 'Status LED']) {
    check(`${name} energized at boot`, (eng.runtime.states.get(comp(p, name).id)?.active ?? 0) > 0.3)
  }
  const runner = await SimRunner3D.create(p, eng)
  try {
    await step(runner, 240)
    const w = motorW(runner, 'Extruder Fan')
    check('extruder fan spins', Math.abs(w) > 0.2, `w=${w.toFixed(2)} rad/s`)
    const owl = pose(runner, p, 'Owl Body')
    const bed = pose(runner, p, 'Print Bed')
    check('printed owl rests on the bed', owl.y - bed.y > 20 && Math.abs(owl.x - bed.x) < 200,
      `owl-bed gap=${(owl.y - bed.y).toFixed(1)}px`)
    const spool = pose(runner, p, 'Filament Spool')
    check('spool hangs on its free bearing', Math.abs(spool.y - -500) < 3, `y=${spool.y.toFixed(2)}`)
  } finally {
    runner.destroy()
  }
}

// ---------------------------------------------------------------- biped balance
async function testBipedBalance() {
  console.log('BIPED BALANCE PRESET')
  const p = PRESETS.find((preset) => preset.id === 'humanoid')!.build()
  const eng = new CircuitEngine(p.circuit)
  const runner = await SimRunner3D.create(p, eng)
  try {
    const start = pose(runner, p, 'Chest Core')
    let drift = 0
    let tilt = 0
    for (let tick = 0; tick < 300; tick++) {
      await step(runner, 1)
      const q = pose(runner, p, 'Chest Core')
      drift = Math.max(drift, Math.hypot(q.x - start.x, q.z - start.z))
      tilt = Math.max(tilt, Math.abs(zAngleOf(q.q)))
    }
    check('humanoid stands balanced with servos idle for 300 steps', drift < 6 && tilt < 0.08,
      `drift=${drift.toFixed(3)}px; tilt=${tilt.toFixed(5)}rad`)
    eng.keyDown('KeyQ')
    let kneeTravel = 0
    let withinLimits = true
    for (let tick = 0; tick < 200; tick++) {
      await step(runner, 1)
      const knee = pose(runner, p, 'Left Knee Rotor')
      const thigh = pose(runner, p, 'Left Thigh')
      const rel = -zAngleOf(quatMul(quatConj(thigh.q), knee.q)) * 180 / Math.PI
      kneeTravel = Math.max(kneeTravel, rel)
      withinLimits &&= rel >= -11 && rel <= 89
    }
    eng.keyUp('KeyQ')
    check('knee servo bends the leg within its limits', kneeTravel > 10 && withinLimits,
      `max rel=${kneeTravel.toFixed(1)}deg`)
    const eyes = ['Eye Left', 'Eye Right'].every((name) => (eng.runtime.states.get(comp(p, name).id)?.brightness ?? 0) > 0.1)
    check('robot eyes lit', eyes)
  } finally {
    runner.destroy()
  }
}

// ---------------------------------------------------------------- main
async function main() {
  testPresetStructure()
  await testPreset3DInvariants()
  await testRobotCircuits()
  await testPresetMechanisms()
  await testAluTrainer()
  await testGamingRig()
  await testArcadeCabinet()
  await testPrinterPress()
  await testBipedBalance()
  await testSolver()
  await testStudioMeshes()

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures > 0) throw new Error(`${failures} checks failed`)
}

main()
