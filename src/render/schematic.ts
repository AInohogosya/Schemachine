// ============================================================================
// Schematic renderer — draws the circuit editor: symbols, live wires with
// voltage color coding, current-flow animation, switch states, key badges,
// floating-input warnings and blown/tripped protection indicators.
// ============================================================================

import type { CircuitComponentData, CircuitData, ProjectData } from '../types'
import type { Selection } from '../store'
import { COMPONENT_DEFS, findPin, formatKeyCode, GATE_LABELS, gateHasSecondInput } from '../circuit/components'
import type { CircuitEngine } from '../circuit/engine'
import { applyCamera, baseTransform, drawGrid, roundRect, snap, type Camera } from './common'
import { SCHEMATIC } from './palette'
import { propsForCatalogEntry, resolveCatalogEntry } from '../circuit/catalog'

export const STUB = 16

export interface WireDraft {
  fromComp: string
  fromPin: string
}

export interface SchematicDrawOpts {
  engine: CircuitEngine
  cam: Camera
  cw: number
  ch: number
  dpr: number
  selection: Selection
  placement: string | null
  hoverPin: { compId: string; pin: string } | null
  hoverComp: string | null
  hoverWire: string | null
  mouseWorld: { x: number; y: number } | null
  wireDraft: WireDraft | null
  time: number
  showGrid?: boolean
}

export function pinWorld(c: CircuitComponentData, pinName: string): { x: number; y: number } | null {
  const def = findPin(c.type, pinName)
  if (!def) return null
  return { x: c.x + def.x, y: c.y + def.y }
}

export function stubEnd(px: number, py: number, dir: string, len = STUB): { x: number; y: number } {
  switch (dir) {
    case 'up':
      return { x: px, y: py - len }
    case 'down':
      return { x: px, y: py + len }
    case 'left':
      return { x: px - len, y: py }
    default:
      return { x: px + len, y: py }
  }
}

/** Orthogonal flowchart-style route between two pins. */
export function routeWire(
  a: { x: number; y: number },
  dirA: string,
  b: { x: number; y: number },
  dirB: string,
): { x: number; y: number }[] {
  const s1 = stubEnd(a.x, a.y, dirA)
  const s2 = stubEnd(b.x, b.y, dirB)
  let mid: { x: number; y: number }
  if (dirA === 'up' || dirA === 'down') mid = { x: s1.x, y: s2.y }
  else mid = { x: s2.x, y: s1.y }
  const raw = [a, s1, mid, s2, b]
  // collapse duplicate consecutive points
  const pts: { x: number; y: number }[] = []
  for (const p of raw) {
    const last = pts[pts.length - 1]
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) pts.push(p)
  }
  return pts
}

export function routeWireFor(project: ProjectData, wireId: string): { x: number; y: number }[] | null {
  const w = project.circuit.wires.find((x) => x.id === wireId)
  if (!w) return null
  const ca = project.circuit.components.find((c) => c.id === w.from.componentId)
  const cb = project.circuit.components.find((c) => c.id === w.to.componentId)
  if (!ca || !cb) return null
  const pa = pinWorld(ca, w.from.pin)
  const pb = pinWorld(cb, w.to.pin)
  if (!pa || !pb) return null
  const da = findPin(ca.type, w.from.pin)?.dir ?? 'right'
  const db = findPin(cb.type, w.to.pin)?.dir ?? 'left'
  return routeWire(pa, da, pb, db)
}

// ---------------------------------------------------------------- hit tests
export function hitTestPin(project: CircuitData, wx: number, wy: number, radius = 12): { compId: string; pin: string } | null {
  for (const c of project.components) {
    const def = COMPONENT_DEFS[c.type]
    if (!def) continue
    for (const p of def.pins) {
      const dx = c.x + p.x - wx
      const dy = c.y + p.y - wy
      if (dx * dx + dy * dy <= radius * radius) return { compId: c.id, pin: p.name }
    }
  }
  return null
}

export function hitTestComponent(project: CircuitData, wx: number, wy: number): CircuitComponentData | null {
  for (let i = project.components.length - 1; i >= 0; i--) {
    const c = project.components[i]
    const def = COMPONENT_DEFS[c.type]
    if (!def) continue
    const hw = def.symbolSize.w / 2 + 10
    const hh = def.symbolSize.h / 2 + 14
    if (Math.abs(wx - c.x) <= hw && Math.abs(wy - c.y) <= hh) return c
  }
  return null
}

function distToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - a.x, py - a.y)
  let t = ((px - a.x) * dx + (py - a.y) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

export function hitTestWire(project: ProjectData, wx: number, wy: number, radius = 8): string | null {
  for (let i = project.circuit.wires.length - 1; i >= 0; i--) {
    const pts = routeWireFor(project, project.circuit.wires[i].id)
    if (!pts) continue
    for (let s = 0; s < pts.length - 1; s++) {
      if (distToSegment(wx, wy, pts[s], pts[s + 1]) < radius) return project.circuit.wires[i].id
    }
  }
  return null
}

// ---------------------------------------------------------------- colors
export function voltageColor(v: number): string {
  if (!Number.isFinite(v)) return SCHEMATIC.inactive
  if (v >= 2.5) return SCHEMATIC.active
  if (v <= 0.5) return SCHEMATIC.inactive
  return SCHEMATIC.analog
}

// ---------------------------------------------------------------- main draw
export function drawSchematic(ctx: CanvasRenderingContext2D, project: ProjectData, o: SchematicDrawOpts) {
  const { engine, cam, cw, ch, dpr } = o
  baseTransform(ctx, dpr)
  ctx.fillStyle = SCHEMATIC.background
  ctx.fillRect(0, 0, cw, ch)
  if (o.showGrid !== false) drawGrid(ctx, cam, cw, ch, 20, dpr)
  applyCamera(ctx, cam, cw, ch, dpr)

  // wires under components
  for (const w of project.circuit.wires) drawWire(ctx, project, engine, w.id, o)

  // wire draft (rubber band)
  if (o.wireDraft && o.mouseWorld) {
    const ca = project.circuit.components.find((c) => c.id === o.wireDraft!.fromComp)
    const pin = ca ? findPin(ca.type, o.wireDraft.fromPin) : undefined
    if (ca && pin) {
      const pa = { x: ca.x + pin.x, y: ca.y + pin.y }
      const target = o.mouseWorld
      const s1 = stubEnd(pa.x, pa.y, pin.dir)
      ctx.save()
      ctx.strokeStyle = SCHEMATIC.accent
      ctx.lineWidth = 2.5
      ctx.setLineDash([6, 5])
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(s1.x, s1.y)
      if (pin.dir === 'up' || pin.dir === 'down') {
        ctx.lineTo(s1.x, target.y)
        ctx.lineTo(target.x, target.y)
      } else {
        ctx.lineTo(target.x, s1.y)
        ctx.lineTo(target.x, target.y)
      }
      ctx.stroke()
      ctx.restore()
    }
  }

  // components
  for (const c of project.circuit.components) drawComponent(ctx, project, engine, c, o)

  // placement ghost
  const placementEntry = resolveCatalogEntry(o.placement)
  if (placementEntry && o.mouseWorld) {
    ctx.save()
    ctx.globalAlpha = 0.48
    drawSymbolBody(ctx, project, engine, {
      id: '__ghost__',
      name: '',
      type: placementEntry.type,
      x: snap(o.mouseWorld.x),
      y: snap(o.mouseWorld.y),
      props: propsForCatalogEntry(placementEntry),
    }, { time: o.time, hoverPin: null, wireDraft: null })
    ctx.restore()
  }
}

function drawWire(
  ctx: CanvasRenderingContext2D,
  project: ProjectData,
  engine: CircuitEngine,
  wireId: string,
  o: SchematicDrawOpts,
) {
  const pts = routeWireFor(project, wireId)
  if (!pts || pts.length < 2) return
  const rt = engine.runtime.wires.get(wireId)
  const selected = o.selection.kind === 'wire' && o.selection.id === wireId
  const hovered = o.hoverWire === wireId
  const overloaded = rt?.overloaded ?? false

  const cA = voltageColor(rt?.vA ?? 0)
  const cB = voltageColor(rt?.vB ?? 0)
  const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y)
  if (overloaded) {
    grad.addColorStop(0, SCHEMATIC.danger)
    grad.addColorStop(1, SCHEMATIC.danger)
  } else {
    grad.addColorStop(0, cA)
    grad.addColorStop(1, cB)
  }

  ctx.save()
  if (selected || hovered) {
    ctx.strokeStyle = SCHEMATIC.selection
    ctx.lineWidth = 7
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    strokePath(ctx, pts)
  }
  ctx.strokeStyle = grad
  ctx.lineWidth = overloaded ? 3.5 : 2.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (overloaded) ctx.setLineDash([8, 5])
  strokePath(ctx, pts)
  ctx.setLineDash([])

  // current-flow animation
  const I = rt?.current ?? 0
  if (Math.abs(I) > 0.005 && !overloaded) {
    ctx.strokeStyle = SCHEMATIC.current
    ctx.lineWidth = 1.6
    ctx.setLineDash([2, 12])
    ctx.lineDashOffset = -o.time * (I > 0 ? 1 : -1) * Math.min(90, 12 + Math.abs(I) * 40)
    strokePath(ctx, pts)
    ctx.setLineDash([])
  }
  ctx.restore()

  if (overloaded) {
    const mid = pts[Math.floor(pts.length / 2)]
    ctx.save()
    ctx.fillStyle = SCHEMATIC.danger
    ctx.font = 'bold 11px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('SHORT', mid.x, mid.y - 8)
    ctx.restore()
  }
}

function strokePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

// ---------------------------------------------------------------- components
function drawComponent(
  ctx: CanvasRenderingContext2D,
  project: ProjectData,
  engine: CircuitEngine,
  c: CircuitComponentData,
  o: SchematicDrawOpts,
) {
  const selected = o.selection.kind === 'circuit' && o.selection.id === c.id
  const hovered = o.hoverComp === c.id
  ctx.save()
  if (selected) {
    ctx.strokeStyle = SCHEMATIC.accent
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    const def = COMPONENT_DEFS[c.type]
    roundRect(ctx, c.x - def.symbolSize.w / 2 - 8, c.y - def.symbolSize.h / 2 - 10, def.symbolSize.w + 16, def.symbolSize.h + 20, 8)
    ctx.stroke()
    ctx.setLineDash([])
  } else if (hovered && !o.wireDraft) {
    ctx.strokeStyle = SCHEMATIC.selection
    ctx.lineWidth = 1.5
    const def = COMPONENT_DEFS[c.type]
    roundRect(ctx, c.x - def.symbolSize.w / 2 - 8, c.y - def.symbolSize.h / 2 - 10, def.symbolSize.w + 16, def.symbolSize.h + 20, 8)
    ctx.stroke()
  }
  drawSymbolBody(ctx, project, engine, c, o)

  // name label
  ctx.fillStyle = SCHEMATIC.name
  ctx.font = '11px system-ui'
  ctx.textAlign = 'center'
  const def = COMPONENT_DEFS[c.type]
  ctx.fillText(c.name || '(unnamed)', c.x, c.y + def.symbolSize.h / 2 + 22)

  // key badge
  if ((c.type === 'switchPush' || c.type === 'switchSlide') && c.props.key) {
    const label = formatKeyCode(c.props.key)
    ctx.font = 'bold 10px system-ui'
    const wdt = ctx.measureText(label).width + 12
    const pressed = engine.isPressed(c.props.key)
    ctx.fillStyle = pressed ? SCHEMATIC.active : SCHEMATIC.badge
    ctx.strokeStyle = pressed ? SCHEMATIC.active : SCHEMATIC.inactive
    ctx.lineWidth = 1
    roundRect(ctx, c.x + def.symbolSize.w / 2 + 6, c.y - 34, wdt, 18, 5)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = pressed ? SCHEMATIC.background : SCHEMATIC.muted
    ctx.textAlign = 'center'
    ctx.fillText(label, c.x + def.symbolSize.w / 2 + 6 + wdt / 2, c.y - 21)
  }
  ctx.restore()
}

