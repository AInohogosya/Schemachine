// ============================================================================
// Hardware assembly in 3D: orbit camera, raycast placement / dragging /
// joint authoring. Authoring stays in the assembly plane (XY + depth);
// the simulation itself is fully three-dimensional.
// ============================================================================

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { store, uid, existingNames, uniqueName } from '../store'
import type { HardwarePartData, HardwarePartType, JointType } from '../types'
import { createScene, makeJointGizmo, makeTextSprite, makeWaterBox, toWorldY } from '../render3d/scene'
import { buildPartMesh } from '../render3d/parts'
import { partDepthOf } from '../physics/materials'
import { AudioKit } from '../sim/audio'
import { shouldIgnoreWorkspaceShortcut } from './shortcuts'

export const PART_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  board: { w: 120, h: 24 },
  chassis: { w: 240, h: 36 },
  wheel: { w: 64, h: 64 },
  gear: { w: 80, h: 80 },
  propeller: { w: 110, h: 14 },
  wing: { w: 150, h: 22 },
  axle: { w: 80, h: 12 },
  duck: { w: 40, h: 40 },
  block: { w: 60, h: 60 },
  deco: { w: 80, h: 50 },
  plant: { w: 50, h: 70 },
  thruster: { w: 60, h: 30 },
  ledBulb: { w: 20, h: 26 },
  switchPad: { w: 44, h: 22 },
  speaker: { w: 50, h: 50 },
  batteryPack: { w: 64, h: 30 },
  emitter: { w: 44, h: 26 },
  water: { w: 260, h: 140 },
}

export const PART_LABELS: Record<string, string> = {
  board: 'Board / Beam',
  chassis: 'Car Chassis',
  wheel: 'Wheel / Tire',
  gear: 'Gear',
  propeller: 'Propeller / Fan',
  wing: 'Wing',
  axle: 'Axle',
  duck: 'Rubber Duck',
  block: 'Block',
  deco: 'Decoration',
  plant: 'Plant',
  thruster: 'Thruster',
  ledBulb: 'LED Bulb',
  switchPad: 'Switch Pad',
  speaker: 'Speaker',
  batteryPack: 'Battery Pack',
  emitter: 'Water Emitter',
  water: 'Water Region',
}

function meshLib(): Map<string, import('../types').CustomMesh> {
  return new Map(store.project.hardware.meshes.map((m) => [m.id, m]))
}

function disposeDeep(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}

