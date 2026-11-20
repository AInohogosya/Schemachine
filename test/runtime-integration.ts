import type {
  CircuitComponentData,
  CircuitComponentType,
  CircuitData,
  CircuitProps,
  HardwarePartData,
  HardwarePartType,
  HardwareProps,
  JointData,
  ProjectData,
  WireData,
} from '../src/types'
import { CURRENT_VERSION } from '../src/types'
import { CircuitEngine } from '../src/circuit/engine'
import { compileCircuit, solveCircuit } from '../src/circuit/solver'
import { circuitAudio, SimRunner3D } from '../src/sim/runner3d'
import { bindingDiagnostics, bindingPools, circuitsBoundTo, resolveBindings } from '../src/sync/registry'

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

function comp(id: string, type: CircuitComponentType, props: CircuitProps = {}, name = id): CircuitComponentData {
  return { id, name, type, x: 0, y: 0, props }
}

function wire(id: string, a: string, ap: string, b: string, bp: string): WireData {
  return { id, from: { componentId: a, pin: ap }, to: { componentId: b, pin: bp } }
}

function part(id: string, name: string, kind: HardwarePartType, x: number, y: number, props: HardwareProps = {}): HardwarePartData {
  return { id, name, kind, x, y, z: 0, angle: 0, w: kind === 'wheel' ? 30 : 80, h: 40, props }
}

function joint(id: string, type: JointData['type'], a: string, b: string, props: JointData['props'] = {}): JointData {
  return { id, type, a, b, ax: 40, ay: 0, bx: 0, by: 0, props }
}

function project(circuit: CircuitData, parts: HardwarePartData[] = [], joints: JointData[] = []): ProjectData {
  return { version: CURRENT_VERSION, name: 'Runtime integration', groundY: 900, circuit, hardware: { parts, joints, meshes: [] } }
}

function near(a: number, b: number, tolerance: number): boolean {
  return Number.isFinite(a) && Math.abs(a - b) <= tolerance
}

function testInputs(): void {
  const authored = comp('authored', 'switchPush', { closed: true })
  const push = comp('push', 'switchPush', { key: 'Space' })
  const slide = comp('slide', 'switchSlide', { key: 'KeyS', closed: false })
  const engine = new CircuitEngine({ components: [authored, push, slide], wires: [] })
  engine.holdPhysical('push', true, 'physical-a')
  engine.keyDown('Space')
  for (let i = 0; i < 8; i++) engine.tick(i * 1000 / 60)
  check('keyed physical hold survives repeated engine ticks', push.props.closed === true && engine.runtime.states.get('push')?.closed === true)
  engine.keyUp('Space')
  engine.tick(200)
  check('keyboard release does not release a physical hold', push.props.closed === true)
  engine.holdMouse('push', true)
  engine.keyDown('Space')
  engine.holdPhysical('push', true, 'physical-b')
  engine.releasePhysical('push', 'physical-a')
  engine.holdMouse('push', false)
  engine.keyUp('Space')
  engine.tick(240)
  check('releasing keyboard, mouse, and one physical source preserves the remaining source', push.props.closed === true)
  engine.releasePhysical('push', 'physical-b')
  check('releasing the final input source opens the push switch', push.props.closed === false)
  engine.tick(280)
  check('authored push state participates independently in the hold OR', authored.props.closed === true)

  engine.holdPhysical('slide', true, 'slide-pad')
  engine.holdPhysical('slide', true, 'slide-pad')
  engine.releasePhysical('slide', 'slide-pad')
  check('physical slide switches toggle only on a press edge', slide.props.closed === true)
  engine.keyDown('KeyS')
  for (let i = 0; i < 4; i++) engine.tick(300 + i * 16)
  check('held slide keys do not repeatedly toggle', slide.props.closed === false)
  engine.holdPhysical('push', true, 'blur-pad')
  engine.holdMouse('push', true)
  engine.clearTransientInputs()
  check('blur cleanup clears keyboard, mouse, and physical holds but not slide state', push.props.closed === false &&
    slide.props.closed === false && authored.props.closed === true && !engine.isPressed('KeyS') && !engine.isPressed('Space'))
  engine.keyDown('KeyS')
  check('slide input remains edge-based after transient cleanup', slide.props.closed === true)
}