export function ledCssColor(color: string | undefined, brightness: number): string {
  const map: Record<string, [number, number, number]> = {
    red: [239, 68, 68],
    green: [34, 197, 94],
    blue: [59, 130, 246],
    yellow: [250, 204, 21],
    white: [241, 245, 249],
  }
  const rgb = map[color ?? 'red'] ?? map.red
  if (brightness <= 0.03) return 'rgb(148,160,162)'
  const k = Math.max(0, Math.min(1, (brightness - 0.03) / 0.97))
  const base = 154
  return `rgb(${Math.round(rgb[0] * k + base * (1 - k))},${Math.round(rgb[1] * k + base * (1 - k))},${Math.round(rgb[2] * k + base * (1 - k))})`
}

function drawSymbolBody(
  ctx: CanvasRenderingContext2D,
  project: ProjectData,
  engine: CircuitEngine,
  c: CircuitComponentData,
  o: { time: number; hoverPin: { compId: string; pin: string } | null; wireDraft: WireDraft | null },
) {
  const time = o.time
  const st = engine.runtime.states.get(c.id)
  const pv = engine.runtime.pinVoltages.get(c.id)
  const V = (pin: string): number => pv?.get(pin) ?? 0
  const { x, y } = c
  const p = c.props

  ctx.save()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = SCHEMATIC.symbol
  ctx.fillStyle = SCHEMATIC.symbol

  switch (c.type) {
    case 'battery': {
      const volts = p.voltage ?? 9
      ctx.textAlign = 'center'
      // + terminal lead
      ctx.beginPath()
      ctx.moveTo(x, y - 30)
      ctx.lineTo(x, y - 10)
      ctx.moveTo(x, y + 10)
      ctx.lineTo(x, y + 30)
      ctx.stroke()
      // long (+) and short (-) plates
      ctx.beginPath()
      ctx.moveTo(x - 16, y - 10)
      ctx.lineTo(x + 16, y - 10)
      ctx.moveTo(x - 8, y + 10)
      ctx.lineTo(x + 8, y + 10)
      ctx.stroke()
      ctx.font = 'bold 11px system-ui'
      ctx.fillStyle = SCHEMATIC.muted
      ctx.fillText('+', x + 22, y - 6)
      ctx.fillText(String(volts) + 'V', x, y + 2)
      if (st?.tripped) {
        ctx.fillStyle = SCHEMATIC.danger
        ctx.font = 'bold 10px system-ui'
        ctx.fillText('TRIPPED', x, y - 36)
        drawBolt(ctx, x - 26, y - 2, 8, SCHEMATIC.danger)
      }
      break
    }
    case 'ground': {
      ctx.beginPath()
      ctx.moveTo(x, y - 20)
      ctx.lineTo(x, y - 6)
      ctx.moveTo(x - 12, y - 6)
      ctx.lineTo(x + 12, y - 6)
      ctx.moveTo(x - 8, y)
      ctx.lineTo(x + 8, y)
      ctx.moveTo(x - 4, y + 6)
      ctx.lineTo(x + 4, y + 6)
      ctx.stroke()
      break
    }
    case 'resistor': {
      drawZigzag(ctx, x, y - 26, x, y + 26, 5)
      const r = p.resistance ?? 220
      ctx.font = '10px system-ui'
      ctx.fillStyle = SCHEMATIC.muted
      ctx.textAlign = 'center'
      ctx.fillText(formatOhms(r), x + 30, y + 3)
      break
    }
    case 'diode':
    case 'schottky':
    case 'zenerDiode':
    case 'led': {
      const isLed = c.type === 'led'
      const bright = isLed ? (st?.brightness ?? 0) : st?.on || st?.reverseBreakdown ? 1 : 0
      const col = isLed ? ledCssColor(typeof p.color === 'string' ? p.color : 'red', bright) : SCHEMATIC.symbol
      ctx.strokeStyle = col
      ctx.beginPath()
      ctx.moveTo(x, y - 26)
      ctx.lineTo(x, y - 8)
      ctx.moveTo(x, y + 8)
      ctx.lineTo(x, y + 26)
      ctx.stroke()
      // triangle pointing down (A top anode)
      ctx.beginPath()
      ctx.moveTo(x, y - 8)
      ctx.lineTo(x - 11, y + 8)
      ctx.lineTo(x + 11, y + 8)
      ctx.closePath()
      ctx.fillStyle = bright > 0.03 ? col : SCHEMATIC.ghostFill
      ctx.fill()
      ctx.strokeStyle = col
      ctx.stroke()
      // cathode bar
      ctx.beginPath()
      ctx.moveTo(x - 11, y + 10)
      ctx.lineTo(x + 11, y + 10)
      if (c.type === 'zenerDiode') {
        ctx.moveTo(x - 11, y + 10)
        ctx.lineTo(x - 15, y + 5)
        ctx.moveTo(x + 11, y + 10)
        ctx.lineTo(x + 15, y + 15)
      } else if (c.type === 'schottky') {
        ctx.moveTo(x - 11, y + 10)
        ctx.lineTo(x - 11, y + 5)
        ctx.lineTo(x - 6, y + 5)
        ctx.moveTo(x + 11, y + 10)
        ctx.lineTo(x + 11, y + 15)
        ctx.lineTo(x + 6, y + 15)
      }
      ctx.stroke()
      if (c.type === 'zenerDiode') {
        ctx.font = '10px system-ui'
        ctx.fillStyle = SCHEMATIC.muted
        ctx.textAlign = 'center'
        ctx.fillText(`${p.zenerVoltage ?? 5.1}V Z`, x + 33, y + 3)
      }
      if (isLed) {
        if (bright > 0.03) {
          ctx.save()
          ctx.shadowColor = ledCssColor(typeof p.color === 'string' ? p.color : 'red', 1)
          ctx.shadowBlur = 18 * bright
          ctx.strokeStyle = ledCssColor(typeof p.color === 'string' ? p.color : 'red', 1)
          ctx.lineWidth = 2
          drawLightRays(ctx, x, y, bright)
          ctx.restore()
        }
        ctx.font = '10px system-ui'
        ctx.fillStyle = SCHEMATIC.muted
        ctx.textAlign = 'center'
        ctx.fillText(`${p.forwardVoltage ?? 2}V`, x + 30, y + 3)
      }
      break
    }
    case 'switchPush': {
      const closed = p.closed === true
      // terminals
      ctx.beginPath()
      ctx.arc(x, y - 22, 3, 0, Math.PI * 2)
      ctx.moveTo(x + 3, y + 22)
      ctx.arc(x, y + 22, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(x, y - 30)
      ctx.lineTo(x, y - 22)
      ctx.moveTo(x, y + 22)
      ctx.lineTo(x, y + 30)
      ctx.stroke()
      // button bridge
      const lift = closed ? 0 : 14
      ctx.strokeStyle = closed ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.fillStyle = closed ? SCHEMATIC.active : SCHEMATIC.badge
      ctx.beginPath()
      ctx.moveTo(x - 14, y - 22 - lift)
      ctx.lineTo(x + 14, y - 22 - lift)
      ctx.stroke()
      roundRect(ctx, x - 8, y - 22 - lift - 12, 16, 10, 3)
      ctx.fill()
      ctx.strokeStyle = closed ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.stroke()
      // stem
      ctx.beginPath()
      ctx.moveTo(x, y - 22)
      ctx.lineTo(x, y - 22 - lift)
      ctx.stroke()
      break
    }
    case 'switchSlide': {
      const closed = p.closed === true
      ctx.beginPath()
      ctx.moveTo(x, y - 30)
      ctx.lineTo(x, y - 18)
      ctx.moveTo(x, y + 18)
      ctx.lineTo(x, y + 30)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y - 18, 3, 0, Math.PI * 2)
      ctx.arc(x, y + 18, 3, 0, Math.PI * 2)
      ctx.fill()
      // lever
      const ang = closed ? 0 : -0.5
      const lx = x + Math.sin(ang) * 36
      const ly = y - 18 + Math.cos(ang) * 36
      ctx.strokeStyle = closed ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x, y - 18)
      ctx.lineTo(lx, ly)
      ctx.stroke()
      ctx.fillStyle = closed ? SCHEMATIC.active : SCHEMATIC.inactive
      ctx.beginPath()
      ctx.arc(lx, ly, 5, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'potentiometer': {
      const pos = Math.min(1, Math.max(0, p.position ?? 0.5))
      drawZigzag(ctx, x - 26, y + 22, x + 26, y + 22, 5)
      ctx.beginPath()
      ctx.moveTo(x - 30, y + 22)
      ctx.lineTo(x - 30, y + 30)
      ctx.moveTo(x + 30, y + 22)
      ctx.lineTo(x + 30, y + 30)
      ctx.stroke()
      const wxp = x - 26 + pos * 52
      ctx.beginPath()
      ctx.moveTo(x, y - 30)
      ctx.lineTo(x, y - 12)
      ctx.lineTo(wxp, y + 18)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(wxp, y + 20, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '10px system-ui'
      ctx.fillStyle = SCHEMATIC.muted
      ctx.textAlign = 'center'
      ctx.fillText(formatOhms(p.resistance ?? 10000), x + 34, y + 26)
      break
    }
    case 'motor': {
      const volts = st?.voltage ?? 0
      ctx.beginPath()
      ctx.arc(x, y, 24, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y - 32)
      ctx.lineTo(x, y - 24)
      ctx.moveTo(x, y + 24)
      ctx.lineTo(x, y + 32)
      ctx.stroke()
      ctx.font = 'bold 16px system-ui'
      ctx.fillStyle = Math.abs(volts) > 0.2 ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.textAlign = 'center'
      ctx.fillText('M', x, y + 6)
      if (Math.abs(volts) > 0.2) {
        ctx.save()
        ctx.strokeStyle = SCHEMATIC.active
        ctx.lineWidth = 2
        const a0 = time * Math.sign(volts) * 4
        ctx.beginPath()
        ctx.arc(x, y, 29, a0, a0 + 4.2)
        ctx.stroke()
        ctx.beginPath()
        const ex = x + Math.cos(a0 + 4.2) * 29
        const ey = y + Math.sin(a0 + 4.2) * 29
        ctx.moveTo(ex, ey)
        ctx.lineTo(ex - 6 * Math.cos(a0 + 4.2 - 0.4), ey - 6 * Math.sin(a0 + 4.2 - 0.4))
        ctx.moveTo(ex, ey)
        ctx.lineTo(ex - 6 * Math.cos(a0 + 4.2 + 0.5), ey - 6 * Math.sin(a0 + 4.2 + 0.5))
        ctx.stroke()
        ctx.restore()
      }
      ctx.font = '10px system-ui'
      ctx.fillStyle = SCHEMATIC.muted
      ctx.fillText(`${volts.toFixed(1)}V`, x + 40, y + 3)
      break
    }
    case 'buzzer': {
      const on = st?.on === true
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.moveTo(x, y - 30)
      ctx.lineTo(x, y - 6)
      ctx.moveTo(x, y + 6)
      ctx.lineTo(x, y + 30)
      ctx.stroke()
      roundRect(ctx, x - 14, y - 6, 28, 12, 4)
      ctx.stroke()
      // bell arcs
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath()
        ctx.arc(x, y, 8 + i * 6, -0.7, 0.7)
        ctx.stroke()
      }
      if (on) {
        ctx.fillStyle = SCHEMATIC.active
        ctx.font = 'bold 10px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText(`${p.frequency ?? 440}Hz`, x, y - 38)
      }
      break
    }
    case 'gate': {
      const gt = (p.gateType ?? 'AND') as string
      const out = st?.out ?? 0
      const negated = gt === 'NAND' || gt === 'NOR' || gt === 'XNOR'
      roundRect(ctx, x - 30, y - 28, 60, 56, 4)
      ctx.stroke()
      ctx.font = 'bold 15px system-ui'
      ctx.textAlign = 'center'
      ctx.fillStyle = SCHEMATIC.symbol
      ctx.fillText(GATE_LABELS[gt] ?? '?', x - 4, y + 5)
      // input stubs
      ctx.beginPath()
      ctx.moveTo(x - 38, y - 18)
      ctx.lineTo(x - 30, y - 18)
      const hasIn2 = gateHasSecondInput(gt)
      if (hasIn2) {
        ctx.moveTo(x - 38, y + 18)
        ctx.lineTo(x - 30, y + 18)
      }
      ctx.stroke()
      if (!hasIn2) {
        ctx.strokeStyle = SCHEMATIC.inactive
        ctx.beginPath()
        ctx.moveTo(x - 38, y + 14)
        ctx.lineTo(x - 32, y + 20)
        ctx.moveTo(x - 32, y + 14)
        ctx.lineTo(x - 38, y + 20)
        ctx.stroke()
        ctx.strokeStyle = SCHEMATIC.symbol
      }
      if (gt === 'XOR' || gt === 'XNOR') {
        ctx.beginPath()
        ctx.moveTo(x - 26, y - 24)
        ctx.quadraticCurveTo(x - 20, y, x - 26, y + 24)
        ctx.stroke()
      }
      // output bubble + stub
      if (negated) {
        ctx.beginPath()
        ctx.arc(x + 33, y, 5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x + 38 - 0 + 0, y)
        ctx.lineTo(x + 38, y)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(x + 30, y)
        ctx.lineTo(x + 38, y)
        ctx.stroke()
      }
      // output state halo
      ctx.fillStyle = out ? SCHEMATIC.active : SCHEMATIC.inactive
      ctx.beginPath()
      ctx.arc(x + 38, y, 4, 0, Math.PI * 2)
      ctx.fill()
      void V
      break
    }
    case 'transistor': {
      const kind = p.transistorKind === 'PNP' ? 'PNP' : 'NPN'
      const on = st?.on === true
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.arc(x, y, 20, 0, Math.PI * 2)
      ctx.stroke()
      // base
      ctx.beginPath()
      ctx.moveTo(x - 32, y)
      ctx.lineTo(x - 6, y)
      ctx.moveTo(x - 6, y - 12)
      ctx.lineTo(x - 6, y + 12)
      ctx.stroke()
      // collector (top right) / emitter (bottom right)
      ctx.beginPath()
      ctx.moveTo(x + 32, y - 24)
      ctx.lineTo(x + 32, y - 10)
      ctx.lineTo(x - 6, y - 4)
      ctx.moveTo(x + 32, y + 24)
      ctx.lineTo(x + 32, y + 10)
      ctx.lineTo(x - 6, y + 4)
      ctx.stroke()
      // emitter arrow
      const tipX = x + 8
      const tipY = kind === 'NPN' ? y + 9 : y - 1
      const dirY = kind === 'NPN' ? 1 : -1
      ctx.fillStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - 7, tipY - dirY * 2 - 5)
      ctx.lineTo(tipX + 1, tipY - dirY * 2 - 6)
      ctx.closePath()
      ctx.fill()
      ctx.font = '10px system-ui'
      ctx.fillText(kind, x, y - 26)
      break
    }
    case 'fuse': {
      const blown = p.blown === true
      ctx.strokeStyle = blown ? SCHEMATIC.danger : SCHEMATIC.symbol
      roundRect(ctx, x - 22, y - 10, 44, 20, 4)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x - 30, y)
      ctx.lineTo(x - 22, y)
      ctx.moveTo(x + 22, y)
      ctx.lineTo(x + 30, y)
      ctx.stroke()
      // filament
      ctx.beginPath()
      if (blown) {
        ctx.moveTo(x - 16, y)
        ctx.lineTo(x - 5, y)
        ctx.moveTo(x + 5, y)
        ctx.lineTo(x + 16, y)
      } else {
        ctx.moveTo(x - 16, y)
        ctx.quadraticCurveTo(x, y - 8, x + 16, y)
      }
      ctx.stroke()
      if (blown) {
        ctx.fillStyle = SCHEMATIC.danger
        ctx.font = 'bold 10px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('BLOWN', x, y - 16)
      }
      break
    }
    case 'capacitor': {
      drawVerticalLeads(ctx, x, y, 30, 7)
      ctx.beginPath()
      ctx.moveTo(x - 15, y - 7)
      ctx.lineTo(x + 15, y - 7)
      ctx.moveTo(x - 15, y + 7)
      ctx.lineTo(x + 15, y + 7)
      ctx.stroke()
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = '10px system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(formatCapacitance(p.capacitance ?? 0.001), x + 21, y + 3)
      break
    }
    case 'inductor': {
      ctx.beginPath()
      ctx.moveTo(x, y - 30)
      ctx.lineTo(x, y - 22)
      ctx.moveTo(x, y + 22)
      ctx.lineTo(x, y + 30)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y - 22)
      for (let i = 0; i < 4; i++) {
        const top = y - 22 + i * 11
        ctx.bezierCurveTo(x - 21, top, x - 21, top + 11, x, top + 11)
      }
      ctx.stroke()
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = '10px system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(formatInductance(p.inductance ?? 0.1), x + 17, y + 3)
      break
    }
    case 'rgbLed': {
      const channels = st?.channels ?? { R: 0, G: 0, B: 0 }
      roundRect(ctx, x - 24, y - 30, 50, 60, 12)
      ctx.stroke()
      ctx.beginPath()
      for (const py of [-24, 0, 24]) {
        ctx.moveTo(x - 38, y + py)
        ctx.lineTo(x - 24, y + py)
      }
      ctx.moveTo(x + 26, y)
      ctx.lineTo(x + 38, y)
      ctx.stroke()
      const colors = { R: 'red', G: 'green', B: 'blue' } as const
      ;(['R', 'G', 'B'] as const).forEach((channel, index) => {
        const brightness = Math.max(0, Math.min(1, channels[channel]))
        ctx.fillStyle = ledCssColor(colors[channel], brightness)
        ctx.beginPath()
        ctx.arc(x, y - 17 + index * 17, 5.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = SCHEMATIC.muted
        ctx.font = '8px system-ui'
        ctx.textAlign = 'left'
        ctx.fillText(channel, x + 10, y - 14 + index * 17)
      })
      break
    }
    case 'incandescent': {
      const brightness = Math.max(0, Math.min(1, st?.brightness ?? 0))
      drawVerticalLeads(ctx, x, y, 30, 20)
      if (brightness > 0.01) {
        ctx.fillStyle = `rgba(196,155,79,${0.08 + brightness * 0.18})`
        ctx.beginPath()
        ctx.arc(x, y, 20, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = brightness > 0.03 ? SCHEMATIC.analog : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.arc(x, y, 20, 0, Math.PI * 2)
      ctx.moveTo(x - 13, y - 13)
      ctx.lineTo(x + 13, y + 13)
      ctx.moveTo(x + 13, y - 13)
      ctx.lineTo(x - 13, y + 13)
      ctx.stroke()
      break
    }
    case 'photoresistor':
    case 'thermistor': {
      drawZigzag(ctx, x, y - 24, x, y + 24, 5)
      drawVerticalLeads(ctx, x, y, 30, 24)
      if (c.type === 'photoresistor') {
        roundRect(ctx, x - 15, y - 28, 30, 56, 5)
        ctx.stroke()
        drawSensorArrows(ctx, x + 18, y - 15)
      } else {
        ctx.beginPath()
        ctx.moveTo(x - 13, y + 20)
        ctx.lineTo(x + 13, y - 20)
        ctx.stroke()
        ctx.fillStyle = SCHEMATIC.muted
        ctx.font = 'bold 10px system-ui'
        ctx.textAlign = 'left'
        ctx.fillText('T', x + 15, y - 15)
      }
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = '9px system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(formatOhms(st?.resistance ?? p.resistance ?? 1000), x + 25, y + 26)
      break
    }
    case 'relay': {
      const on = st?.on === true
      ctx.beginPath()
      ctx.moveTo(x - 48, y - 24)
      ctx.lineTo(x - 32, y - 24)
      ctx.moveTo(x - 48, y + 24)
      ctx.lineTo(x - 32, y + 24)
      ctx.moveTo(x + 20, y)
      ctx.lineTo(x + 48, y)
      ctx.moveTo(x + 38, y - 32)
      ctx.lineTo(x + 48, y - 32)
      ctx.moveTo(x + 38, y + 32)
      ctx.lineTo(x + 48, y + 32)
      ctx.stroke()
      roundRect(ctx, x - 32, y - 29, 23, 58, 4)
      ctx.stroke()
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.arc(x - 20, y - 17 + i * 11, 7, -Math.PI / 2, Math.PI / 2)
        ctx.stroke()
      }
      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = SCHEMATIC.inactive
      ctx.beginPath()
      ctx.moveTo(x - 7, y)
      ctx.lineTo(x + 17, y)
      ctx.stroke()
      ctx.restore()
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.moveTo(x + 20, y)
      ctx.lineTo(x + 38, on ? y - 32 : y + 32)
      ctx.stroke()
      for (const py of [-32, 32]) {
        ctx.beginPath()
        ctx.arc(x + 38, y + py, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'mosfet': {
      const kind = p.mosfetKind === 'P' ? 'P' : 'N'
      const on = st?.on === true
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.arc(x, y, 23, 0, Math.PI * 2)
      ctx.moveTo(x - 32, y)
      ctx.lineTo(x - 12, y)
      ctx.moveTo(x - 12, y - 15)
      ctx.lineTo(x - 12, y + 15)
      ctx.moveTo(x - 5, y - 13)
      ctx.lineTo(x - 5, y + 13)
      ctx.moveTo(x + 32, y - 24)
      ctx.lineTo(x + 12, y - 24)
      ctx.lineTo(x + 12, y - 7)
      ctx.lineTo(x - 5, y - 7)
      ctx.moveTo(x + 32, y + 24)
      ctx.lineTo(x + 12, y + 24)
      ctx.lineTo(x + 12, y + 7)
      ctx.lineTo(x - 5, y + 7)
      ctx.moveTo(x - 5, y)
      ctx.lineTo(x + 12, y)
      ctx.lineTo(x + 12, y + 24)
      ctx.stroke()
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = '9px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(`${kind}-CH`, x, y - 29)
      break
    }
    case 'currentSource': {
      drawVerticalLeads(ctx, x, y, 30, 20)
      ctx.beginPath()
      ctx.arc(x, y, 20, 0, Math.PI * 2)
      ctx.moveTo(x, y + 12)
      ctx.lineTo(x, y - 12)
      ctx.moveTo(x, y - 12)
      ctx.lineTo(x - 5, y - 5)
      ctx.moveTo(x, y - 12)
      ctx.lineTo(x + 5, y - 5)
      ctx.stroke()
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = '10px system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(`${((p.current ?? 0.01) * 1000).toFixed(0)}mA`, x + 26, y + 3)
      break
    }
    case 'clock': {
      const on = (st?.out ?? 0) > 0.5
      ctx.beginPath()
      ctx.moveTo(x - 38, y)
      ctx.lineTo(x - 30, y)
      ctx.moveTo(x + 30, y)
      ctx.lineTo(x + 38, y)
      ctx.stroke()
      roundRect(ctx, x - 30, y - 22, 60, 44, 5)
      ctx.stroke()
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.moveTo(x - 20, y + 8)
      ctx.lineTo(x - 10, y + 8)
      ctx.lineTo(x - 10, y - 8)
      ctx.lineTo(x + 2, y - 8)
      ctx.lineTo(x + 2, y + 8)
      ctx.lineTo(x + 15, y + 8)
      ctx.stroke()
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = '9px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(`${p.frequency ?? 1}Hz`, x, y + 32)
      break
    }
    case 'opAmp': {
      ctx.beginPath()
      ctx.moveTo(x - 44, y - 22)
      ctx.lineTo(x - 22, y - 22)
      ctx.moveTo(x - 44, y + 22)
      ctx.lineTo(x - 22, y + 22)
      ctx.moveTo(x + 28, y)
      ctx.lineTo(x + 44, y)
      ctx.moveTo(x, y - 44)
      ctx.lineTo(x, y - 30)
      ctx.moveTo(x, y + 30)
      ctx.lineTo(x, y + 44)
      ctx.moveTo(x - 22, y - 32)
      ctx.lineTo(x - 22, y + 32)
      ctx.lineTo(x + 28, y)
      ctx.closePath()
      ctx.stroke()
      ctx.fillStyle = SCHEMATIC.muted
      ctx.font = 'bold 13px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('+', x - 14, y - 17)
      ctx.fillText('−', x - 14, y + 26)
      ctx.font = '10px system-ui'
      ctx.fillText(`${(st?.voltage ?? V('OUT')).toFixed(1)}V`, x + 2, y + 4)
      break
    }
    case 'solenoid': {
      const on = st?.on === true
      drawVerticalLeads(ctx, x, y, 30, 20)
      roundRect(ctx, x - 25, y - 20, 50, 40, 4)
      ctx.stroke()
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.arc(x - 15 + i * 10, y, 6, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(x - 31, y - 26)
      ctx.lineTo(x + 30, y - 26)
      ctx.moveTo(x + 30, y - 26)
      ctx.lineTo(x + 23, y - 30)
      ctx.moveTo(x + 30, y - 26)
      ctx.lineTo(x + 23, y - 22)
      ctx.stroke()
      break
    }
    case 'fan': {
      const on = Math.abs(st?.voltage ?? 0) > 0.2
      drawVerticalLeads(ctx, x, y, 32, 25)
      ctx.beginPath()
      ctx.arc(x, y, 25, 0, Math.PI * 2)
      ctx.stroke()
      ctx.save()
      ctx.translate(x, y)
      if (on) ctx.rotate(time * 2.5 * Math.sign(st?.voltage ?? 1))
      ctx.fillStyle = on ? SCHEMATIC.active : SCHEMATIC.inactive
      for (let i = 0; i < 3; i++) {
        ctx.rotate(Math.PI * 2 / 3)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.quadraticCurveTo(5, -19, 17, -15)
        ctx.quadraticCurveTo(20, -4, 0, 0)
        ctx.fill()
      }
      ctx.restore()
      break
    }
    case 'speaker': {
      const on = st?.on === true
      drawVerticalLeads(ctx, x, y, 30, 17)
      ctx.strokeStyle = on ? SCHEMATIC.active : SCHEMATIC.symbol
      ctx.beginPath()
      ctx.moveTo(x - 17, y - 8)
      ctx.lineTo(x - 7, y - 8)
      ctx.lineTo(x + 7, y - 19)
      ctx.lineTo(x + 7, y + 19)
      ctx.lineTo(x - 7, y + 8)
      ctx.lineTo(x - 17, y + 8)
      ctx.closePath()
      ctx.stroke()
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath()
        ctx.arc(x + 7, y, 7 + i * 6, -0.75, 0.75)
        ctx.stroke()
      }
      break
    }
    default:
      break
  }
  ctx.restore()

  // pin dots + floating-input warnings
  const def = COMPONENT_DEFS[c.type]
  if (def) {
    for (const pin of def.pins) {
      const px = x + pin.x
      const py = y + pin.y
      const isHover = o.hoverPin?.compId === c.id && o.hoverPin?.pin === pin.name
      const isDraftFrom = o.wireDraft?.fromComp === c.id && o.wireDraft?.fromPin === pin.name
      ctx.save()
      ctx.fillStyle = isHover || isDraftFrom ? SCHEMATIC.accent : SCHEMATIC.pin
      ctx.beginPath()
      ctx.arc(px, py, isHover || isDraftFrom ? 5 : 3, 0, Math.PI * 2)
      ctx.fill()
      if (def.pins.length > 2) {
        ctx.fillStyle = SCHEMATIC.muted
        ctx.font = '8px system-ui'
        ctx.textAlign = pin.dir === 'left' ? 'right' : pin.dir === 'right' ? 'left' : 'center'
        const lx = px + (pin.dir === 'left' ? -7 : pin.dir === 'right' ? 7 : 0)
        const ly = py + (pin.dir === 'up' ? -8 : pin.dir === 'down' ? 11 : 3)
        ctx.fillText(pin.name, lx, ly)
      }
      if (pin.role === 'input') {
        const connected = project.circuit.wires.some(
          (w) =>
            (w.from.componentId === c.id && w.from.pin === pin.name) ||
            (w.to.componentId === c.id && w.to.pin === pin.name),
        )
        if (!connected) {
          ctx.strokeStyle = SCHEMATIC.warning
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.arc(px, py, 9, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
  }
}

function drawVerticalLeads(ctx: CanvasRenderingContext2D, x: number, y: number, pinOffset: number, bodyOffset: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - pinOffset)
  ctx.lineTo(x, y - bodyOffset)
  ctx.moveTo(x, y + bodyOffset)
  ctx.lineTo(x, y + pinOffset)
  ctx.stroke()
}

function drawSensorArrows(ctx: CanvasRenderingContext2D, x: number, y: number) {
  for (const offset of [0, 10]) {
    ctx.beginPath()
    ctx.moveTo(x + offset + 7, y - 7)
    ctx.lineTo(x + offset, y)
    ctx.lineTo(x + offset + 7, y + 7)
    ctx.moveTo(x + offset, y)
    ctx.lineTo(x + offset + 5, y - 1)
    ctx.moveTo(x + offset, y)
    ctx.lineTo(x + offset + 2, y + 5)
    ctx.stroke()
  }
}

function formatCapacitance(value: number): string {
  if (value >= 1) return `${value}F`
  if (value >= 0.001) return `${Number((value * 1000).toFixed(2))}mF`
  if (value >= 0.000001) return `${Number((value * 1000000).toFixed(2))}µF`
  if (value >= 0.000000001) return `${Number((value * 1000000000).toFixed(2))}nF`
  return `${Number((value * 1000000000000).toFixed(2))}pF`
}

function formatInductance(value: number): string {
  if (value >= 1) return `${Number(value.toFixed(2))}H`
  if (value >= 0.001) return `${Number((value * 1000).toFixed(2))}mH`
  return `${Number((value * 1000000).toFixed(2))}µH`
}

function drawZigzag(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, peaks: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  for (let i = 1; i < peaks * 2; i++) {
    const t = i / (peaks * 2)
    const off = i % 2 === 1 ? 8 : -8
    const mx = x1 + (x2 - x1) * t
    const my = y1 + (y2 - y1) * t
    // perpendicular offset
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    ctx.lineTo(mx + (-dy / len) * off, my + (dx / len) * off)
  }
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function drawLightRays(ctx: CanvasRenderingContext2D, x: number, y: number, bright: number) {
  ctx.save()
  ctx.globalAlpha = 0.4 + 0.6 * bright
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
  ]) {
    for (let i = 0; i < 2; i++) {
      ctx.beginPath()
      ctx.moveTo(x + dx * 14, y - 10 - i * 4)
      ctx.lineTo(x + dx * 22, y - 18 - i * 6)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + s * 0.6, y)
  ctx.lineTo(x - s * 0.2, y + s * 1.1)
  ctx.lineTo(x + s * 0.2, y + s * 1.1)
  ctx.lineTo(x - s * 0.6, y + s * 2.2)
  ctx.lineTo(x + s * 0.5, y + s * 1.05)
  ctx.lineTo(x + s * 0.1, y + s * 1.05)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function formatOhms(r: number): string {
  if (r >= 1e6) return `${(r / 1e6).toFixed(r % 1e6 === 0 ? 0 : 1)}M\u03A9`
  if (r >= 1000) return `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)}k\u03A9`
  return `${Math.round(r)}\u03A9`
}
