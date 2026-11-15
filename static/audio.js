// 猫娘星海作战 —— WebAudio 合成音效与背景音乐（不需要任何音频文件）
export class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.sfxOn = true;
    this.musicOn = true;
    this.noise = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (err) {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.5;
      this.musicGain.connect(this.master);
      this.noise = this._makeNoise();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.musicOn) this.startMusic();
  }

  setSfx(on) {
    this.sfxOn = !!on;
  }

  setMusic(on) {
    this.musicOn = !!on;
    if (!this.musicOn) this.stopMusic();
    else if (this.ctx) this.startMusic();
  }

  _makeNoise() {
    const length = Math.floor(this.ctx.sampleRate * 0.6);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _tone({ freq = 440, dur = 0.12, type = "square", vol = 0.15, slide = 0, delay = 0, to = null }) {
    if (!this.ctx || !this.sfxOn) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freq), now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + dur);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  _burst({ dur = 0.3, vol = 0.2, freq = 900, delay = 0 }) {
    if (!this.ctx || !this.sfxOn || !this.noise) return;
    const now = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  shoot() {
    this._tone({ freq: 880, to: 620, dur: 0.05, type: "square", vol: 0.045 });
  }

  enemyShoot() {
    this._tone({ freq: 300, to: 190, dur: 0.08, type: "sawtooth", vol: 0.05 });
  }

  hit() {
    this._burst({ dur: 0.18, vol: 0.16, freq: 1400 });
    this._tone({ freq: 180, to: 60, dur: 0.18, type: "triangle", vol: 0.15 });
  }

  explode(big = false) {
    this._burst({ dur: big ? 0.65 : 0.26, vol: big ? 0.32 : 0.16, freq: big ? 1200 : 900 });
    this._tone({ freq: big ? 110 : 220, to: 50, dur: big ? 0.5 : 0.2, type: "triangle", vol: big ? 0.2 : 0.09 });
  }

  pickup() {
    this._tone({ freq: 660, dur: 0.07, type: "square", vol: 0.08 });
    this._tone({ freq: 880, dur: 0.09, type: "square", vol: 0.08, delay: 0.07 });
    this._tone({ freq: 1320, dur: 0.1, type: "square", vol: 0.07, delay: 0.14 });
  }

  order() {
    this._tone({ freq: 520, dur: 0.1, type: "sawtooth", vol: 0.1 });
    this._tone({ freq: 1040, dur: 0.16, type: "sawtooth", vol: 0.08, delay: 0.08 });
  }

  deny() {
    this._tone({ freq: 200, dur: 0.12, type: "square", vol: 0.09 });
    this._tone({ freq: 150, dur: 0.14, type: "square", vol: 0.08, delay: 0.1 });
  }

  bossAlarm() {
    for (let i = 0; i < 3; i += 1) {
      this._tone({ freq: 760, dur: 0.16, type: "square", vol: 0.09, delay: i * 0.26 });
      this._tone({ freq: 540, dur: 0.16, type: "square", vol: 0.08, delay: i * 0.26 + 0.12 });
    }
  }

  cheer() {
    [523, 659, 784, 1047].forEach((freq, index) => {
      this._tone({ freq, dur: 0.12, type: "triangle", vol: 0.09, delay: index * 0.07 });
    });
  }

  over() {
    [392, 330, 262, 196].forEach((freq, index) => {
      this._tone({ freq, dur: 0.22, type: "triangle", vol: 0.1, delay: index * 0.16 });
    });
  }

  ui() {
    this._tone({ freq: 720, dur: 0.04, type: "square", vol: 0.04 });
  }

  startMusic() {
    if (!this.ctx || this.musicTimer || !this.musicOn) return;
    this.musicStep = 0;
    this.musicTimer = setInterval(() => this._scheduleMusic(), 220);
    this._scheduleMusic();
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  _scheduleMusic() {
    if (!this.ctx || !this.musicOn) return;
    // A 小调五声音阶，8 分音符循环；低沉、不抢戏。
    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    const pattern = [0, 3, 2, 5, 4, 2, 3, 1, 0, 3, 5, 4, 2, 3, 1, 2];
    const step = this.musicStep % pattern.length;
    const freq = scale[pattern[step] % scale.length];
    const now = this.ctx.currentTime;
    const lookahead = 0.22;
    this._musicNote(freq, now + 0.02, 0.18, "triangle", 0.05);
    if (step % 4 === 0) this._musicNote(freq / 2, now + 0.02, 0.4, "sine", 0.07);
    if (step % 8 === 4) this._musicNote(freq * 2, now + lookahead * 0.5, 0.1, "square", 0.02);
    this.musicStep += 1;
  }

  _musicNote(freq, at, dur, type, vol) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}