function testEmptyAndProtection(): void {
  const emptyNet = compileCircuit({ components: [], wires: [] })
  const empty = solveCircuit(emptyNet, { now: 100, motorW: new Map() })
  const emptyEngine = new CircuitEngine({ components: [], wires: [] })
  emptyEngine.tick(120)
  check('zero-equation solve is healthy and empty', empty.solved && empty.warnings.length === 0 &&
    empty.pinVoltages.size === 0 && empty.wires.size === 0 && empty.states.size === 0)
  check('empty engine ticks without warnings and commits finite time', emptyEngine.runtime.solved &&
    emptyEngine.runtime.warnings.length === 0 && emptyEngine.runtime.states.size === 0 && emptyEngine.net.lastNow === 120)

  const circuit: CircuitData = {
    components: [comp('b', 'battery', { voltage: 9, maxCurrent: 1000 }), comp('g', 'ground'),
      comp('f', 'fuse', { maxCurrent: 0.1 }), comp('r', 'resistor', { resistance: 10 })],
    wires: [wire('w1', 'b', '+', 'f', 'A'), wire('w2', 'f', 'B', 'r', 'A'), wire('w3', 'r', 'B', 'g', 'G'),
      wire('w4', 'b', '-', 'g', 'G')],
  }
  const engine = new CircuitEngine(circuit)
  engine.tick(0)
  check('overcurrent automatically and persistently blows a fuse', engine.runtime.states.get('f')?.blown === true &&
    engine.net.blownFuses.has('f') && (engine.runtime.states.get('f')?.current ?? 0) > 0.1)
  engine.tick(16)
  check('a blown fuse is open on later solves', engine.runtime.states.get('f')?.blown === true &&
    Math.abs(engine.runtime.states.get('f')?.current ?? 1) < 1e-5)
  const moved: CircuitData = {
    components: engine.net.circuit.components.map((c) => ({ ...c, x: c.x + 25,
      props: c.id === 'f' ? { ...c.props, blown: false } : { ...c.props } })),
    wires: engine.net.circuit.wires.map((w) => ({ ...w })),
  }
  engine.rebuild(moved)
  check('rebuilds preserve blown state by stable component ID', engine.runtime.states.get('f')?.blown === true &&
    engine.net.blownFuses.has('f') && Math.abs(engine.runtime.states.get('f')?.current ?? 1) < 1e-5)
  engine.resetFuse(engine.componentById('f')!)
  check('resetFuse restores the fuse for the reset operation', engine.runtime.states.get('f')?.blown === false &&
    !engine.net.blownFuses.has('f') && (engine.runtime.states.get('f')?.current ?? 0) > 0.1)
  engine.componentById('b')!.props.voltage = 1
  engine.tick(2000)
  check('a reset fuse remains closed within its rating', engine.runtime.states.get('f')?.blown === false &&
    Math.abs(engine.runtime.states.get('f')?.current ?? 0) < 0.1)
  engine.componentById('b')!.props.voltage = 9
  engine.tick(3000)
  check('renewed overcurrent blows a reset fuse again', engine.runtime.states.get('f')?.blown === true)
}

