import type { CircuitComponentData, HardwarePartData, HardwarePartType, HardwareProps, ProjectData } from '../types'
import { PB } from './helpers'

// ============================================================================
// Retro Arcade Cabinet — a coin-op CRT machine: marquee lit by two bulbs,
// glowing screen, working speaker + buzzer behind the grille, physical
// button pads, coin door, and a spinning roof exhaust fan. The cabinet is
// a fixed body, so its vertical-axis fan is legal.
// ============================================================================

export function buildArcadeCabinet(): ProjectData {
  const pb = new PB('Retro Arcade Cabinet', 1000)
  const supply = pb.c('battery', 'Cabinet Power', 100, 100, { voltage: 12, maxCurrent: 5 })
  const ground = pb.c('ground', 'Cabinet Ground', 100, 220)
  const fuse = pb.c('fuse', 'Cabinet Main Fuse', 260, 100, { maxCurrent: 4 })
  const master = pb.c('switchSlide', 'Cabinet Power Switch', 420, 100, { key: 'KeyP', closed: true })
  pb.w(supply, '-', ground, 'G')
  pb.w(supply, '+', fuse, 'A')
  pb.w(fuse, 'B', master, 'A')

  const marquee = pb.c('switchSlide', 'Marquee Lights', 620, 100, { key: 'KeyL', closed: true })
  pb.w(master, 'B', marquee, 'A')
  const marqueeLamps: CircuitComponentData[] = []
  for (const [name, y] of [['Marquee Light Left', 260], ['Marquee Light Right', 400]] as const) {
    const r = pb.c('resistor', `${name} Ballast`, 620, y, { resistance: 470 })
    const led = pb.c('led', name, 800, y, { forwardVoltage: 2.2, color: 'yellow' })
    pb.w(marquee, 'B', r, 'A')
    pb.w(r, 'B', led, 'A')
    pb.w(led, 'K', ground, 'G')
    marqueeLamps.push(led)
  }

  const fire = pb.c('switchPush', 'Fire Button', 620, 560, { key: 'Space', closed: false })
  const fireR = pb.c('resistor', 'Fire Lamp Ballast', 800, 540, { resistance: 330 })
  const fireLed = pb.c('led', 'Fire LED', 960, 540, { forwardVoltage: 2, color: 'red' })
  const fireDamp = pb.c('resistor', 'Fire Speaker Damping', 800, 660, { resistance: 47 })
  const fireSpeaker = pb.c('speaker', 'Fire Speaker', 960, 660, { resistance: 8, frequency: 880, ratedPower: 5 })
  pb.w(master, 'B', fire, 'A')
  pb.w(fire, 'B', fireR, 'A')
  pb.w(fireR, 'B', fireLed, 'A')
  pb.w(fireLed, 'K', ground, 'G')
  pb.w(fire, 'B', fireDamp, 'A')
  pb.w(fireDamp, 'B', fireSpeaker, '+')
  pb.w(fireSpeaker, '-', ground, 'G')

  const start = pb.c('switchPush', 'Start Button', 620, 800, { key: 'Enter', closed: false })
  const startR = pb.c('resistor', 'Start Lamp Ballast', 800, 780, { resistance: 330 })
  const startLed = pb.c('led', 'Start LED', 960, 780, { forwardVoltage: 2, color: 'white' })
  const startBuzzer = pb.c('buzzer', 'Start Chime', 960, 900, { resistance: 100, frequency: 660 })
  pb.w(master, 'B', start, 'A')
  pb.w(start, 'B', startR, 'A')
  pb.w(startR, 'B', startLed, 'A')
  pb.w(startLed, 'K', ground, 'G')
  pb.w(start, 'B', startBuzzer, '+')
  pb.w(startBuzzer, '-', ground, 'G')

  const coin = pb.c('switchPush', 'Coin Button', 620, 1040, { key: 'KeyC', closed: false })
  const coinR = pb.c('resistor', 'Credit Lamp Ballast', 800, 1040, { resistance: 470 })
  const coinLed = pb.c('led', 'Credit LED', 960, 1040, { forwardVoltage: 2.2, color: 'green' })
  pb.w(master, 'B', coin, 'A')
  pb.w(coin, 'B', coinR, 'A')
  pb.w(coinR, 'B', coinLed, 'A')
  pb.w(coinLed, 'K', ground, 'G')

  const fan = pb.c('fan', 'Cabinet Exhaust Fan', 620, 1220, { resistance: 14, ke: 2.5, maxCurrent: 1 })
  pb.w(master, 'B', fan, '+')
  pb.w(fan, '-', ground, 'G')
  const glow = pb.c('led', 'Screen Glow', 1160, 100, { forwardVoltage: 2.6, color: 'white' })
  const glowBallast = pb.c('resistor', 'Screen Glow Ballast', 1040, 100, { resistance: 680 })
  pb.w(master, 'B', glowBallast, 'A')
  pb.w(glowBallast, 'B', glow, 'A')
  pb.w(glow, 'K', ground, 'G')

  const shell: HardwareProps = { material: 'plastic', color: '#20303f', depth: 10 }
  const trim: HardwareProps = { material: 'plastic', color: '#d8434f', depth: 8 }
  const steel: HardwareProps = { material: 'steel', color: '#59636e', depth: 10 }
  const dark: HardwareProps = { material: 'plastic', color: '#12161c', depth: 10 }
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

  // ---- fixed cabinet body ----
  const base = p('block', 'Cabinet Base', 620, 960, 0, 220, 64, { ...shell, isStatic: true, depth: 330 })
  for (const [x, z] of [[540, -140], [540, 140], [700, -140], [700, 140]] as const) {
    attach(base, 'block', `Cabinet Leveler ${x} ${z}`, x, 996, z, 24, 10, { material: 'rubber', color: '#15181d', depth: 24 })
  }
  for (const [side, z] of [['Left', -165], ['Right', 165]] as const) {
    attach(base, 'board', `${side} Side Panel`, 620, 605, z, 215, 655, { ...shell, depth: 14 })
    attach(base, 'board', `${side} Side Art`, 610, 560, z + Math.sign(z) * 9, 170, 320, { material: 'plastic', color: side === 'Left' ? '#2f6db8' : '#d8a03f', depth: 3 })
  }
  attach(base, 'board', 'Cabinet Back Panel', 508, 605, 0, 20, 650, { ...shell, depth: 316 })
  attach(base, 'board', 'Cabinet Top Cap', 620, 282, 0, 220, 10, { ...trim, depth: 330 })
  attach(base, 'board', 'Kick Panel', 736, 900, 0, 18, 120, { ...trim, depth: 316 })
  attach(base, 'block', 'Control Deck', 770, 806, 0, 160, 14, { ...dark, depth: 316 }, -14)

  // ---- marquee ----
  attach(base, 'block', 'Marquee Box', 620, 322, 0, 226, 66, { ...dark, depth: 322 })
  attach(base, 'board', 'Marquee Acrylic', 736, 322, 0, 8, 52, { material: 'acrylic', color: '#274a86', depth: 250 })
  attach(base, 'board', 'Marquee Title Strip', 736, 322, 0, 4, 30, { material: 'plastic', color: '#ffd35c', depth: 130 })
  attach(base, 'ledBulb', 'Marquee Light Left Bulb', 726, 322, -80, 16, 40, { depth: 16, boundComponent: 'Marquee Light Left' })
  attach(base, 'ledBulb', 'Marquee Light Right Bulb', 726, 322, 80, 16, 40, { depth: 16, boundComponent: 'Marquee Light Right' })

  // ---- screen + speaker grille ----
  attach(base, 'block', 'CRT Tube', 664, 490, 0, 76, 190, { ...dark, color: '#1a2027', depth: 250 })
  attach(base, 'board', 'CRT Screen', 704, 490, 0, 8, 168, { material: 'acrylic', color: '#0d2233', depth: 226 })
  attach(base, 'board', 'Screen Bezel Top', 710, 400, 0, 10, 8, trim)
  attach(base, 'board', 'Screen Bezel Bottom', 710, 580, 0, 10, 8, trim)
  attach(base, 'ledBulb', 'Screen Glow Bulb', 640, 490, 0, 40, 120, { depth: 10, boundComponent: 'Screen Glow' })
  for (let i = 0; i < 6; i++) {
    attach(base, 'board', `Speaker Grille Slat ${i + 1}`, 712, 348 + i * 9, 0, 6, 5, { ...steel, depth: 180 })
  }

  // ---- controls ----
  attach(base, 'block', 'Joystick Mount', 766, 796, 0, 62, 10, { ...steel, depth: 90 })
  attach(base, 'block', 'Joystick Dust Cover', 766, 788, 0, 42, 10, { ...dark, depth: 60 })
  attach(base, 'board', 'Joystick Shaft', 766, 752, 0, 10, 72, { ...steel, color: '#c2cad2', depth: 10 })
  attach(base, 'axle', 'Joystick Ball', 766, 712, 0, 36, 36, { material: 'plastic', color: '#d8434f', depth: 36 })
  attach(base, 'axle', 'Fire Button Cap', 842, 788, -46, 38, 38, { material: 'plastic', color: '#d8434f', depth: 16 })
  attach(base, 'axle', 'Start Button Cap', 842, 788, 46, 38, 38, { material: 'plastic', color: '#ffd35c', depth: 16 })
  const firePad = attach(base, 'switchPad', 'Fire Button Pad', 842, 792, -46, 46, 12, { material: 'plastic', color: '#8c2a31', depth: 14, boundComponent: fire.name })
  fire.props.bindHardware = firePad.name
  const startPad = attach(base, 'switchPad', 'Start Button Pad', 842, 792, 46, 46, 12, { material: 'plastic', color: '#a8842f', depth: 14, boundComponent: start.name })
  start.props.bindHardware = startPad.name
  attach(base, 'board', 'Deck Instruction Strip', 800, 776, 108, 110, 6, { material: 'plastic', color: '#e8ecef', depth: 40 })

  // ---- coin door ----
  attach(base, 'board', 'Coin Door Frame', 748, 892, 0, 8, 86, { ...steel, depth: 130 })
  const coinPad = attach(base, 'switchPad', 'Coin Button Pad', 748, 884, 0, 30, 44, { ...steel, color: '#8c96a2', depth: 16, boundComponent: coin.name })
  coin.props.bindHardware = coinPad.name
  attach(base, 'board', 'Coin Slot Plate', 754, 880, 0, 6, 5, { ...dark, depth: 40 })
  attach(base, 'board', 'Coin Return Flap', 748, 918, 62, 5, 20, { ...steel, color: '#8c96a2', depth: 34 })
  attach(base, 'block', 'Coin Lock Barrel', 748, 918, -62, 14, 14, steel)

  // ---- roof exhaust fan (vertical axis on the fixed body) ----
  const fanRing = attach(base, 'board', 'Exhaust Fan Ring', 620, 276, 0, 150, 8, { ...steel, depth: 150 })
  const fanStator = attach(fanRing, 'block', 'Exhaust Fan Stator', 620, 268, 0, 24, 14, dark)
  const hub = p('block', 'Exhaust Fan Hub', 620, 268, 0, 20, 14, dark)
  pb.j('motor', fanStator, hub, 0, 0, 0, 0, { boundComponent: fan.name, kv: 1 / 2.5, maxAccel: 14 })
  for (const [i, [dx, dz, w, d, bz]] of [
    [1, 0, 118, 10, -69], [0, 1, 10, 118, 0], [-1, 0, 118, 10, -69], [0, -1, 10, 118, 0],
  ].entries()) {
    attach(hub, 'board', `Exhaust Fan Blade ${i + 1}`, 620 + dx * 36, 268, bz, w, 5, { ...dark, color: '#2b323a', depth: d })
  }
  for (const [x, z] of [[566, -46], [566, 46], [674, -46], [674, 46]] as const) {
    attach(fanRing, 'board', `Fan Guard Post ${x} ${z}`, x, 268, z, 8, 12, steel)
  }

  // ---- master + lights pads on top ----
  const masterPad = attach(base, 'switchPad', 'Cabinet Power Pad', 560, 276, 0, 44, 12, { material: 'plastic', color: '#37b26c', depth: 14, boundComponent: master.name })
  master.props.bindHardware = masterPad.name
  const lightPad = attach(base, 'switchPad', 'Marquee Lights Pad', 560, 276, 60, 44, 12, { material: 'plastic', color: '#ffd35c', depth: 14, boundComponent: marquee.name })
  marquee.props.bindHardware = lightPad.name

  return pb.build()
}
