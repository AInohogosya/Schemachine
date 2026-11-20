import type {
  CircuitComponentData,
  CircuitComponentType,
  CircuitData,
  CircuitProps,
  CircuitRuntime,
  ProjectData,
  WireData,
} from '../src/types'
import { CURRENT_VERSION } from '../src/types'
import { COMPONENT_DEFS } from '../src/circuit/components'
import { CIRCUIT_CATALOG, propsForCatalogEntry, searchCatalog } from '../src/circuit/catalog'
import {
  clockVoltage,
  compileCircuit,
  knownPins,
  opAmpTarget,
  photoresistorResistance,
  solveCircuit,
  thermistorResistance,
  transientTimeStep,
  type CompiledNetwork,
} from '../src/circuit/solver'
import { parseProjectFile, serializeProject } from '../src/ui/io'

const NEW_TYPES = [
  'capacitor', 'inductor', 'schottky', 'zenerDiode', 'rgbLed', 'incandescent',
  'photoresistor', 'thermistor', 'relay', 'mosfet', 'currentSource', 'clock',
  'opAmp', 'solenoid', 'fan', 'speaker',
] as const satisfies readonly CircuitComponentType[]

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

function near(actual: number, expected: number, tolerance: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
}

function comp(id: string, type: CircuitComponentType, props: CircuitProps = {}): CircuitComponentData {
  return { id, name: id, type, x: 0, y: 0, props }
}

function wire(id: string, a: string, ap: string, b: string, bp: string): WireData {
  return { id, from: { componentId: a, pin: ap }, to: { componentId: b, pin: bp } }
}

function makeNet(components: CircuitComponentData[], wires: WireData[]): CompiledNetwork {
  return compileCircuit({ components, wires })
}

function step(net: CompiledNetwork, now: number, motorW = new Map<string, number>()): CircuitRuntime {
  return solveCircuit(net, { now, motorW })
}

function pin(runtime: CircuitRuntime, componentId: string, pinName: string): number {
  return runtime.pinVoltages.get(componentId)?.get(pinName) ?? Number.NaN
}

function twoTerminalNet(
  type: CircuitComponentType,
  props: CircuitProps,
  a = 'A',
  b = 'B',
  voltage = 5,
): CompiledNetwork {
  return makeNet(
    [comp('supply', 'battery', { voltage }), comp('ground', 'ground'), comp('device', type, props)],
    [wire('wa', 'supply', '+', 'device', a), wire('wb', 'device', b, 'ground', 'G'), wire('wg', 'supply', '-', 'ground', 'G')],
  )
}