function testConvergenceAndRebuilds(): void {
  const oscillator: CircuitData = {
    components: [comp('b', 'battery', { voltage: 9 }), comp('g', 'ground'),
      comp('relay', 'relay', { pickupVoltage: 5, resistance: 200 })],
    wires: [wire('w1', 'b', '+', 'relay', 'COM'), wire('w2', 'relay', 'NC', 'relay', 'A'),
      wire('w3', 'relay', 'B', 'g', 'G'), wire('w4', 'b', '-', 'g', 'G')],
  }
  const relayRuntime = solveCircuit(compileCircuit(oscillator), { now: 0, motorW: new Map() })
  check('relay oscillation at the iteration cap is explicitly unconverged', !relayRuntime.solved &&
    relayRuntime.warnings.some((warning) => warning.includes('did not converge after 12 iterations')))

  const reactive: CircuitData = {
    components: [comp('vp', 'battery', { voltage: 10 }), comp('vn', 'battery', { voltage: 10 }),
      comp('in', 'battery', { voltage: 1 }), comp('g', 'ground'),
      comp('op', 'opAmp', { gain: 100000, outputResistance: 5 }),
      comp('cap', 'capacitor', { capacitance: 0.001, initialVoltage: 3 })],
    wires: [wire('w1', 'vp', '+', 'op', 'V+'), wire('w2', 'vp', '-', 'g', 'G'),
      wire('w3', 'vn', '+', 'g', 'G'), wire('w4', 'vn', '-', 'op', 'V-'),
      wire('w5', 'in', '+', 'op', 'IN+'), wire('w6', 'in', '-', 'g', 'G'),
      wire('w7', 'op', 'IN-', 'op', 'OUT'), wire('w8', 'op', 'OUT', 'cap', 'A'), wire('w9', 'cap', 'B', 'g', 'G')],
  }
  const reactiveNet = compileCircuit(reactive)
  const failed = solveCircuit(reactiveNet, { now: 1000, motorW: new Map() })
  const history = reactiveNet.transient.get('cap')
  check('unconverged nonlinear results do not commit capacitor history or time', !failed.solved &&
    failed.warnings.some((warning) => warning.includes('Nonlinear solver did not converge')) &&
    history?.voltage === 3 && history.current === 0 && reactiveNet.lastNow === null)

  const transientCircuit: CircuitData = {
    components: [comp('b', 'battery', { voltage: 5 }), comp('g', 'ground'),
      comp('rc', 'resistor', { resistance: 100 }), comp('rl', 'resistor', { resistance: 10 }),
      comp('cap', 'capacitor', { capacitance: 0.001 }), comp('ind', 'inductor', { inductance: 0.1 })],
    wires: [wire('w1', 'b', '+', 'rc', 'A'), wire('w2', 'rc', 'B', 'cap', 'A'), wire('w3', 'cap', 'B', 'g', 'G'),
      wire('w4', 'b', '+', 'rl', 'A'), wire('w5', 'rl', 'B', 'ind', 'A'), wire('w6', 'ind', 'B', 'g', 'G'),
      wire('w7', 'b', '-', 'g', 'G')],
  }
  const engine = new CircuitEngine(transientCircuit)
  for (let i = 0; i <= 10; i++) engine.tick(i * 1000 / 60)
  const capBefore = engine.net.transient.get('cap')?.voltage ?? 0
  const indBefore = engine.net.transient.get('ind')?.current ?? 0
  const edited: CircuitData = {
    components: [...engine.net.circuit.components.map((c) => ({ ...c, x: c.x + 100, props: { ...c.props } })),
      comp('unrelated', 'resistor', { resistance: 500 })],
    wires: engine.net.circuit.wires.map((w) => ({ ...w })),
  }
  engine.rebuild(edited)
  const capAfter = engine.net.transient.get('cap')?.voltage ?? 0
  const indAfter = engine.net.transient.get('ind')?.current ?? 0
  check('rebuilds preserve capacitor and inductor history by stable ID', capBefore > 0 && indBefore > 0 &&
    capAfter >= capBefore && indAfter >= indBefore * 0.99 && engine.net.lastNow !== null &&
    engine.runtime.states.get('unrelated') !== undefined, `V ${capBefore.toFixed(4)}→${capAfter.toFixed(4)}, I ${indBefore.toFixed(4)}→${indAfter.toFixed(4)}`)
}

