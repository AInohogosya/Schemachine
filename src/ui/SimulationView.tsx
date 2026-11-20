// ============================================================================
// Unified 3D simulation: Rapier rigid bodies + circuit solver in one 60 Hz
// loop, rendered with Three.js. Click switch pads on the model, hold
// push-pads, use keyboard bindings, drag bodies to throw them.
// ============================================================================

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { getCircuit } from '../runtime'
import { store } from '../store'
import { SimRunner3D } from '../sim/runner3d'
import { createScene, makeJointGizmo, makeWaterBox, toWorldY } from '../render3d/scene'
import { buildPartMesh, type PartRefs } from '../render3d/parts'
import { partDepthOf } from '../physics/materials'
import { AudioKit } from '../sim/audio'
import type { HardwarePartData } from '../types'

function ledCss(color: string | undefined): string {
  const map: Record<string, string> = {
    red: '#ef4444', green: '#22c55e', blue: '#3b82f6',
    yellow: '#facc15', white: '#f8fafc',
  }
  return map[color ?? 'red'] ?? '#ef4444'
}

function meshLib(): Map<string, import('../types').CustomMesh> {
  return new Map(store.project.hardware.meshes.map((m) => [m.id, m]))
}

export default function SimulationView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const runnerRef = useRef<SimRunner3D | null>(null)
  const bundleRef = useRef<ReturnType<typeof createScene> | null>(null)
  const contentRef = useRef<THREE.Group | null>(null)
  const partObjsRef = useRef(new Map<string, THREE.Group>())
  const refsRef = useRef(new Map<string, PartRefs>())
  const gizmosRef = useRef(new Map<string, THREE.Group>())
  const particleMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const [playing, setPlaying] = useState(true)
  const [gen, setGen] = useState(0)
  const [gravity, setGravity] = useState(1)
  const [fps, setFps] = useState(0)
  const [showGrid, setShowGrid] = useState(true)
  const playingRef = useRef(true)
  const gravityRef = useRef(1)
  const dragRef = useRef<RAPIER.RigidBody | null>(null)
  const pressPartRef = useRef<string | null>(null)

  playingRef.current = playing
  gravityRef.current = gravity

  useSyncExternalStore(store.subscribe, () => store.hardwareRev)

  // runner + scene lifecycle
  useEffect(() => {
    let dead = false
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const bundle = createScene(canvas)
    bundleRef.current = bundle
    bundle.setGroundY(store.project.groundY)

    // static content: water volumes (bodies move, water stays)
    const content = new THREE.Group()
    const lib = meshLib()
    partObjsRef.current.clear()
    refsRef.current.clear()
    gizmosRef.current.clear()
    for (const p of store.project.hardware.parts) {
      if (p.kind !== 'water') continue
      const depth = partDepthOf('water', p.props.depth)
      const wb = makeWaterBox(p.w, p.h, depth)
      wb.position.set(p.x, toWorldY(p.y), p.z ?? 0)
      content.add(wb)
    }
    bundle.scene.add(content)
    contentRef.current = content

    // particles
    const pgeo = new THREE.SphereGeometry(5, 10, 8)
    const pmat = new THREE.MeshStandardMaterial({ color: '#6e9fac', roughness: 0.35 })
    const pinst = new THREE.InstancedMesh(pgeo, pmat, 240)
    pinst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    pinst.castShadow = true
    pinst.frustumCulled = false
    content.add(pinst)
    particleMeshRef.current = pinst

    // fit camera
    {
      const parts = store.project.hardware.parts
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
      for (const p of parts) {
        const r = Math.max(p.w, p.h) / 2
        x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, -p.y - r)
        x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, -p.y + r)
      }
      if (parts.length === 0) { x0 = -400; y0 = -700; x1 = 400; y1 = -100 }
      y0 = Math.min(y0, toWorldY(store.project.groundY))
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const size = Math.max(x1 - x0, (y1 - y0) * 1.4, 300)
      bundle.controls.target.set(cx, cy, 0)
      bundle.camera.position.set(cx + size * 0.45, cy + size * 0.4, size * 1.15)
    }

    SimRunner3D.create(store.project, getCircuit()).then((runner) => {
      if (dead) {
        runner.destroy()
        return
      }
      runner.world.gravityScale = gravityRef.current
      runnerRef.current = runner
      // body meshes (one Group per part, posed from physics each frame)
      for (const p of store.project.hardware.parts) {
        if (p.kind === 'water') continue
        const { group, refs } = buildPartMesh(p, meshLib())
        group.traverse((o) => {
          o.userData.partId = p.id
        })
        content.add(group)
        partObjsRef.current.set(p.id, group)
        refsRef.current.set(p.id, refs)
      }
      // joint gizmos
      const pmap = new Map(store.project.hardware.parts.map((x) => [x.id, x]))
      for (const j of store.project.hardware.joints) {
        const g = makeJointGizmo(j.type, j.type === 'motor' ? (j.props.boundComponent ?? '') : '')
        content.add(g)
        gizmosRef.current.set(j.id, g)
      }
      void pmap
    }).catch(() => {
      if (!dead) store.toast('3D physics engine failed to initialise', 'error')
    })

    return () => {
      dead = true
      runnerRef.current?.destroy()
      runnerRef.current = null
      bundle.dispose()
      bundleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const bundle = bundleRef.current
    if (!canvas || !wrap || !bundle) return

    let raf = 0
    let last = performance.now()
    let acc = 0
    let frames = 0
    let fpsT = last
    const dummy = new THREE.Object3D()

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      frames++
      if (now - fpsT > 500) {
        setFps(Math.round((frames * 1000) / (now - fpsT)))
        frames = 0
        fpsT = now
      }
      const runner = runnerRef.current
      const r = wrap.getBoundingClientRect()
      const cw = Math.max(1, Math.round(r.width))
      const ch = Math.max(1, Math.round(r.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        bundle.renderer.setSize(cw, ch, false)
        bundle.camera.aspect = cw / ch
        bundle.camera.updateProjectionMatrix()
      }

      if (runner && playingRef.current) {
        runner.world.gravityScale = gravityRef.current
        acc += dt
        let steps = 0
        while (acc >= 1 / 60 && steps < 3) {
          runner.step(performance.now())
          acc -= 1 / 60
          steps++
        }
        if (steps === 3) acc = 0
      }

      if (runner) syncScene(runner, dummy)
      if (runner) runner.syncAudio()
      bundle.controls.update()
      bundle.renderer.render(bundle.scene, bundle.camera)
    }

    const ray = new THREE.Raycaster()
    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const pickPart = (e: PointerEvent): string | null => {
      ray.setFromCamera(ndc(e), bundle.camera)
      const hits = ray.intersectObjects([...partObjsRef.current.values()], true)
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object
        while (o && !o.userData.partId) o = o.parent
        if (o?.userData.partId) return o.userData.partId as string
      }
      return null
    }
    const isInteractive = (part: HardwarePartData): boolean => {
      if (part.kind === 'switchPad') return true
      const bound = (part.props.boundComponent ?? '').trim().toLowerCase()
      if (!bound) return false
      return store.project.circuit.components.some(
        (c) => (c.type === 'switchPush' || c.type === 'switchSlide') && c.name.trim().toLowerCase() === bound,
      )
    }

    const onPointerDown = (e: PointerEvent) => {
      AudioKit.unlock()
      if (e.button !== 0) return
      canvas.setPointerCapture(e.pointerId)
      const runner = runnerRef.current
      if (!runner) return
      const partId = pickPart(e)
      const part = partId ? store.project.hardware.parts.find((p) => p.id === partId) : undefined
      if (part && isInteractive(part)) {
        pressPartRef.current = part.id
        runner.pressPhysical(part.id, true)
        return
      }
      if (part) {
        const body = runner.world.bodies.get(part.id)
        if (body && !body.isFixed()) {
          dragRef.current = body
          bundle.controls.enabled = false
          canvas.setPointerCapture(e.pointerId)
          return
        }
      }
      return
    }

    const onPointerMove = (e: PointerEvent) => {
      const body = dragRef.current
      if (!body) return
      ray.setFromCamera(ndc(e), bundle.camera)
      const camDir = bundle.camera.getWorldDirection(new THREE.Vector3())
      const t = body.translation()
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.negate(), new THREE.Vector3(t.x, t.y, t.z))
      const pt = new THREE.Vector3()
      if (!ray.ray.intersectPlane(plane, pt)) return
      body.setLinvel({ x: (pt.x - t.x) * 8, y: (pt.y - t.y) * 8, z: (pt.z - t.z) * 8 }, true)
    }

    const onPointerUp = () => {
      const runner = runnerRef.current
      if (pressPartRef.current && runner) {
        runner.pressPhysical(pressPartRef.current, false)
        pressPartRef.current = null
      }
      // Release the drag but keep its velocity: throwing works.
      dragRef.current = null
      bundle.controls.enabled = true
    }
    const onContext = (ev: Event) => ev.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('contextmenu', onContext)
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('contextmenu', onContext)
      dragRef.current = null
      bundle.controls.enabled = true
      if (pressPartRef.current && runnerRef.current) {
        try {
          runnerRef.current.pressPhysical(pressPartRef.current, false)
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen])

  // ---- per-frame scene sync ----
  const syncScene = (runner: SimRunner3D, dummy: THREE.Object3D) => {
    const eng = getCircuit()
    // parts follow physics
    for (const p of store.project.hardware.parts) {
      if (p.kind === 'water') continue
      const obj = partObjsRef.current.get(p.id)
      const pose = runner.world.partPose(p.id)
      if (!obj || !pose) continue
      obj.position.set(pose.x, pose.y, pose.z)
      obj.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w)
      // live electrical visuals
      const refs = refsRef.current.get(p.id)
      const bound = (p.props.boundComponent ?? '').trim().toLowerCase()
      const boundComps = bound
        ? store.project.circuit.components.filter((c) => c.name.trim().toLowerCase() === bound)
        : []
      if (refs && p.kind === 'ledBulb') {
        let glow = 0
        let css = ledCss(undefined)
        for (const c of boundComps) {
          const st = eng.runtime.states.get(c.id)
          if (!st) continue
          if (c.type === 'led') {
            glow = Math.max(glow, st.brightness ?? 0)
            css = ledCss(c.props.color)
          } else if (c.type === 'rgbLed') {
            glow = Math.max(glow, st.brightness ?? 0)
            const channels = st.channels ?? { R: 0, G: 0, B: 0 }
            const channel = (value: number) => Math.round(45 + Math.max(0, Math.min(1, value)) * 210)
            css = `rgb(${channel(channels.R)},${channel(channels.G)},${channel(channels.B)})`
          } else if (c.type === 'incandescent') {
            glow = Math.max(glow, st.brightness ?? 0)
            css = '#d6a854'
          }
        }
        for (const m of refs.glowMats) {
          m.emissive.set(css)
          m.emissiveIntensity = glow * 1.8
        }
        for (const s of refs.sprites) {
          ;(s.material as THREE.SpriteMaterial).opacity = glow * 0.65
          ;(s.material as THREE.SpriteMaterial).color.set(css)
        }
      }
      if (refs && p.kind === 'switchPad' && refs.lever) {
        const on = runner.padState(p.id)
        refs.lever.rotation.z += ((on ? 0.5 : -0.5) - refs.lever.rotation.z) * 0.3
        for (const m of refs.glowMats) m.emissiveIntensity = on ? 0.9 : 0
      }
      if (refs && p.kind === 'thruster') {
        const a = runner.activeOf(p.props.boundComponent)
        if (refs.flame) {
          refs.flame.visible = a > 0.02
          refs.flame.scale.set(0.6 + a, 0.6 + a * 0.6, 0.6 + a)
        }
        for (const s of refs.sprites) (s.material as THREE.SpriteMaterial).opacity = a * 0.85
      }
      if (refs && p.kind === 'speaker') {
        let a = 0
        for (const c of boundComps) {
          const st = eng.runtime.states.get(c.id)
          if ((c.type === 'buzzer' || c.type === 'speaker') && st) a = Math.max(a, st.active ?? 0)
        }
        if (refs.rings) refs.rings.forEach((r, i) => r.scale.setScalar(1 + a * 0.12 * Math.sin(performance.now() / 90 + i)))
      }
    }
    // joint gizmos follow anchors
    const pmap = new Map(store.project.hardware.parts.map((x) => [x.id, x]))
    for (const j of store.project.hardware.joints) {
      const g = gizmosRef.current.get(j.id)
      if (!g) continue
      const aW = runner.world.jointAnchorWorld(j, true, pmap)
      const bW = runner.world.jointAnchorWorld(j, false, pmap)
      if (!aW || !bW) continue
      g.position.set((aW.x + bW.x) / 2, (aW.y + bW.y) / 2, (aW.z + bW.z) / 2)
    }
    // particles
    const pinst = particleMeshRef.current
    if (pinst) {
      const list = runner.world.particles
      for (let i = 0; i < 240; i++) {
        const b = list[i]
        if (b) {
          const t = b.translation()
          dummy.position.set(t.x, t.y, t.z)
          dummy.updateMatrix()
          pinst.setMatrixAt(i, dummy.matrix)
        } else {
          dummy.position.set(0, -100000, 0)
          dummy.updateMatrix()
          pinst.setMatrixAt(i, dummy.matrix)
        }
      }
      pinst.instanceMatrix.needsUpdate = true
    }
  }

  const warnings = getCircuit().runtime.warnings
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive 3D physics simulation" style={{ width: '100%', height: '100%' }} />
      <div className="hud" aria-label="Simulation playback controls">
        <button className="btn primary" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button className="btn" onClick={() => setGen((g) => g + 1)}>Reset</button>
        <button className={'btn' + (showGrid ? ' armed' : '')} aria-pressed={showGrid} onClick={() => {
          const next = !showGrid
          setShowGrid(next)
          if (bundleRef.current) bundleRef.current.grid.visible = next
        }}>Grid</button>
        <label className="hud-label">
          Gravity
          <input aria-label="Gravity scale" type="range" min={0} max={2} step={0.05} value={gravity} onChange={(e) => setGravity(Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <span className="hud-value">{fps} fps</span>
      </div>
      <div className="canvas-hint">
        Drag to orbit • wheel zooms • right-drag pans • click pads on the model • drag bodies to throw them
        {warnings.length > 0 ? ` • ${warnings.length} solver warning(s)` : ''}
      </div>
    </div>
  )
}
