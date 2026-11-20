// ============================================================================
// AudioKit — WebAudio buzzer output. Initialised lazily on the first user
// gesture (browser autoplay policy); ticks update frequency/gain.
// ============================================================================

class AudioKitImpl {
  private ctx: AudioContext | null = null
  private osc: OscillatorNode | null = null
  private gain: GainNode | null = null
  private armed = false

  /** Call from any user gesture to unlock audio. Safe to call repeatedly. */
  unlock() {
    if (this.armed) return
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.osc = this.ctx.createOscillator()
      this.osc.type = 'square'
      this.osc.frequency.value = 440
      this.gain = this.ctx.createGain()
      this.gain.gain.value = 0
      this.osc.connect(this.gain)
      this.gain.connect(this.ctx.destination)
      this.osc.start()
      this.armed = true
    } catch {
      this.ctx = null
    }
  }

  /** volume 0..1, frequency Hz. */
  setBuzzer(volume: number, frequency: number) {
    if (!this.armed || !this.ctx || !this.osc || !this.gain) return
    const t = this.ctx.currentTime
    const v = Math.max(0, Math.min(1, volume)) * 0.06
    this.gain.gain.setTargetAtTime(v, t, 0.02)
    this.osc.frequency.setTargetAtTime(Math.max(40, Math.min(4000, frequency)), t, 0.02)
    if (this.ctx.state === 'suspended' && volume > 0) void this.ctx.resume()
  }
}

export const AudioKit = new AudioKitImpl()
