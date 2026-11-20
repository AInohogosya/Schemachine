// ============================================================================
// Part Studio — build complex part shapes: primitives, indent/bulge brush
// sculpting, and STL import. All edits are parametric (ops list) so they
// serialize into .schemachine.json and rebuild physics colliders deterministically.
// ============================================================================

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { store, uid } from '../store'
import type { CustomMesh } from '../types'
import { createScene } from '../render3d/scene'
import { buildMeshData } from '../studio/meshdata'
import { meshDataToGeometry } from '../studio/meshbuild'
import { normalizeGeometry, parseStl, f32ToBase64, u32ToBase64 } from '../studio/stl'

export function meshMap(): Map<string, CustomMesh> {
  return new Map(store.project.hardware.meshes.map((m) => [m.id, m]))
}

export default function PartStudioView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bundleRef = useRef<ReturnType<typeof createScene> | null>(null)
  const meshObjRef = useRef<THREE.Mesh | null>(null)
  const [mode, setMode] = useState<'sculpt' | 'orbit'>('sculpt')
  const [tool, setTool] = useState<'indent' | 'bulge'>('indent')
  const [radius, setRadius] = useState(24)
  const [strength, setStrength] = useState(8)
  const [falloff, setFalloff] = useState(2)
  const [wire, setWire] = useState(false)
  const [spin, setSpin] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const paintRef = useRef<{ x: number; y: number; z: number } | null>(null)

  const selId = store.studioMeshId
  useSyncExternalStore(store.subscribe, () => (store.studioMeshId ?? '') + store.hardwareRev)

  const mesh: CustomMesh | undefined = store.project.hardware.meshes.find((m) => m.id === selId)

  const rebuildMeshObject = () => {
    const bundle = bundleRef.current
    if (!bundle || !mesh) return
    if (meshObjRef.current) {
      bundle.scene.remove(meshObjRef.current)
      meshObjRef.current.geometry.dispose()
      ;(meshObjRef.current.material as THREE.Material).dispose()
    }
    const data = buildMeshData(mesh)
    const geo = meshDataToGeometry(data)
    const mat = new THREE.MeshStandardMaterial({
      color: '#7897a0',
      roughness: 0.55,
      metalness: 0.12,
      wireframe: wire,
      side: THREE.DoubleSide,
    })
    const obj = new THREE.Mesh(geo, mat)
    obj.castShadow = true
    obj.receiveShadow = true
    bundle.scene.add(obj)
    meshObjRef.current = obj
  }

  // scene lifecycle
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const bundle = createScene(canvas)
    bundleRef.current = bundle
    bundle.setGroundY(-60)
    bundle.camera.position.set(160, 140, 320)
    bundle.controls.target.set(0, 0, 0)
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (spin) {
        const o = meshObjRef.current
        if (o) o.rotation.y += 0.008
      }
      bundle.controls.update()
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
        rendererResize(bundle, canvas, wrap)
      }
      bundle.renderer.render(bundle.scene, bundle.camera)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      bundle.dispose()
      bundleRef.current = null
      meshObjRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // rebuild on mesh/ops/wire change
  useEffect(() => {
    rebuildMeshObject()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, mesh?.ops.length, mesh?.stl, mesh?.base, mesh?.w, mesh?.h, mesh?.depth, mesh?.segments, wire])

  const stampAt = (clientX: number, clientY: number, allowDrag: boolean) => {
    const bundle = bundleRef.current
    const obj = meshObjRef.current
    if (!bundle || !obj || !mesh) return false
    const rect = canvasRef.current!.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, bundle.camera)
    const hits = ray.intersectObject(obj, false)
    if (hits.length === 0) {
      if (!allowDrag) paintRef.current = null
      return false
    }
    const p = obj.worldToLocal(hits[0].point.clone())
    const last = paintRef.current
    if (allowDrag && last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z)
      if (d < radius * 0.4) return true
    }
    paintRef.current = { x: p.x, y: p.y, z: p.z }
    if (mesh.ops.length >= 300) {
      store.toast('Op limit reached (300) — undo some stamps first', 'warn')
      return true
    }
    mesh.ops.push({
      x: p.x,
      y: p.y,
      z: p.z,
      radius,
      strength: tool === 'indent' ? -Math.abs(strength) : Math.abs(strength),
      falloff,
    })
    store.markHardwareDirty()
    return true
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const down = (e: PointerEvent) => {
      if (mode !== 'sculpt' || e.button !== 0) return
      if (stampAt(e.clientX, e.clientY, false)) {
        bundleRef.current!.controls.enabled = false
        canvas.setPointerCapture(e.pointerId)
      }
    }
    const move = (e: PointerEvent) => {
      if (mode !== 'sculpt' || !bundleRef.current || bundleRef.current.controls.enabled) return
      if (e.buttons & 1) stampAt(e.clientX, e.clientY, true)
    }
    const up = () => {
      if (bundleRef.current) bundleRef.current.controls.enabled = true
      paintRef.current = null
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('lostpointercapture', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('lostpointercapture', up)
      up()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tool, radius, strength, falloff, selId])

  const createMesh = (base: CustomMesh['base']) => {
    const names = new Set(store.project.hardware.meshes.map((m) => m.name.toLowerCase()))
    let i = 1
    while (names.has(`shape ${i}`)) i++
    const m: CustomMesh = {
      id: uid('m'), name: `Shape ${i}`, base,
      w: 120, h: 80, depth: 30, segments: 18, ops: [],
    }
    store.project.hardware.meshes.push(m)
    store.studioMeshId = m.id
    store.markHardwareDirty()
    store.toast(`Created ${m.name}`, 'ok')
  }

  const importStl = (f: File) => {
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const buf = rd.result as ArrayBuffer
        const geo = normalizeGeometry(parseStl(buf), 120)
        if (geo.positions.length < 9) throw new Error('no triangles found')
        const target: CustomMesh =
          mesh ?? (() => {
            const m: CustomMesh = {
              id: uid('m'), name: f.name.replace(/\.stl$/i, '') || 'STL Shape',
              base: 'plate', w: 120, h: 120, depth: 120, segments: 8, ops: [],
            }
            store.project.hardware.meshes.push(m)
            return m
          })()
        target.name = mesh ? target.name : f.name.replace(/\.stl$/i, '') || 'STL Shape'
        target.stl = {
          positions: f32ToBase64(geo.positions),
          indices: u32ToBase64(geo.indices),
          vertexCount: geo.positions.length / 3,
          triangleCount: geo.indices.length / 3,
        }
        target.ops = []
        store.studioMeshId = target.id
        store.markHardwareDirty()
        store.toast(`Imported ${target.stl.triangleCount} triangles`, 'ok')
      } catch (err) {
        store.toast(err instanceof Error ? err.message : 'STL import failed', 'error')
      }
    }
    rd.readAsArrayBuffer(f)
  }

  const verts = mesh ? buildMeshData(mesh).positions.length / 3 : 0

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive 3D Part Studio" style={{ width: '100%', height: '100%' }} />
      <div className="canvas-tools studio-tools" aria-label="Sculpting tools">
        <button className={'btn' + (mode === 'sculpt' ? ' armed' : '')} onClick={() => setMode('sculpt')} aria-pressed={mode === 'sculpt'}>Sculpt</button>
        <button className={'btn' + (mode === 'orbit' ? ' armed' : '')} onClick={() => setMode('orbit')} aria-pressed={mode === 'orbit'}>Orbit</button>
        <button className={'btn' + (mode === 'sculpt' && tool === 'indent' ? ' armed' : '')} onClick={() => { setTool('indent'); setMode('sculpt') }} aria-pressed={mode === 'sculpt' && tool === 'indent'}>Indent</button>
        <button className={'btn' + (mode === 'sculpt' && tool === 'bulge' ? ' armed' : '')} onClick={() => { setTool('bulge'); setMode('sculpt') }} aria-pressed={mode === 'sculpt' && tool === 'bulge'}>Bulge</button>
      </div>
      <div className="hud studio-hud" aria-label="Shape creation and display controls">
        <button className="btn" onClick={() => createMesh('plate')}>+ Plate</button>
        <button className="btn" onClick={() => createMesh('cylinder')}>+ Cylinder</button>
        <button className="btn" onClick={() => createMesh('sphere')}>+ Sphere</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import STL</button>
        <button className={'btn' + (wire ? ' armed' : '')} onClick={() => setWire(!wire)} aria-pressed={wire}>Wireframe</button>
        <button className={'btn' + (spin ? ' armed' : '')} onClick={() => setSpin(!spin)} aria-pressed={spin}>Auto-rotate</button>
        <span className="hud-label">
          {mesh ? `${mesh.name} · ${verts.toFixed(0)} vertices · ${mesh.ops.length} stamps` : 'No shape selected'}
        </span>
      </div>
      <div className="canvas-hint">
        {mode === 'sculpt'
          ? 'Drag on the surface to stamp dents/bulges • drag empty space to orbit • right-drag pans'
          : 'Left-drag orbits • wheel zooms • right-drag pans'}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".stl"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importStl(f)
          e.target.value = ''
        }}
      />
      <StudioSidePanel
        radius={radius} setRadius={setRadius}
        strength={strength} setStrength={setStrength}
        falloff={falloff} setFalloff={setFalloff}
      />
    </div>
  )
}

