// ============================================================================
// Render smoke test (3D): builds every part mesh, custom-mesh geometry,
// schematic drawing and short sim runs to catch runtime crashes without
// a browser (no WebGL needed — geometry only).
// Run with: npm run test:render
// ============================================================================

// Minimal DOM stub for glow-texture canvases (three.js core is DOM-free).
const ctxStub = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === 'measureText') return () => ({ width: 10 })
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: () => undefined })
      }
      if (prop === 'getImageData') return () => ({ data: [] })
      return () => undefined
    },
    set() {
      return true
    },
  },
);
;(globalThis as Record<string, unknown>).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ctxStub }
    return {}
  },
};

import { CircuitEngine } from '../src/circuit/engine'
import { COMPONENT_DEFS } from '../src/circuit/components'
import { CIRCUIT_CATALOG } from '../src/circuit/catalog'
import { SimRunner3D } from '../src/sim/runner3d'
import { drawSchematic, hitTestComponent } from '../src/render/schematic'
import { buildPartMesh } from '../src/render3d/parts'
import { buildMeshData } from '../src/studio/meshdata'
import { basePlate, baseCylinder, baseSphere, rebuildDisplaced } from '../src/studio/displace'
import { parseStl, normalizeGeometry, f32ToBase64, base64ToF32 } from '../src/studio/stl'
import { PRESETS } from '../src/presets'
import type { ProjectData } from '../src/types'

function makeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined }
  const target: Record<string, unknown> = {
    canvas: { width: 1280, height: 800 },
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return () => undefined
    },
    set(t, prop: string, value: unknown) {
      t[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

let failures = 0
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  PASS ${name}`))
    .catch((err) => {
      failures++
      console.log(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`)
    })
}

async function main() {
  await check('studio primitives build', () => {
    for (const g of [
      basePlate(120, 80, 24, 12),
      baseCylinder(40, 24, 12),
      baseSphere(40, 12),
    ]) {
      if (g.positions.length < 9 || g.indices.length < 3) throw new Error('degenerate primitive')
    }
    const dented = rebuildDisplaced(basePlate(120, 80, 24, 12).positions, basePlate(120, 80, 24, 12).indices, [
      { x: 0, y: 0, z: 12, radius: 30, strength: -10, falloff: 2 },
      { x: 20, y: 10, z: 12, radius: 20, strength: 8, falloff: 2 },
    ])
    if (dented.positions.length === 0) throw new Error('displace failed')
  })

  await check('STL ascii + binary parse', () => {
    const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t`
    const a = parseStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer)
    if (a.indices.length !== 3) throw new Error('ascii parse failed')
    // minimal binary: 84 header + 1 tri
    const buf = new ArrayBuffer(84 + 50)
    const v = new DataView(buf)
    v.setUint32(80, 1, true)
    let o = 84 + 12
    const pts = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    for (const n of pts) {
      v.setFloat32(o, n, true)
      o += 4
    }
    const b = parseStl(buf)
    if (b.indices.length !== 3) throw new Error('binary parse failed')
    const n = normalizeGeometry(b, 120)
    const b64 = f32ToBase64(n.positions)
    if (base64ToF32(b64).length !== n.positions.length) throw new Error('base64 roundtrip failed')
  })

  await check('every circuit symbol and catalog placement preview draws', () => {
    const components = (Object.keys(COMPONENT_DEFS) as (keyof typeof COMPONENT_DEFS)[]).map((type, index) => ({
      id: `component-${type}`, name: COMPONENT_DEFS[type].label, type,
      x: 100 + (index % 6) * 150, y: 100 + Math.floor(index / 6) * 150,
      props: COMPONENT_DEFS[type].defaults(),
    }))
    const project: ProjectData = { version: 1, name: 'Symbol coverage', groundY: 900, circuit: { components, wires: [] }, hardware: { parts: [], joints: [], meshes: [] } }
    const engine = new CircuitEngine(project.circuit)
    engine.tick(1)
    for (const entry of CIRCUIT_CATALOG) {
      drawSchematic(makeCtx(), project, {
        engine, cam: { x: 450, y: 350, zoom: 1 }, cw: 1000, ch: 900, dpr: 1,
        selection: { kind: 'none', id: '' }, placement: entry.id, hoverPin: null, hoverComp: null, hoverWire: null,
        mouseWorld: { x: 500, y: 500 }, wireDraft: null, time: 1, showGrid: true,
      })
    }
  })

  for (const preset of PRESETS) {
    console.log(preset.title)
    const p: ProjectData = preset.build()
    const eng = new CircuitEngine(p.circuit)
    for (const c of p.circuit.components) {
      if (c.type === 'switchSlide' || c.type === 'switchPush') c.props.closed = true
    }
    eng.tick(1)
    const ctx = makeCtx()
    await check('schematic draw', () => {
      drawSchematic(ctx, p, {
        engine: eng,
        cam: { x: 400, y: 400, zoom: 1 },
        cw: 1280, ch: 800, dpr: 1,
        selection: { kind: 'none', id: '' },
        placement: null, hoverPin: null, hoverComp: null, hoverWire: null,
        mouseWorld: null, wireDraft: null, time: 1,
      })
      for (const c of p.circuit.components) hitTestComponent(p.circuit, c.x, c.y)
    })
    await check('3D part meshes build', () => {
      const lib = new Map(p.hardware.meshes.map((m) => [m.id, m]))
      for (const part of p.hardware.parts) {
        if (part.kind === 'water') continue
        const { group } = buildPartMesh(part, lib)
        if (group.children.length === 0) throw new Error(`empty mesh for ${part.kind}`)
        // pose math smoke
        group.position.set(part.x, -part.y, part.z ?? 0)
        group.rotation.z = (-part.angle * Math.PI) / 180
        group.updateMatrixWorld(true)
      }
    })
    await check('sim runs + poses read', async () => {
      const runner = await SimRunner3D.create(p, eng)
      for (let i = 0; i < 90; i++) runner.step(i)
      for (const part of p.hardware.parts) {
        if (part.kind === 'water') continue
        const pose = runner.world.partPose(part.id)
        if (!pose || !Number.isFinite(pose.x + pose.y + pose.z)) {
          throw new Error(`bad pose for ${part.name}`)
        }
      }
      runner.destroy()
    })
  }

  // studio mesh data path with ops + STL blob
  await check('custom mesh data path', () => {
    const data = buildMeshData({
      id: 'm', name: 't', base: 'plate', w: 100, h: 80, depth: 20, segments: 10,
      ops: [{ x: 0, y: 0, z: 10, radius: 25, strength: -8, falloff: 2 }],
    })
    if (data.positions.length === 0) throw new Error('empty')
  })

  console.log(failures === 0 ? '\nrender smoke: all clear' : `\nrender smoke: ${failures} failures`)
  if (failures > 0) throw new Error('render smoke failed')
}

main()
