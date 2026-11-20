import type { CircuitComponentData, HardwarePartData, HardwarePartType, HardwareProps, ProjectData } from '../types'
import { PB } from './helpers'

// ============================================================================
// CoreXY 3D Printer — static aluminum frame with a rack-and-pinion tool
// carriage sliding on X (A/D) and the whole gantry lifting on Z (W/S).
// Spinning extruder fan, glowing hot end and bed heaters, passive filament
// spool on a free bearing, LCD console and a freshly printed owl.
// ============================================================================

export function buildPrinter(): ProjectData {
  const pb = new PB('CoreXY 3D Printer', 1000)
  const supply = pb.c('battery', 'Printer PSU', 100, 100, { voltage: 12, maxCurrent: 5 })
  const ground = pb.c('ground', 'Printer Ground', 100, 220)
  const fuse = pb.c('fuse', 'Printer Main Fuse', 260, 100, { maxCurrent: 4 })
  const master = pb.c('switchSlide', 'Printer Power', 420, 100, { key: 'KeyP', closed: true })
  pb.w(supply, '-', ground, 'G')
  pb.w(supply, '+', fuse, 'A')
  pb.w(fuse, 'B', master, 'A')

  const bipolar = (label: string, y: number, keys: [string, string], motorName: string, ke: number, posLabel: string, negLabel: string) => {
    const branch = pb.c('fuse', `${label} Branch Fuse`, 100, y, { maxCurrent: 1.5 })
    const pos = pb.c('switchPush', posLabel, 260, y, { key: keys[0], closed: false })
    const neg = pb.c('switchPush', negLabel, 260, y + 140, { key: keys[1], closed: false })
    const motor = pb.c('motor', motorName, 440, y, { resistance: 12, ke, kv: 1 / ke, maxCurrent: 1.2 })
    const rp = pb.c('resistor', `${label} Positive Return`, 620, y, { resistance: 22 })
    const rn = pb.c('resistor', `${label} Negative Return`, 620, y + 140, { resistance: 22 })
    pb.w(master, 'B', branch, 'A')
    pb.w(branch, 'B', pos, 'A')
    pb.w(branch, 'B', neg, 'A')
    pb.w(pos, 'B', rp, 'A')
    pb.w(neg, 'B', rn, 'A')
    pb.w(rp, 'A', motor, '+')
    pb.w(rn, 'A', motor, '-')
    pb.w(rp, 'B', ground, 'G')
    pb.w(rn, 'B', ground, 'G')
    return { motor, pos, neg }
  }
  const xAxis = bipolar('X Axis', 340, ['KeyD', 'KeyA'], 'X Drive Motor', 16, 'Head Right', 'Head Left')
  const zLift = bipolar('Z Lift', 620, ['KeyW', 'KeyS'], 'Z Lift Motor', 18, 'Gantry Up', 'Gantry Down')

  const fan = pb.c('fan', 'Extruder Fan', 820, 100, { resistance: 12, ke: 2.5, maxCurrent: 1 })
  pb.w(master, 'B', fan, '+')
  pb.w(fan, '-', ground, 'G')
  for (const [name, y] of [['Hot End Heater', 260], ['Bed Heater', 400]] as const) {
    const ballast = pb.c('resistor', `${name} Ballast`, 700, y, { resistance: 470 })
    const led = pb.c('led', name, 820, y, { forwardVoltage: 2, color: 'red' })
    pb.w(master, 'B', ballast, 'A')
    pb.w(ballast, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
  }
  const lights = pb.c('switchSlide', 'Printer Lights', 1020, 100, { key: 'KeyL', closed: true })
  pb.w(master, 'B', lights, 'A')
  const frameLamps: CircuitComponentData[] = []
  for (const [name, y] of [['Frame Light Left', 260], ['Frame Light Right', 400]] as const) {
    const r = pb.c('resistor', `${name} Ballast`, 1020, y, { resistance: 470 })
    const led = pb.c('led', name, 1200, y, { forwardVoltage: 2.4, color: 'white' })
    pb.w(lights, 'B', r, 'A')
    pb.w(r, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
    frameLamps.push(led)
  }
  const status = pb.c('led', 'Status LED', 1200, 540, { forwardVoltage: 2.2, color: 'green' })
  const statusBallast = pb.c('resistor', 'Status LED Ballast', 1080, 540, { resistance: 1000 })
  pb.w(master, 'B', statusBallast, 'A')
  pb.w(statusBallast, 'B', status, 'A')
  pb.w(status, 'K', ground, 'G')

  const frame: HardwareProps = { material: 'steel', color: '#4a5560', depth: 12 }
  const dark: HardwareProps = { material: 'plastic', color: '#1d232b', depth: 10 }
  const alu: HardwareProps = { material: 'steel', color: '#b9c2cb', depth: 10 }
  const brass: HardwareProps = { material: 'iron', color: '#c9a227', depth: 10 }
  const p = (kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = frame, angle = 0) => {
    const part = pb.p(kind, name, x, y, w, h, props, angle)
    part.z = z
    return part
  }
  const attach = (parent: HardwarePartData, kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = frame, angle = 0) => {
    const part = p(kind, name, x, y, z, w, h, props, angle)
    pb.weld(parent, part)
    return part
  }

  // ---- static base + frame ----
  const base = p('block', 'Printer Base', 760, 950, 0, 580, 40, { ...dark, depth: 490, isStatic: true })
  for (const [x, z] of [[510, -210], [510, 210], [1010, -210], [1010, 210]] as const) {
    attach(base, 'block', `Printer Foot ${x} ${z}`, x, 992, z, 40, 16, { material: 'rubber', color: '#15181d', depth: 40 })
  }
  for (const [x, z] of [[510, -190], [510, 190], [1010, -190], [1010, 190]] as const) {
    const upright = attach(base, 'board', `Frame Upright ${x} ${z}`, x, 740, z, 24, 380, frame)
    attach(upright, 'block', `Corner Cube ${x} ${z}`, x, 550, z, 34, 34, alu)
    attach(upright, 'block', `Upright Foot ${x} ${z}`, x, 926, z, 40, 12, alu)
  }
  attach(base, 'board', 'Top Frame Front', 760, 550, 190, 548, 22, frame)
  attach(base, 'board', 'Top Frame Back', 760, 550, -190, 548, 22, frame)
  attach(base, 'board', 'Top Frame Left', 510, 550, 0, 22, 22, { ...frame, depth: 380 })
  attach(base, 'board', 'Top Frame Right', 1010, 550, 0, 22, 22, { ...frame, depth: 380 })
  attach(base, 'block', 'PSU Enclosure', 950, 890, 214, 110, 70, { ...dark, depth: 90 })
  attach(base, 'batteryPack', 'PSU Brick', 950, 884, 214, 84, 24, { ...dark, depth: 70, boundComponent: supply.name })
  for (let i = 0; i < 3; i++) {
    attach(base, 'board', `Cable Chain Link ${i + 1}`, 545 + i * 14, 700 + i * 60, 0, 10, 46, { material: 'rubber', color: '#2b323a', depth: 10 }, i % 2 ? 10 : -10)
  }

  // ---- Z lift pinions (drive the vertical slider; parked clear of the
  // gantry bridge and its guide blocks so nothing interpenetrates) ----
  const zPinionL = p('gear', 'Z Lift Pinion Left', 510, 640, 80, 40, 40, { ...alu, teeth: 12, depth: 16 })
  const zPinionR = p('gear', 'Z Lift Pinion Right', 1010, 640, -80, 40, 40, { ...alu, teeth: 12, depth: 16 })
  const zBracketL = attach(base, 'block', 'Z Pinion Bracket Left', 510, 640, 80, 30, 30, { ...alu, depth: 14 })
  const zBracketR = attach(base, 'block', 'Z Pinion Bracket Right', 1010, 640, -80, 30, 30, { ...alu, depth: 14 })
  const zJointL = pb.j('motor', zBracketL, zPinionL, 0, 0, 0, 0, { boundComponent: zLift.motor.name, kv: 1 / 18, maxAccel: 4, minAngle: -60, maxAngle: 60 })
  const zJointR = pb.j('motor', zBracketR, zPinionR, 0, 0, 0, 0, { boundComponent: zLift.motor.name, kv: 1 / 18, maxAccel: 4, minAngle: -60, maxAngle: 60 })

  // ---- Z gantry (vertical slider driven by both pinions) ----
  const gantry = p('block', 'Z Gantry Bridge', 760, 640, 0, 540, 24, { ...frame, depth: 70 })
  pb.j('slider', base, gantry, 0, -310, 0, 0, { axis: 90, ratio: 60, driveBy: zJointL.id })
  for (const [side, z] of [['Front', 44], ['Back', -44]] as const) {
    attach(gantry, 'board', `Gantry ${side} Rail`, 760, 640, z, 520, 16, alu)
    for (const x of [510, 1010]) {
      attach(gantry, 'block', `Z Guide Block ${x} ${side}`, x, 640, z, 40, 44, dark)
    }
  }

  // ---- X drive pinion + tool carriage (horizontal slider) ----
  const xPinion = p('gear', 'X Drive Pinion', 760, 612, 0, 36, 36, { ...alu, teeth: 12, depth: 14 })
  const xJoint = pb.j('motor', gantry, xPinion, 0, -28, 0, 0, { boundComponent: xAxis.motor.name, kv: 1 / 16, maxAccel: 4, minAngle: -110, maxAngle: 110 })
  const carriage = p('block', 'Tool Carriage', 760, 672, 0, 74, 58, { ...dark, depth: 64 })
  pb.j('slider', gantry, carriage, 0, 32, 0, 0, { axis: 0, ratio: 55, driveBy: xJoint.id })
  attach(carriage, 'board', 'Tool Carriage Backplate', 760, 672, -36, 68, 54, alu)
  attach(carriage, 'board', 'X Rack Strip', 760, 664, 0, 500, 6, { ...alu, depth: 8 })
  attach(carriage, 'block', 'Extruder Body', 760, 716, 20, 54, 40, dark)
  for (let i = 0; i < 4; i++) {
    attach(carriage, 'board', `Heatsink Fin ${i + 1}`, 760, 742 + i * 7, 20, 46, 6, alu)
  }
  attach(carriage, 'block', 'Heater Block', 760, 780, 20, 22, 16, brass)
  attach(carriage, 'block', 'Nozzle Tip', 760, 792, 20, 10, 10, brass)
  attach(carriage, 'ledBulb', 'Hot End Glow Bulb', 774, 780, 20, 10, 10, { depth: 10, boundComponent: 'Hot End Heater' })

  // ---- extruder fan (screen-plane rotor on the carriage) ----
  const fanHub = p('axle', 'Extruder Fan Rotor', 700, 712, 44, 16, 16, { ...dark, depth: 10 })
  const fanMount = attach(carriage, 'block', 'Extruder Fan Mount', 700, 712, 44, 24, 24, { ...dark, depth: 10 })
  pb.j('motor', fanMount, fanHub, 0, 0, 0, 0, { boundComponent: fan.name, kv: 1 / 2.5, maxAccel: 14 })
  for (let i = 0; i < 6; i++) {
    const rad = (i * 60 * Math.PI) / 180
    attach(fanHub, 'board', `Extruder Fan Blade ${i + 1}`, 700 + 27 * Math.cos(rad), 712 + 27 * Math.sin(rad), 44, 30, 8, { ...dark, color: '#2b323a', depth: 4 }, i * 60 + 25)
  }
  attach(carriage, 'board', 'Fan Shroud Frame', 700, 712, 36, 74, 74, { ...dark, depth: 4 })

  // ---- print bed + the printed owl ----
  const bed = attach(base, 'board', 'Print Bed', 760, 925, 0, 390, 10, { ...dark, depth: 400 })
  for (const [x, z] of [[575, -180], [575, 180], [945, -180], [945, 180]] as const) {
    attach(bed, 'block', `Bed Clip ${x} ${z}`, x, 918, z, 14, 8, alu)
  }
  attach(bed, 'ledBulb', 'Bed Heater Bulb', 760, 925, 214, 30, 10, { depth: 12, boundComponent: 'Bed Heater' })
  const owlBody = attach(bed, 'block', 'Owl Body', 700, 884, 0, 88, 56, { material: 'plastic', color: '#7a5cc4', depth: 88 })
  const owlHead = attach(owlBody, 'block', 'Owl Head', 700, 838, 0, 66, 36, { material: 'plastic', color: '#8a6ad4', depth: 76 })
  for (const [side, dx] of [['Left', -20], ['Right', 20]] as const) {
    attach(owlHead, 'block', `Owl Ear ${side}`, 700 + dx, 812, 0, 14, 16, { material: 'plastic', color: '#7a5cc4', depth: 20 })
    attach(owlHead, 'block', `Owl Eye ${side}`, 700 + dx, 838, 36, 16, 16, { material: 'plastic', color: '#f2f4f7', depth: 8 })
    attach(owlHead, 'block', `Owl Pupil ${side}`, 700 + dx, 838, 40, 7, 7, { material: 'plastic', color: '#1d232b', depth: 4 })
    attach(owlBody, 'board', `Owl Wing ${side}`, 700 + dx * 2.6, 890, 0, 18, 34, { material: 'plastic', color: '#6a4cb4', depth: 20 }, dx < 0 ? -14 : 14)
  }
  attach(owlHead, 'block', 'Owl Beak', 700, 852, 40, 12, 10, { material: 'plastic', color: '#e29a3f', depth: 8 })
  attach(owlBody, 'board', 'Owl Tail', 648, 892, 0, 20, 12, { material: 'plastic', color: '#6a4cb4', depth: 30 }, 18)

  // ---- filament spool on a free bearing + guide tube ----
  const spoolArm = attach(base, 'board', 'Spool Bracket', 760, 528, 0, 20, 44, frame)
  const spool = p('axle', 'Filament Spool', 760, 500, 0, 92, 92, { ...dark, depth: 118 })
  pb.j('pin', spoolArm, spool, 0, -28, 0, 0, {})
  for (const z of [-62, 62]) {
    attach(spool, 'gear', `Spool Flange ${z}`, 760, 500, z, 94, 94, { ...dark, color: '#15181d', depth: 10, teeth: 18 })
  }
  attach(spool, 'axle', 'Filament Wind', 760, 500, 0, 74, 74, { material: 'plastic', color: '#e29a3f', depth: 100 })
  attach(spool, 'axle', 'Spool Hub', 760, 500, 0, 26, 26, { ...alu, depth: 130 })
  attach(spoolArm, 'board', 'Filament Guide 1', 736, 580, 24, 8, 90, { material: 'rubber', color: '#e29a3f', depth: 6 }, 14)
  attach(spoolArm, 'board', 'Filament Guide 2', 748, 650, 28, 6, 70, { material: 'rubber', color: '#e29a3f', depth: 6 }, -10)

  // ---- LCD console + pads + lights ----
  const lcd = attach(base, 'block', 'LCD Console', 700, 890, 250, 170, 74, dark)
  attach(lcd, 'board', 'LCD Screen', 700, 882, 258, 150, 54, { material: 'acrylic', color: '#123a66', depth: 4 })
  attach(lcd, 'axle', 'LCD Knob', 790, 914, 258, 18, 18, { ...alu, depth: 8 })
  attach(lcd, 'ledBulb', 'Status LED Bulb', 640, 916, 258, 12, 12, { depth: 10, boundComponent: status.name })
  const pad = (control: CircuitComponentData, x: number, y: number, color: string) => {
    const p2 = attach(lcd, 'switchPad', `${control.name} Pad`, x, y, 262, 42, 15, { material: 'plastic', color, depth: 10, boundComponent: control.name })
    control.props.bindHardware = p2.name
  }
  pad(xAxis.pos, 660, 862, '#3f7fbf')
  pad(xAxis.neg, 660, 884, '#3f7fbf')
  pad(zLift.pos, 710, 862, '#37b26c')
  pad(zLift.neg, 710, 884, '#37b26c')
  pad(master, 762, 862, '#e0662f')
  pad(lights, 762, 884, '#e2a849')
  for (const [i, lamp] of frameLamps.entries()) {
    attach(base, 'ledBulb', `${lamp.name} Bulb`, 640 + i * 240, 566, 0, 44, 16, { depth: 16, boundComponent: lamp.name })
  }

  return pb.build()
}
