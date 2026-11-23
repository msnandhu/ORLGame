/** Procedural engine, tyre-skid and water audio using WebAudio (no samples). */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private osc1!: OscillatorNode; private osc2!: OscillatorNode; private engGain!: GainNode; private filt!: BiquadFilterNode;
  private noiseGain!: GainNode; private noiseFilt!: BiquadFilterNode;
  private splashGain!: GainNode;
  volume = 0.6;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 600; this.filt.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.filt); this.osc2.connect(g2).connect(this.filt);
    this.filt.connect(this.engGain).connect(this.master);
    this.osc1.start(); this.osc2.start();
    // white noise for tyre slip / gravel and water
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type: BiquadFilterType, f: number) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(fl).connect(g).connect(this.master); src.start();
      return { g, fl };
    };
    const n = mk('bandpass', 900); this.noiseGain = n.g; this.noiseFilt = n.fl;
    this.splashGain = mk('lowpass', 500).g;
  }
  suspend() { this.ctx?.suspend(); }
  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  update(rpm: number, throttle: number, engineOn: boolean, slip: number, water: number, active: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const fire = (rpm / 60) * 2; // 4-cylinder firing frequency
    this.osc1.frequency.setTargetAtTime(Math.max(fire, 10), t, 0.03);
    this.osc2.frequency.setTargetAtTime(Math.max(fire * 0.5, 5), t, 0.03);
    this.filt.frequency.setTargetAtTime(300 + throttle * 1400 + rpm * 0.15, t, 0.05);
    this.engGain.gain.setTargetAtTime(active && engineOn ? 0.09 + throttle * 0.12 : 0, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(active ? Math.min(0.25, slip * 0.3) : 0, t, 0.05);
    this.noiseFilt.frequency.setTargetAtTime(600 + slip * 900, t, 0.1);
    this.splashGain.gain.setTargetAtTime(active ? Math.min(0.4, water) : 0, t, 0.1);
  }
}
