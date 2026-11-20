import type { CircuitComponentData, HardwarePartData, HardwarePartType, HardwareProps, ProjectData } from '../types'
import { PB } from './helpers'

// ============================================================================
// RGB Gaming Rig — a full battlestation: desk, static tower with spinning
// radiator + GPU fans (vertical-axis rotors on the fixed chassis), RGB
// lighting, monitor, keyboard, mouse, speakers and a desk lamp.
// ============================================================================

export function buildGamingRig(): ProjectData {
  const pb = new PB('RGB Gaming Rig', 1000)
  const supply = pb.c('battery', 'PSU 12V Rail', 100, 120, { voltage: 12, maxCurrent: 6 })
  const ground = pb.c('ground', 'PSU Ground', 100, 260)
  const fuse = pb.c('fuse', 'PSU Main Fuse', 260, 120, { maxCurrent: 5 })
  const master = pb.c('switchSlide', 'Power Switch', 420, 120, { key: 'KeyP', closed: true })
  pb.w(supply, '-', ground, 'G')
  pb.w(supply, '+', fuse, 'A')
  pb.w(fuse, 'B', master, 'A')

  const radiatorFan = pb.c('fan', 'Radiator Fan', 620, 120, { resistance: 12, ke: 2.5, maxCurrent: 1 })
  const gpuFan = pb.c('fan', 'GPU Fan', 620, 260, { resistance: 12, ke: 2.5, maxCurrent: 1 })
  for (const fan of [radiatorFan, gpuFan]) {
    pb.w(master, 'B', fan, '+')
    pb.w(fan, '-', ground, 'G')
  }
  const lampSwitch = pb.c('switchSlide', 'Lamp Switch', 820, 120, { key: 'KeyL', closed: true })
  pb.w(master, 'B', lampSwitch, 'A')
  const lampR = pb.c('resistor', 'Lamp Ballast', 980, 120, { resistance: 330 })
  const lamp = pb.c('led', 'Desk Lamp', 1120, 120, { forwardVoltage: 3, color: 'white' })
  pb.w(lampSwitch, 'B', lampR, 'A')
  pb.w(lampR, 'B', lamp, 'A')
  pb.w(lamp, 'K', ground, 'G')
  const strips: CircuitComponentData[] = []
  for (const [name, color, y] of [['RGB Strip Red', 'red', 300], ['RGB Strip Green', 'green', 420], ['RGB Strip Blue', 'blue', 540]] as const) {
    const r = pb.c('resistor', `${name} Ballast`, 980, y, { resistance: 470 })
    const led = pb.c('led', name, 1120, y, { forwardVoltage: 2, color })
    pb.w(master, 'B', r, 'A')
    pb.w(r, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
    strips.push(led)
  }
  const powerR = pb.c('resistor', 'Power LED Ballast', 980, 660, { resistance: 470 })
  const powerLed = pb.c('led', 'Power LED', 1120, 660, { forwardVoltage: 2.2, color: 'green' })
  pb.w(master, 'B', powerR, 'A')
  pb.w(powerR, 'B', powerLed, 'A')
  pb.w(powerLed, 'K', ground, 'G')
  const monitorLed = pb.c('led', 'Monitor LED', 1120, 780, { forwardVoltage: 2, color: 'white' })
  const monitorBallast = pb.c('resistor', 'Monitor LED Ballast', 980, 780, { resistance: 470 })
  pb.w(master, 'B', monitorBallast, 'A')
  pb.w(monitorBallast, 'B', monitorLed, 'A')
  pb.w(monitorLed, 'K', ground, 'G')

  const steel: HardwareProps = { material: 'steel', color: '#3c4650', depth: 12 }
  const shell: HardwareProps = { material: 'steel', color: '#1d232b', depth: 10 }
  const glass: HardwareProps = { material: 'acrylic', color: '#9fb6c4', depth: 4 }
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
  // Vertical-axis fan (legal because the tower is a fixed body). A stator
  // bracket at the hub's own z keeps the motor-joint anchors z-coincident,
  // and the blades come in two tiers so depth stations stay separated.
  const fanY = (parent: HardwarePartData, name: string, x: number, y: number, z: number, radius: number, motor: string) => {
    const stator = attach(parent, 'block', `${name} Stator`, x, y, z, 24, 24, { ...dark, depth: 14 })
    const hub = p('block', `${name} Hub`, x, y, z, 20, 20, { ...dark, depth: 20 })
    pb.j('motor', stator, hub, 0, 0, 0, 0, { boundComponent: motor, kv: 1 / 2.5, maxAccel: 16 })
    for (const [i, [dx, dz, w, d, bz]] of [
      [1, 0, radius * 2, 10, z - (radius + 10)], [0, 1, 10, radius * 2, z],
      [-1, 0, radius * 2, 10, z - (radius + 10)], [0, -1, 10, radius * 2, z],
    ].entries()) {
      attach(hub, 'board', `${name} Blade ${i + 1}`, x + dx * (radius * 0.62), y, bz, w, 5, { ...dark, color: '#2b323a', depth: d })
    }
    return hub
  }
  const dark: HardwareProps = { material: 'plastic', color: '#14181e', depth: 10 }

  // Desk (static).
  const desk = p('board', 'Desk Top', 700, 890, 0, 1280, 16, { material: 'wood', color: '#7c5a38', depth: 460, isStatic: true })
  for (const x of [130, 1270]) for (const z of [-200, 200]) {
    attach(desk, 'board', `Desk Leg ${x} ${z}`, x, 949, z, 30, 102, { ...steel, color: '#242a31', depth: 30 })
    attach(desk, 'block', `Desk Foot ${x} ${z}`, x, 1002, z, 44, 8, { material: 'rubber', color: '#15181d', depth: 44 })
  }
  attach(desk, 'board', 'Desk Modesty Panel', 700, 946, 0, 1200, 40, { ...shell, depth: 8 })

  // ---- Tower (entirely static so its vertical-axis fans are legal) ----
  const tower = p('block', 'Tower Frame', 1150, 757, 0, 108, 250, { ...shell, isStatic: true, depth: 190 })
  attach(tower, 'board', 'Tower Left Panel', 1150, 757, -98, 108, 250, shell)
  attach(tower, 'board', 'Tower Glass Panel', 1150, 757, 98, 108, 250, { ...glass, depth: 4 })
  attach(tower, 'board', 'Tower Top Panel', 1150, 634, 0, 108, 6, { ...shell, depth: 196 })
  attach(tower, 'board', 'Tower Bottom Panel', 1150, 880, 0, 108, 6, { ...shell, depth: 196 })
  attach(tower, 'board', 'Tower Front Panel', 1206, 757, 0, 8, 250, { ...shell, depth: 196 })
  attach(tower, 'board', 'Tower Rear Panel', 1094, 757, 0, 8, 250, { ...shell, depth: 196 })
  for (let i = 0; i < 5; i++) {
    attach(tower, 'board', `Front Vent Slats ${i + 1}`, 1201, 680 + i * 12, 0, 6, 5, { ...dark, depth: 120 })
  }
  attach(tower, 'board', 'Motherboard Tray', 1176, 742, 42, 6, 214, { ...shell, depth: 140 })
  const mb = attach(tower, 'board', 'Motherboard PCB', 1170, 742, 40, 6, 206, { material: 'plastic', color: '#0e5c3f', depth: 132 })
  for (let i = 0; i < 4; i++) {
    attach(mb, 'board', `RAM Stick ${i + 1}`, 1166, 700 + i * 9, -20 + i * 14, 10, 120, { material: 'plastic', color: '#173a2b', depth: 10 })
  }
  attach(mb, 'block', 'CPU Cooler Block', 1166, 800, 10, 26, 26, { ...steel, color: '#c8ccd2', depth: 34 })
  const gpu = attach(tower, 'board', 'GPU Card', 1162, 798, -20, 8, 42, { material: 'plastic', color: '#1b2430', depth: 150 })
  attach(gpu, 'block', 'GPU Shroud', 1162, 824, -20, 36, 14, { ...dark, depth: 150 })
  fanY(gpu, 'GPU Fan A', 1162, 838, -52, 26, gpuFan.name)
  fanY(gpu, 'GPU Fan B', 1162, 838, 12, 26, gpuFan.name)
  attach(gpu, 'board', 'GPU Backplate', 1158, 798, -20, 4, 42, { ...steel, color: '#59636e', depth: 150 })
  const radiatorCore = attach(tower, 'block', 'Radiator Core', 1150, 648, 0, 96, 16, { ...steel, color: '#8d97a2', depth: 186 })
  for (let i = 0; i < 9; i++) {
    attach(radiatorCore, 'board', `Radiator Fin ${i + 1}`, 1110 + i * 10, 648, 0, 5, 12, { ...steel, color: '#a7b1bb', depth: 180 })
  }
  fanY(tower, 'Radiator A', 1150, 672, -62, 30, radiatorFan.name)
  fanY(tower, 'Radiator B', 1150, 672, 0, 30, radiatorFan.name)
  fanY(tower, 'Radiator C', 1150, 672, 62, 30, radiatorFan.name)
  for (const z of [-60, 60]) {
    attach(tower, 'board', `Coolant Tube ${z}`, 1114, 690, z * 0.6, 10, 60, { material: 'rubber', color: '#23282e', depth: 10 }, 18)
  }
  attach(tower, 'block', 'PSU Shroud', 1150, 856, 0, 104, 14, { ...shell, depth: 192 })
  attach(tower, 'batteryPack', 'PSU Module', 1150, 866, -50, 58, 22, { ...dark, depth: 84, boundComponent: supply.name })
  for (const [i, z] of [[1, -40], [2, 0], [3, 40]] as const) {
    attach(tower, 'board', `Sleeved Cable ${i}`, 1108, 820, z, 8, 70, { material: 'rubber', color: ['#7a1f1f', '#1f3a7a', '#1f5a2a'][i - 1], depth: 8 }, 12)
  }
  for (const [i, y] of [[1, 690], [2, 730], [3, 770]] as const) {
    attach(tower, 'ledBulb', `Front RGB Bulb ${i}`, 1201, y, 0, 12, 22, { depth: 14, boundComponent: strips[i - 1].name })
  }
  attach(tower, 'ledBulb', 'Power LED Bulb', 1201, 640, 84, 10, 10, { depth: 10, boundComponent: powerLed.name })
  const powerPad = attach(tower, 'switchPad', 'Power Switch Pad', 1180, 626, 70, 44, 14, { material: 'plastic', color: '#37b26c', depth: 18, boundComponent: master.name })
  master.props.bindHardware = powerPad.name

  // ---- Monitor, peripherals, lamp, speakers, mug ----
  attach(desk, 'block', 'Monitor Base', 330, 876, 0, 170, 10, { ...dark, depth: 130 })
  attach(desk, 'board', 'Monitor Pole', 330, 828, 0, 16, 84, { ...steel, color: '#2b323a', depth: 34 })
  const screen = attach(desk, 'block', 'Monitor Panel', 330, 736, 0, 270, 168, { ...dark, depth: 26 })
  attach(screen, 'board', 'Monitor Screen', 330, 736, 14, 250, 148, { material: 'acrylic', color: '#123a66', depth: 5 })
  attach(screen, 'ledBulb', 'Monitor LED Bulb', 330, 812, 15, 10, 8, { depth: 8, boundComponent: monitorLed.name })
  attach(desk, 'block', 'Keyboard Deck', 580, 877, 40, 280, 10, { ...dark, depth: 120 })
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      attach(desk, 'block', `Keycap ${row + 1} ${col + 1}`, 480 + col * 28, 869, 8 + row * 30, 24, 8, { material: 'plastic', color: '#39424d', depth: 22 })
    }
  }
  attach(desk, 'block', 'Spacebar', 604, 869, 98, 120, 8, { material: 'plastic', color: '#39424d', depth: 22 })
  attach(desk, 'block', 'Mouse Body', 800, 874, 40, 46, 16, { ...dark, depth: 70 })
  attach(desk, 'axle', 'Mouse Wheel', 800, 866, 40, 10, 10, { material: 'rubber', color: '#39424d', depth: 10 })
  attach(desk, 'board', 'Mousepad', 790, 884, 40, 220, 4, { material: 'rubber', color: '#1a2c3c', depth: 150 })
  for (const [side, z] of [['Left', -150], ['Right', 150]] as const) {
    const box = attach(desk, 'block', `${side} Speaker`, 130, 830, z, 74, 108, { ...dark, depth: 74 })
    attach(box, 'axle', `${side} Speaker Cone`, 130, 822, z + (side === 'Left' ? 34 : -34), 44, 44, { ...dark, color: '#2b323a', depth: 12 })
    attach(box, 'axle', `${side} Speaker Knob`, 130, 872, z + (side === 'Left' ? 34 : -34), 12, 12, { ...steel, color: '#c8ccd2', depth: 10 })
  }
  const lampBase = attach(desk, 'block', 'Lamp Base', 470, 878, -160, 70, 8, { ...dark, depth: 70 })
  const armA = attach(lampBase, 'board', 'Lamp Arm Lower', 470, 830, -160, 8, 94, steel)
  attach(armA, 'board', 'Lamp Arm Upper', 430, 782, -160, 74, 8, steel, -32)
  const lampHead = attach(armA, 'block', 'Lamp Head', 398, 770, -160, 56, 22, { ...dark, depth: 56 }, -12)
  attach(lampHead, 'ledBulb', 'Desk Lamp Bulb', 398, 784, -160, 30, 14, { depth: 14, boundComponent: lamp.name })
  const lampPad = attach(desk, 'switchPad', 'Lamp Switch Pad', 470, 884, -60, 44, 12, { material: 'plastic', color: '#e2a849', depth: 16, boundComponent: lampSwitch.name })
  lampSwitch.props.bindHardware = lampPad.name
  attach(desk, 'axle', 'Coffee Mug', 940, 862, 150, 38, 38, { material: 'plastic', color: '#c14a3a', depth: 38 })
  attach(desk, 'board', 'Mug Handle', 962, 862, 150, 16, 22, { material: 'plastic', color: '#c14a3a', depth: 8 })

  return pb.build()
}