function testOverloadStates(): void {
  const relayCircuit: CircuitData = {
    components: [comp('b', 'battery', { voltage: 9 }), comp('g', 'ground'),
      comp('relay', 'relay', { pickupVoltage: 5, maxCurrent: 0.5 }), comp('r', 'resistor', { resistance: 1 })],
    wires: [wire('w1', 'b', '+', 'relay', 'COM'), wire('w2', 'relay', 'NC', 'r', 'A'),
      wire('w3', 'r', 'B', 'g', 'G'), wire('w4', 'b', '-', 'g', 'G'), wire('w5', 'relay', 'A', 'g', 'G'),
      wire('w6', 'relay', 'B', 'g', 'G')],
  }
  const relay = solveCircuit(compileCircuit(relayCircuit), { now: 0, motorW: new Map() })
  check('relay maxCurrent measures contact current independently of coil current', relay.solved &&
    relay.states.get('relay')?.overloaded === true && Math.abs(relay.states.get('relay')?.current ?? 1) < 1e-6)

  const solenoidCircuit: CircuitData = {
    components: [comp('b', 'battery', { voltage: 12, maxCurrent: 1000 }), comp('g', 'ground'),
      comp('s', 'solenoid', { resistance: 12, maxCurrent: 100, ratedPower: 1 })],
    wires: [wire('w1', 'b', '+', 's', '+'), wire('w2', 's', '-', 'g', 'G'), wire('w3', 'b', '-', 'g', 'G')],
  }
  const solenoid = solveCircuit(compileCircuit(solenoidCircuit), { now: 0, motorW: new Map() })
  check('solenoid ratedPower contributes to overload state', solenoid.solved && solenoid.states.get('s')?.overloaded === true &&
    (solenoid.states.get('s')?.power ?? 0) > 1)
}

function testRegistryDiagnostics(): void {
  const p = project({ components: [comp('a', 'motor', {}, 'Duplicate'), comp('b', 'switchPush', {}, ' duplicate '),
    comp('wrong', 'motor', { bindHardware: 'Pad' }, 'Wrong consumer')], wires: [] },
  [part('pad-a', 'Pad', 'switchPad', 0, 0), part('pad-b', ' pad ', 'switchPad', 100, 0)])
  const issues = bindingDiagnostics(p)
  const pools = bindingPools(p)
  check('registry reports duplicate normalized circuit and hardware names', issues.some((issue) => issue.includes('Duplicate circuit Name ID "duplicate"')) &&
    issues.some((issue) => issue.includes('Duplicate hardware Name ID "pad"')))
  check('registry reports incompatible binding consumers', issues.some((issue) => issue.includes('incompatible') &&
    issue.includes('Wrong consumer') && issue.includes('switchPad')))
  check('bindingPools keeps its existing API and sorted name lists', Array.isArray(pools.circuitNames) && Array.isArray(pools.hardwareNames) &&
    pools.circuitNames.includes('Duplicate') && pools.hardwareNames.includes('Pad'))
}

