import type { ProjectData } from '../types'
import { buildAluTrainer } from './cpu'
import { buildGamingRig } from './computer'
import { buildBipedalHumanoid } from './humanoid'
import { buildQuadrupedHound } from './quadruped'
import { buildArcadeCabinet } from './arcade'
import { buildPrinter } from './printer'

export interface PresetInfo {
  id: string
  title: string
  blurb: string
  build: () => ProjectData
}

export const PRESETS: PresetInfo[] = [
  { id: 'cpu', title: '8-Bit ALU Trainer', blurb: 'A real 3-bit ripple-carry adder wired from raw gates, gated clock LED and spinning heatsink fan. Close the input switches and watch the carry chain light up.', build: buildAluTrainer },
  { id: 'computer', title: 'RGB Gaming Rig', blurb: 'Full battlestation: desk, tower with spinning radiator and GPU fans, RGB strips, monitor, keyboard and speakers. P power, L desk lamp.', build: buildGamingRig },
  { id: 'humanoid', title: 'Bipedal Humanoid Robot', blurb: 'Android in its calibration cradle: pose and shuffle the servo legs — hips (ArrowUp/Down, W/S), knees (Q/A, E/D), arms (R/F), head nod (T/G). I power, H lights.', build: buildBipedalHumanoid },
  { id: 'quadruped', title: 'Quadruped Robot Hound', blurb: 'Robo-hound on its service cradle: front hips (W/S), rear hips (E/D), knees (Q/A), neck (R/F), tail (T/G). I power, H beacon.', build: buildQuadrupedHound },
  { id: 'arcade', title: 'Retro Arcade Cabinet', blurb: 'Coin-op CRT cabinet: Fire (Space) blasts the speaker, Start (Enter) chimes the buzzer, marquee lights (L), spinning roof exhaust fan.', build: buildArcadeCabinet },
  { id: 'printer', title: 'CoreXY 3D Printer', blurb: 'Print-head gantry A/D, Z lift W/S, extruder fan, glowing hot end and bed heaters, passive filament spool, and a freshly printed owl. P power, L lights.', build: buildPrinter },
]

export function buildPreset(id: string): ProjectData | null {
  const p = PRESETS.find((x) => x.id === id)
  return p ? p.build() : null
}