function rendererResize(
  bundle: ReturnType<typeof createScene>,
  canvas: HTMLCanvasElement,
  wrap: HTMLDivElement,
) {
  const r = wrap.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(r.width * dpr)
  canvas.height = Math.round(r.height * dpr)
  bundle.renderer.setSize(r.width, r.height, false)
  bundle.camera.aspect = r.width / r.height
  bundle.camera.updateProjectionMatrix()
}

/** Brush + mesh settings rendered inside the canvas wrap (right side). */
function StudioSidePanel(props: {
  radius: number; setRadius: (v: number) => void
  strength: number; setStrength: (v: number) => void
  falloff: number; setFalloff: (v: number) => void
}) {
  useSyncExternalStore(store.subscribe, () => (store.studioMeshId ?? '') + store.hardwareRev)
  const mesh = store.project.hardware.meshes.find((m) => m.id === store.studioMeshId)
  const [assignPart, setAssignPart] = useState('')
  if (!mesh) {
    return (
      <div className="studio-panel empty">
        Create a plate, cylinder, or sphere, or import an STL to begin sculpting.
      </div>
    )
  }
  const usedBy = store.project.hardware.parts.filter((p) => p.props.meshId === mesh.id)
  return (
    <div className="studio-panel" aria-label="Brush and shape settings">
      <div className="field">
        <label>Shape name</label>
        <input aria-label="Shape name" type="text" value={mesh.name} onChange={(e) => { mesh.name = e.target.value; store.markHardwareDirty() }} spellCheck={false} />
      </div>
      <div className="field">
        <label>Brush radius ({props.radius})</label>
        <input aria-label="Brush radius" type="range" min={4} max={80} value={props.radius} onChange={(e) => props.setRadius(Number(e.target.value))} />
      </div>
      <div className="field">
        <label>Brush strength ({props.strength})</label>
        <input aria-label="Brush strength" type="range" min={1} max={30} value={props.strength} onChange={(e) => props.setStrength(Number(e.target.value))} />
      </div>
      <div className="field">
        <label>Falloff ({props.falloff.toFixed(1)})</label>
        <input aria-label="Brush falloff" type="range" min={1} max={4} step={0.1} value={props.falloff} onChange={(e) => props.setFalloff(Number(e.target.value))} />
      </div>
      {!mesh.stl && (
        <div className="row2">
          <div className="field"><label>W</label><input aria-label="Shape width" type="number" value={Math.round(mesh.w)} onChange={(e) => { mesh.w = Math.max(8, Number(e.target.value)); store.markHardwareDirty() }} /></div>
          <div className="field"><label>H</label><input aria-label="Shape height" type="number" value={Math.round(mesh.h)} onChange={(e) => { mesh.h = Math.max(8, Number(e.target.value)); store.markHardwareDirty() }} /></div>
        </div>
      )}
      {!mesh.stl && (
        <div className="row2">
          <div className="field"><label>Depth</label><input aria-label="Shape depth" type="number" value={Math.round(mesh.depth)} onChange={(e) => { mesh.depth = Math.max(8, Number(e.target.value)); store.markHardwareDirty() }} /></div>
          <div className="field"><label>Segments</label><input aria-label="Mesh segments" type="number" min={4} max={40} value={mesh.segments} onChange={(e) => { mesh.segments = Math.max(4, Math.min(40, Math.round(Number(e.target.value)))); store.markHardwareDirty() }} /></div>
        </div>
      )}
      {mesh.stl && <div className="help-text">STL: {mesh.stl.triangleCount} tris (sculptable on top)</div>}
      <div className="row2" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => { mesh.ops.pop(); store.markHardwareDirty() }} disabled={mesh.ops.length === 0}>Undo stamp</button>
        <button className="btn danger" onClick={() => { mesh.ops = []; store.markHardwareDirty() }} disabled={mesh.ops.length === 0}>Clear</button>
      </div>
      <div className="field">
        <label>Use on hardware part</label>
        <div className="row2">
          <select aria-label="Hardware part for custom shape" value={assignPart} onChange={(e) => setAssignPart(e.target.value)}>
            <option value="">(choose part)</option>
            {store.project.hardware.parts.filter((p) => p.kind !== 'water').map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="btn" style={{ flex: '0 0 auto' }} disabled={!assignPart} onClick={() => {
            const part = store.partById(assignPart)
            if (part) {
              part.props.meshId = mesh.id
              store.markHardwareDirty()
              store.toast(`${mesh.name} → ${part.name}`, 'ok')
            }
          }}>Apply</button>
        </div>
      </div>
      {usedBy.length > 0 && (
        <div className="help-text">Used by: {usedBy.map((p) => p.name).join(', ')}</div>
      )}
      <button className="btn danger" onClick={() => {
        if (usedBy.length > 0) {
          store.toast(`In use by ${usedBy.length} part(s) — unassign first`, 'warn')
          return
        }
        store.project.hardware.meshes = store.project.hardware.meshes.filter((m) => m.id !== mesh.id)
        store.studioMeshId = store.project.hardware.meshes[0]?.id ?? null
        store.markHardwareDirty()
      }}>Delete shape</button>
    </div>
  )
}