async function testRunner(): Promise<void> {
  const components = [
    comp('m', 'motor', { bindHardware: 'Rotor', ke: 2 }, 'Drive Motor'),
    comp('f', 'fan', { bindHardware: 'Fan Rotor', ke: 0.5 }, 'Feedback Fan'),
    comp('push', 'switchPush', { bindHardware: 'Reverse Pad', key: 'KeyP' }, 'Pad Signal'),
    comp('boost', 'switchSlide', { bindHardware: 'Jet', closed: true }, 'Boost Signal'),
    comp('buzzer', 'buzzer', { frequency: 440 }),
    comp('speaker', 'speaker', { frequency: 880 }),
  ]
  const parts = [
    part('stator', 'Stator', 'block', 300, 500, { isStatic: true }),
    part('rotor', 'Rotor', 'wheel', 340, 500),
    part('fan-stator', 'Fan Stator', 'block', 600, 500, { isStatic: true }),
    part('fan-rotor', 'Fan Rotor', 'wheel', 640, 500),
    part('pad', 'Reverse Pad', 'switchPad', 300, 700, { isStatic: true }),
    part('jet', 'Jet', 'thruster', 600, 700, { isStatic: true }),
  ]
  const joints = [joint('motor-joint', 'motor', 'stator', 'rotor'), joint('fan-joint', 'motor', 'fan-stator', 'fan-rotor')]
  const p = project({ components, wires: [] }, parts, joints)
  const original = JSON.stringify(p)
  const engine = new CircuitEngine(p.circuit)
  const runner = await SimRunner3D.create(p, engine)
  check('reverse-only registry links reach every runner hardware consumer', resolveBindings(p).length === 4 &&
    circuitsBoundTo(p, 'pad')[0]?.id === 'push' && circuitsBoundTo(p, 'jet')[0]?.id === 'boost' &&
    circuitsBoundTo(p, 'rotor')[0]?.id === 'm' && circuitsBoundTo(p, 'fan-rotor')[0]?.id === 'f')
  const motorJoint = runner.world.joints.find((j) => j.def.id === 'motor-joint')
  const fanJoint = runner.world.joints.find((j) => j.def.id === 'fan-joint')
  check('runner creation adapts reverse motor links without mutating project data', motorJoint?.def.props.boundComponent === 'Drive Motor' &&
    fanJoint?.def.props.boundComponent === 'Feedback Fan' && JSON.stringify(p) === original &&
    joints.every((j) => j.props.boundComponent === undefined))

  engine.tick(0)
  engine.runtime.states.set('m', { ...engine.runtime.states.get('m'), active: 1, voltage: 6 })
  engine.runtime.states.set('f', { ...engine.runtime.states.get('f'), active: 1, voltage: 3 })
  runner.step(16)
  check('reverse-bound motor joints receive drive and reverse-bound thrusters activate', motorJoint?.driveV === 6 &&
    fanJoint?.driveV === 3 && runner.world.thrusters.find((t) => t.partId === 'jet')?.active === 1)
  check('motor and fan components both receive mechanical speed feedback', engine.motorW.get('m') === motorJoint?.rotorW &&
    engine.motorW.get('f') === fanJoint?.rotorW && engine.motorW.has('f'))

  engine.runtime.states.set('buzzer', { active: 0.25, frequency: 440 })
  engine.runtime.states.set('speaker', { active: 0.75, frequency: 1200 })
  const routing = circuitAudio(p, engine)
  const synced = runner.syncAudio()
  check('speaker state is included in live audio routing and public resync', routing.volume === 0.75 && routing.frequency === 1200 &&
    synced.volume === 0.75 && synced.frequency === 1200)

  runner.pressPhysical('pad', true)
  engine.keyDown('KeyP')
  runner.step(32)
  const heldThroughRunner = components[2].props.closed === true && runner.padState('pad')
  engine.keyUp('KeyP')
  runner.step(48)
  const heldAfterKeyRelease = components[2].props.closed === true
  runner.pressPhysical('pad', false)
  check('runner physical holds use engine state and survive keyed ticks', heldThroughRunner && heldAfterKeyRelease &&
    components[2].props.closed === false && !runner.padState('pad'))

  const rapierWorld = runner.world.world
  const free = rapierWorld.free
  let freeCalls = 0
  rapierWorld.free = () => {
    freeCalls++
    free.call(rapierWorld)
  }
  runner.destroy()
  runner.destroy()
  runner.step(64)
  const silent = runner.syncAudio()
  check('runner cleanup frees Rapier once and remains idempotent', freeCalls === 1 && silent.volume === 0 && silent.frequency === 440)
}

testInputs()
testEmptyAndProtection()
testConvergenceAndRebuilds()
testOverloadStates()
testRegistryDiagnostics()
await testRunner()

console.log(`${passes} passed, ${failures} failed`)
if (failures > 0) throw new Error(`${failures} runtime integration test(s) failed`)
