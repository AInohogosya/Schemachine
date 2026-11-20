// ============================================================================
// Shared Three.js scene scaffolding: renderer, orbit camera, lights,
// ground, water volumes, text sprites, joint gizmos.
// ============================================================================

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface SceneBundle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  ground: THREE.Mesh
  grid: THREE.GridHelper
  setGroundY: (groundY2d: number) => void
  dispose: () => void
}

export function toWorldY(y2d: number): number {
  return -y2d
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#e8edee')
  scene.fog = new THREE.Fog('#e8edee', 3000, 10000)

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 30000)
  camera.position.set(320, 260, 900)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxDistance = 6000
  controls.minDistance = 40
  controls.target.set(0, 0, 0)

  const hemi = new THREE.HemisphereLight('#f4f7f7', '#7f8b88', 1.35)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight('#fffaf1', 2.2)
  dir.position.set(500, 900, 600)
  dir.castShadow = true
  dir.shadow.mapSize.set(2048, 2048)
  dir.shadow.camera.left = -1200
  dir.shadow.camera.right = 1200
  dir.shadow.camera.top = 1200
  dir.shadow.camera.bottom = -1200
  dir.shadow.camera.far = 4000
  dir.shadow.bias = -0.0005
  scene.add(dir)
  const fill = new THREE.DirectionalLight('#d8e6e8', 0.45)
  fill.position.set(-600, 300, -400)
  scene.add(fill)

  const groundMat = new THREE.MeshStandardMaterial({ color: '#d5dcda', roughness: 0.95 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 5000), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(4000, 80, 0x8da2a5, 0xabb9b9)
  grid.material.transparent = true
  grid.material.opacity = 0.28
  grid.material.depthWrite = false
  scene.add(grid)

  const setGroundY = (groundY2d: number) => {
    const y = toWorldY(groundY2d)
    ground.position.y = y
    grid.position.y = y + 1
    dir.target.position.set(0, y, 0)
    dir.target.updateMatrixWorld()
  }

  const resize = () => {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()

  return {
    renderer, scene, camera, controls, ground, grid, setGroundY,
    dispose: () => {
      controls.dispose()
      renderer.dispose()
    },
  }
}

export function makeTextSprite(text: string, color = '#34464d', size = 44): THREE.Sprite {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = `600 ${size}px system-ui`
  const wdt = Math.ceil(g.measureText(text).width) + 24
  c.width = wdt
  c.height = size + 24
  const g2 = c.getContext('2d')!
  g2.font = `600 ${size}px system-ui`
  g2.fillStyle = 'rgba(251,252,252,0.92)'
  g2.fillRect(0, 0, c.width, c.height)
  g2.strokeStyle = 'rgba(126,145,150,0.45)'
  g2.strokeRect(0.5, 0.5, c.width - 1, c.height - 1)
  g2.fillStyle = color
  g2.textBaseline = 'middle'
  g2.fillText(text, 12, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const s = new THREE.Sprite(mat)
  s.scale.set(c.width * 0.9, c.height * 0.9, 1)
  return s
}

/** Water volume box (translucent, double-sided). */
export function makeWaterBox(w: number, h: number, d: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: '#6e9fac',
    transparent: true,
    opacity: 0.38,
    roughness: 0.28,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.receiveShadow = true
  return m
}

/** Joint anchor gizmo. */
export function makeJointGizmo(type: string, label: string): THREE.Group {
  const g = new THREE.Group()
  let core: THREE.Mesh
  if (type === 'weld') {
    core = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: '#817494' }))
  } else if (type === 'motor') {
    core = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 10), new THREE.MeshBasicMaterial({ color: '#467c64' }))
  } else if (type === 'slider') {
    core = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: '#39778c' }))
  } else {
    core = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10), new THREE.MeshBasicMaterial({ color: '#a17b3f' }))
  }
  g.add(core)
  if (label) {
    const s = makeTextSprite(label, type === 'motor' ? '#37634f' : '#34464d', 36)
    s.position.y = -22
    g.add(s)
  }
  return g
}
