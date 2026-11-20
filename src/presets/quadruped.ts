import type { CircuitComponentData, HardwarePartData, HardwarePartType, HardwareProps, ProjectData } from '../types'
import { PB } from './helpers'

// ============================================================================
// Quadruped Robot Hound — a four-legged walker with servo hips and knees on
// every leg, an elevating camera head and a wagging tail. Front hips (W/S),
// rear hips (E/D), knees (Q/A), neck (R/F), tail (T/G). I power, H beacon.
// ============================================================================

export function buildQuadrupedHound(): ProjectData {
  const pb = new PB('Quadruped Robot Hound', 1000)
  const supply = pb.c('battery', 'Hound Battery', 100, 100, { voltage: 12, maxCurrent: 6 })
  const ground = pb.c('ground', 'Hound Ground', 100, 220)
  const bus = pb.c('fuse', 'Servo Bus Fuse', 260, 100, { maxCurrent: 5 })
  const master = pb.c('switchSlide', 'Robot Power', 420, 100, { key: 'KeyI', closed: true })
  pb.w(supply, '-', ground, 'G')
  pb.w(supply, '+', bus, 'A')
  pb.w(bus, 'B', master, 'A')

  const bipolar = (label: string, y: number, keys: [string, string], motorName: string, ke: number, posLabel: string, negLabel: string) => {
    const branch = pb.c('fuse', `${label} Branch Fuse`, 100, y, { maxCurrent: 1.5 })
    const pos = pb.c('switchPush', posLabel, 260, y, { key: keys[0], closed: false })
    const neg = pb.c('switchPush', negLabel, 260, y + 140, { key: keys[1], closed: false })
    const motor = pb.c('motor', motorName, 440, y, { resistance: 14, ke, kv: 1 / ke, maxCurrent: 1.2 })
    const rp = pb.c('resistor', `${label} Positive Return`, 620, y, { resistance: 33 })
    const rn = pb.c('resistor', `${label} Negative Return`, 620, y + 140, { resistance: 33 })
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
  const frontHips = bipolar('Front Hips', 340, ['KeyS', 'KeyW'], 'Front Hip Motor', 24, 'Front Hips Back', 'Front Hips Forward')
  const rearHips = bipolar('Rear Hips', 620, ['KeyD', 'KeyE'], 'Rear Hip Motor', 24, 'Rear Hips Back', 'Rear Hips Forward')
  const knees = bipolar('Knees', 900, ['KeyQ', 'KeyA'], 'Knee Motor', 22, 'Knees Bend', 'Knees Extend')
  const neck = bipolar('Neck', 1180, ['KeyF', 'KeyR'], 'Neck Motor', 32, 'Neck Down', 'Neck Up')
  const tail = bipolar('Tail', 1460, ['KeyT', 'KeyG'], 'Tail Motor', 34, 'Tail Raise', 'Tail Lower')
  const drives = [frontHips, rearHips, knees, neck, tail]

  const lights = pb.c('switchSlide', 'Hound Beacon', 820, 100, { key: 'KeyH', closed: true })
  pb.w(master, 'B', lights, 'A')
  for (const [name, color, y] of [['Head Beacon', 'green', 300], ['Camera Illuminator', 'white', 440], ['Tail Marker', 'red', 580]] as const) {
    const r = pb.c('resistor', `${name} Ballast`, 820, y, { resistance: 680 })
    const led = pb.c('led', name, 1000, y, { forwardVoltage: 2.2, color })
    pb.w(lights, 'B', r, 'A')
    pb.w(r, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
  }

  const shell: HardwareProps = { material: 'plastic', color: '#e8e3d8', depth: 10 }
  const accent: HardwareProps = { material: 'plastic', color: '#d8862b', depth: 8 }
  const dark: HardwareProps = { material: 'plastic', color: '#262b31', depth: 10 }
  const joint: HardwareProps = { material: 'steel', color: '#59636e', depth: 10 }
  const rubber: HardwareProps = { material: 'rubber', color: '#23282e', depth: 10 }
  const p = (kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = shell, angle = 0) => {
    const part = pb.p(kind, name, x, y, w, h, props, angle)
    part.z = z
    return part
  }
  const attach = (parent: HardwarePartData, kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = shell, angle = 0) => {
    const part = p(kind, name, x, y, z, w, h, props, angle)
    pb.weld(parent, part)
    return part
  }

  // ---- chassis ----
  const chassis = p('block', 'Hound Chassis', 760, 780, 0, 340, 60, { ...shell, depth: 150 })
  attach(chassis, 'board', 'Spine Plate', 760, 748, 0, 320, 10, accent)
  for (const [side, z] of [['Left', -76], ['Right', 76]] as const) {
    attach(chassis, 'board', `${side} Flank Panel`, 760, 780, z, 330, 54, { ...dark, depth: 8 })
    for (let i = 0; i < 5; i++) {
      attach(chassis, 'board', `${side} Vent Slat ${i + 1}`, 660 + i * 40, 762, z + Math.sign(z) * 6, 26, 5, { ...joint, depth: 5 })
    }
  }
  for (let i = 0; i < 4; i++) {
    attach(chassis, 'board', `Chassis Rib ${i + 1}`, 640 + i * 80, 806, 0, 12, 8, { ...joint, depth: 136 })
  }
  attach(chassis, 'block', 'Belly Tray', 760, 816, 0, 260, 12, { ...dark, depth: 120 })
  for (const z of [-60, 60]) {
    attach(chassis, 'board', `Belly Vent ${z}`, 760, 816, z * 1.4, 40, 6, { ...joint, depth: 6 })
  }
  attach(chassis, 'batteryPack', 'Belly Battery Pack', 730, 826, 0, 64, 18, { ...dark, depth: 90, boundComponent: supply.name })
  attach(chassis, 'board', 'Antenna Mast', 916, 722, -50, 8, 52, joint)
  attach(chassis, 'axle', 'Antenna Bead', 916, 694, -50, 10, 10, { ...accent, depth: 8 })
  const console_ = attach(chassis, 'block', 'Spine Console', 800, 736, 20, 120, 14, dark)
  const padControls = drives.flatMap((d) => [d.pos, d.neg])
  padControls.forEach((control, i) => {
    const pad = attach(console_, 'switchPad', `${control.name} Pad`, 768 + (i % 5) * 26, 726, -18 + Math.floor(i / 5) * 36, 22, 16, {
      ...accent, depth: 12, boundComponent: control.name,
    })
    control.props.bindHardware = pad.name
  })
  const masterPad = attach(console_, 'switchPad', 'Robot Power Pad', 856, 726, 18, 22, 16, { ...accent, depth: 12, boundComponent: master.name })
  master.props.bindHardware = masterPad.name
  const lightPad = attach(console_, 'switchPad', 'Hound Beacon Pad', 856, 726, -18, 22, 16, { ...accent, depth: 12, boundComponent: lights.name })
  lights.props.bindHardware = lightPad.name

  // ---- service cradle (static): a slim center post carries the belly
  // between two clamp pads, so the hound stays planted while its legs,
  // neck and tail are exercised. Everything clears the swinging legs. ----
  const post = p('board', 'Cradle Post', 760, 911, 0, 36, 178, { ...dark, isStatic: true, depth: 22 })
  attach(post, 'block', 'Cradle Foot Pad', 760, 995, 0, 44, 10, { material: 'rubber', color: '#15181d', depth: 30 })
  attach(post, 'board', 'Cradle Bridge', 760, 828, 0, 380, 10, { ...joint, depth: 22 })
  attach(post, 'block', 'Cradle Front Clamp', 941, 789, 0, 14, 74, { ...accent, depth: 170 })
  attach(post, 'block', 'Cradle Rear Clamp', 579, 789, 0, 14, 74, { ...accent, depth: 170 })

  // ---- legs: hip rotor -> thigh; knee rotor -> shin/paw ----
  for (const [position, x] of [['Front', 880], ['Rear', 640]] as const) {
    for (const [side, z] of [['Left', -95], ['Right', 95]] as const) {
      const hipStator = attach(chassis, 'block', `${position} ${side} Hip Yoke`, x, 806, z, 28, 28, { ...joint, depth: 38 })
      const hip = p('axle', `${position} ${side} Hip Rotor`, x, 806, z, 22, 22, { ...joint, depth: 42 })
      pb.j('motor', hipStator, hip, 0, 0, 0, 0, {
        boundComponent: position === 'Front' ? 'Front Hip Motor' : 'Rear Hip Motor',
        kv: 1 / 24, maxAccel: 16, minAngle: -35, maxAngle: 35,
      })
      attach(chassis, 'block', `${position} ${side} Hip Cowl`, x, 806, z * 1.6, 52, 44, { ...shell, depth: 22 })
      for (const dz of [-14, 14]) {
        attach(chassis, 'axle', `${position} ${side} Hip Bolt ${dz}`, x, 806, z * 1.6 + dz, 7, 7, { material: 'steel', color: '#c2cad2', depth: 7 })
      }
      const thigh = attach(hip, 'board', `${position} ${side} Thigh`, x - 6, 862, z, 24, 106, { ...dark, depth: 40 })
      attach(thigh, 'board', `${position} ${side} Thigh Piston`, x - 20, 862, z, 8, 88, { ...joint, depth: 10 })
      const knee = p('axle', `${position} ${side} Knee Rotor`, x, 920, z, 18, 18, { ...joint, depth: 36 })
      pb.j('motor', thigh, knee, 6, 58, 0, 0, {
        boundComponent: 'Knee Motor', kv: 1 / 22, maxAccel: 16, minAngle: -10, maxAngle: 75,
      })
      attach(knee, 'block', `${position} ${side} Knee Cap`, x, 920, z, 34, 28, { ...accent, depth: 48 })
      const shin = attach(knee, 'board', `${position} ${side} Shin`, x + 10, 958, z, 20, 72, { ...shell, depth: 36 })
      attach(shin, 'board', `${position} ${side} Shin Guard`, x + 20, 958, z, 6, 60, { ...dark, depth: 28 })
      const paw = attach(shin, 'board', `${position} ${side} Paw`, x + 16, 983, z, 74, 10, { material: 'steel', color: '#3a424c', depth: 50 })
      attach(paw, 'board', `${position} ${side} Toe Pad`, x + 48, 978, z, 16, 6, accent)
    }
  }

  // ---- head (elevation joint about its own center) ----
  attach(chassis, 'block', 'Neck Yoke', 928, 748, 0, 34, 28, { ...joint, depth: 70 })
  const head = p('block', 'Hound Head', 992, 718, 0, 112, 64, { ...shell, depth: 112 })
  pb.j('motor', chassis, head, 232, -62, 0, 0, { boundComponent: 'Neck Motor', kv: 1 / 32, maxAccel: 16, minAngle: -28, maxAngle: 28 })
  attach(head, 'block', 'Hound Snout', 1052, 728, 0, 34, 24, { ...dark, depth: 60 })
  attach(head, 'block', 'Snout Nose', 1070, 722, 0, 10, 10, { ...dark, depth: 24 })
  attach(head, 'board', 'Jaw Plate', 1052, 744, 0, 30, 6, { ...accent, depth: 54 })
  attach(head, 'board', 'Camera Visor', 1044, 706, 0, 8, 22, { material: 'acrylic', color: '#72cce8', depth: 70 })
  attach(head, 'board', 'Camera Iris Ring', 1040, 706, 0, 4, 26, { ...joint, depth: 74 })
  attach(head, 'ledBulb', 'Camera Illuminator Bulb', 1044, 690, 0, 12, 12, { depth: 10, boundComponent: 'Camera Illuminator' })
  attach(head, 'ledBulb', 'Head Beacon Bulb', 962, 684, 0, 14, 14, { depth: 12, boundComponent: 'Head Beacon' })
  attach(head, 'board', 'Head Crest', 962, 684, 0, 40, 5, accent)
  for (const [side, z] of [['Left', -56], ['Right', 56]] as const) {
    attach(head, 'board', `${side} Ear Fin`, 976, 682, z, 10, 34, { ...accent, depth: 8 }, -10)
    attach(head, 'board', `${side} Cheek Panel`, 992, 718, z * 1.02, 96, 58, { ...dark, depth: 6 })
  }

  // ---- tail (wag joint about its own center) ----
  const tailBase = p('block', 'Tail Base', 566, 762, 0, 44, 24, { ...joint, depth: 60 })
  pb.j('motor', chassis, tailBase, -194, -18, 0, 0, { boundComponent: 'Tail Motor', kv: 1 / 34, maxAccel: 16, minAngle: -40, maxAngle: 40 })
  attach(tailBase, 'board', 'Tail Segment 1', 536, 748, 0, 40, 14, { ...dark, depth: 36 }, -18)
  attach(tailBase, 'board', 'Tail Segment 2', 508, 730, 0, 34, 12, { ...dark, depth: 30 }, -34)
  attach(tailBase, 'ledBulb', 'Tail Marker Bulb', 494, 724, 0, 12, 12, { depth: 10, boundComponent: 'Tail Marker' })

  return pb.build()
}
