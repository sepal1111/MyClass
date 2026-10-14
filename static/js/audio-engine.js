/* ==========================================================================
   國小課堂即時記錄系統 - Web Audio Sound Engine (晶片級原生音效合成，零外部依賴)
   Shared by the desktop Toolkit tab (toolkit.js) and the projection screen
   (projection.js), which plays bell sounds triggered remotely from a phone.
   ========================================================================== */
(function (window) {
  'use strict';

  const AudioEngine = {
    ctx: null,
    volume: 0.85,

    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    setVolume(val) {
      this.volume = Math.max(0, Math.min(1, parseFloat(val) || 0.85));
    },

    // 🔔 1. 清脆叮咚鈴聲 (Chime Bell)
    playChime() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Note 1: High E6 (1318.5Hz)
      this._playTone(1318.51, now, 0.8, 'sine', 0.5 * this.volume);
      // Note 2: High G6 (1567.98Hz)
      this._playTone(1567.98, now + 0.15, 1.2, 'sine', 0.6 * this.volume);
      // Harmonics
      this._playTone(2637.02, now + 0.15, 0.9, 'triangle', 0.2 * this.volume);
    },

    // 📢 2. 專注提示音 (Attention Alert)
    playAttention() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // 3 short rhythmic beeps + 1 lingering bell
      [0, 0.12, 0.24].forEach((t, i) => {
        this._playTone(880, now + t, 0.08, 'sine', 0.4 * this.volume);
      });
      this._playTone(1760, now + 0.38, 1.0, 'sine', 0.6 * this.volume);
      this._playTone(1760 * 1.5, now + 0.38, 0.7, 'triangle', 0.25 * this.volume);
    },

    // 👏 3. 熱烈掌聲與歡呼 (Applause & Cheers Simulation)
    playApplause() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const duration = 2.2;
      const bufferSize = this.ctx.sampleRate * duration;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);

      // Pink noise clap burst algorithm
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Modulate with rhythmic clapping pulses
        const t = i / this.ctx.sampleRate;
        const pulse = Math.sin(t * 30) * Math.sin(t * 18) * Math.sin(t * 12);
        data[i] = white * (0.3 + 0.7 * Math.abs(pulse)) * Math.exp(-t * 0.9);
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Bandpass filter for clapping acoustics
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.Q.setValueAtTime(2.0, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.8 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(now);
    },

    // 🏫 4. 學校鐘聲 (School Bell / Westminster Chime)
    playSchoolBell() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // 4-note chime sequence: E4 (329.63), C4 (261.63), D4 (293.66), G3 (196.00)
      const notes = [
        { f: 659.25, t: 0.0, d: 0.6 },
        { f: 523.25, t: 0.45, d: 0.6 },
        { f: 587.33, t: 0.9, d: 0.6 },
        { f: 392.00, t: 1.35, d: 1.2 }
      ];

      notes.forEach(n => {
        this._playTone(n.f, now + n.t, n.d, 'sine', 0.55 * this.volume);
        this._playTone(n.f * 2, now + n.t, n.d * 0.7, 'triangle', 0.25 * this.volume);
      });
    },

    // ⏰ 5. 倒數結束響鈴 3 次 (Timer Alarm - 3 rings)
    playTimerAlarm(times = 3) {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // 3 distinct alarm ring bursts (0.85s interval)
      for (let i = 0; i < times; i++) {
        const offset = i * 0.85;
        [0, 0.12, 0.24, 0.36].forEach((t) => {
          this._playTone(1046.50, now + offset + t, 0.08, 'square', 0.45 * this.volume);
          this._playTone(2093.00, now + offset + t, 0.08, 'sine', 0.35 * this.volume);
        });
      }
    },

    // 🎺 6. 勝利歡呼號角 (Victory Fanfare)
    playVictory() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // Fanfare notes: C5, E5, G5, high C6!
      const fanfare = [
        { f: 523.25, t: 0.0, d: 0.12 },
        { f: 523.25, t: 0.14, d: 0.12 },
        { f: 523.25, t: 0.28, d: 0.12 },
        { f: 659.25, t: 0.42, d: 0.25 },
        { f: 783.99, t: 0.70, d: 0.25 },
        { f: 1046.50, t: 0.98, d: 0.85 }
      ];

      fanfare.forEach(n => {
        this._playTone(n.f, now + n.t, n.d, 'triangle', 0.6 * this.volume);
        this._playTone(n.f * 0.5, now + n.t, n.d, 'sawtooth', 0.2 * this.volume);
      });
    },

    // 🎲 7. 抽籤洗牌喀嗒聲 (Shuffle Tick)
    playTick(isFast = true) {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const freq = isFast ? 1200 : 900;
      const duration = isFast ? 0.05 : 0.09;
      const gainVal = isFast ? 0.25 : 0.35;
      this._playTone(freq, now, duration, 'square', gainVal * this.volume);
    },

    playSound(sound) {
      switch (sound) {
        case 'chime':
          this.playChime();
          break;
        case 'attention':
          this.playAttention();
          break;
        case 'applause':
          this.playApplause();
          break;
        case 'school_bell':
          this.playSchoolBell();
          break;
        case 'alarm':
          this.playTimerAlarm();
          break;
        case 'victory':
          this.playVictory();
          break;
        default:
          this.playChime();
      }
    },

    _playTone(freq, startTime, duration, type = 'sine', gainVal = 0.5) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(gainVal, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    }
  };

  window.AudioEngine = AudioEngine;

})(window);
