import type { CircuitComponentData, HardwarePartData, HardwarePartType, HardwareProps, ProjectData } from '../types'
import { PB } from './helpers'

// ============================================================================
// 8-Bit ALU Trainer — a real 3-bit ripple-carry adder compiled from raw
// logic gates, a gated board clock, and a bench with the silicon to match:
// PGA socket, heatsink with a spinning fan, DIMMs and a breadboard console.
// ============================================================================

export function buildAluTrainer(): ProjectData {
  const pb = new PB('8-Bit ALU Trainer', 1080)
  const supply = pb.c('battery', 'Logic Supply 5V', 100, 120, { voltage: 5, maxCurrent: 2.5 })
  const ground = pb.c('ground', 'Logic Ground', 100, 260)
  const fuse = pb.c('fuse', 'ALU Main Fuse', 260, 120, { maxCurrent: 2 })
  const master = pb.c('switchSlide', 'ALU Power', 420, 120, { key: 'KeyP', closed: true })
  pb.w(supply, '-', ground, 'G')
  pb.w(supply, '+', fuse, 'A')
  pb.w(fuse, 'B', master, 'A')

  const clock = pb.c('clock', 'Board Clock', 560, 120, { frequency: 2, amplitude: 5, dutyCycle: 0.5, outputResistance: 50 })
  pb.w(clock, 'GND', ground, 'G')
  const run = pb.c('switchSlide', 'Run Enable', 560, 260, { key: 'KeyR', closed: true })
  const runPull = pb.c('resistor', 'Run Enable Pull Down', 560, 400, { resistance: 100000 })
  const clockGate = pb.c('gate', 'Clock Gate AND', 740, 190, { gateType: 'AND' })
  pb.w(clock, 'OUT', clockGate, 'IN1')
  pb.w(run, 'B', clockGate, 'IN2')
  pb.w(run, 'B', runPull, 'A')
  pb.w(runPull, 'B', ground, 'G')
  pb.w(master, 'B', run, 'A')
  const clockR = pb.c('resistor', 'Clock Ballast', 920, 120, { resistance: 330 })
  const clockLed = pb.c('led', 'Clock Pulse', 1060, 120, { forwardVoltage: 2, color: 'yellow' })
  pb.w(clockGate, 'OUT', clockR, 'A')
  pb.w(clockR, 'B', clockLed, 'A')
  pb.w(clockLed, 'K', ground, 'G')
  const powerR = pb.c('resistor', 'Power Ballast', 920, 300, { resistance: 470 })
  const powerLed = pb.c('led', 'Power Good', 1060, 300, { forwardVoltage: 2.2, color: 'green' })
  pb.w(master, 'B', powerR, 'A')
  pb.w(powerR, 'B', powerLed, 'A')
  pb.w(powerLed, 'K', ground, 'G')

  // 3-bit ripple-carry adder: S_i = A_i xor B_i xor Cin, Cout = majority.
  // Each logic input gets a 100k pull-down so an open switch reads LOW
  // instead of floating high through the switch's off-resistance.
  const bits: { a: CircuitComponentData; b: CircuitComponentData; xor2: CircuitComponentData; and2: CircuitComponentData; or: CircuitComponentData }[] = []
  for (let i = 0; i < 3; i++) {
    const y = 460 + i * 250
    const a = pb.c('switchSlide', `Input A${i}`, 240, y, { closed: false })
    const b = pb.c('switchSlide', `Input B${i}`, 240, y + 130, { closed: false })
    const aPull = pb.c('resistor', `Input A${i} Pull Down`, 100, y, { resistance: 100000 })
    const bPull = pb.c('resistor', `Input B${i} Pull Down`, 100, y + 130, { resistance: 100000 })
    pb.w(a, 'B', aPull, 'A')
    pb.w(aPull, 'B', ground, 'G')
    pb.w(b, 'B', bPull, 'A')
    pb.w(bPull, 'B', ground, 'G')
    pb.w(master, 'B', a, 'A')
    pb.w(master, 'B', b, 'A')
    const xor1 = pb.c('gate', `XOR Pair ${i}`, 470, y + 65, { gateType: 'XOR' })
    const and1 = pb.c('gate', `AND Pair ${i}`, 470, y + 235, { gateType: 'AND' })
    pb.w(a, 'B', xor1, 'IN1')
    pb.w(b, 'B', xor1, 'IN2')
    pb.w(a, 'B', and1, 'IN1')
    pb.w(b, 'B', and1, 'IN2')
    const xor2 = pb.c('gate', `XOR Sum ${i}`, 680, y, { gateType: 'XOR' })
    const and2 = pb.c('gate', `AND Carry ${i}`, 680, y + 140, { gateType: 'AND' })
    pb.w(xor1, 'OUT', xor2, 'IN1')
    pb.w(xor1, 'OUT', and2, 'IN1')
    const or = pb.c('gate', `OR Carry ${i}`, 890, y + 70, { gateType: 'OR' })
    pb.w(and1, 'OUT', or, 'IN1')
    pb.w(and2, 'OUT', or, 'IN2')
    const r = pb.c('resistor', `Sum Ballast ${i}`, 1090, y, { resistance: 330 })
    const led = pb.c('led', `Sum Bit ${i}`, 1230, y, { forwardVoltage: 2, color: 'white' })
    pb.w(xor2, 'OUT', r, 'A')
    pb.w(r, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
    bits.push({ a, b, xor2, and2, or })
  }
  pb.w(ground, 'G', bits[0].xor2, 'IN2')
  pb.w(ground, 'G', bits[0].and2, 'IN2')
  for (let i = 1; i < 3; i++) {
    pb.w(bits[i - 1].or, 'OUT', bits[i].xor2, 'IN2')
    pb.w(bits[i - 1].or, 'OUT', bits[i].and2, 'IN2')
  }
  const carryR = pb.c('resistor', 'Carry Ballast', 1090, 1300, { resistance: 330 })
  const carryLed = pb.c('led', 'Carry Out', 1230, 1300, { forwardVoltage: 2, color: 'red' })
  pb.w(bits[2].or, 'OUT', carryR, 'A')
  pb.w(carryR, 'B', carryLed, 'A')
  pb.w(carryLed, 'K', ground, 'G')

  const fan = pb.c('fan', 'Heatsink Fan', 1400, 120, { resistance: 12, ke: 2.5, maxCurrent: 0.6 })
  pb.w(master, 'B', fan, '+')
  pb.w(fan, '-', ground, 'G')

  const steel: HardwareProps = { material: 'steel', color: '#9aa4ae', depth: 12 }
  const pcb: HardwareProps = { material: 'plastic', color: '#0e5c3f', depth: 8 }
  const gold: HardwareProps = { material: 'iron', color: '#d4af37', depth: 12 }
  const dark: HardwareProps = { material: 'plastic', color: '#23282e', depth: 10 }
  const alu: HardwareProps = { material: 'steel', color: '#b9c2cb', depth: 12 }
  const p = (kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = steel, angle = 0) => {
    const part = pb.p(kind, name, x, y, w, h, props, angle)
    part.z = z
    return part
  }
  const attach = (parent: HardwarePartData, kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = steel, angle = 0) => {
    const part = p(kind, name, x, y, z, w, h, props, angle)
    pb.weld(parent, part)
    return part
  }

  // Workbench (static).
  const bench = p('board', 'Trainer Benchtop', 800, 944, 0, 1240, 16, { material: 'wood', color: '#8a5f39', depth: 460, isStatic: true })
  for (const x of [250, 1350]) for (const z of [-200, 200]) {
    attach(bench, 'board', `Bench Leg ${x} ${z}`, x, 1017, z, 26, 130, { material: 'steel', color: '#3c4650', depth: 26 })
    attach(bench, 'block', `Bench Foot ${x} ${z}`, x, 1086, z, 40, 10, { material: 'rubber', color: '#1c2126', depth: 40 })
  }
  attach(bench, 'board', 'Bench Drawer Front', 800, 975, 232, 420, 44, { material: 'wood', color: '#7a5232', depth: 14 })
  for (const x of [700, 900]) attach(bench, 'axle', `Drawer Pull ${x}`, x, 972, 244, 10, 10, { ...steel, depth: 20 })

  // Motherboard.
  const board = p('board', 'Main PCB', 620, 932, 0, 720, 8, { ...pcb, depth: 380 })
  for (const [x, z] of [[280, -160], [280, 160], [960, -160], [960, 160]] as const) {
    attach(board, 'axle', `PCB Standoff ${x} ${z}`, x, 926, z * 0.82, 10, 10, { ...gold, depth: 10 })
  }
  const socket = attach(board, 'block', 'CPU Socket Frame', 430, 921, 0, 132, 14, { ...dark, depth: 150 })
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      attach(board, 'block', `Socket Pin ${row} ${col}`, 376 + col * 15.5, 912, -54 + row * 36, 6, 6, gold)
    }
  }
  attach(board, 'block', 'CPU Substrate', 430, 905, 0, 122, 8, { material: 'plastic', color: '#1c5b3a', depth: 132 })
  attach(board, 'block', 'CPU Die', 430, 897, 0, 66, 10, { ...steel, color: '#cfd6dd', depth: 72 })
  attach(board, 'board', 'CPU IHS Etch', 430, 891, 0, 52, 4, { ...steel, color: '#aab3bc', depth: 58 })

  // Heatsink + spinning fan.
  const base = attach(board, 'block', 'Heatsink Base', 430, 888, 0, 112, 8, { ...alu, depth: 156 })
  for (let i = 0; i < 10; i++) {
    attach(base, 'board', `Heatsink Fin ${i + 1}`, 430, 852, -45 + i * 10, 100, 64, { ...alu, color: '#aeb8c2', depth: 6 })
  }
  for (const z of [-48, 48]) for (const x of [386, 474]) {
    attach(base, 'board', `Heatsink Clip ${x} ${z}`, x, 826, z, 8, 44, { ...steel, color: '#7d8790', depth: 6 })
  }
  const rotor = p('axle', 'Heatsink Fan Rotor', 430, 816, 62, 26, 26, { ...dark, depth: 22 })
  const fanMount = attach(board, 'block', 'Heatsink Fan Mount', 430, 816, 62, 30, 30, { ...dark, depth: 12 })
  pb.j('motor', fanMount, rotor, 0, 0, 0, 0, { boundComponent: 'Heatsink Fan', kv: 1 / 2.5, maxAccel: 14 })
  for (let i = 0; i < 6; i++) {
    const rad = (i * 60 * Math.PI) / 180
    attach(rotor, 'board', `Heatsink Fan Blade ${i + 1}`, 430 + 42 * Math.cos(rad), 816 + 42 * Math.sin(rad), 62, 44, 9, { ...dark, color: '#2e353c', depth: 5 }, i * 60 + 25)
  }
  attach(rotor, 'axle', 'Heatsink Fan Cap', 430, 816, 74, 12, 12, { ...steel, color: '#d7dde3', depth: 5 })
  for (const [x, z] of [[366, 30], [366, 94], [494, 30], [494, 94]] as const) {
    attach(board, 'board', `Fan Shroud Post ${x} ${z}`, x, 828, z, 8, 40, dark)
  }

  // DIMMs, crystal, capacitors.
  for (const [i, x] of [[1, 620], [2, 668]] as const) {
    const stick = attach(board, 'board', `RAM Stick ${i}`, x, 861, -80, 16, 130, { material: 'plastic', color: '#173a2b', depth: 92 })
    attach(board, 'board', `DIMM Slot ${i}`, x, 925, -80, 22, 6, { ...dark, depth: 100 })
    for (let chip = 0; chip < 4; chip++) {
      attach(stick, 'block', `RAM Chip ${i} ${chip + 1}`, x, 815 + chip * 26, -29, 12, 20, dark)
    }
  }
  attach(board, 'axle', 'Clock Crystal', 770, 920, 0, 16, 16, { ...steel, color: '#c9ced4', depth: 28 })
  for (let i = 0; i < 6; i++) {
    attach(board, 'axle', `Filter Capacitor ${i + 1}`, 322 + (i % 3) * 22, 908 + Math.floor(i / 3) * 20, i < 3 ? -18 : 18, 12, 12, { ...steel, color: '#3c4c5c', depth: 18 })
  }
  for (let i = 0; i < 6; i++) {
    attach(board, 'board', `Jumper Bridge ${i + 1}`, 726 + (i % 3) * 26, 916, 120 + Math.floor(i / 3) * 26, 18, 4, { material: 'plastic', color: ['#e2574c', '#3f7fbf', '#e2a849'][i % 3], depth: 10 })
  }
  for (const [x, z] of [[300, -176], [300, 176], [940, -176], [940, 176]] as const) {
    attach(board, 'axle', `PCB Screw ${x} ${z}`, x, 926, z, 9, 9, { ...steel, color: '#d7dde3', depth: 9 })
  }

  // Status LED board.
  const panel = attach(board, 'board', 'Status LED Board', 880, 862, 0, 74, 124, { ...dark, depth: 12 })
  const bulbNames = ['Sum Bit 2', 'Sum Bit 1', 'Sum Bit 0', 'Carry Out', 'Clock Pulse', 'Power Good']
  bulbNames.forEach((name, i) => {
    const y = 816 + i * 20
    attach(panel, 'ledBulb', `${name} Bulb`, 880, y, 7, 14, 18, { boundComponent: name, depth: 10 })
    attach(panel, 'board', `${name} Label`, 880, y + 9, 8, 40, 4, { material: 'plastic', color: '#e8ecef', depth: 6 })
  })

  // Breadboard console with touch pads for every control.
  const console_ = p('board', 'Breadboard Console', 1420, 950, 0, 340, 40, { ...dark, color: '#e9edf0', depth: 320, isStatic: true })
  attach(console_, 'board', 'Console Rail', 1420, 922, 0, 340, 12, { ...dark, depth: 320 })
  const pad = (control: CircuitComponentData, x: number, y: number, z: number, color: string) => {
    const p2 = attach(console_, 'switchPad', `${control.name} Pad`, x, y, z, 54, 26, { material: 'plastic', color, depth: 20, boundComponent: control.name })
    control.props.bindHardware = p2.name
  }
  const inputs = [bits[0].a, bits[1].a, bits[2].a, bits[0].b, bits[1].b, bits[2].b]
  inputs.forEach((control, i) => {
    pad(control, 1320 + (i % 3) * 100, 928, i < 3 ? -110 : 110, i < 3 ? '#e2574c' : '#3f7fbf')
  })
  pad(run, 1630, 928, -110, '#e2a849')
  pad(master, 1630, 928, 110, '#37b26c')
  for (let i = 0; i < 8; i++) {
    attach(console_, 'board', `Console Header ${i + 1}`, 1266 + i * 10, 916, 0, 5, 10, gold)
  }
  attach(console_, 'board', 'Console Title Strip', 1420, 906, 0, 200, 8, { material: 'plastic', color: '#2e353c', depth: 40 })

  return pb.build()
}
