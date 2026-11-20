import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { COMPONENT_DEFS } from '../circuit/components'
import { propsForCatalogEntry, resolveCatalogEntry } from '../circuit/catalog'
import { getCircuit } from '../runtime'
import { store, uid, existingNames, uniqueName } from '../store'
import type { CircuitComponentData } from '../types'
import { drawSchematic, hitTestComponent, hitTestPin, hitTestWire, type WireDraft } from '../render/schematic'
import { defaultCamera, fitCameraToBounds, screenToWorld, snap, type Camera } from '../render/common'
import { AudioKit } from '../sim/audio'
import { prefersReducedMotion, shouldIgnoreWorkspaceShortcut } from './shortcuts'

function fitSchematic(cam: Camera, wrap: HTMLDivElement | null) {
  if (!wrap) return 100
  const rect = wrap.getBoundingClientRect()
  const components = store.project.circuit.components
  if (components.length === 0) {
    cam.x = 320
    cam.y = 300
    cam.zoom = 1
  } else {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const component of components) {
      const size = COMPONENT_DEFS[component.type]?.symbolSize ?? { w: 60, h: 60 }
      x0 = Math.min(x0, component.x - size.w / 2)
      y0 = Math.min(y0, component.y - size.h / 2)
      x1 = Math.max(x1, component.x + size.w / 2)
      y1 = Math.max(y1, component.y + size.h / 2)
    }
    fitCameraToBounds(cam, rect.width, rect.height, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 100)
  }
  return Math.round(cam.zoom * 100)
}