export default function HardwareView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bundleRef = useRef<ReturnType<typeof createScene> | null>(null)
  const contentRef = useRef<THREE.Group | null>(null)
  const partObjsRef = useRef(new Map<string, THREE.Group>())
  const jointObjsRef = useRef(new Map<string, THREE.Group>())
  const dragRef = useRef<{ id: string; plane: THREE.Plane; offset: THREE.Vector3; startPoint: THREE.Vector3; startData: { x: number; y: number; z: number }; preSnap: string; moved: boolean } | null>(null)
  const ghostRef = useRef<THREE.Object3D | null>(null)
  const previewRef = useRef<THREE.Group | null>(null)
  const lastMoveRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const fittedRef = useRef(false)
  const [showGrid, setShowGrid] = useState(true)

  useSyncExternalStore(
    store.subscribe,
    () => store.hardwareRev + store.selection.id + store.selection.kind + (store.partPlacement ?? '') + (store.jointTool ? 'j' + store.jointTool.aId : ''),
  )

  const rebuild = () => {
    const bundle = bundleRef.current
    if (!bundle) return
    if (contentRef.current) {
      bundle.scene.remove(contentRef.current)
      contentRef.current.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
    }
    const content = new THREE.Group()
    const lib = meshLib()
    partObjsRef.current.clear()
    jointObjsRef.current.clear()
    for (const p of store.project.hardware.parts) {
      if (p.kind === 'water') {
        const depth = partDepthOf('water', p.props.depth)
        const wb = makeWaterBox(p.w, p.h, depth)
        wb.position.set(p.x, toWorldY(p.y), p.z ?? 0)
        wb.userData.partId = p.id
        content.add(wb)
        partObjsRef.current.set(p.id, wb as unknown as THREE.Group)
        continue
      }
      const { group } = buildPartMesh(p, lib)
      group.position.set(p.x, toWorldY(p.y), p.z ?? 0)
      group.rotation.z = (-p.angle * Math.PI) / 180
      group.userData.partId = p.id
      group.traverse((o) => {
        o.userData.partId = p.id
      })
      content.add(group)
      partObjsRef.current.set(p.id, group)
    }
    // joint gizmos
    for (const j of store.project.hardware.joints) {
      const pa = store.partById(j.a)
      const pb = store.partById(j.b)
      if (!pa || !pb) continue
      const aW = partLocalToWorld(pa, j.ax, j.ay)
      const bW = partLocalToWorld(pb, j.bx, j.by)
      const g = makeJointGizmo(j.type, j.type === 'motor' ? (j.props.boundComponent ?? '') : '')
      g.position.set((aW.x + bW.x) / 2, (aW.y + bW.y) / 2, (aW.z + bW.z) / 2)
      g.traverse((object) => { object.userData.jointId = j.id })
      jointObjsRef.current.set(j.id, g)
      content.add(g)
      if (j.type === 'slider') {
        const axisRad = ((j.props.axis ?? 90) * Math.PI) / 180
        const dir = new THREE.Vector3(Math.cos(axisRad), -Math.sin(axisRad), 0).applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          (-pa.angle * Math.PI) / 180,
        )
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(aW.x, aW.y, aW.z).addScaledVector(dir, -90),
          new THREE.Vector3(aW.x, aW.y, aW.z).addScaledVector(dir, 90),
        ])
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: '#39778c', dashSize: 6, gapSize: 5 }))
        line.computeLineDistances()
        content.add(line)
      }
    }
    // selection label
    const sel = store.selection
    if ((sel.kind === 'part' || sel.kind === 'joint') && sel.id) {
      const obj = sel.kind === 'joint' ? jointObjsRef.current.get(sel.id) : partObjsRef.current.get(sel.id)
      let anchor: THREE.Vector3 | null = null
      if (obj) anchor = obj.position.clone()
      if (sel.kind === 'joint' && !anchor) {
        const j = store.jointById(sel.id)
        const pa = j && store.partById(j.a)
        if (j && pa) {
          const aW = partLocalToWorld(pa, j.ax, j.ay)
          anchor = new THREE.Vector3(aW.x, aW.y, aW.z)
        }
      }
      if (anchor) {
        const name = sel.kind === 'part' ? (store.partById(sel.id)?.name ?? '') : `${store.jointById(sel.id)?.type} joint`
        const s = makeTextSprite(name, '#39778c', 40)
        s.position.copy(anchor).add(new THREE.Vector3(0, 46, 0))
        content.add(s)
        const helper = new THREE.BoxHelper(obj ?? new THREE.Object3D(), '#39778c')
        if (obj) content.add(helper)
      }
    }
    // joint-tool first anchor marker
    if (store.jointTool?.aId) {
      const pa = store.partById(store.jointTool.aId)
      if (pa) {
        const o = partObjsRef.current.get(pa.id)
        if (o) {
          const helper = new THREE.BoxHelper(o, '#467c64')
          content.add(helper)
        }
      }
    }
    bundle.scene.add(content)
    contentRef.current = content
  }

  // translucent ghost that follows the cursor while a part is being placed
  useEffect(() => {
    const bundle = bundleRef.current
    if (!bundle) return
    if (ghostRef.current) {
      bundle.scene.remove(ghostRef.current)
      disposeDeep(ghostRef.current)
      ghostRef.current = null
    }
    const kind = store.partPlacement
    if (!kind) return
    const size = PART_DEFAULT_SIZE[kind] ?? { w: 60, h: 40 }
    const probe: HardwarePartData = { id: 'ghost', name: 'ghost', kind: kind as HardwarePartType, x: 0, y: 0, z: 0, angle: 0, w: size.w, h: size.h, props: {} }
    const obj: THREE.Object3D = kind === 'water'
      ? makeWaterBox(size.w, size.h, partDepthOf('water', undefined))
      : buildPartMesh(probe, meshLib()).group
    obj.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) {
        o.visible = false
        return
      }
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = false
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined
        if (mat) {
          mat.transparent = true
          mat.opacity = (mat.opacity ?? 1) * 0.45
          mat.depthWrite = false
        }
      }
    })
    obj.visible = false
    bundle.scene.add(obj)
    ghostRef.current = obj
    return () => {
      if (ghostRef.current) {
        bundle.scene.remove(ghostRef.current)
        disposeDeep(ghostRef.current)
        ghostRef.current = null
      }
    }
  }, [store.partPlacement])

  // keep the ground plane in sync when the project ground level changes
  useEffect(() => {
    bundleRef.current?.setGroundY(store.project.groundY)
  }, [store.project.groundY, store.hardwareRev])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const bundle = createScene(canvas)
    bundleRef.current = bundle
    bundle.setGroundY(store.project.groundY)
    rebuild()

    // live joint-tool preview (anchor marker + line to the cursor)
    const preview = new THREE.Group()
    preview.visible = false
    bundle.scene.add(preview)
    previewRef.current = preview

    if (!fittedRef.current) {
      fittedRef.current = true
      fitCamera(bundle)
    }

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const r = wrap.getBoundingClientRect()
      const cw = Math.max(1, Math.round(r.width))
      const ch = Math.max(1, Math.round(r.height))
      if (canvas.width !== cw * Math.min(2, window.devicePixelRatio || 1) || canvas.height !== ch * Math.min(2, window.devicePixelRatio || 1)) {
        bundle.renderer.setSize(cw, ch, false)
        bundle.camera.aspect = cw / ch
        bundle.camera.updateProjectionMatrix()
      }
      bundle.controls.update()
      bundle.renderer.render(bundle.scene, bundle.camera)
    }
    raf = requestAnimationFrame(loop)

    const ray = new THREE.Raycaster()
    const ndc = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect()
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const pickPart = (e: { clientX: number; clientY: number }): { id: string; point: THREE.Vector3; normal: THREE.Vector3 } | null => {
      ray.setFromCamera(ndc(e), bundle.camera)
      const objs = [...partObjsRef.current.values()]
      const hits = ray.intersectObjects(objs, true)
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object
        while (o && !o.userData.partId) o = o.parent
        if (o?.userData.partId) {
          const n = (h.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone().transformDirection(h.object.matrixWorld)
          return { id: o.userData.partId as string, point: h.point, normal: n }
        }
      }
      return null
    }
    const pickJoint = (e: { clientX: number; clientY: number }): string | null => {
      ray.setFromCamera(ndc(e), bundle.camera)
      const hits = ray.intersectObjects([...jointObjsRef.current.values()], true)
      for (const hit of hits) {
        let object: THREE.Object3D | null = hit.object
        while (object && !object.userData.jointId) object = object.parent
        if (object?.userData.jointId) return object.userData.jointId as string
      }
      return null
    }
    /** Cursor world point (part surface or ground plane). */
    const cursorWorldPoint = (e: { clientX: number; clientY: number }): THREE.Vector3 | null => {
      const hit = pickPart(e)
      if (hit) return hit.point.clone()
      ray.setFromCamera(ndc(e), bundle.camera)
      const t = (toWorldY(store.project.groundY) - ray.ray.origin.y) / ray.ray.direction.y
      if (!Number.isFinite(t) || t < 0) return null
      return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t)
    }
    /** Placement target in authored data coords (grid-snapped, rests on ground). */
    const computePlacement = (e: { clientX: number; clientY: number }, kind: HardwarePartType): { x: number; y: number; z: number } | null => {
      const size = PART_DEFAULT_SIZE[kind] ?? { w: 60, h: 40 }
      const hit = pickPart(e)
      let pos: THREE.Vector3
      if (hit) {
        pos = hit.point.clone().addScaledVector(hit.normal, 4)
      } else {
        ray.setFromCamera(ndc(e), bundle.camera)
        const t = (toWorldY(store.project.groundY) - ray.ray.origin.y) / ray.ray.direction.y
        if (!Number.isFinite(t) || t < 0) return null
        pos = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t)
      }
      const x = Math.round(pos.x / 5) * 5
      const z = Math.round(pos.z / 5) * 5
      let y = Math.round(-pos.y / 5) * 5
      const gy = store.project.groundY
      if (y + Math.max(size.w, size.h) / 2 > gy) y = gy - Math.max(size.w, size.h) / 2
      return { x, y, z }
    }
    /** How close (world px) the second joint anchor must be to snap onto the first. */
    const JOINT_SNAP = 16

    const updateGhost = (e: { clientX: number; clientY: number } | null) => {
      const ghost = ghostRef.current
      if (!ghost) return
      const kind = store.partPlacement
      if (!kind || !e) {
        ghost.visible = false
        return
      }
      const pos = computePlacement(e, kind as HardwarePartType)
      if (!pos) {
        ghost.visible = false
        return
      }
      ghost.position.set(pos.x, toWorldY(pos.y), pos.z)
      ghost.visible = true
    }

    const updateJointPreview = (e: { clientX: number; clientY: number } | null) => {
      const g = previewRef.current
      if (!g) return
      for (const child of [...g.children]) {
        g.remove(child)
        disposeDeep(child)
      }
      const jt = store.jointTool
      const pa = jt?.aId ? store.partById(jt.aId) : undefined
      if (!jt || !pa) {
        g.visible = false
        return
      }
      const aW = partLocalToWorld(pa, jt.ax, jt.ay)
      const aV = new THREE.Vector3(aW.x, aW.y, aW.z)
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(6, 12, 8),
        new THREE.MeshBasicMaterial({ color: '#2f7d55' }),
      )
      marker.position.copy(aV)
      g.add(marker)
      if (e) {
        const point = cursorWorldPoint(e)
        if (point) {
          const snapped = point.distanceTo(aV) <= JOINT_SNAP
          if (snapped) {
            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(11, 1.6, 8, 24),
              new THREE.MeshBasicMaterial({ color: '#2e9e63' }),
            )
            ring.position.copy(aV)
            g.add(ring)
          } else {
            const geo = new THREE.BufferGeometry().setFromPoints([aV, point])
            const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: '#39778c', dashSize: 6, gapSize: 5 }))
            line.computeLineDistances()
            g.add(line)
            const dot = new THREE.Mesh(
              new THREE.SphereGeometry(4, 10, 8),
              new THREE.MeshBasicMaterial({ color: '#39778c' }),
            )
            dot.position.copy(point)
            g.add(dot)
          }
        }
      }
      g.visible = true
    }

    const onPointerDown = (e: PointerEvent) => {
      AudioKit.unlock()
      lastMoveRef.current = { clientX: e.clientX, clientY: e.clientY }
      if (e.button === 2) return // orbit pan
      // placement
      if (store.partPlacement && e.button === 0) {
        const kind = store.partPlacement as HardwarePartType
        const size = PART_DEFAULT_SIZE[kind] ?? { w: 60, h: 40 }
        const pos = computePlacement(e, kind)
        if (!pos) return
        const names = existingNames(store.project.circuit.components, store.project.hardware.parts)
        const part: HardwarePartData = {
          id: uid('p'),
          name: uniqueName(PART_LABELS[kind] ?? kind, names),
          kind,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          angle: 0,
          w: size.w,
          h: size.h,
          props: {},
        }
        store.beginChange()
        store.project.hardware.parts.push(part)
        store.setSelection({ kind: 'part', id: part.id })
        if (!e.shiftKey) store.partPlacement = null
        store.markHardwareDirty()
        rebuild()
        updateGhost(e)
        return
      }
      if (e.button !== 0) return
      const hit = pickPart(e)
      // joint tool
      if (store.jointTool) {
        if (hit) {
          const part = store.partById(hit.id)
          if (part) {
            const local = worldToPartLocal(part, hit.point)
            const jt = store.jointTool
            if (!jt.aId) {
              store.jointTool = { type: jt.type, aId: part.id, ax: local.x, ay: local.y }
              store.notify()
              rebuild()
              updateJointPreview(e)
            } else if (jt.aId !== part.id) {
              // snap the second anchor onto the first when clicked close, so
              // hinge axes line up instead of fighting the solver
              let bx = local.x
              let by = local.y
              const pa = store.partById(jt.aId)
              if (pa) {
                const aW = partLocalToWorld(pa, jt.ax, jt.ay)
                if (hit.point.distanceTo(new THREE.Vector3(aW.x, aW.y, aW.z)) <= JOINT_SNAP) {
                  const snapped = worldToPartLocal(part, new THREE.Vector3(aW.x, aW.y, aW.z))
                  bx = snapped.x
                  by = snapped.y
                }
              }
              const joint = {
                id: uid('j'),
                type: jt.type as JointType,
                a: jt.aId,
                b: part.id,
                ax: jt.ax,
                ay: jt.ay,
                bx,
                by,
                props: {},
              }
              store.beginChange()
              store.project.hardware.joints.push(joint)
              store.setSelection({ kind: 'joint', id: joint.id })
              store.jointTool = { type: jt.type, aId: '', ax: 0, ay: 0 }
              store.markHardwareDirty()
              rebuild()
              updateJointPreview(e)
            }
          }
        }
        return
      }
      const jointId = pickJoint(e)
      if (jointId) {
        store.setSelection({ kind: 'joint', id: jointId })
        rebuild()
        return
      }
      // drag part
      if (hit) {
        store.setSelection({ kind: 'part', id: hit.id })
        const n = bundle.camera.getWorldDirection(new THREE.Vector3()).negate()
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point)
        const part = store.partById(hit.id)!
        const startPt = new THREE.Vector3()
        ray.setFromCamera(ndc(e), bundle.camera)
        ray.ray.intersectPlane(plane, startPt)
        dragRef.current = {
          id: hit.id,
          plane,
          offset: new THREE.Vector3(part.x - hit.point.x, -part.y - hit.point.y, (part.z ?? 0) - hit.point.z),
          startPoint: startPt,
          startData: { x: part.x, y: part.y, z: part.z ?? 0 },
          preSnap: store.snapshot(),
          moved: false,
        }
        bundle.controls.enabled = false
        canvas.setPointerCapture(e.pointerId)
        rebuild()
        return
      }
      store.setSelection({ kind: 'none', id: '' })
      rebuild()
    }

    const onPointerMove = (e: PointerEvent) => {
      lastMoveRef.current = { clientX: e.clientX, clientY: e.clientY }
      updateGhost(e)
      updateJointPreview(e)
      const d = dragRef.current
      if (!d) return
      ray.setFromCamera(ndc(e), bundle.camera)
      const pt = new THREE.Vector3()
      if (!ray.ray.intersectPlane(d.plane, pt)) return
      // Shift locks movement to the dominant screen axis
      if (e.shiftKey && d.startPoint) {
        if (Math.abs(pt.x - d.startPoint.x) >= Math.abs(pt.y - d.startPoint.y)) pt.y = d.startPoint.y
        else pt.x = d.startPoint.x
      }
      const part = store.partById(d.id)
      if (!part) return
      pt.add(d.offset)
      part.x = Math.round(pt.x / 5) * 5
      part.y = Math.round(-pt.y / 5) * 5
      part.z = Math.round(pt.z / 5) * 5
      if (part.x !== d.startData.x || part.y !== d.startData.y || part.z !== d.startData.z) d.moved = true
      const obj = partObjsRef.current.get(part.id)
      if (obj) obj.position.set(part.x, toWorldY(part.y), part.z ?? 0)
      store.notify()
    }

    const onPointerUp = () => {
      const d = dragRef.current
      if (d) {
        if (d.moved) store.pushSnapshot(d.preSnap)
        store.markHardwareDirty()
        rebuild()
      }
      dragRef.current = null
      bundle.controls.enabled = true
    }

    const onPointerLeave = () => {
      updateGhost(null)
      updateJointPreview(null)
    }

    const nudgeSelected = (dx: number, dy: number, dz: number, tag: string) => {
      const sel = store.selection
      if (sel.kind !== 'part') return
      const part = store.partById(sel.id)
      if (!part) return
      store.beginChange(tag)
      part.x += dx
      part.y += dy
      part.z = (part.z ?? 0) + dz
      store.markHardwareDirty()
      rebuild()
    }

    const rotateSelected = (delta: number, tag: string) => {
      const sel = store.selection
      if (sel.kind !== 'part') return
      const part = store.partById(sel.id)
      if (!part) return
      store.beginChange(tag)
      part.angle = (((part.angle + delta) % 360) + 360) % 360
      store.markHardwareDirty()
      rebuild()
    }

    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreWorkspaceShortcut(e)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        store.deleteSelection()
        rebuild()
      } else if (e.key === 'Escape') {
        store.partPlacement = null
        store.jointTool = null
        store.setSelection({ kind: 'none', id: '' })
        rebuild()
        updateGhost(null)
        updateJointPreview(null)
      } else if (e.key === 'r' || e.key === 'R') {
        rotateSelected(e.shiftKey ? -15 : 15, `rot:${store.selection.id}`)
      } else if (e.key === '[') {
        rotateSelected(-5, `rot:${store.selection.id}`)
      } else if (e.key === ']') {
        rotateSelected(5, `rot:${store.selection.id}`)
      } else if (e.key === 'q' || e.key === 'Q') {
        nudgeSelected(0, 0, e.shiftKey ? -20 : -5, `depth:${store.selection.id}`)
      } else if (e.key === 'e' || e.key === 'E') {
        nudgeSelected(0, 0, e.shiftKey ? 20 : 5, `depth:${store.selection.id}`)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nudgeSelected(e.shiftKey ? -1 : -5, 0, 0, `nudge:${store.selection.id}`)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nudgeSelected(e.shiftKey ? 1 : 5, 0, 0, `nudge:${store.selection.id}`)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        nudgeSelected(0, e.shiftKey ? -1 : -5, 0, `nudge:${store.selection.id}`)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        nudgeSelected(0, e.shiftKey ? 1 : 5, 0, `nudge:${store.selection.id}`)
      } else if (e.key === 'f' || e.key === 'F') {
        fitCamera(bundle)
      }
    }
    const onContext = (ev: Event) => ev.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKey)
      if (previewRef.current) {
        bundle.scene.remove(previewRef.current)
        disposeDeep(previewRef.current)
        previewRef.current = null
      }
      if (ghostRef.current) {
        bundle.scene.remove(ghostRef.current)
        disposeDeep(ghostRef.current)
        ghostRef.current = null
      }
      bundle.dispose()
      bundleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // rebuild scene content on structural changes
  useEffect(() => {
    rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hardwareRev, store.selection.id, store.selection.kind])

  const placing = store.partPlacement
  const jt = store.jointTool
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive 3D hardware assembly" style={{ width: '100%', height: '100%' }} />
      <div className="canvas-tools" aria-label="Assembly view controls">
        <button className="btn" onClick={() => { if (bundleRef.current) fitCamera(bundleRef.current) }} title="Fit assembly (F)">Fit</button>
        <button className={'btn' + (showGrid ? ' armed' : '')} aria-pressed={showGrid} onClick={() => {
          const next = !showGrid
          setShowGrid(next)
          if (bundleRef.current) bundleRef.current.grid.visible = next
        }}>Grid</button>
      </div>
      <div className="canvas-hint">
        {placing
          ? `Placing ${PART_LABELS[placing] ?? placing} — a ghost previews the drop spot (Shift-click for many, Esc to cancel)`
          : jt
            ? jt.aId
              ? `Joint ${jt.type}: click the second part — the anchor snaps onto the first when close`
              : `Joint ${jt.type}: click the first part`
            : 'Drag orbit • wheel zoom • drag parts (Shift = lock axis) • arrows nudge • Q/E depth • R, [ ] rotate • F fit • Ctrl+Z undo'}
      </div>
    </div>
  )
}

