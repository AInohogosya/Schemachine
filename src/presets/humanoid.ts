import type { CircuitComponentData, HardwarePartData, HardwarePartType, HardwareProps, ProjectData } from '../types'
import { PB } from './helpers'

// ============================================================================
// Bipedal Humanoid Robot — a free-standing android with servo hip, knee,
// shoulder and neck joints. Every joint anchors at the rotor's own center,
// so the proven velocity-servo path drives it. Keys pose and shuffle-walk
// the robot; eyes, chest light and beacon follow the lighting switch.
// ============================================================================

export function buildBipedalHumanoid(): ProjectData {
  const pb = new PB('Bipedal Humanoid Robot', 1000)
  const supply = pb.c('battery', 'Servo Battery', 100, 100, { voltage: 12, maxCurrent: 6 })
  const ground = pb.c('ground', 'Robot Ground', 100, 220)
  const fuse = pb.c('fuse', 'Servo Bus Fuse', 260, 100, { maxCurrent: 5 })
  const master = pb.c('switchSlide', 'Robot Power', 420, 100, { key: 'KeyI', closed: true })
  pb.w(supply, '-', ground, 'G')
  pb.w(supply, '+', fuse, 'A')
  pb.w(fuse, 'B', master, 'A')

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
  const leftHip = bipolar('Left Hip', 340, ['ArrowDown', 'ArrowUp'], 'Left Hip Motor', 26, 'Left Hip Sweep Back', 'Left Hip Sweep Forward')
  const rightHip = bipolar('Right Hip', 620, ['KeyS', 'KeyW'], 'Right Hip Motor', 26, 'Right Hip Sweep Back', 'Right Hip Sweep Forward')
  const leftKnee = bipolar('Left Knee', 900, ['KeyQ', 'KeyA'], 'Left Knee Motor', 24, 'Left Knee Bend', 'Left Knee Extend')
  const rightKnee = bipolar('Right Knee', 1180, ['KeyE', 'KeyD'], 'Right Knee Motor', 24, 'Right Knee Bend', 'Right Knee Extend')
  const arms = bipolar('Shoulders', 1460, ['KeyR', 'KeyF'], 'Shoulder Motor', 30, 'Arms Swing Back', 'Arms Swing Forward')
  const headDrive = bipolar('Neck', 1740, ['KeyT', 'KeyG'], 'Head Nod Motor', 36, 'Head Nod Down', 'Head Nod Up')
  const drives = [leftHip, rightHip, leftKnee, rightKnee, arms, headDrive]

  const lights = pb.c('switchSlide', 'Robot Lights', 820, 100, { key: 'KeyH', closed: true })
  pb.w(master, 'B', lights, 'A')
  const lamps: CircuitComponentData[] = []
  for (const [name, color, y] of [['Eye Left', 'white', 300], ['Eye Right', 'white', 440], ['Chest Light', 'blue', 580], ['Status Beacon', 'green', 720]] as const) {
    const r = pb.c('resistor', `${name} Ballast`, 820, y, { resistance: 680 })
    const led = pb.c('led', name, 1000, y, { forwardVoltage: 2.2, color })
    pb.w(lights, 'B', r, 'A')
    pb.w(r, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
    lamps.push(led)
  }

  const armor: HardwareProps = { material: 'steel', color: '#7f8b99', depth: 12 }
  const shell: HardwareProps = { material: 'plastic', color: '#dfe4ea', depth: 10 }
  const accent: HardwareProps = { material: 'plastic', color: '#e0662f', depth: 8 }
  const dark: HardwareProps = { material: 'plastic', color: '#2a3138', depth: 10 }
  const joint: HardwareProps = { material: 'steel', color: '#59636e', depth: 10 }
  const p = (kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = armor, angle = 0) => {
    const part = pb.p(kind, name, x, y, w, h, props, angle)
    part.z = z
    return part
  }
  const attach = (parent: HardwarePartData, kind: HardwarePartType, name: string, x: number, y: number, z: number, w: number, h: number, props: HardwareProps = armor, angle = 0) => {
    const part = p(kind, name, x, y, z, w, h, props, angle)
    pb.weld(parent, part)
    return part
  }

  // ---- pelvis + torso (one welded body) ----
  const pelvis = p('block', 'Pelvis Frame', 620, 630, 0, 124, 44, { ...shell, depth: 168 })
  attach(pelvis, 'board', 'Waist Ring Front', 620, 606, 0, 96, 14, accent)
  attach(pelvis, 'board', 'Waist Ring Back', 620, 654, 0, 96, 14, dark)
  attach(pelvis, 'batteryPack', 'Hip Battery Pack', 566, 630, 0, 34, 30, { ...dark, depth: 60, boundComponent: supply.name })
  const spine = attach(pelvis, 'block', 'Spine Column', 620, 594, 0, 62, 32, { ...dark, depth: 104 })
  const chest = attach(spine, 'block', 'Chest Core', 620, 520, 0, 152, 122, { ...shell, depth: 152 })
  attach(chest, 'board', 'Chest Plate', 690, 520, 0, 10, 108, { ...armor, depth: 136 })
  for (let i = 0; i < 4; i++) {
    attach(chest, 'board', `Chest Rib ${i + 1}`, 694, 480 + i * 26, 0, 6, 5, { ...accent, depth: 90 })
  }
  for (let i = 0; i < 3; i++) {
    attach(chest, 'board', `Spine Fin ${i + 1}`, 548, 470 + i * 34, 0, 12, 8, { ...dark, depth: 96 })
  }
  attach(chest, 'board', 'Collar Guard', 630, 456, 0, 84, 12, { ...accent, depth: 130 })
  attach(chest, 'ledBulb', 'Chest Light Bulb', 694, 560, 0, 16, 20, { depth: 14, boundComponent: 'Chest Light' })
  attach(chest, 'ledBulb', 'Status Beacon Bulb', 552, 484, 0, 14, 14, { depth: 12, boundComponent: 'Status Beacon' })
  for (let i = 0; i < 4; i++) {
    attach(chest, 'axle', `Chest Bolt ${i + 1}`, 694, 474 + i * 32, 0, 8, 8, { material: 'steel', color: '#c2cad2', depth: 8 })
  }
  const masterPad = attach(chest, 'switchPad', 'Robot Power Pad', 694, 600, 0, 40, 20, { ...accent, depth: 14, boundComponent: master.name })
  master.props.bindHardware = masterPad.name
  const lightPad = attach(chest, 'switchPad', 'Robot Lights Pad', 694, 600, 60, 40, 20, { ...accent, depth: 14, boundComponent: lights.name })
  lights.props.bindHardware = lightPad.name

  // ---- backpack control console ----
  const pack = attach(chest, 'block', 'Control Backpack', 556, 530, 0, 46, 100, { ...dark, depth: 148 })
  for (let i = 0; i < 4; i++) {
    attach(pack, 'board', `Backpack Fin ${i + 1}`, 532, 500 + i * 22, 0, 8, 10, { ...joint, depth: 120 })
  }
  for (const z of [-52, 52]) {
    attach(pack, 'board', `Backpack Vent ${z}`, 532, 570, z, 10, 20, { ...joint, depth: 8 })
  }
  const padControls = drives.flatMap((d) => [d.pos, d.neg])
  padControls.forEach((control, i) => {
    const p2 = attach(pack, 'switchPad', `${control.name} Pad`, 531, 496 + (i % 3) * 32, -48 + Math.floor(i / 3) * 32, 34, 18, {
      ...accent, depth: 12, boundComponent: control.name,
    })
    control.props.bindHardware = p2.name
  })

  // ---- head (nod joint about its own center) ----
  const neck = attach(chest, 'block', 'Neck Yoke', 632, 450, 0, 28, 22, { ...joint, depth: 64 })
  const head = p('block', 'Head Shell', 640, 408, 0, 92, 72, { ...shell, depth: 112 })
  pb.j('motor', chest, head, 20, -112, 0, 0, { boundComponent: 'Head Nod Motor', kv: 1 / 36, maxAccel: 26, minAngle: -24, maxAngle: 24 })
  attach(head, 'board', 'Face Plate', 686, 408, 0, 10, 56, { ...armor, depth: 100 })
  attach(head, 'ledBulb', 'Eye Left Bulb', 686, 396, -28, 11, 13, { depth: 12, boundComponent: 'Eye Left' })
  attach(head, 'ledBulb', 'Eye Right Bulb', 686, 396, 28, 11, 13, { depth: 12, boundComponent: 'Eye Right' })
  attach(head, 'block', 'Chin Vent', 686, 436, 0, 8, 14, dark)
  for (const [side, z] of [['Left', -58], ['Right', 58]] as const) {
    attach(head, 'block', `${side} Ear Pod`, 632, 408, z, 22, 30, { ...accent, depth: 16 })
    attach(head, 'board', `${side} Antenna`, 612, 360, z * 0.6, 8, 42, { ...joint, depth: 8 }, 8)
  }
  attach(head, 'board', 'Crest Fin', 622, 370, 0, 30, 8, accent)

  // ---- arms (one motor swings both shoulders in sync) ----
  for (const [side, z] of [['Left', -86], ['Right', 86]] as const) {
    const shoulderStator = attach(chest, 'block', `${side} Shoulder Stator`, 600, 482, z, 26, 26, { ...joint, depth: 26 })
    const rotor = p('axle', `${side} Shoulder Rotor`, 600, 482, z, 20, 20, { ...joint, depth: 30 })
    pb.j('motor', shoulderStator, rotor, 0, 0, 0, 0, { boundComponent: arms.motor.name, kv: 1 / 30, maxAccel: 18, minAngle: -70, maxAngle: 70 })
    attach(rotor, 'block', `${side} Shoulder Pad`, 600, 470, z, 52, 26, { ...accent, depth: 56 })
    for (const dz of [-20, 20]) {
      attach(chest, 'board', `${side} Shoulder Strut ${dz}`, 586, 496, z + dz, 24, 10, { ...joint, depth: 8 }, 24)
    }
    const upper = attach(rotor, 'board', `${side} Upper Arm`, 602, 428, z, 24, 96, shell)
    attach(upper, 'board', `${side} Elbow Cap`, 602, 384, z, 30, 18, { ...joint, depth: 40 })
    attach(upper, 'board', `${side} Forearm`, 612, 336, z, 22, 84, { ...armor, depth: 44 })
    attach(upper, 'block', `${side} Fist`, 618, 292, z, 26, 26, { ...dark, depth: 46 })
  }

  // ---- calibration cradle (static): a slim center post carries the pelvis
  // between two clamp pads, so the android cannot topple while its servo
  // joints are exercised. Everything stays clear of the swinging legs. ----
  const post = p('board', 'Cradle Post', 620, 827, 0, 36, 346, { ...dark, isStatic: true, depth: 22 })
  attach(post, 'block', 'Cradle Foot Pad', 620, 995, 0, 44, 10, { material: 'rubber', color: '#15181d', depth: 30 })
  attach(post, 'board', 'Cradle Bridge', 620, 661, 0, 170, 10, { ...joint, depth: 22 })
  attach(post, 'block', 'Cradle Front Clamp', 690, 630, 0, 14, 60, { ...accent, depth: 176 })
  attach(post, 'block', 'Cradle Rear Clamp', 550, 630, 0, 14, 60, { ...accent, depth: 176 })

  // ---- legs: hip rotor -> thigh; knee rotor -> shin/foot ----
  for (const [side, z] of [['Left', -60], ['Right', 60]] as const) {
    const hipStator = attach(pelvis, 'block', `${side} Hip Stator`, 610, 650, z, 28, 28, { ...joint, depth: 40 })
    const hipRotor = p('axle', `${side} Hip Rotor`, 610, 650, z, 22, 22, { ...joint, depth: 46 })
    pb.j('motor', hipStator, hipRotor, 0, 0, 0, 0, { boundComponent: `${side === 'Left' ? 'Left' : 'Right'} Hip Motor`, kv: 1 / 26, maxAccel: 18, minAngle: -45, maxAngle: 45 })
    attach(pelvis, 'block', `${side} Hip Pod`, 612, 648, z * 1.75, 56, 40, { ...shell, depth: 26 })
    for (const dz of [-16, 16]) {
      attach(pelvis, 'axle', `${side} Hip Bolt ${dz}`, 612, 648, z * 1.75 + dz, 7, 7, { material: 'steel', color: '#c2cad2', depth: 7 })
    }
    const thigh = attach(hipRotor, 'board', `${side} Thigh`, 610, 726, z, 26, 146, { ...armor, depth: 46 })
    attach(thigh, 'board', `${side} Thigh Piston`, 590, 726, z, 10, 120, { ...joint, depth: 12 })
    attach(thigh, 'block', `${side} Thigh Piston Rod`, 582, 700, z, 8, 24, { material: 'steel', color: '#c2cad2', depth: 8 })
    const kneeRotor = p('axle', `${side} Knee Rotor`, 610, 810, z, 20, 20, { ...joint, depth: 40 })
    pb.j('motor', thigh, kneeRotor, 0, 84, 0, 0, { boundComponent: `${side === 'Left' ? 'Left' : 'Right'} Knee Motor`, kv: 1 / 24, maxAccel: 18, minAngle: -10, maxAngle: 88 })
    attach(kneeRotor, 'block', `${side} Knee Cap`, 610, 810, z, 40, 34, { ...accent, depth: 56 })
    attach(kneeRotor, 'board', `${side} Knee Hose`, 590, 830, z, 8, 34, { ...dark, depth: 6 }, -12)
    const shin = attach(kneeRotor, 'board', `${side} Shin`, 610, 888, z, 24, 146, { ...shell, depth: 44 })
    attach(shin, 'board', `${side} Shin Guard`, 622, 888, z, 8, 120, { ...armor, depth: 34 })
    attach(shin, 'board', `${side} Shin Stripe`, 616, 900, z * 0.6, 5, 80, { ...accent, depth: 5 })
    attach(shin, 'block', `${side} Calf Vent`, 596, 866, z, 12, 40, dark)
    attach(shin, 'block', `${side} Ankle Guard`, 606, 964, z, 40, 22, { ...joint, depth: 52 })
    const sole = attach(shin, 'board', `${side} Foot Sole`, 620, 979, z, 156, 14, { material: 'steel', color: '#3a424c', depth: 92 })
    attach(sole, 'board', `${side} Toe Cap`, 692, 981, z, 22, 8, { ...accent, depth: 92 })
    attach(sole, 'block', `${side} Heel Bumper`, 552, 981, z, 20, 8, dark)
  }

  return pb.build()
}
