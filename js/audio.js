// WebAudio ile tamamen sentezlenen sesler (harici dosya yok)
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.noise = null;
    this.lastShot = 0;
    this.ambient = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // 2 saniyelik beyaz gürültü tamponu
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.startAmbient();
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  _now() { return this.ctx.currentTime; }
  _noise(dur, { gain = 0.5, type = 'lowpass', freq = 1200, q = 1, attack = 0.001, sweep = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  }
  _tone(freq, dur, { gain = 0.3, type = 'sine', end = null, delay = 0, attack = 0.002 } = {}) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (end) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = this.ctx.createGain(); g.gain.value = 0.055;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lg = this.ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    this.ambient = { src, g, lfo };
  }
  play(name, opts = {}) {
    if (!this.ctx) return;
    const dist = opts.dist ?? 0;
    const att = 1 / (1 + dist * dist * 0.012);
    const V = att * (opts.volume ?? 1);
    if (V < 0.005) return;
    switch (name) {
      case 'rifle':
        this._noise(0.13, { gain: 0.55 * V, freq: 4200, type: 'highpass', sweep: 0.15 });
        this._noise(0.24, { gain: 0.42 * V, freq: 900, sweep: 0.25 });
        this._tone(150, 0.13, { gain: 0.42 * V, type: 'triangle', end: 45 });
        this._tone(1900, 0.035, { gain: 0.1 * V, type: 'square', end: 300 });
        break;
      case 'smg':
        this._noise(0.09, { gain: 0.4 * V, freq: 5200, type: 'highpass', sweep: 0.2 });
        this._tone(190, 0.09, { gain: 0.3 * V, type: 'triangle', end: 60 });
        break;
      case 'dmr':
        this._noise(0.22, { gain: 0.65 * V, freq: 2800, sweep: 0.1 });
        this._tone(110, 0.28, { gain: 0.5 * V, type: 'sawtooth', end: 38 });
        this._noise(0.5, { gain: 0.13 * V, freq: 700, delay: 0.08, sweep: 0.4 });
        break;
      case 'dry': this._noise(0.04, { gain: 0.16 * V, freq: 3000, type: 'highpass' }); break;
      case 'reload':
        this._noise(0.05, { gain: 0.16 * V, freq: 2200, type: 'bandpass', delay: 0 });
        this._noise(0.06, { gain: 0.18 * V, freq: 1200, type: 'bandpass', delay: 0.22 });
        this._noise(0.045, { gain: 0.2 * V, freq: 3000, type: 'bandpass', delay: 0.5 });
        break;
      case 'step':
        this._noise(0.07, { gain: 0.09 * V, freq: 400 + Math.random() * 300, sweep: 0.4 });
        break;
      case 'jump': this._noise(0.08, { gain: 0.1 * V, freq: 700, sweep: 0.5 }); break;
      case 'land': this._noise(0.13, { gain: 0.18 * V, freq: 350, sweep: 0.4 }); break;
      case 'hit': this._tone(1450, 0.06, { gain: 0.17 * V, type: 'square', end: 900 }); break;
      case 'headshot':
        this._tone(1800, 0.07, { gain: 0.16 * V, type: 'square', end: 1100 });
        this._tone(2400, 0.08, { gain: 0.12 * V, delay: 0.07 });
        break;
      case 'hurt': this._noise(0.2, { gain: 0.22 * V, freq: 500, sweep: 0.3 }); break;
      case 'kill':
        this._tone(660, 0.1, { gain: 0.18 * V });
        this._tone(990, 0.16, { gain: 0.18 * V, delay: 0.1 });
        break;
      case 'death':
        this._tone(320, 0.5, { gain: 0.25 * V, type: 'sawtooth', end: 70 });
        this._noise(0.6, { gain: 0.2 * V, freq: 900, sweep: 0.2 });
        break;
      case 'explosion':
        this._noise(0.9, { gain: 0.8 * V, freq: 1400, sweep: 0.06 });
        this._tone(75, 0.75, { gain: 0.6 * V, type: 'sine', end: 28 });
        this._noise(1.3, { gain: 0.18 * V, freq: 380, delay: 0.12, sweep: 0.3 });
        break;
      case 'grenade': this._noise(0.06, { gain: 0.22 * V, freq: 2400, type: 'bandpass' }); break;
      case 'whiz': this._noise(0.1, { gain: 0.13 * V, freq: 3200, type: 'bandpass', sweep: 2.5 }); break;
      case 'ui': this._tone(560, 0.05, { gain: 0.09 * V, end: 800 }); break;
      case 'start':
        this._tone(440, 0.16, { gain: 0.16 * V });
        this._tone(660, 0.28, { gain: 0.16 * V, delay: 0.18 });
        break;
      case 'beep': this._tone(880, 0.07, { gain: 0.12 * V, type: 'square' }); break;
    }
  }
}