function seriesDiodeNet(type: 'schottky' | 'zenerDiode', props: CircuitProps, voltage: number): CompiledNetwork {
  return makeNet(
    [comp('b', 'battery', { voltage }), comp('g', 'ground'), comp('r', 'resistor', { resistance: 1000 }),
      comp('d', type, props)],
    [wire('w1', 'b', '+', 'r', 'A'), wire('w2', 'r', 'B', 'd', 'A'), wire('w3', 'd', 'K', 'g', 'G'),
      wire('w4', 'b', '-', 'g', 'G')],
  )
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function testCatalog(): void {
  const categories = new Set(['power', 'passive', 'inputs', 'outputs', 'semiconductors', 'logic'])
  check('catalog contains every new component type', NEW_TYPES.every((type) => COMPONENT_DEFS[type] !== undefined))
  check('catalog definitions have metadata, finite geometry, unique pins and defaults', NEW_TYPES.every((type) => {
    const def = COMPONENT_DEFS[type]
    const names = def.pins.map((entry) => entry.name)
    return categories.has(def.category) && def.description.trim().length > 0 && def.keywords.length > 0 &&
      def.symbolSize.w > 0 && def.symbolSize.h > 0 && new Set(names).size === names.length &&
      def.pins.every((entry) => [entry.x, entry.y].every(Number.isFinite)) && typeof def.defaults() === 'object'
  }))
  check('existing and new functional categories are assigned', COMPONENT_DEFS.battery.category === 'power' &&
    COMPONENT_DEFS.ground.category === 'power' && COMPONENT_DEFS.fuse.category === 'power' &&
    COMPONENT_DEFS.diode.category === 'semiconductors' && COMPONENT_DEFS.schottky.category === 'semiconductors' &&
    COMPONENT_DEFS.zenerDiode.category === 'semiconductors' && COMPONENT_DEFS.transistor.category === 'semiconductors' &&
    COMPONENT_DEFS.mosfet.category === 'semiconductors' && COMPONENT_DEFS.gate.category === 'logic' &&
    COMPONENT_DEFS.rgbLed.category === 'outputs' && COMPONENT_DEFS.incandescent.category === 'outputs')
  check('specialized pin layouts match their electrical interfaces', knownPins('relay').join(',') === 'A,B,COM,NO,NC' &&
    knownPins('rgbLed').join(',') === 'R,G,B,K' && knownPins('opAmp').join(',') === 'IN+,IN-,OUT,V+,V-' &&
    knownPins('mosfet').join(',') === 'G,D,S' && knownPins('currentSource').join(',') === 'A,B' &&
    knownPins('clock').join(',') === 'OUT,GND')
  check('catalog and solver pin lists agree for every new type', NEW_TYPES.every((type) =>
    knownPins(type).join(',') === COMPONENT_DEFS[type].pins.map((entry) => entry.name).join(',')))
  check('reactive defaults are realistic', COMPONENT_DEFS.capacitor.defaults().capacitance === 0.001 &&
    COMPONENT_DEFS.inductor.defaults().inductance === 0.1 && COMPONENT_DEFS.schottky.defaults().forwardVoltage === 0.3)
  check('placeable catalog covers every component type with unique IDs', new Set(CIRCUIT_CATALOG.map((entry) => entry.id)).size === CIRCUIT_CATALOG.length &&
    (Object.keys(COMPONENT_DEFS) as CircuitComponentType[]).every((type) => CIRCUIT_CATALOG.some((entry) => entry.type === type)))
  check('catalog variants preserve their electrical defaults', CIRCUIT_CATALOG.filter((entry) => entry.id.startsWith('gate')).length === 7 &&
    propsForCatalogEntry(CIRCUIT_CATALOG.find((entry) => entry.id === 'transistorPnp')!).transistorKind === 'PNP' &&
    propsForCatalogEntry(CIRCUIT_CATALOG.find((entry) => entry.id === 'mosfetP')!).mosfetKind === 'P' &&
    propsForCatalogEntry(CIRCUIT_CATALOG.find((entry) => entry.id === 'capacitorCeramic')!).capacitance === 0.0000001)
  check('catalog search understands aliases, functions, and multi-term queries', searchCatalog(CIRCUIT_CATALOG, 'LDR')[0]?.id === 'photoresistor' &&
    searchCatalog(CIRCUIT_CATALOG, 'NMOS')[0]?.id === 'mosfetN' && searchCatalog(CIRCUIT_CATALOG, 'decoupling')[0]?.id === 'capacitorCeramic' &&
    searchCatalog(CIRCUIT_CATALOG, 'choke')[0]?.id === 'inductor' && searchCatalog(CIRCUIT_CATALOG, 'light sensor').some((entry) => entry.id === 'photoresistor') &&
    searchCatalog(CIRCUIT_CATALOG, 'not-a-real-component').length === 0)
}

function testTransient(): void {
  check('timestep is initialized and bounded', near(transientTimeStep(null, 1000), 1 / 60, 1e-12) &&
    near(transientTimeStep(0, 1000 / 60), 1 / 60, 1e-9) && transientTimeStep(0, 100000) === 0.1)

  const capNet = makeNet(
    [comp('b', 'battery', { voltage: 5 }), comp('g', 'ground'), comp('r', 'resistor', { resistance: 100 }),
      comp('c', 'capacitor', { capacitance: 0.001 })],
    [wire('w1', 'b', '+', 'r', 'A'), wire('w2', 'r', 'B', 'c', 'A'), wire('w3', 'c', 'B', 'g', 'G'),
      wire('w4', 'b', '-', 'g', 'G')],
  )
  const firstCap = step(capNet, 0)
  const firstV = firstCap.states.get('c')?.voltage ?? Number.NaN
  const firstI = Math.abs(firstCap.states.get('c')?.current ?? Number.NaN)
  let capRuntime = firstCap
  let capFinite = firstCap.solved && Number.isFinite(firstV) && Number.isFinite(firstI)
  for (let tick = 1; tick <= 240; tick++) {
    capRuntime = step(capNet, tick * 1000 / 60)
    const state = capRuntime.states.get('c')
    capFinite &&= capRuntime.solved && Number.isFinite(state?.voltage) && Number.isFinite(state?.current)
  }
  const finalV = capRuntime.states.get('c')?.voltage ?? Number.NaN
  const finalI = Math.abs(capRuntime.states.get('c')?.current ?? Number.NaN)
  check('capacitor charges toward DC supply and becomes open', capFinite && firstV > 0 && firstV < 1 &&
    finalV > 4.9 && finalV <= 5 && finalI < firstI * 0.01, `V ${firstV.toFixed(3)}→${finalV.toFixed(3)}, I ${firstI.toFixed(3)}→${finalI.toExponential(2)}`)
  check('capacitor history commits one voltage per solve', near(capNet.transient.get('c')?.voltage ?? Number.NaN, finalV, 1e-9))

  const indNet = makeNet(
    [comp('b', 'battery', { voltage: 5 }), comp('g', 'ground'), comp('r', 'resistor', { resistance: 10 }),
      comp('l', 'inductor', { inductance: 0.1 })],
    [wire('w1', 'b', '+', 'r', 'A'), wire('w2', 'r', 'B', 'l', 'A'), wire('w3', 'l', 'B', 'g', 'G'),
      wire('w4', 'b', '-', 'g', 'G')],
  )
  const firstInd = step(indNet, 0)
  const initialCurrent = firstInd.states.get('l')?.current ?? Number.NaN
  let indRuntime = firstInd
  let indFinite = firstInd.solved && Number.isFinite(initialCurrent)
  for (let tick = 1; tick <= 240; tick++) {
    indRuntime = step(indNet, tick * 1000 / 60)
    const state = indRuntime.states.get('l')
    indFinite &&= indRuntime.solved && Number.isFinite(state?.voltage) && Number.isFinite(state?.current)
  }
  const finalCurrent = indRuntime.states.get('l')?.current ?? Number.NaN
  const finalVoltage = indRuntime.states.get('l')?.voltage ?? Number.NaN
  check('inductor current rises continuously and approaches a DC short', indFinite && initialCurrent > 0 &&
    finalCurrent > initialCurrent && finalCurrent > 0.48 && finalCurrent < 0.5 && Math.abs(finalVoltage) < 0.005,
  `I ${initialCurrent.toFixed(3)}→${finalCurrent.toFixed(3)}, V=${finalVoltage.toExponential(2)}`)
}

function testDiodesAndRgb(): void {
  const schottky = step(seriesDiodeNet('schottky', {}, 3), 0)
  const schottkyV = schottky.states.get('d')?.voltage ?? Number.NaN
  check('Schottky diode conducts at its low forward voltage', schottkyV > 0.25 && schottkyV < 0.5,
    `Vf=${schottkyV.toFixed(3)}V`)

  const reverseNet = makeNet(
    [comp('b', 'battery', { voltage: 12 }), comp('g', 'ground'), comp('r', 'resistor', { resistance: 1000 }),
      comp('z', 'zenerDiode', { zenerVoltage: 5.1 })],
    [wire('w1', 'b', '+', 'r', 'A'), wire('w2', 'r', 'B', 'z', 'K'), wire('w3', 'z', 'A', 'g', 'G'),
      wire('w4', 'b', '-', 'g', 'G')],
  )
  const reverse = step(reverseNet, 0)
  const reverseState = reverse.states.get('z')
  check('Zener regulates in reverse breakdown', reverse.solved && reverseState?.reverseBreakdown === true &&
    (reverseState.current ?? 0) < 0 && pin(reverse, 'z', 'K') > 5 && pin(reverse, 'z', 'K') < 5.3,
  `K=${pin(reverse, 'z', 'K').toFixed(3)}V`)

  const forward = step(seriesDiodeNet('zenerDiode', { zenerVoltage: 5.1 }, 3), 0)
  check('Zener also conducts normally in forward bias', forward.states.get('d')?.on === true &&
    forward.states.get('d')?.reverseBreakdown === false && near(forward.states.get('d')?.voltage ?? 0, 0.7, 0.15))

  for (const activeChannel of ['R', 'G', 'B'] as const) {
    const net = makeNet(
      [comp('b', 'battery', { voltage: 5 }), comp('g', 'ground'), comp('r', 'resistor', { resistance: 220 }),
        comp('rgb', 'rgbLed')],
      [wire('w1', 'b', '+', 'r', 'A'), wire('w2', 'r', 'B', 'rgb', activeChannel), wire('w3', 'rgb', 'K', 'g', 'G'),
        wire('w4', 'b', '-', 'g', 'G')],
    )
    const runtime = step(net, 0)
    const state = runtime.states.get('rgb')
    const independent = (['R', 'G', 'B'] as const).every((channel) =>
      channel === activeChannel ? (state?.channels?.[channel] ?? 0) > 0.2 : (state?.channels?.[channel] ?? 1) < 0.01)
    check(`RGB ${activeChannel} channel solves independently`, independent && (state?.current ?? 0) > 0.005 &&
      (state?.brightness ?? 0) > 0.2 && state?.active === state?.brightness)
  }
}

function testRelay(): void {
  const net = makeNet(
    [comp('coilPower', 'battery', { voltage: 9 }), comp('contactPower', 'battery', { voltage: 5 }), comp('g', 'ground'),
      comp('relay', 'relay', { resistance: 200, pickupVoltage: 5 }), comp('noLoad', 'resistor', { resistance: 1000 }),
      comp('ncLoad', 'resistor', { resistance: 1000 })],
    [wire('w1', 'coilPower', '+', 'relay', 'A'), wire('w2', 'relay', 'B', 'g', 'G'), wire('w3', 'coilPower', '-', 'g', 'G'),
      wire('w4', 'contactPower', '+', 'relay', 'COM'), wire('w5', 'contactPower', '-', 'g', 'G'),
      wire('w6', 'relay', 'NO', 'noLoad', 'A'), wire('w7', 'noLoad', 'B', 'g', 'G'),
      wire('w8', 'relay', 'NC', 'ncLoad', 'A'), wire('w9', 'ncLoad', 'B', 'g', 'G')],
  )
  const energized = step(net, 0)
  check('relay pickup closes COM-NO and opens COM-NC', energized.states.get('relay')?.on === true &&
    pin(energized, 'relay', 'NO') > 4.9 && Math.abs(pin(energized, 'relay', 'NC')) < 0.001)
  net.compById.get('coilPower')!.data.props.voltage = 0
  const released = step(net, 1000 / 60)
  check('relay release closes COM-NC and opens COM-NO', released.states.get('relay')?.closed === false &&
    pin(released, 'relay', 'NC') > 4.9 && Math.abs(pin(released, 'relay', 'NO')) < 0.001)
}

function testSensorsAndOutputs(): void {
  const darkProps: CircuitProps = { resistance: 1000, darkResistance: 1000000, lightLevel: 0 }
  const brightProps: CircuitProps = { ...darkProps, lightLevel: 1 }
  const dark = step(twoTerminalNet('photoresistor', darkProps), 0)
  const bright = step(twoTerminalNet('photoresistor', brightProps), 0)
  check('photoresistor resistance and current respond to light', photoresistorResistance(darkProps) === 1000000 &&
    photoresistorResistance(brightProps) === 1000 && (bright.states.get('device')?.current ?? 0) >
    (dark.states.get('device')?.current ?? 0) * 100 && bright.states.get('device')?.lightLevel === 1)

  const coldProps: CircuitProps = { resistance: 10000, beta: 3950, temperature: 25 }
  const hotProps: CircuitProps = { ...coldProps, temperature: 85 }
  const cold = step(twoTerminalNet('thermistor', coldProps), 0)
  const hot = step(twoTerminalNet('thermistor', hotProps), 0)
  check('NTC thermistor follows beta temperature behavior', near(thermistorResistance(coldProps), 10000, 1e-6) &&
    thermistorResistance(hotProps) < 2000 && (hot.states.get('device')?.current ?? 0) > (cold.states.get('device')?.current ?? 0) * 5 &&
    hot.states.get('device')?.temperature === 85)

  const lamp = step(twoTerminalNet('incandescent', { resistance: 24, ratedPower: 12 }, '+', '-', 12), 0)
  const lampState = lamp.states.get('device')
  check('incandescent brightness follows filament power', (lampState?.brightness ?? 0) > 0.4 &&
    (lampState?.brightness ?? 0) < 0.6 && near(lampState?.power ?? 0, Math.abs((lampState?.voltage ?? 0) * (lampState?.current ?? 0)), 1e-9))

  const solenoid = step(twoTerminalNet('solenoid', { resistance: 12, pickupVoltage: 3 }, '+', '-', 6), 0)
  check('solenoid is a driven resistive actuator', solenoid.states.get('device')?.on === true &&
    near(solenoid.states.get('device')?.current ?? 0, 6 / 12.05, 0.001))

  const fanNet = twoTerminalNet('fan', { resistance: 4, ke: 0.5 }, '+', '-', 12)
  const fan = step(fanNet, 0, new Map([['device', 10]]))
  check('fan uses winding resistance and speed-dependent back-EMF', fan.states.get('device')?.angularVelocity === 10 &&
    near(fan.states.get('device')?.current ?? 0, 7 / 4.05, 0.001))

  const speaker = step(twoTerminalNet('speaker', { resistance: 8, frequency: 880 }, '+', '-', 9), 0)
  check('speaker exposes buzzer-compatible audio behavior', speaker.states.get('device')?.on === true &&
    speaker.states.get('device')?.frequency === 880 && (speaker.states.get('device')?.current ?? 0) > 1)
}

function testMosfets(): void {
  const nNet = makeNet(
    [comp('drainPower', 'battery', { voltage: 5 }), comp('gatePower', 'battery', { voltage: 3 }), comp('g', 'ground'),
      comp('load', 'resistor', { resistance: 1000 }), comp('m', 'mosfet', { mosfetKind: 'N', thresholdVoltage: 2, rdsOn: 0.05 })],
    [wire('w1', 'drainPower', '+', 'load', 'A'), wire('w2', 'load', 'B', 'm', 'D'), wire('w3', 'm', 'S', 'g', 'G'),
      wire('w4', 'drainPower', '-', 'g', 'G'), wire('w5', 'gatePower', '+', 'm', 'G'), wire('w6', 'gatePower', '-', 'g', 'G')],
  )
  const nOn = step(nNet, 0)
  check('N-channel MOSFET turns on above threshold with near-zero gate current', nOn.states.get('m')?.on === true &&
    (nOn.states.get('m')?.current ?? 0) > 0.004 && pin(nOn, 'm', 'D') < 0.1 &&
    Math.abs(nOn.states.get('gatePower')?.current ?? 1) < 1e-6)
  nNet.compById.get('gatePower')!.data.props.voltage = 0
  const nOff = step(nNet, 1000 / 60)
  check('N-channel MOSFET turns off below threshold', nOff.states.get('m')?.on === false &&
    pin(nOff, 'm', 'D') > 4.99 && Math.abs(nOff.states.get('m')?.current ?? 1) < 1e-5)

  const pNet = makeNet(
    [comp('sourcePower', 'battery', { voltage: 5 }), comp('gatePower', 'battery', { voltage: 0 }), comp('g', 'ground'),
      comp('load', 'resistor', { resistance: 1000 }), comp('m', 'mosfet', { mosfetKind: 'P', thresholdVoltage: 2, rdsOn: 0.05 })],
    [wire('w1', 'sourcePower', '+', 'm', 'S'), wire('w2', 'sourcePower', '-', 'g', 'G'), wire('w3', 'm', 'D', 'load', 'A'),
      wire('w4', 'load', 'B', 'g', 'G'), wire('w5', 'gatePower', '+', 'm', 'G'), wire('w6', 'gatePower', '-', 'g', 'G')],
  )
  const pOn = step(pNet, 0)
  check('P-channel MOSFET uses complementary gate polarity', pOn.states.get('m')?.on === true &&
    Math.abs(pOn.states.get('m')?.current ?? 0) > 0.004 && pin(pOn, 'm', 'D') > 4.9)
}

function testSourcesAndOpAmp(): void {
  const sourceNet = makeNet(
    [comp('source', 'currentSource', { current: 0.02 }), comp('load', 'resistor', { resistance: 1000 }), comp('g', 'ground')],
    [wire('w1', 'source', 'A', 'load', 'A'), wire('w2', 'load', 'B', 'g', 'G'), wire('w3', 'source', 'B', 'g', 'G')],
  )
  const source = step(sourceNet, 0)
  check('current source drives its configured current through a load', near(pin(source, 'source', 'A'), 20, 0.1) &&
    near(source.states.get('source')?.current ?? 0, 0.02, 1e-12) && near(Math.abs(source.wires.get('w1')?.current ?? 0), 0.02, 0.0001))

  const clockNet = makeNet(
    [comp('clock', 'clock', { frequency: 10, amplitude: 5, dutyCycle: 0.25, outputResistance: 50 }),
      comp('load', 'resistor', { resistance: 1000 }), comp('g', 'ground')],
    [wire('w1', 'clock', 'OUT', 'load', 'A'), wire('w2', 'load', 'B', 'g', 'G'), wire('w3', 'clock', 'GND', 'g', 'G')],
  )
  const high = step(clockNet, 0)
  const low = step(clockNet, 40)
  check('clock generates a relative square wave with finite output current', high.states.get('clock')?.out === 1 &&
    pin(high, 'clock', 'OUT') > 4.7 && low.states.get('clock')?.out === 0 && Math.abs(pin(low, 'clock', 'OUT')) < 0.001 &&
    Number.isFinite(high.states.get('clock')?.current) && clockVoltage({ frequency: 10, amplitude: 5, dutyCycle: 0.25 }, 10) === 5)

  const opNet = makeNet(
    [comp('positiveSupply', 'battery', { voltage: 10 }), comp('negativeSupply', 'battery', { voltage: 10 }),
      comp('input', 'battery', { voltage: 0.4 }), comp('g', 'ground'), comp('op', 'opAmp', { gain: 10, outputResistance: 5 }),
      comp('load', 'resistor', { resistance: 10000 })],
    [wire('w1', 'positiveSupply', '+', 'op', 'V+'), wire('w2', 'positiveSupply', '-', 'g', 'G'),
      wire('w3', 'negativeSupply', '+', 'g', 'G'), wire('w4', 'negativeSupply', '-', 'op', 'V-'),
      wire('w5', 'input', '+', 'op', 'IN+'), wire('w6', 'input', '-', 'g', 'G'), wire('w7', 'op', 'IN-', 'g', 'G'),
      wire('w8', 'op', 'OUT', 'load', 'A'), wire('w9', 'load', 'B', 'g', 'G')],
  )
  const linear = step(opNet, 0)
  check('op-amp converges to a linear differential output', linear.solved && near(pin(linear, 'op', 'OUT'), 4, 0.03) &&
    near(pin(linear, 'op', 'V-'), -10, 0.001) && Math.abs(linear.states.get('input')?.current ?? 1) < 1e-6,
  `OUT=${pin(linear, 'op', 'OUT').toFixed(4)}V`)
  opNet.compById.get('input')!.data.props.voltage = 2
  const saturated = step(opNet, 1000 / 60)
  check('op-amp output is limited by its supply rails', pin(saturated, 'op', 'OUT') > 9.9 && pin(saturated, 'op', 'OUT') <= 10 &&
    opAmpTarget({ gain: 10 }, 2, 0, 10, -10) === 10)
}

function testIoRoundTrip(): void {
  const components = NEW_TYPES.map((type, index) => ({
    id: `new-${type}`,
    name: `New ${type}`,
    type,
    x: index * 100,
    y: 200,
    props: COMPONENT_DEFS[type].defaults(),
  })) as CircuitComponentData[]
  const original: ProjectData = {
    version: CURRENT_VERSION,
    name: 'Expanded components',
    groundY: 900,
    circuit: { components, wires: [] },
    hardware: { parts: [], joints: [], meshes: [] },
  }
  const parsed = parseProjectFile(serializeProject(original))
  check('project IO round-trips every new type and all default properties', canonical(parsed) === canonical(original))
  check('project IO retains all 16 new component types', NEW_TYPES.every((type) =>
    parsed.circuit.components.some((entry) => entry.type === type && entry.id === `new-${type}`)))
  const empty: ProjectData = { version: CURRENT_VERSION, name: 'Blank', groundY: 900, circuit: { components: [], wires: [] }, hardware: { parts: [], joints: [], meshes: [] } }
  check('blank project IO round-trips without a false validation error', canonical(parseProjectFile(serializeProject(empty))) === canonical(empty))
  const meshOnly: ProjectData = { ...empty, name: 'Mesh only', hardware: { parts: [], joints: [], meshes: [{ id: 'mesh', name: 'Plate', base: 'plate', w: 100, h: 80, depth: 20, segments: 8, ops: [] }] } }
  check('mesh-only project IO preserves the Part Studio library', parseProjectFile(serializeProject(meshOnly)).hardware.meshes[0]?.id === 'mesh')
  const invalidWire = parseProjectFile(JSON.stringify({ ...empty, circuit: {
    components: [comp('supply', 'battery'), comp('ground', 'ground')],
    wires: [wire('valid', 'supply', '-', 'ground', 'G'), wire('invalid', 'supply', 'missing', 'ground', 'G')],
  } }))
  check('project IO drops wires with unknown component pins', invalidWire.circuit.wires.length === 1 && invalidWire.circuit.wires[0].id === 'valid')
}

function testNetworkCompleteness(): void {
  const circuit: CircuitData = {
    components: NEW_TYPES.map((type) => comp(`c-${type}`, type, COMPONENT_DEFS[type].defaults())),
    wires: [],
  }
  const runtime = step(compileCircuit(circuit), 0)
  check('every new type receives a finite runtime state in an isolated network', runtime.solved &&
    NEW_TYPES.every((type) => {
      const state = runtime.states.get(`c-${type}`)
      return state !== undefined && [state.active, state.voltage, state.current, state.brightness, state.power]
        .every((value) => value === undefined || Number.isFinite(value))
    }))
}

testCatalog()
testTransient()
testDiodesAndRgb()
testRelay()
testSensorsAndOutputs()
testMosfets()
testSourcesAndOpAmp()
testIoRoundTrip()
testNetworkCompleteness()

console.log(`${passes} passed, ${failures} failed`)
if (failures > 0) throw new Error(`${failures} component test(s) failed`)