export default function SchematicView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const camRef = useRef<Camera>(defaultCamera())
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const draftRef = useRef<WireDraft | null>(null)
  const hoverPinRef = useRef<{ compId: string; pin: string } | null>(null)
  const hoverCompRef = useRef<string | null>(null)
  const hoverWireRef = useRef<string | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean; downX: number; downY: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null)
  const holdRef = useRef<string | null>(null)
  const fittedRef = useRef(false)
  const gridRef = useRef(true)
  const [showGrid, setShowGrid] = useState(true)
  const [zoomLabel, setZoomLabel] = useState(100)
  gridRef.current = showGrid

  useSyncExternalStore(store.subscribe, () => store.circuitRev + store.selection.id + store.selection.kind + (store.circuitPlacement ?? ''))

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    if (!fittedRef.current) {
      fittedRef.current = true
      setZoomLabel(fitSchematic(camRef.current, wrap))
    }

    const pos = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { sx: event.clientX - rect.left, sy: event.clientY - rect.top, w: rect.width, h: rect.height }
    }

    const onPointerDown = (event: PointerEvent) => {
      AudioKit.unlock()
      canvas.setPointerCapture(event.pointerId)
      const { sx, sy, w, h } = pos(event)
      const cam = camRef.current
      const world = screenToWorld(cam, sx, sy, w, h)
      const entry = resolveCatalogEntry(store.circuitPlacement)
      if (entry && event.button === 0) {
        const def = COMPONENT_DEFS[entry.type]
        const names = existingNames(store.project.circuit.components, store.project.hardware.parts)
        const base = entry.label.replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim() || 'Part'
        const component: CircuitComponentData = {
          id: uid('c'),
          name: uniqueName(base, names),
          type: entry.type,
          x: snap(world.x),
          y: snap(world.y),
          props: propsForCatalogEntry(entry),
        }
        store.project.circuit.components.push(component)
        store.setSelection({ kind: 'circuit', id: component.id })
        if (!event.shiftKey) store.circuitPlacement = null
        store.markCircuitDirty()
        return
      }
      if (event.button === 1) {
        panRef.current = { sx, sy, cx: cam.x, cy: cam.y }
        return
      }
      const pin = hitTestPin(store.project.circuit, world.x, world.y, 12 / camRef.current.zoom)
      if (pin && event.button === 0) {
        draftRef.current = { fromComp: pin.compId, fromPin: pin.pin }
        return
      }
      const component = hitTestComponent(store.project.circuit, world.x, world.y)
      if (component && event.button === 0) {
        store.setSelection({ kind: 'circuit', id: component.id })
        dragRef.current = { id: component.id, dx: component.x - world.x, dy: component.y - world.y, moved: false, downX: world.x, downY: world.y }
        if (component.type === 'switchPush') {
          getCircuit().holdMouse(component.id, true)
          holdRef.current = component.id
        }
        return
      }
      const wireId = hitTestWire(store.project, world.x, world.y, 8 / camRef.current.zoom)
      if (wireId && event.button === 0) {
        store.setSelection({ kind: 'wire', id: wireId })
        return
      }
      if (event.button === 0) {
        panRef.current = { sx, sy, cx: cam.x, cy: cam.y }
        store.setSelection({ kind: 'none', id: '' })
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const { sx, sy, w, h } = pos(event)
      const cam = camRef.current
      const world = screenToWorld(cam, sx, sy, w, h)
      mouseRef.current = world
      if (panRef.current) {
        const pan = panRef.current
        cam.x = pan.cx - (sx - pan.sx) / cam.zoom
        cam.y = pan.cy - (sy - pan.sy) / cam.zoom
        canvas.style.cursor = 'grabbing'
        return
      }
      if (dragRef.current) {
        const drag = dragRef.current
        const component = store.project.circuit.components.find((item) => item.id === drag.id)
        if (component) {
          const x = snap(world.x + drag.dx)
          const y = snap(world.y + drag.dy)
          if (Math.abs(world.x - drag.downX) + Math.abs(world.y - drag.downY) > 5) drag.moved = true
          if (component.x !== x || component.y !== y) {
            component.x = x
            component.y = y
            drag.moved = true
            store.notify()
          }
        }
        return
      }
      hoverPinRef.current = hitTestPin(store.project.circuit, world.x, world.y, 12 / camRef.current.zoom)
      const component = hitTestComponent(store.project.circuit, world.x, world.y)
      hoverCompRef.current = component?.id ?? null
      hoverWireRef.current = component || hoverPinRef.current ? null : hitTestWire(store.project, world.x, world.y, 8 / camRef.current.zoom)
      canvas.style.cursor = store.circuitPlacement ? 'copy' : hoverPinRef.current ? 'crosshair' : component ? 'move' : hoverWireRef.current ? 'pointer' : 'grab'
    }

    const releaseHold = () => {
      if (!holdRef.current) return
      getCircuit().holdMouse(holdRef.current, false)
      holdRef.current = null
    }

    const onPointerUp = (event: PointerEvent) => {
      const { sx, sy, w, h } = pos(event)
      const world = screenToWorld(camRef.current, sx, sy, w, h)
      releaseHold()
      if (draftRef.current) {
        const draft = draftRef.current
        draftRef.current = null
        const target = hitTestPin(store.project.circuit, world.x, world.y, 12 / camRef.current.zoom)
        if (target && !(target.compId === draft.fromComp && target.pin === draft.fromPin)) {
          const exists = store.project.circuit.wires.some((wire) =>
            (wire.from.componentId === draft.fromComp && wire.from.pin === draft.fromPin && wire.to.componentId === target.compId && wire.to.pin === target.pin) ||
            (wire.to.componentId === draft.fromComp && wire.to.pin === draft.fromPin && wire.from.componentId === target.compId && wire.from.pin === target.pin),
          )
          if (!exists) {
            const wire = { id: uid('w'), from: { componentId: draft.fromComp, pin: draft.fromPin }, to: { componentId: target.compId, pin: target.pin } }
            store.project.circuit.wires.push(wire)
            store.setSelection({ kind: 'wire', id: wire.id })
            store.markCircuitDirty()
          }
        }
      } else if (dragRef.current) {
        const drag = dragRef.current
        dragRef.current = null
        const component = store.project.circuit.components.find((item) => item.id === drag.id)
        if (component && !drag.moved && component.type === 'switchSlide') {
          getCircuit().toggleSlide(component)
          store.notify()
        }
        if (drag.moved) store.markCircuitDirty()
      }
      panRef.current = null
    }

    const onPointerCancel = () => {
      releaseHold()
      draftRef.current = null
      dragRef.current = null
      panRef.current = null
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const { sx, sy, w, h } = pos(event)
      const cam = camRef.current
      const before = screenToWorld(cam, sx, sy, w, h)
      cam.zoom = Math.max(0.2, Math.min(3, cam.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const after = screenToWorld(cam, sx, sy, w, h)
      cam.x += before.x - after.x
      cam.y += before.y - after.y
      setZoomLabel(Math.round(cam.zoom * 100))
    }

    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreWorkspaceShortcut(event)) return
      if (event.key === 'Delete' || event.key === 'Backspace') store.deleteSelection()
      else if (event.key === 'Escape') {
        draftRef.current = null
        store.circuitPlacement = null
        store.setSelection({ kind: 'none', id: '' })
      } else if (event.key.toLowerCase() === 'f') setZoomLabel(fitSchematic(camRef.current, wrap))
      else if (event.key.toLowerCase() === 'g') setShowGrid((value) => !value)
    }

    const onContext = (event: Event) => event.preventDefault()
    const loop = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) resize()
      drawSchematic(ctx, store.project, {
        engine: getCircuit(), cam: camRef.current, cw: rect.width, ch: rect.height, dpr,
        selection: store.selection, placement: store.circuitPlacement, hoverPin: hoverPinRef.current,
        hoverComp: hoverCompRef.current, hoverWire: hoverWireRef.current, mouseWorld: mouseRef.current,
        wireDraft: draftRef.current, time: prefersReducedMotion() ? 0 : performance.now() / 1000, showGrid: gridRef.current,
      })
      raf = requestAnimationFrame(loop)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('contextmenu', onContext)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('contextmenu', onContext)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      releaseHold()
    }
  }, [])

  const placing = resolveCatalogEntry(store.circuitPlacement)
  const zoomBy = (factor: number) => {
    const cam = camRef.current
    cam.zoom = Math.max(0.2, Math.min(3, cam.zoom * factor))
    setZoomLabel(Math.round(cam.zoom * 100))
  }
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive circuit schematic"/>
      <div className="canvas-tools" aria-label="Schematic view controls">
        <button className="btn" onClick={() => setZoomLabel(fitSchematic(camRef.current, wrapRef.current))} title="Fit circuit (F)">Fit</button>
        <button className="btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
        <span className="hud-value">{zoomLabel}%</span>
        <button className="btn" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        <button className={'btn' + (showGrid ? ' armed' : '')} onClick={() => setShowGrid((value) => !value)} aria-pressed={showGrid} title="Toggle grid (G)">Grid</button>
      </div>
      <div className="canvas-hint">
        {placing ? `Placing ${placing.label} · click to place · Shift-click for several · Esc to cancel` : 'Drag pins to wire · drag empty space to pan · wheel to zoom · F fit · G grid · Delete removes selection'}
      </div>
    </div>
  )
}