export function partLocalToWorld(p: HardwarePartData, lx: number, ly: number): { x: number; y: number; z: number } {
  // 2D clockwise-positive rotation in y-down coords.
  const a = (p.angle * Math.PI) / 180
  return {
    x: p.x + lx * Math.cos(a) - ly * Math.sin(a),
    y: -(p.y + lx * Math.sin(a) + ly * Math.cos(a)),
    z: p.z ?? 0,
  }
}

/** World point -> 2D part-local coords (for joint anchors). */
export function worldToPartLocal(p: HardwarePartData, wpt: THREE.Vector3): { x: number; y: number } {
  const a = (p.angle * Math.PI) / 180
  const dx = wpt.x - p.x
  const dy = -wpt.y - p.y
  return {
    x: dx * Math.cos(a) + dy * Math.sin(a),
    y: -dx * Math.sin(a) + dy * Math.cos(a),
  }
}

function fitCamera(bundle: ReturnType<typeof createScene>) {
  const parts = store.project.hardware.parts
  let x0 = 1e9
  let y0 = 1e9
  let x1 = -1e9
  let y1 = -1e9
  for (const p of parts) {
    const r = Math.max(p.w, p.h) / 2
    x0 = Math.min(x0, p.x - r)
    y0 = Math.min(y0, -p.y - r)
    x1 = Math.max(x1, p.x + r)
    y1 = Math.max(y1, -p.y + r)
  }
  if (parts.length === 0) {
    x0 = -400; y0 = -700; x1 = 400; y1 = -100
  }
  y0 = Math.min(y0, toWorldY(store.project.groundY))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const size = Math.max(x1 - x0, (y1 - y0) * 1.4, 300)
  bundle.controls.target.set(cx, cy, 0)
  bundle.camera.position.set(cx + size * 0.45, cy + size * 0.4, size * 1.15)
  bundle.camera.lookAt(cx, cy, 0)
}
