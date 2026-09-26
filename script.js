/* 3D 沉浸式五子棋 · 全量重构版
 * Three.js r160 ESM + EffectComposer 后期 + 程序化 PBR + Worker AI + 禁手规则 + 对局复盘
 * 模块结构（单文件组织，按节划分）：
 *   0. imports / 常量 / DOM
 *   1. 程序化 PBR 纹理生成器（FBM 木纹 + 玉石微晶 + 接触阴影贴图）
 *   2. Web Audio 程序化音效引擎（落子/悔棋/胜负/禁手 + 卷积混响 + 音量）
 *   3. 对局状态 + 规则判定 + 禁手（Renju）判定
 *   4. Worker AI 管理器（含主线程启发式兜底，保证 file:// 也可对弈）
 *   5. Three.js 场景 / 灯光 / 环境 / EffectComposer 后期管线
 *   6. 棋盘 / 棋子 / 接触阴影 / 十字微光 / 光环 / 涟漪 / 粒子 / 光柱
 *   7. 对局流程（落子/胜负/悔棋/重开/禁手拦截）
 *   8. 复盘系统（步进/自动播放/相机追踪）
 *   9. SGF/PGN 导出导入 + PNG 截图
 *   10. 交互 / UI 事件 / 自适应 / 主循环 / 启动
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ================= 0. 常量与 DOM ================= */
const SIZE = 15;
const SPACING = 1;
const HALF = (SIZE - 1) / 2;
const STONE_Y = 0.30;
const DROP_HEIGHT = 6.0;
const BLACK = 1;
const WHITE = 2;

const container = document.getElementById('scene-container');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const moveCountEl = document.getElementById('moveCount');
const turnInfoEl = document.getElementById('turnInfo');
const youAreEl = document.getElementById('youAre');
const aiStateEl = document.getElementById('aiState');
const aiBar = document.getElementById('aiBar');
const aiDepthEl = document.getElementById('aiDepth');
const aiEvalEl = document.getElementById('aiEval');
const aiNpsEl = document.getElementById('aiNps');
const aiPvEl = document.getElementById('aiPv');
const historyEl = document.getElementById('history');
const winOverlay = document.getElementById('winOverlay');
const winTitle = document.getElementById('winTitle');
const winDesc = document.getElementById('winDesc');
const winIcon = document.getElementById('winIcon');
const winCard = winOverlay ? winOverlay.querySelector('.win-card') : null;
const loadingEl = document.getElementById('loading');
const aiGlowEl = document.getElementById('aiGlow');
const flashEl = document.getElementById('flash');
const forbidTipEl = document.getElementById('forbidTip');
const resetViewBtn = document.getElementById('resetViewBtn');
const rotateBtn = document.getElementById('rotateBtn');
const topViewBtn = document.getElementById('topViewBtn');
const soundBtn = document.getElementById('soundBtn');
const shotBtn = document.getElementById('shotBtn');
const renjuToggle = document.getElementById('renjuToggle');
const volumeSlider = document.getElementById('volumeSlider');
const engineBadge = document.getElementById('engineBadge');
const replayBar = document.getElementById('replayBar');
const replayPos = document.getElementById('replayPos');
const replayPrevBtn = document.getElementById('replayPrev');
const replayNextBtn = document.getElementById('replayNext');
const replayAutoBtn = document.getElementById('replayAuto');
const replayExitBtn = document.getElementById('replayExit');

const ICON_WIN = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" stroke="currentColor" stroke-width="1.6"/><path d="M7 5H4.5A1.5 1.5 0 0 0 4.6 8c.8.4 1.6.7 2.4.9M17 5h2.5A1.5 1.5 0 0 1 19.4 8c-.8.4-1.6.7-2.4.9M12 14v3M8.5 20.5h7M10 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LOSS = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';
const ICON_DRAW = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_FORBID = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M6 6l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_SOUND_ON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6v4h2.5L9 13.5v-11L5 6H2.5z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON_SOUND_OFF = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6v4h2.5L9 13.5v-11L5 6H2.5z" fill="currentColor"/><path d="M11.5 6.5l3 3M14.5 6.5l-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

/* ================= 1. 程序化 PBR 纹理生成器 ================= */
// 确定性种子随机，保证每次加载纹理一致
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeValueNoise2D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad[i] = rand() * 2 - 1;
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const aa = perm[(perm[X] + Y) & 511];
    const ba = perm[(perm[(X + 1) & 255] + Y) & 511];
    const ab = perm[(perm[X] + Y + 1) & 511];
    const bb = perm[(perm[(X + 1) & 255] + Y + 1) & 511];
    const u = fade(xf), v = fade(yf);
    const x1 = grad[aa] + (grad[ba] - grad[aa]) * u;
    const x2 = grad[ab] + (grad[bb] - grad[ab]) * u;
    return (x1 + (x2 - x1) * v) * 0.5 + 0.5; // 0..1
  }
  function fbm(x, y, oct) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
  return { noise, fbm };
}

// 金丝楠木棋盘：BaseColor + Roughness + Bump，一次遍历同时生成三张贴图
function makeWoodTextures(size) {
  const s = size || 512;
  const { fbm } = makeValueNoise2D(20260926);
  const baseCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  baseCanvas.width = baseCanvas.height = s;
  roughCanvas.width = roughCanvas.height = s;
  bumpCanvas.width = bumpCanvas.height = s;
  const bctx = baseCanvas.getContext('2d');
  const rctx = roughCanvas.getContext('2d');
  const uctx = bumpCanvas.getContext('2d');
  const bimg = bctx.createImageData(s, s);
  const rimg = rctx.createImageData(s, s);
  const uimg = uctx.createImageData(s, s);
  // 楠木色阶：深棕 -> 金丝 -> 浅金
  const cDark = [74, 50, 26];
  const cMid = [146, 106, 58];
  const cGold = [217, 184, 122];
  const cPale = [232, 205, 150];
  for (let y = 0; y < s; y++) {
    const v = y / s;
    for (let x = 0; x < s; x++) {
      const u = x / s;
      // 年轮扰动：沿 x 方向的细密纹理 + FBM 扭曲
      const warp = fbm(u * 5, v * 5, 4);
      const rings = 0.5 + 0.5 * Math.sin((u * 46 + warp * 26 + v * 7) * Math.PI * 2 / 9);
      const streak = fbm(u * 26, v * 90, 3);
      const fine = fbm(u * 90, v * 90, 2);
      const glow = Math.pow(fbm(u * 8 + 40, v * 8, 3), 2.2); // 金丝亮筋
      let r, g, b;
      const k = Math.min(1, Math.max(0, rings * 0.55 + streak * 0.45));
      if (k < 0.5) {
        const t = k / 0.5;
        r = cDark[0] + (cMid[0] - cDark[0]) * t;
        g = cDark[1] + (cMid[1] - cDark[1]) * t;
        b = cDark[2] + (cMid[2] - cDark[2]) * t;
      } else {
        const t = (k - 0.5) / 0.5;
        r = cMid[0] + (cGold[0] - cMid[0]) * t;
        g = cMid[1] + (cGold[1] - cMid[1]) * t;
        b = cMid[2] + (cGold[2] - cMid[2]) * t;
      }
      r += glow * (cPale[0] - r) * 0.85;
      g += glow * (cPale[1] - g) * 0.85;
      b += glow * (cPale[2] - b) * 0.85;
      const i = (y * s + x) * 4;
      bimg.data[i] = r; bimg.data[i + 1] = g; bimg.data[i + 2] = b; bimg.data[i + 3] = 255;
      // Roughness：纹理凹处更粗糙，金丝处更光滑
      const rough = 150 + streak * 60 - glow * 70 + fine * 20;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.max(60, Math.min(235, rough));
      rimg.data[i + 3] = 255;
      // Bump：年轮高度
      const bump = 110 + rings * 60 + fine * 40 - streak * 30;
      uimg.data[i] = uimg.data[i + 1] = uimg.data[i + 2] = Math.max(0, Math.min(255, bump));
      uimg.data[i + 3] = 255;
    }
  }
  bctx.putImageData(bimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  uctx.putImageData(uimg, 0, 0);
  function toTexture(canvas, srgb) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  return {
    map: toTexture(baseCanvas, true),
    roughnessMap: toTexture(roughCanvas, false),
    bumpMap: toTexture(bumpCanvas, false)
  };
}

// 玉石微晶：256 细腻噪声，供棋子 roughnessMap / bumpMap 复用
function makeJadeMicroTexture() {
  const s = 256;
  const { fbm } = makeValueNoise2D(770011);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s;
      const micro = fbm(u * 22, v * 22, 4);
      const crystal = Math.pow(fbm(u * 60 + 9, v * 60, 2), 3) * 60; // 隐约微晶闪点
      const val = 118 + micro * 40 + crystal;
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, val));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// 径向接触阴影贴图（共享）
function makeRadialShadowTexture() {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// 柔光粒子贴图（共享）
function makeGlowSpriteTexture() {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(canvas);
}

/* ================= 2. Web Audio 程序化音效引擎 ================= */
const AudioEngine = {
  ctx: null,
  master: null,
  verb: null,
  verbGain: null,
  muted: false,
  volume: 0.55,
  lastHoverAt: 0,
  _noiseBuf: null,

  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 18;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.24;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        // 合成大厅混响：指数衰减噪声脉冲
        const dur = 1.8;
        const rate = this.ctx.sampleRate;
        const len = Math.floor(rate * dur);
        const imp = this.ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
          const d = imp.getChannelData(ch);
          for (let i = 0; i < len; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
          }
        }
        this.verb = this.ctx.createConvolver();
        this.verb.buffer = imp;
        this.verbGain = this.ctx.createGain();
        this.verbGain.gain.value = 0.33;
        this.verb.connect(this.verbGain);
        this.verbGain.connect(this.master);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (e) { return false; }
  },

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    this.syncButton();
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  },

  syncButton() {
    if (!soundBtn) return;
    soundBtn.innerHTML = (this.muted ? ICON_SOUND_OFF : ICON_SOUND_ON) + '<span>' + (this.muted ? '静音' : '音效开') + '</span>';
    soundBtn.classList.toggle('muted', this.muted);
    soundBtn.setAttribute('aria-pressed', String(!this.muted));
    soundBtn.title = this.muted ? '开启音效' : '静音（关闭合成音效）';
  },

  tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.2, vol = 0.2, delay = 0, attack = 0.004, echo = 0 }) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    if (echo > 0 && this.verb) {
      const send = this.ctx.createGain();
      send.gain.value = echo;
      g.connect(send);
      send.connect(this.verb);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },

  noiseHit({ dur = 0.05, vol = 0.25, freq = 2500, freqEnd = null, q = 1.2, type = 'bandpass', delay = 0, echo = 0 }) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(freq, t0);
    if (freqEnd) flt.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), t0 + dur);
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.master);
    if (echo > 0 && this.verb) {
      const send = this.ctx.createGain();
      send.gain.value = echo;
      g.connect(send);
      send.connect(this.verb);
    }
    src.start(t0);
  },

  // 落子：玉石双正弦冲击（1200Hz + 2800Hz，20ms 级快衰减）+ 实木低频共鸣（180Hz 低通 120ms）+ 随机音调抖动
  playStone(color) {
    if (this.muted || !this.ensure()) return;
    const dark = color === BLACK;
    const jitter = 1 + (Math.random() - 0.5) * 0.05;
    const f1 = (dark ? 1150 : 1350) * jitter;
    const f2 = (dark ? 2700 : 3050) * jitter;
    this.tone({ freq: f1, type: 'sine', dur: 0.035, vol: 0.5, attack: 0.001 });
    this.tone({ freq: f2, type: 'sine', dur: 0.022, vol: 0.28, attack: 0.001 });
    // 实木腔体共鸣
    this.tone({ freq: dark ? 170 : 195, freqEnd: 120, type: 'sine', dur: 0.13, vol: 0.34 });
    this.noiseHit({ dur: 0.12, vol: 0.22, freq: 900, freqEnd: 180, q: 0.8, type: 'lowpass' });
    // 石质清脆瞬态
    this.noiseHit({ dur: 0.03, vol: 0.2, freq: dark ? 2400 : 3200, q: 1.4 });
    // 尾韵泛音
    this.tone({ freq: (dark ? 1620 : 2080) * jitter, type: 'sine', dur: 0.12, vol: 0.06, delay: 0.01, echo: 0.5 });
  },

  playHover() {
    if (this.muted) return;
    const now = performance.now();
    if (now - this.lastHoverAt < 110) return;
    this.lastHoverAt = now;
    this.tone({ freq: 2350, type: 'sine', dur: 0.05, vol: 0.03 });
  },

  // 悔棋：逆向气流扫频 + 温润小木槌微敲击
  playUndo() {
    if (this.muted || !this.ensure()) return;
    this.noiseHit({ dur: 0.28, vol: 0.16, freq: 2600, freqEnd: 500, q: 2.2, type: 'bandpass', echo: 0.4 });
    this.tone({ freq: 640, freqEnd: 320, type: 'triangle', dur: 0.14, vol: 0.22, delay: 0.02 });
    this.tone({ freq: 1280, type: 'sine', dur: 0.08, vol: 0.06, delay: 0.02 });
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', dur: 0.14, vol: 0.1, delay: 0.1 + i * 0.06, echo: 0.5 });
    });
  },

  // 胜利：编钟五声音阶泛音（宫商角徵羽），多振荡器叠加延迟混响
  playWin() {
    if (this.muted || !this.ensure()) return;
    const penta = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
    const seq = [0, 2, 4, 7, 4, 7, 9, 7];
    seq.forEach((n, i) => {
      const f = penta[n];
      const dl = i * 0.16;
      this.tone({ freq: f, type: 'triangle', dur: 2.2, vol: 0.2, delay: dl, echo: 1.0 });
      this.tone({ freq: f, type: 'sine', dur: 2.6, vol: 0.13, delay: dl + 0.02, echo: 1.0 });
      this.tone({ freq: f * 2, type: 'sine', dur: 1.5, vol: 0.05, delay: dl + 0.03, echo: 0.8 });
      this.tone({ freq: f * 2.99, type: 'sine', dur: 0.9, vol: 0.02, delay: dl + 0.04, echo: 0.6 });
    });
    this.noiseHit({ dur: 0.6, vol: 0.04, freq: 6500, q: 0.8, type: 'highpass', delay: 0.1, echo: 0.7 });
  },

  // 落败：深沉大提琴弦震 + 木鱼残响
  playLose() {
    if (this.muted || !this.ensure()) return;
    this.tone({ freq: 110, freqEnd: 44, type: 'triangle', dur: 2.0, vol: 0.4, echo: 0.7 });
    this.tone({ freq: 65.4, type: 'sine', dur: 2.6, vol: 0.42, echo: 0.8 });
    this.tone({ freq: 49, type: 'sine', dur: 2.8, vol: 0.28, delay: 0.06, echo: 0.8 });
    this.tone({ freq: 220, freqEnd: 55, type: 'sawtooth', dur: 1.2, vol: 0.05, echo: 0.5 });
    // 木鱼残响：两声空木敲击
    [0, 0.42].forEach((dl) => {
      this.tone({ freq: 812, freqEnd: 640, type: 'triangle', dur: 0.22, vol: 0.2, delay: dl, echo: 0.9 });
      this.noiseHit({ dur: 0.04, vol: 0.12, freq: 1800, q: 2, delay: dl });
    });
    this.noiseHit({ dur: 0.4, vol: 0.08, freq: 300, q: 0.7, type: 'lowpass' });
  },

  playDraw() {
    if (this.muted || !this.ensure()) return;
    this.tone({ freq: 392, type: 'triangle', dur: 1.2, vol: 0.18, echo: 0.7 });
    this.tone({ freq: 587.33, type: 'triangle', dur: 1.5, vol: 0.16, delay: 0.12, echo: 0.7 });
  },

  // 禁手警告：低沉双音警示
  playForbid() {
    if (this.muted || !this.ensure()) return;
    this.tone({ freq: 233, type: 'square', dur: 0.16, vol: 0.08 });
    this.tone({ freq: 196, type: 'square', dur: 0.24, vol: 0.08, delay: 0.16 });
  },

  playClick() {
    this.tone({ freq: 1250, type: 'sine', dur: 0.05, vol: 0.06 });
  }
};

/* ================= 3. 对局状态 + 规则判定 + 禁手 ================= */
let board;
let history;
let gameOver;
let gameResult; // null | { winner, reason, winCells, forbid }
let playerColor = BLACK;
let aiColor = WHITE;
let level = 'medium';
let currentColor = BLACK;
let lastMove = null;
let hoverCell = null;
let aiThinking = false;
let renjuEnabled = false;

function initState() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  history = [];
  gameOver = false;
  gameResult = null;
  currentColor = BLACK;
  lastMove = null;
  hoverCell = null;
  aiThinking = false;
}

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
function inBoard(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }

function checkWin(bd, x, y, color) {
  for (const [dx, dy] of DIRS) {
    let count = 1;
    const cells = [{ x, y }];
    for (const s of [1, -1]) {
      let nx = x + dx * s;
      let ny = y + dy * s;
      while (inBoard(nx, ny) && bd[ny][nx] === color) {
        count += 1;
        cells.push({ x: nx, y: ny });
        nx += dx * s;
        ny += dy * s;
      }
    }
    if (count >= 5) return cells;
  }
  return null;
}

function coordLabel(x, y) { return String.fromCharCode(65 + x) + (y + 1); }

/* ---- 禁手（Renju）判定：黑棋三三 / 四四 / 长连；恰五豁免 ---- */
function countDir2D(bd, x, y, dx, dy, color) {
  let c = 0;
  let nx = x + dx, ny = y + dy;
  while (inBoard(nx, ny) && bd[ny][nx] === color) { c++; nx += dx; ny += dy; }
  return c;
}
function lineLen2D(bd, x, y, dx, dy, color) {
  return 1 + countDir2D(bd, x, y, dx, dy, color) + countDir2D(bd, x, y, -dx, -dy, color);
}
function lineCells2D(bd, x, y, dx, dy, color) {
  // 返回该方向 11 格（含越界标记 -1），中心下标 5，且落子点视为 color
  const cells = [];
  for (let k = -5; k <= 5; k++) {
    const nx = x + dx * k, ny = y + dy * k;
    if (!inBoard(nx, ny)) { cells.push(-1); continue; }
    if (nx === x && ny === y) { cells.push(color); continue; }
    cells.push(bd[ny][nx]);
  }
  return cells;
}
function formsFour2D(bd, x, y, color) {
  for (const [dx, dy] of DIRS) {
    if (lineLen2D(bd, x, y, dx, dy, color) >= 5) return true;
    const cells = lineCells2D(bd, x, y, dx, dy, color);
    for (let s = 0; s + 4 < cells.length; s++) {
      let cc = 0, ee = 0;
      for (let j = 0; j < 5; j++) {
        if (cells[s + j] === color) cc++;
        else if (cells[s + j] === 0) ee++;
      }
      if (cc === 4 && ee === 1) return true;
    }
  }
  return false;
}
function isOpenThreeDir2D(bd, x, y, dx, dy, color) {
  const cells = lineCells2D(bd, x, y, dx, dy, color);
  const center = 5;
  for (let s = center - 4; s <= center; s++) {
    if (s < 0 || s + 4 >= cells.length) continue;
    let cntC = 0, cntE = 0, cntO = 0;
    const empties = [];
    for (let j = 0; j < 5; j++) {
      const v = cells[s + j];
      if (v === color) cntC++;
      else if (v === 0) { cntE++; empties.push(s + j); }
      else cntO++;
    }
    if (cntC === 3 && cntE === 2 && cntO === 0) {
      let ok = true;
      for (const pos of empties) {
        const px = x + dx * (pos - center), py = y + dy * (pos - center);
        bd[py][px] = color;
        const four = formsFour2D(bd, px, py, color);
        bd[py][px] = 0;
        if (!four) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}
function isFourDir2D(bd, x, y, dx, dy, color) {
  const cells = lineCells2D(bd, x, y, dx, dy, color);
  const center = 5;
  for (let s = center - 4; s <= center; s++) {
    if (s < 0 || s + 4 >= cells.length) continue;
    let cc = 0, ee = 0, oo = 0;
    for (let j = 0; j < 5; j++) {
      const v = cells[s + j];
      if (v === color) cc++;
      else if (v === 0) ee++;
      else oo++;
    }
    if (cc === 4 && ee === 1 && oo === 0) return true;
  }
  return false;
}
// 返回 null | 'overline' | 'double-three' | 'double-four'
function forbiddenType2D(bd, x, y, color) {
  if (color !== BLACK) return null;
  if (!inBoard(x, y) || bd[y][x] !== 0) return null;
  bd[y][x] = color;
  let exactFive = false, overline = false;
  for (const [dx, dy] of DIRS) {
    const len = lineLen2D(bd, x, y, dx, dy, color);
    if (len === 5) exactFive = true;
    if (len >= 6) overline = true;
  }
  if (exactFive) { bd[y][x] = 0; return null; }
  if (overline) { bd[y][x] = 0; return 'overline'; }
  let threes = 0;
  for (const [dx, dy] of DIRS) if (isOpenThreeDir2D(bd, x, y, dx, dy, color)) threes++;
  if (threes >= 2) { bd[y][x] = 0; return 'double-three'; }
  let fours = 0;
  for (const [dx, dy] of DIRS) if (isFourDir2D(bd, x, y, dx, dy, color)) fours++;
  if (fours >= 2) { bd[y][x] = 0; return 'double-four'; }
  bd[y][x] = 0;
  return null;
}
const FORBID_NAMES = { 'overline': '长连禁手', 'double-three': '三三禁手', 'double-four': '四四禁手' };

/* ================= 4. Worker AI 管理器（含主线程兜底） ================= */
const LEVEL_CONF = {
  easy: { maxDepth: 2, timeLimitMs: 200 },
  medium: { maxDepth: 4, timeLimitMs: 700 },
  hard: { maxDepth: 6, timeLimitMs: 1500 }
};
let aiWorker = null;
let workerUsable = false;
let workerFailed = false;
let aiReqId = 0;
let pendingHint = false;

function boardToFlat() {
  const flat = new Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) flat[y * SIZE + x] = board[y][x];
  }
  return flat;
}

function initWorker() {
  try {
    aiWorker = new Worker('ai.worker.js');
  } catch (e) {
    workerFailed = true;
    workerUsable = false;
    if (engineBadge) engineBadge.textContent = 'Three.js · 本地启发式引擎';
    return;
  }
  aiWorker.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'info') {
      if (msg.reqId !== aiReqId) return;
      updateAIInfo(msg, false);
      if (aiBar) aiBar.style.width = Math.min(92, 30 + (msg.depth || 0) * 12) + '%';
    } else if (msg.type === 'result') {
      if (msg.reqId !== aiReqId) return;
      onAIResult(msg);
    }
  };
  aiWorker.onerror = () => {
    workerFailed = true;
    workerUsable = false;
    if (engineBadge) engineBadge.textContent = 'Three.js · 本地启发式引擎';
    // 若正在等待 AI，直接用兜底走一步
    if (aiThinking) {
      const mv = fallbackBestMove(aiColor, level);
      aiThinking = false;
      setThinkingUI(false);
      if (mv && !pendingHint) {
        placeStone(mv.x, mv.y, aiColor);
        if (!gameOver) updateUI('轮到你落子（' + (playerColor === BLACK ? '黑棋' : '白棋') + '）');
      }
      if (pendingHint) { pendingHint = false; showHint(mv); }
    }
  };
  workerUsable = true;
  if (engineBadge) engineBadge.textContent = 'Three.js · Worker AI 引擎';
}

/* ---- 主线程兜底：轻量启发式 + 2-ply（Worker 不可用时，如 file://） ---- */
function lineScoreLocal(count, openEnds) {
  if (count >= 5) return 1000000;
  if (count === 4) return openEnds === 2 ? 100000 : 10000;
  if (count === 3) return openEnds === 2 ? 5000 : 500;
  if (count === 2) return openEnds === 2 ? 200 : 20;
  if (count === 1) return openEnds === 2 ? 10 : 2;
  return 0;
}
function evalPointLocal(bd, x, y, color) {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1, ends = 0;
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (inBoard(nx, ny) && bd[ny][nx] === color) { count++; nx += dx * s; ny += dy * s; }
      if (inBoard(nx, ny) && bd[ny][nx] === 0) ends++;
    }
    total += lineScoreLocal(count, ends);
  }
  return total;
}
function candidatesLocal(bd, range) {
  if (history.length === 0) return [{ x: 7, y: 7 }];
  const seen = new Set();
  const list = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (bd[y][x] !== 0) {
        for (let dy = -range; dy <= range; dy++) {
          for (let dx = -range; dx <= range; dx++) {
            const nx = x + dx, ny = y + dy;
            if (inBoard(nx, ny) && bd[ny][nx] === 0 && !seen.has(ny * SIZE + nx)) {
              seen.add(ny * SIZE + nx);
              list.push({ x: nx, y: ny });
            }
          }
        }
      }
    }
  }
  return list.length ? list : [{ x: 7, y: 7 }];
}
function scoreMoveLocal(bd, x, y, ai, human) {
  bd[y][x] = ai;
  const atk = evalPointLocal(bd, x, y, ai);
  const winNow = checkWin(bd, x, y, ai) ? 5000000 : 0;
  bd[y][x] = human;
  const def = evalPointLocal(bd, x, y, human);
  const loseNext = checkWin(bd, x, y, human) ? 4000000 : 0;
  bd[y][x] = 0;
  return atk + winNow + (def + loseNext) * 0.9 + Math.random() * 4;
}
function fallbackBestMove(ai, difficulty) {
  let cands = candidatesLocal(board, 2);
  if (renjuEnabled && ai === BLACK) {
    const legal = cands.filter((p) => !forbiddenType2D(board, p.x, p.y, BLACK));
    if (legal.length) cands = legal;
  }
  if (difficulty === 'easy' && Math.random() < 0.45) {
    return cands[Math.floor(Math.random() * cands.length)];
  }
  const human = ai === BLACK ? WHITE : BLACK;
  const scored = cands.map((p) => ({ x: p.x, y: p.y, s: scoreMoveLocal(board, p.x, p.y, ai, human) }));
  scored.sort((a, b) => b.s - a.s);
  if (difficulty === 'hard') {
    const top = scored.slice(0, 8);
    let best = top[0];
    let bestVal = -Infinity;
    for (const m of top) {
      board[m.y][m.x] = ai;
      if (checkWin(board, m.x, m.y, ai)) { board[m.y][m.x] = 0; return m; }
      const opps = candidatesLocal(board, 2).map((p) => ({ x: p.x, y: p.y, s: scoreMoveLocal(board, p.x, p.y, human, ai) }));
      opps.sort((a, b) => b.s - a.s);
      const oppBest = opps.length ? opps[0].s : 0;
      const val = m.s - oppBest * 0.85;
      board[m.y][m.x] = 0;
      if (val > bestVal) { bestVal = val; best = m; }
    }
    return best;
  }
  return scored[0];
}

function updateAIInfo(msg, isFinal) {
  if (aiDepthEl) aiDepthEl.textContent = (msg.depth || 0) + ' ply' + (msg.vcf ? ' · 算杀' : '') + (msg.method ? ' · ' + msg.method : '');
  if (aiEvalEl) {
    const sc = typeof msg.score === 'number' ? msg.score : 0;
    const txt = (sc > 9000000 ? '必胜' : sc < -9000000 ? '必败' : (sc > 0 ? '+' : '') + sc) + ' / ' + (msg.nodes || 0) + ' 节点';
    aiEvalEl.textContent = txt;
  }
  if (aiNpsEl) aiNpsEl.textContent = (msg.nps || 0).toLocaleString() + ' /s' + (msg.timeMs != null ? ' · ' + msg.timeMs + 'ms' : '');
  if (aiPvEl && msg.pv && msg.pv.length) {
    aiPvEl.textContent = 'PV ' + msg.pv.slice(0, 8).map((p) => coordLabel(p.x, p.y)).join(' → ');
  } else if (aiPvEl && isFinal) {
    aiPvEl.textContent = 'PV —';
  }
  const label = document.getElementById('thinkingLabel');
  if (label && !isFinal) label.textContent = '演算中… ' + (msg.depth || 0) + ' ply';
}

function onAIResult(msg) {
  aiThinking = false;
  setThinkingUI(false);
  if (aiBar) {
    aiBar.style.width = '100%';
    setTimeout(() => { if (aiBar) aiBar.style.width = '0'; }, 450);
  }
  const label = document.getElementById('thinkingLabel');
  if (label) label.textContent = '';
  updateAIInfo(msg, true);
  let mv = (msg.x >= 0 && msg.y >= 0) ? { x: msg.x, y: msg.y } : null;
  if (mv && board[mv.y][mv.x] !== 0) mv = null;
  if (pendingHint) {
    pendingHint = false;
    if (aiStateEl) aiStateEl.textContent = '待机';
    showHint(mv);
    return;
  }
  if (!mv) {
    // 无可用着法（黑棋被禁手逼死等）：直接判负
    if (!gameOver) {
      const loser = aiColor;
      endGame(loser === BLACK ? WHITE : BLACK, null, { foul: 'no-move', foulName: '黑棋无合法着法（禁手困毙）', loser });
    }
    return;
  }
  if (gameOver) return;
  placeStone(mv.x, mv.y, aiColor);
  if (!gameOver) updateUI('轮到你落子（' + (playerColor === BLACK ? '黑棋' : '白棋') + '）');
}

function aiMove(hintOnly) {
  if (gameOver && !hintOnly) return Promise.resolve(null);
  if (replay.active) return Promise.resolve(null);
  if (aiThinking && !hintOnly) return Promise.resolve(null);
  const mover = hintOnly ? playerColor : aiColor;
  if (!hintOnly && currentColor !== aiColor) return Promise.resolve(null);
  aiThinking = true;
  pendingHint = !!hintOnly;
  const conf = LEVEL_CONF[level] || LEVEL_CONF.medium;
  if (!hintOnly) {
    setThinkingUI(true);
    if (aiBar) aiBar.style.width = '30%';
  } else if (aiStateEl) {
    aiStateEl.textContent = '支招中';
  }
  // Worker 可用：异步深搜；不可用：延迟后主线程兜底，保证 UI 不冻结过久
  if (workerUsable && aiWorker && !workerFailed) {
    aiReqId += 1;
    try {
      aiWorker.postMessage({
        type: 'search',
        reqId: aiReqId,
        flat: boardToFlat(),
        aiColor: mover,
        level: hintOnly ? 'hard' : level,
        timeLimitMs: hintOnly ? 900 : conf.timeLimitMs,
        maxDepth: hintOnly ? 5 : conf.maxDepth,
        renju: renjuEnabled,
        moveCount: history.length
      });
    } catch (e) {
      workerFailed = true;
      workerUsable = false;
      fallbackHybrid(hintOnly, mover);
    }
    return Promise.resolve(null);
  }
  fallbackHybrid(hintOnly, mover);
  return Promise.resolve(null);
}

function fallbackHybrid(hintOnly, mover) {
  const other = mover === BLACK ? WHITE : BLACK;
  const delay = level === 'hard' ? 420 : level === 'medium' ? 280 : 180;
  setTimeout(() => {
    const mv = fallbackBestMove(mover, hintOnly ? 'hard' : level);
    aiThinking = false;
    if (!hintOnly) {
      setThinkingUI(false);
      if (aiBar) { aiBar.style.width = '100%'; setTimeout(() => { if (aiBar) aiBar.style.width = '0'; }, 400); }
      if (mv && !gameOver) {
        placeStone(mv.x, mv.y, aiColor);
        if (!gameOver) updateUI('轮到你落子（' + (playerColor === BLACK ? '黑棋' : '白棋') + '）');
      }
      if (aiDepthEl) aiDepthEl.textContent = '本地 2-ply';
      if (aiPvEl && mv) aiPvEl.textContent = 'PV ' + coordLabel(mv.x, mv.y);
    } else {
      if (aiStateEl) aiStateEl.textContent = '待机';
      showHint(mv);
    }
    pendingHint = false;
  }, delay);
}

function showHint(mv) {
  if (!mv) return;
  hoverCell = mv;
  const p = gridToWorld(mv.x, mv.y);
  if (previewStone) {
    previewStone.visible = true;
    previewStone.material = playerColor === BLACK ? previewMatBlack : previewMatWhite;
    previewStone.position.set(p.x, STONE_Y + 0.2, p.z);
  }
  updateUI('建议落子：' + coordLabel(mv.x, mv.y) + '（点击棋盘落子）');
  setTimeout(() => { if (previewStone && !replay.active) previewStone.visible = false; }, 2400);
}

/* ================= 5. Three.js 场景与后期管线 ================= */
let renderer;
let scene;
let camera;
let controls;
let raycaster;
let pointerNDC;
let composer;
let bloomPass;
let grainPass;
let boardGroup;
let stoneGroup;
let shadowGroup;
let fxGroup;
let hitPlane;
let previewStone;
let previewMatBlack;
let previewMatWhite;
let previewMatForbid;
let crosshair;
let crosshairMat;
let lastMoveHalo;
let winBeamGroup = null;
let winBeamLight = null;
let aiMoodLight;
let keyLight;

const stoneMeshes = new Map(); // key "x,y" -> Mesh
const shadowMeshes = new Map(); // key "x,y" -> Mesh
const tweens = [];
const ripples = [];
const particleSystems = [];
const clock = new THREE.Clock();

let camAnim = null;
let shakeTime = 0;
let shakeDuration = 0;
let shakeStrength = 0;
let autoRotateWanted = false;
let crossTarget = null;

const DEFAULT_CAM_POS = new THREE.Vector3(0, 15.5, 13.5);
const DEFAULT_CAM_TG = new THREE.Vector3(0, 0, 0.6);

// 复用几何体 / 材质（性能保底：全局共享，销毁时显式 dispose 动态特效）
let stoneGeometry;
let blackStoneMat;
let whiteStoneMat;
let shadowGeometry;
let shadowTexture;
let shadowMaterial;
let glowTexture;
let haloGeometry;
let haloMaterial;
let rippleGeometry;
let jadeMicroTex;
let woodTextures = null;

// 晕影 + 胶片颗粒自定义 Shader Pass
const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.12 },
    uGrain: { value: 0.05 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 13.0) * 43758.5453);
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 d = vUv - vec2(0.5);
      float vig = smoothstep(0.85, 0.25, length(d) * uVignette);
      col.rgb *= mix(0.62, 1.0, vig);
      // 暗角微暖
      col.rgb += vec3(0.028, 0.018, 0.006) * vig;
      // 胶片颗粒
      float g = hash(vUv * vec2(1920.0, 1080.0)) - 0.5;
      col.rgb += g * uGrain * (1.0 - vig * 0.5);
      gl_FragColor = col;
    }
  `
};

function gridToWorld(x, y) {
  return new THREE.Vector3((x - HALF) * SPACING, 0, (y - HALF) * SPACING);
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const p = t - 1.5 / d1; return n1 * p * p + 0.75; }
  if (t < 2.5 / d1) { const p = t - 2.25 / d1; return n1 * p * p + 0.9375; }
  const p = t - 2.625 / d1;
  return n1 * p * p + 0.984375;
}
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function addTween(tw) {
  tw.elapsed = 0;
  tweens.push(tw);
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);
  scene.fog = new THREE.Fog(0x0a0d12, 30, 70);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.copy(DEFAULT_CAM_POS);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(DEFAULT_CAM_TG);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 7;
  controls.maxDistance = 34;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.autoRotateSpeed = 1.2;

  // PBR 环境反射：RoomEnvironment，玉石与金丝质感的关键
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
    pmrem.dispose();
  } catch (e) { /* 无环境反射仍可运行 */ }

  raycaster = new THREE.Raycaster();
  pointerNDC = new THREE.Vector2(-10, -10);

  buildLights();
  buildEnvironment();
  buildBoard();
  buildStonesAssets();
  buildHalo();
  buildCrosshair();
  buildHitPlane();

  stoneGroup = new THREE.Group();
  shadowGroup = new THREE.Group();
  fxGroup = new THREE.Group();
  scene.add(stoneGroup);
  scene.add(shadowGroup);
  scene.add(fxGroup);

  // 后期处理管线：Render -> Bloom（金丝/星位/光环溢光）-> 晕影颗粒 -> 输出
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const size = new THREE.Vector2(container.clientWidth || 640, container.clientHeight || 640);
  bloomPass = new UnrealBloomPass(size, 0.5, 0.65, 0.82);
  composer.addPass(bloomPass);
  grainPass = new ShaderPass(VignetteGrainShader);
  composer.addPass(grainPass);
  composer.addPass(new OutputPass());

  onResize();
  if (loadingEl) loadingEl.classList.add('hidden');
}

function buildLights() {
  const ambient = new THREE.AmbientLight(0xcfd8e6, 0.5);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xbdd0e8, 0x2a1e12, 0.35);
  scene.add(hemi);

  keyLight = new THREE.DirectionalLight(0xfff1d6, 1.6);
  keyLight.position.set(9, 16, 7);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.camera.near = 2;
  keyLight.shadow.camera.far = 45;
  keyLight.shadow.bias = -0.0004;
  scene.add(keyLight);

  const warmPoint = new THREE.PointLight(0xffc98a, 28, 30, 2);
  warmPoint.position.set(-7, 5, 6);
  scene.add(warmPoint);

  const coolPoint = new THREE.PointLight(0x86b8ff, 22, 30, 2);
  coolPoint.position.set(7, 4.5, -6);
  scene.add(coolPoint);

  aiMoodLight = new THREE.PointLight(0x8aa39b, 0, 26, 2);
  aiMoodLight.position.set(0, 6, 0);
  scene.add(aiMoodLight);
}

function buildEnvironment() {
  const groundGeo = new THREE.CircleGeometry(34, 72);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f14, roughness: 0.85, metalness: 0.25
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.85;
  ground.receiveShadow = true;
  scene.add(ground);

  const ringGeo = new THREE.RingGeometry(12.4, 12.7, 128);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xc9ae7e, transparent: true, opacity: 0.22, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.82;
  scene.add(ring);

  // 星空微尘（GPU Points，一次绘制）
  const starCount = 320;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 22 + Math.random() * 22;
    const th = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(th) * r;
    pos[i * 3 + 1] = 2 + Math.random() * 18;
    pos[i * 3 + 2] = Math.sin(th) * r;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sm = new THREE.PointsMaterial({ color: 0x8fa3c8, size: 0.09, transparent: true, opacity: 0.55 });
  const stars = new THREE.Points(sg, sm);
  scene.add(stars);
}

/* ================= 6. 棋盘 / 棋子 / 阴影 / 特效 ================= */
function buildBoard() {
  boardGroup = new THREE.Group();
  scene.add(boardGroup);

  woodTextures = makeWoodTextures(512);
  woodTextures.map.repeat.set(1, 1);

  // 黑曜石底座
  const baseGeo = new THREE.BoxGeometry(16.4, 0.8, 16.4);
  const baseMat = new THREE.MeshPhysicalMaterial({
    color: 0x241a12, roughness: 0.32, metalness: 0.15,
    clearcoat: 0.9, clearcoatRoughness: 0.25
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -0.4;
  base.castShadow = true;
  base.receiveShadow = true;
  boardGroup.add(base);

  // 实木棋盘面（程序化 PBR：BaseColor + Roughness + Bump）
  const topGeo = new THREE.BoxGeometry(15.4, 0.12, 15.4);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: woodTextures.map,
    roughnessMap: woodTextures.roughnessMap,
    bumpMap: woodTextures.bumpMap,
    bumpScale: 0.6,
    roughness: 1.0,
    metalness: 0.05
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = 0.02;
  top.receiveShadow = true;
  boardGroup.add(top);

  // 棋盘面细纹理罩（半透明叠加增强金丝感）
  const faceGeo = new THREE.PlaneGeometry(14.6, 14.6);
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0xd9b87a, roughness: 0.7, metalness: 0.02, transparent: true, opacity: 0.16, depthWrite: false
  });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.086;
  face.receiveShadow = true;
  boardGroup.add(face);

  // 金色包边
  const edgeGeo = new THREE.BoxGeometry(15.7, 0.1, 15.7);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xc9ae7e, roughness: 0.28, metalness: 0.85,
    emissive: 0x553f14, emissiveIntensity: 0.35
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.y = -0.02;
  boardGroup.add(edge);

  // 金丝网格线
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x3a2c14, roughness: 0.5, metalness: 0.3,
    emissive: 0xcf9f4a, emissiveIntensity: 0.22
  });
  const lineLen = (SIZE - 1) * SPACING;
  const hGeo = new THREE.BoxGeometry(lineLen, 0.014, 0.028);
  const vGeo = new THREE.BoxGeometry(0.028, 0.014, lineLen);
  for (let i = 0; i < SIZE; i++) {
    const c = (i - HALF) * SPACING;
    const h = new THREE.Mesh(hGeo, lineMat);
    h.position.set(0, 0.095, c);
    boardGroup.add(h);
    const v = new THREE.Mesh(vGeo, lineMat);
    v.position.set(c, 0.095, 0);
    boardGroup.add(v);
  }

  // 星位标记
  const starGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 24);
  const starMat = new THREE.MeshStandardMaterial({
    color: 0x8a6a2a, roughness: 0.3, metalness: 0.8,
    emissive: 0xaa7f2e, emissiveIntensity: 0.5
  });
  const stars = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
  for (const [sx, sy] of stars) {
    const p = gridToWorld(sx, sy);
    const m = new THREE.Mesh(starGeo, starMat);
    m.position.set(p.x, 0.1, p.z);
    boardGroup.add(m);
  }
}

function buildStonesAssets() {
  // 双凸扁球体：全局复用单一几何体
  stoneGeometry = new THREE.SphereGeometry(0.44, 48, 32);
  stoneGeometry.scale(1, 0.58, 1);

  jadeMicroTex = makeJadeMicroTexture();

  // 墨玉黑子：深邃透光近似（sheen + 清漆 + 微晶 bump），隐约玉质反光
  blackStoneMat = new THREE.MeshPhysicalMaterial({
    color: 0x14151b,
    roughness: 0.24,
    metalness: 0.2,
    roughnessMap: jadeMicroTex,
    bumpMap: jadeMicroTex,
    bumpScale: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    sheen: 0.6,
    sheenColor: new THREE.Color(0x3a4a6b),
    sheenRoughness: 0.5,
    envMapIntensity: 1.1
  });
  // 凝脂白子：羊脂白玉温润内散射近似（sheen + 微透光 emissive + 各向异性感高光）
  whiteStoneMat = new THREE.MeshPhysicalMaterial({
    color: 0xf3ede0,
    roughness: 0.3,
    metalness: 0.0,
    roughnessMap: jadeMicroTex,
    bumpMap: jadeMicroTex,
    bumpScale: 0.1,
    clearcoat: 0.85,
    clearcoatRoughness: 0.2,
    sheen: 1.0,
    sheenColor: new THREE.Color(0xfff6e0),
    sheenRoughness: 0.35,
    emissive: 0x39332a,
    emissiveIntensity: 0.25,
    envMapIntensity: 0.9
  });

  previewMatBlack = new THREE.MeshStandardMaterial({
    color: 0x22242a, transparent: true, opacity: 0.45,
    roughness: 0.4, metalness: 0.1, depthWrite: false
  });
  previewMatWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.45,
    roughness: 0.4, metalness: 0.0, depthWrite: false
  });
  previewMatForbid = new THREE.MeshStandardMaterial({
    color: 0xe0685e, transparent: true, opacity: 0.5,
    roughness: 0.4, metalness: 0.0, depthWrite: false,
    emissive: 0x7a1a12, emissiveIntensity: 0.7
  });
  previewStone = new THREE.Mesh(stoneGeometry, previewMatBlack);
  previewStone.visible = false;
  previewStone.position.y = STONE_Y;
  scene.add(previewStone);

  // 接触阴影：共享几何体 + 共享贴图 + 共享材质
  shadowTexture = makeRadialShadowTexture();
  shadowGeometry = new THREE.PlaneGeometry(1.25, 1.25);
  shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture, transparent: true, opacity: 0.55, depthWrite: false
  });
  glowTexture = makeGlowSpriteTexture();
  rippleGeometry = new THREE.RingGeometry(0.32, 0.44, 48);
}

function buildHalo() {
  haloGeometry = new THREE.TorusGeometry(0.58, 0.035, 16, 72);
  haloMaterial = new THREE.MeshBasicMaterial({ color: 0xe9c576, transparent: true, opacity: 0.95 });
  lastMoveHalo = new THREE.Mesh(haloGeometry, haloMaterial);
  lastMoveHalo.rotation.x = Math.PI / 2;
  lastMoveHalo.visible = false;
  scene.add(lastMoveHalo);
}

// 悬停十字聚焦微光（共享材质，双向细光带 + 中心辉光）
function buildCrosshair() {
  crosshair = new THREE.Group();
  crosshairMat = new THREE.MeshBasicMaterial({
    color: 0xe9c576, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const armH = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.06), crosshairMat);
  armH.rotation.x = -Math.PI / 2;
  const armV = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.7), crosshairMat);
  armV.rotation.x = -Math.PI / 2;
  const dotMat = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0xffd977, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), dotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.005;
  crosshair.add(armH);
  crosshair.add(armV);
  crosshair.add(dot);
  crosshair.position.y = 0.12;
  crosshair.visible = false;
  scene.add(crosshair);
  crosshair.userData.dotMat = dotMat;
}

function buildHitPlane() {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE);
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  hitPlane = new THREE.Mesh(geo, mat);
  hitPlane.rotation.x = -Math.PI / 2;
  hitPlane.position.y = 0.12;
  scene.add(hitPlane);
}

/* ---- 落子 / 移除 / 阴影 ---- */
function stoneKey(x, y) { return x + ',' + y; }

function createStoneMesh(color) {
  const mesh = new THREE.Mesh(stoneGeometry, color === BLACK ? blackStoneMat : whiteStoneMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addContactShadow(x, y, instant) {
  const p = gridToWorld(x, y);
  const sh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  sh.rotation.x = -Math.PI / 2;
  sh.position.set(p.x, 0.115, p.z);
  shadowGroup.add(sh);
  shadowMeshes.set(stoneKey(x, y), sh);
  if (!instant) {
    sh.scale.set(0.4, 0.4, 0.4);
    addTween({
      dur: 0.5,
      update: (t) => {
        const s = 0.4 + easeOutCubic(t) * 0.6;
        sh.scale.set(s, s, s);
      },
      complete: () => { sh.scale.set(1, 1, 1); }
    });
  }
}

function removeContactShadow(x, y) {
  const k = stoneKey(x, y);
  const sh = shadowMeshes.get(k);
  if (sh) {
    shadowGroup.remove(sh);
    shadowMeshes.delete(k);
    // 共享几何体/材质：不 dispose
  }
}

function dropStoneAnimated(x, y, color, instant) {
  const p = gridToWorld(x, y);
  const mesh = createStoneMesh(color);
  mesh.position.set(p.x, instant ? STONE_Y : DROP_HEIGHT, p.z);
  stoneGroup.add(mesh);
  stoneMeshes.set(stoneKey(x, y), mesh);
  addContactShadow(x, y, instant);
  if (!instant) {
    addTween({
      dur: 0.62,
      update: (t) => {
        const e = easeOutBounce(t);
        mesh.position.y = DROP_HEIGHT + (STONE_Y - DROP_HEIGHT) * e;
      },
      complete: () => {
        mesh.position.y = STONE_Y;
        // 棋盘微震：底座下沉回弹
        if (boardGroup) {
          addTween({
            dur: 0.3,
            update: (tt) => {
              const dip = Math.sin(tt * Math.PI) * -0.055;
              boardGroup.position.y = dip;
            },
            complete: () => { if (boardGroup) boardGroup.position.y = 0; }
          });
        }
      }
    });
    spawnRipple(p.x, p.z, color === BLACK ? 0xc9ae7e : 0xffffff);
  } else {
    mesh.position.y = STONE_Y;
  }
  updateLastMoveHalo();
  return mesh;
}

function removeStoneAnimated(x, y) {
  const k = stoneKey(x, y);
  const mesh = stoneMeshes.get(k);
  removeContactShadow(x, y);
  if (!mesh) return;
  stoneMeshes.delete(k);
  const startY = mesh.position.y;
  addTween({
    dur: 0.45,
    update: (t) => {
      const e = easeOutCubic(t);
      mesh.position.y = startY + e * 3.2;
      mesh.rotation.y = e * 1.4;
      const s = 1 - e * 0.35;
      mesh.scale.set(s, s, s);
    },
    complete: () => {
      stoneGroup.remove(mesh);
      // 网格引用共享几何体/材质：不 dispose
      updateLastMoveHalo();
    }
  });
}

function clearAllStones() {
  for (const [, mesh] of stoneMeshes) stoneGroup.remove(mesh);
  stoneMeshes.clear();
  for (const [, sh] of shadowMeshes) shadowGroup.remove(sh);
  shadowMeshes.clear();
  clearWinBeam();
  if (lastMoveHalo) lastMoveHalo.visible = false;
  clearParticles();
}

function updateLastMoveHalo() {
  if (!lastMoveHalo) return;
  if (!lastMove) { lastMoveHalo.visible = false; return; }
  const p = gridToWorld(lastMove.x, lastMove.y);
  lastMoveHalo.position.set(p.x, STONE_Y + 0.62, p.z);
  lastMoveHalo.visible = true;
}

function spawnRipple(x, z, colorHex) {
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false
  });
  const ring = new THREE.Mesh(rippleGeometry, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.14, z);
  fxGroup.add(ring);
  ripples.push({ mesh: ring, t: 0, dur: 0.7 });
}

/* ---- 粒子特效（BufferGeometry + Points，显式 dispose） ---- */
function makeParticleSystem({ count, colors, center, speedMin, speedMax, upBias, size, life, swirl }) {
  const positions = new Float32Array(count * 3);
  const vels = new Float32Array(count * 3);
  const colArr = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    positions[i * 3] = center.x + (Math.random() - 0.5) * 0.6;
    positions[i * 3 + 1] = center.y + Math.random() * 0.5;
    positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * 0.6;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const sp = speedMin + Math.random() * (speedMax - speedMin);
    vels[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
    vels[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.9 + upBias;
    vels[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
    const c = colors[Math.floor(Math.random() * colors.length)];
    tmp.set(c);
    colArr[i * 3] = tmp.r;
    colArr[i * 3 + 1] = tmp.g;
    colArr[i * 3 + 2] = tmp.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const m = new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture, alphaTest: 0.01
  });
  const points = new THREE.Points(g, m);
  fxGroup.add(points);
  const sys = { points, vels, t: 0, life, swirl: swirl || 0, gravity: 3.2 };
  particleSystems.push(sys);
  return sys;
}

function clearParticles() {
  for (const s of particleSystems) {
    fxGroup.remove(s.points);
    s.points.geometry.dispose();
    s.points.material.dispose();
  }
  particleSystems.length = 0;
}

function updateParticles(dt) {
  for (let i = particleSystems.length - 1; i >= 0; i--) {
    const s = particleSystems[i];
    s.t += dt;
    const k = s.t / s.life;
    const posAttr = s.points.geometry.getAttribute('position');
    const arr = posAttr.array;
    const n = arr.length / 3;
    for (let j = 0; j < n; j++) {
      const ix = j * 3;
      if (s.swirl) {
        const x = arr[ix];
        const z = arr[ix + 2];
        const ang = s.swirl * dt;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        arr[ix] = x * cos - z * sin;
        arr[ix + 2] = x * sin + z * cos;
      }
      s.vels[ix + 1] -= s.gravity * dt * 0.55;
      arr[ix] += s.vels[ix] * dt;
      arr[ix + 1] += s.vels[ix + 1] * dt;
      arr[ix + 2] += s.vels[ix + 2] * dt;
      if (arr[ix + 1] < 0.05) { arr[ix + 1] = 0.05; s.vels[ix + 1] *= -0.35; }
    }
    posAttr.needsUpdate = true;
    s.points.material.opacity = Math.max(0, 1 - k);
    if (s.t >= s.life) {
      fxGroup.remove(s.points);
      s.points.geometry.dispose();
      s.points.material.dispose();
      particleSystems.splice(i, 1);
    }
  }
}

function spawnWinParticles(center) {
  makeParticleSystem({
    count: 900, colors: [0xffd977, 0xfff3c4, 0xe8a93d, 0xffffff],
    center: new THREE.Vector3(center.x, 1.2, center.z),
    speedMin: 2.5, speedMax: 8.5, upBias: 4.2, size: 0.14, life: 3.4, swirl: 1.4
  });
  makeParticleSystem({
    count: 350, colors: [0xffe9a8, 0xffffff],
    center: new THREE.Vector3(center.x, 2.5, center.z),
    speedMin: 1.0, speedMax: 3.0, upBias: 1.4, size: 0.1, life: 2.6, swirl: -1.0
  });
}

function spawnLossParticles(center) {
  makeParticleSystem({
    count: 700, colors: [0x6fb3ff, 0x2b4a8f, 0xff4d5e, 0x9dc0ff],
    center: new THREE.Vector3(center.x, 1.0, center.z),
    speedMin: 2.0, speedMax: 7.0, upBias: 2.6, size: 0.13, life: 2.8, swirl: 0.8
  });
}

function spawnDrawParticles() {
  const c = new THREE.Vector3(0, 1.4, 0);
  makeParticleSystem({
    count: 450, colors: [0xf2ecdd, 0xffffff],
    center: c, speedMin: 1.5, speedMax: 4.5, upBias: 2.2, size: 0.12, life: 3.6, swirl: 2.2
  });
  makeParticleSystem({
    count: 450, colors: [0x22345e, 0x6fb3ff],
    center: c, speedMin: 1.5, speedMax: 4.5, upBias: 2.2, size: 0.12, life: 3.6, swirl: -2.2
  });
}

/* ---- 胜负光柱 / 镜头 / 震屏 ---- */
function clearWinBeam() {
  if (winBeamGroup) {
    scene.remove(winBeamGroup);
    winBeamGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    winBeamGroup = null;
  }
  if (winBeamLight) { scene.remove(winBeamLight); winBeamLight = null; }
}

function buildWinBeam(cells, mode) {
  clearWinBeam();
  winBeamGroup = new THREE.Group();
  const pts = cells.map((c) => gridToWorld(c.x, c.y));
  pts.sort((a, b) => (a.x - b.x) || (a.z - b.z));
  const p0 = pts[0];
  const p1 = pts[pts.length - 1];
  const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  mid.y = STONE_Y + 0.35;
  const len = p0.distanceTo(p1) + 1.4;
  const angle = Math.atan2(p1.z - p0.z, p1.x - p0.x);

  const isWin = mode === 'win';
  const coreColor = isWin ? 0xffd977 : 0x7fb6ff;
  const haloColor = isWin ? 0xff9d2e : 0x2b4a8f;

  const coreGeo = new THREE.BoxGeometry(len, 0.1, 0.2);
  const coreMat = new THREE.MeshBasicMaterial({ color: coreColor, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.copy(mid);
  core.rotation.y = -angle;
  winBeamGroup.add(core);

  const haloGeo = new THREE.BoxGeometry(len + 0.4, 0.22, 0.5);
  const haloMat = new THREE.MeshBasicMaterial({ color: haloColor, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(mid);
  halo.position.y += 0.02;
  halo.rotation.y = -angle;
  winBeamGroup.add(halo);

  for (const c of cells) {
    const wp = gridToWorld(c.x, c.y);
    const colGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.2, 20, 1, true);
    const colMat = new THREE.MeshBasicMaterial({ color: coreColor, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(wp.x, STONE_Y + 1.6, wp.z);
    winBeamGroup.add(col);
  }

  winBeamLight = new THREE.PointLight(coreColor, 30, 16, 2);
  winBeamLight.position.set(mid.x, 3.2, mid.z);
  scene.add(winBeamLight);
  scene.add(winBeamGroup);
}

function focusCameraOn(worldPos, dist) {
  const d = dist || 9;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const toPos = new THREE.Vector3().copy(worldPos).addScaledVector(dir, d);
  toPos.y = Math.max(toPos.y, worldPos.y + 6.5);
  const toTg = new THREE.Vector3(worldPos.x, 0.4, worldPos.z);
  camAnim = {
    fromPos: camera.position.clone(), toPos,
    fromTg: controls.target.clone(), toTg,
    t: 0, dur: 1.6
  };
}

function resetView(instant) {
  if (instant) {
    camera.position.copy(DEFAULT_CAM_POS);
    controls.target.copy(DEFAULT_CAM_TG);
    camAnim = null;
    return;
  }
  camAnim = {
    fromPos: camera.position.clone(), toPos: DEFAULT_CAM_POS.clone(),
    fromTg: controls.target.clone(), toTg: DEFAULT_CAM_TG.clone(),
    t: 0, dur: 0.9
  };
}

function startShake(duration, strength) {
  shakeTime = duration || 0.55;
  shakeDuration = shakeTime;
  shakeStrength = strength || 0.35;
  if (container) {
    container.classList.remove('shake');
    void container.offsetWidth;
    container.classList.add('shake');
  }
}

function flashScreen(kind) {
  if (!flashEl) return;
  flashEl.className = 'flash ' + kind;
  setTimeout(() => { flashEl.className = 'flash'; }, kind === 'gold' ? 900 : 700);
}

/* ================= 7. 对局流程 ================= */
function setStatus(text, mode) {
  if (statusText) statusText.textContent = text;
  else if (statusEl) statusEl.textContent = text;
  if (statusEl) {
    statusEl.classList.toggle('forbidden', mode === 'forbidden');
  }
}

function setThinkingUI(on) {
  if (aiGlowEl) aiGlowEl.classList.toggle('hidden', !on);
  if (statusEl) statusEl.classList.toggle('thinking', on);
  if (aiStateEl) {
    aiStateEl.textContent = on ? '思考中' : '待机';
    aiStateEl.classList.toggle('on', on);
  }
  const label = document.getElementById('thinkingLabel');
  if (label && !on) label.textContent = '';
}

function updateUI(text) {
  if (text) setStatus(text);
  if (turnInfoEl) turnInfoEl.textContent = currentColor === BLACK ? '黑棋' : '白棋';
  if (youAreEl) youAreEl.textContent = playerColor === BLACK ? '黑棋' : '白棋';
}

function addHistoryItem() {
  const m = history[history.length - 1];
  const li = document.createElement('li');
  const label = (m.color === BLACK ? '黑' : '白') + ' ' + coordLabel(m.x, m.y);
  li.textContent = '第' + history.length + '手 ' + label + (m.color === playerColor ? ' · 你' : ' · AI');
  historyEl.prepend(li);
}

function rebuildHistory() {
  historyEl.innerHTML = '';
  history.forEach((m, i) => {
    const li = document.createElement('li');
    li.textContent = '第' + (i + 1) + '手 ' + (m.color === BLACK ? '黑' : '白') + ' ' + coordLabel(m.x, m.y) + (m.color === playerColor ? ' · 你' : ' · AI');
    historyEl.prepend(li);
  });
}

function showForbidTip(text, ms) {
  if (!forbidTipEl) return;
  forbidTipEl.textContent = text;
  forbidTipEl.classList.remove('hidden');
  clearTimeout(showForbidTip._t);
  showForbidTip._t = setTimeout(() => { forbidTipEl.classList.add('hidden'); }, ms || 2200);
}

function placeStone(x, y, color, instant) {
  board[y][x] = color;
  history.push({ x, y, color });
  lastMove = { x, y };
  currentColor = color === BLACK ? WHITE : BLACK;
  moveCountEl.textContent = '手数 ' + history.length;
  addHistoryItem();
  dropStoneAnimated(x, y, color, !!instant);
  if (!instant) AudioEngine.playStone(color);
  const win = checkWin(board, x, y, color);
  if (win) { endGame(color, win, null); return win; }
  if (history.length >= SIZE * SIZE) { endGame(0, null, null); return []; }
  return null;
}

function endGame(winner, winCells, extra) {
  gameOver = true;
  gameResult = { winner, winCells: winCells || null, extra: extra || null };
  exitReplay(true);
  if (previewStone) previewStone.visible = false;
  if (crosshair) crosshair.visible = false;
  if (winCard) winCard.classList.remove('loss', 'draw', 'forbid');

  if (winner === 0) {
    if (winIcon) winIcon.innerHTML = ICON_DRAW;
    if (winTitle) winTitle.textContent = '和棋';
    if (winDesc) winDesc.textContent = '棋盘已满，势均力敌。';
    setStatus('和棋');
    if (turnInfoEl) turnInfoEl.textContent = '和棋';
    spawnDrawParticles();
    AudioEngine.playDraw();
    flashScreen('taiji');
  } else if (extra && extra.foul) {
    // 禁手 / 无棋可下判负
    const foulName = extra.foulName || '禁手犯规';
    const loserIsHuman = extra.loser === playerColor;
    if (winIcon) winIcon.innerHTML = ICON_FORBID;
    if (winTitle) winTitle.textContent = loserIsHuman ? '禁手告负' : '对方禁手，你获胜';
    if (winDesc) winDesc.textContent = foulName + '。' + (loserIsHuman ? '黑棋触犯禁手，殊为可惜。' : '对方黑棋触犯禁手，直接判负。');
    if (winCard) winCard.classList.add('forbid');
    setStatus(foulName + '，对局结束');
    if (turnInfoEl) turnInfoEl.textContent = winner === BLACK ? '黑棋胜' : '白棋胜';
    if (loserIsHuman) { AudioEngine.playLose(); startShake(0.6, 0.4); flashScreen('cold'); }
    else {
      AudioEngine.playWin();
      if (lastMove) {
        const wp = gridToWorld(lastMove.x, lastMove.y);
        spawnWinParticles(wp);
        focusCameraOn(wp, 8.5);
      }
      flashScreen('gold');
    }
  } else if (winner === playerColor) {
    if (winIcon) winIcon.innerHTML = ICON_WIN;
    if (winTitle) winTitle.textContent = '你赢了';
    if (winDesc) winDesc.textContent = '恭喜，在第 ' + history.length + ' 手连成五子。';
    setStatus('你获胜');
    if (turnInfoEl) turnInfoEl.textContent = winner === BLACK ? '黑棋胜' : '白棋胜';
    if (winCells) {
      buildWinBeam(winCells, 'win');
      const mid = winCells[Math.floor(winCells.length / 2)];
      const wp = gridToWorld(mid.x, mid.y);
      spawnWinParticles(wp);
      AudioEngine.playWin();
      focusCameraOn(wp, 8.5);
      flashScreen('gold');
    } else {
      AudioEngine.playWin();
    }
  } else {
    if (winIcon) winIcon.innerHTML = ICON_LOSS;
    if (winTitle) winTitle.textContent = 'AI 获胜';
    if (winDesc) winDesc.textContent = 'AI 在第 ' + history.length + ' 手获胜，再接再厉。';
    setStatus('AI 获胜，再来一局');
    if (turnInfoEl) turnInfoEl.textContent = winner === BLACK ? '黑棋胜' : '白棋胜';
    if (winCard) winCard.classList.add('loss');
    if (winCells) {
      buildWinBeam(winCells, 'loss');
      const mid = winCells[Math.floor(winCells.length / 2)];
      const wp = gridToWorld(mid.x, mid.y);
      spawnLossParticles(wp);
      AudioEngine.playLose();
      focusCameraOn(wp, 9.5);
    } else {
      AudioEngine.playLose();
    }
    startShake(0.6, 0.4);
    flashScreen('cold');
  }
  updateLastMoveHalo();
  setTimeout(() => { if (winOverlay && !replay.active) winOverlay.classList.remove('hidden'); }, winner === 0 ? 900 : 1400);
}

function resetGame() {
  exitReplay(true);
  initState();
  clearAllStones();
  if (previewStone) previewStone.visible = false;
  if (crosshair) crosshair.visible = false;
  if (winOverlay) winOverlay.classList.add('hidden');
  if (historyEl) historyEl.innerHTML = '';
  if (moveCountEl) moveCountEl.textContent = '手数 0';
  if (aiBar) aiBar.style.width = '0';
  if (aiDepthEl) aiDepthEl.textContent = '—';
  if (aiEvalEl) aiEvalEl.textContent = '—';
  if (aiNpsEl) aiNpsEl.textContent = '—';
  if (aiPvEl) aiPvEl.textContent = 'PV —';
  if (forbidTipEl) forbidTipEl.classList.add('hidden');
  setThinkingUI(false);
  resetView(true);
  updateUI('轮到' + (currentColor === playerColor ? '你' : 'AI') + '落子');
  if (playerColor !== BLACK) {
    updateUI('AI 执黑先行…');
    aiMove(false);
  } else {
    updateUI('轮到你落子（黑棋）');
  }
}

/* ---- 人类落子（含禁手拦截） ---- */
function humanPlay(x, y) {
  if (!canHumanPlay()) return;
  if (board[y][x] !== 0) return;
  if (renjuEnabled && playerColor === BLACK) {
    const ft = forbiddenType2D(board, x, y, BLACK);
    if (ft) {
      AudioEngine.playForbid();
      showForbidTip('禁手！' + FORBID_NAMES[ft] + ' — 请另选落点');
      setStatus('禁手：' + FORBID_NAMES[ft] + '，请另选落点', 'forbidden');
      startShake(0.35, 0.2);
      return;
    }
  }
  if (previewStone) previewStone.visible = false;
  if (crosshair) crosshair.visible = false;
  placeStone(x, y, playerColor);
  if (!gameOver) {
    updateUI('AI 思考中…');
    aiMove(false);
  }
}

/* ================= 8. 复盘系统 ================= */
const replay = {
  active: false,
  list: [],
  index: 0,
  auto: false,
  autoTimer: 0
};

function enterReplay() {
  if (!history.length) return;
  replay.active = true;
  replay.list = history.map((m) => ({ x: m.x, y: m.y, color: m.color }));
  replay.index = 0;
  replay.auto = false;
  if (winOverlay) winOverlay.classList.add('hidden');
  if (previewStone) previewStone.visible = false;
  if (replayBar) replayBar.classList.remove('hidden');
  if (replayAutoBtn) {
    replayAutoBtn.textContent = '▶ 自动';
    replayAutoBtn.classList.remove('active');
    replayAutoBtn.setAttribute('aria-pressed', 'false');
  }
  // 清空棋盘进入回放态
  initStateKeepResult();
  clearAllStones();
  if (replayBar) replayBar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  replayGoto(replay.list.length); // 先展示终局，随后用户可步进
  setStatus('复盘模式：拖动步进回顾对局');
}

function initStateKeepResult() {
  const kept = gameResult;
  const over = gameOver;
  initState();
  gameResult = kept;
  gameOver = over;
}

function replayGoto(i) {
  if (!replay.active) return;
  replay.index = Math.max(0, Math.min(replay.list.length, i));
  clearAllStones();
  // 无动画瞬间重建前 index 手（含阴影，无音效）
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  history = [];
  for (let k = 0; k < replay.index; k++) {
    const m = replay.list[k];
    board[m.y][m.x] = m.color;
    history.push({ x: m.x, y: m.y, color: m.color });
    dropStoneAnimated(m.x, m.y, m.color, true);
  }
  lastMove = replay.index > 0 ? { x: replay.list[replay.index - 1].x, y: replay.list[replay.index - 1].y } : null;
  currentColor = replay.index % 2 === 0 ? BLACK : WHITE;
  moveCountEl.textContent = '手数 ' + history.length + ' / ' + replay.list.length;
  rebuildHistory();
  updateLastMoveHalo();
  if (replayPos) replayPos.textContent = replay.index + ' / ' + replay.list.length;
  if (lastMove) {
    const wp = gridToWorld(lastMove.x, lastMove.y);
    focusCameraOn(wp, 10);
  } else {
    resetView(false);
  }
}

function replayStep(d) {
  if (!replay.active) return;
  replay.auto = false;
  if (replayAutoBtn) {
    replayAutoBtn.textContent = '▶ 自动';
    replayAutoBtn.classList.remove('active');
  }
  replayGoto(replay.index + d);
}

function toggleReplayAuto() {
  if (!replay.active) return;
  replay.auto = !replay.auto;
  replay.autoTimer = 0;
  if (replayAutoBtn) {
    replayAutoBtn.textContent = replay.auto ? '⏸ 暂停' : '▶ 自动';
    replayAutoBtn.classList.toggle('active', replay.auto);
    replayAutoBtn.setAttribute('aria-pressed', String(replay.auto));
  }
  if (replay.auto && replay.index >= replay.list.length) replayGoto(0);
}

function exitReplay(silent) {
  if (!replay.active) return;
  replay.active = false;
  replay.auto = false;
  replay.list = [];
  replay.index = 0;
  if (replayBar) replayBar.classList.add('hidden');
}

/* ================= 9. SGF / PGN / 截图 ================= */
function sgfCoord(x, y) {
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}
function exportSGF() {
  let s = '(;GM[1]FF[4]SZ[15]AP[3DGobang]';
  s += 'RU[' + (renjuEnabled ? 'Renju' : 'Chinese') + ']';
  s += 'PB[' + (playerColor === BLACK ? 'Human' : 'AI') + ']PW[' + (playerColor === WHITE ? 'Human' : 'AI') + ']';
  const snap = replay.active ? replay.list : history;
  for (const m of snap) {
    s += ';' + (m.color === BLACK ? 'B' : 'W') + '[' + sgfCoord(m.x, m.y) + ']';
  }
  s += ')';
  return s;
}
function exportPGN() {
  const snap = replay.active ? replay.list : history;
  let s = '[Event "3D Gobang"]\n[Site "Local"]\n[Size "15x15"]\n';
  s += '[Black "' + (playerColor === BLACK ? 'Human' : 'AI') + '"]\n';
  s += '[White "' + (playerColor === WHITE ? 'Human' : 'AI') + '"]\n';
  s += '[Rule "' + (renjuEnabled ? 'Renju' : 'Freestyle') + '"]\n\n';
  for (let i = 0; i < snap.length; i += 2) {
    const n = i / 2 + 1;
    const b = snap[i] ? coordLabel(snap[i].x, snap[i].y) : '';
    const w = snap[i + 1] ? coordLabel(snap[i + 1].x, snap[i + 1].y) : '';
    s += n + '. ' + b + (w ? ' ' + w : '') + ' ';
    if (n % 4 === 0) s += '\n';
  }
  if (gameResult && gameResult.winner === BLACK) s += '\n1-0\n';
  else if (gameResult && gameResult.winner === WHITE) s += '\n0-1\n';
  else if (gameResult && gameResult.winner === 0) s += '\n1/2-1/2\n';
  return s;
}
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 800);
}
function importSGFFromText(text) {
  const re = /;([BW])\[([a-s])([a-s])\]/g;
  const moves = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const color = m[1] === 'B' ? BLACK : WHITE;
    const x = m[2].charCodeAt(0) - 97;
    const y = m[3].charCodeAt(0) - 97;
    if (inBoard(x, y)) moves.push({ x, y, color });
  }
  if (!moves.length) {
    showForbidTip('未在文本中找到可用 SGF 着法');
    return false;
  }
  exitReplay(true);
  initState();
  clearAllStones();
  if (winOverlay) winOverlay.classList.add('hidden');
  if (historyEl) historyEl.innerHTML = '';
  setThinkingUI(false);
  for (const mv of moves) {
    if (board[mv.y][mv.x] !== 0) continue;
    if (renjuEnabled && mv.color === BLACK && forbiddenType2D(board, mv.x, mv.y, BLACK)) {
      endGame(mv.color === BLACK ? WHITE : BLACK, null, { foul: 'forbid', foulName: '黑棋' + FORBID_NAMES[forbiddenType2D(board, mv.x, mv.y, BLACK)], loser: BLACK });
      moveCountEl.textContent = '手数 ' + history.length;
      return true;
    }
    placeStone(mv.x, mv.y, mv.color, true);
    if (gameOver) break;
  }
  moveCountEl.textContent = '手数 ' + history.length;
  if (!gameOver) updateUI('已导入 ' + moves.length + ' 手，轮到' + (currentColor === playerColor ? '你' : 'AI') + '落子');
  resetView(true);
  return true;
}
function saveScreenshot() {
  try {
    AudioEngine.ensure();
    if (composer) composer.render();
    else if (renderer && scene && camera) renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = 'gobang-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    AudioEngine.playClick();
  } catch (e) {
    showForbidTip('截图失败：' + String((e && e.message) || e));
  }
}

/* ================= 10. 交互 / UI / 自适应 / 主循环 ================= */
function cellFromPointer(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObject(hitPlane, false);
  if (!hits.length) return null;
  const p = hits[0].point;
  const x = Math.round(p.x / SPACING + HALF);
  const y = Math.round(p.z / SPACING + HALF);
  if (!inBoard(x, y)) return null;
  return { x, y };
}

function canHumanPlay() {
  return !gameOver && !replay.active && !aiThinking && currentColor === playerColor;
}

function bindInteraction() {
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!canHumanPlay()) {
      if (previewStone) previewStone.visible = false;
      if (crosshair) crosshair.visible = false;
      if (forbidTipEl && !forbidTipEl.classList.contains('hidden') && forbidTipEl.dataset.pin !== '1') {
        // 悬停提示不常驻
      }
      return;
    }
    const c = cellFromPointer(e.clientX, e.clientY);
    const prevKey = hoverCell ? hoverCell.x + ',' + hoverCell.y : null;
    const nextKey = c ? c.x + ',' + c.y : null;
    hoverCell = c;
    if (c && board[c.y][c.x] === 0) {
      const p = gridToWorld(c.x, c.y);
      const isForbid = renjuEnabled && playerColor === BLACK && !!forbiddenType2D(board, c.x, c.y, BLACK);
      previewStone.visible = true;
      previewStone.material = isForbid ? previewMatForbid : (playerColor === BLACK ? previewMatBlack : previewMatWhite);
      previewStone.position.set(p.x, STONE_Y + 0.12, p.z);
      renderer.domElement.style.cursor = isForbid ? 'not-allowed' : 'pointer';
      // 十字微光目标（主循环 Lerp 平滑追踪）
      crossTarget = { x: p.x, z: p.z };
      crosshair.visible = true;
      if (isForbid) {
        const ft = forbiddenType2D(board, c.x, c.y, BLACK);
        showForbidTip('禁手点：' + FORBID_NAMES[ft], 1200);
      }
      if (nextKey !== prevKey) AudioEngine.playHover();
    } else {
      previewStone.visible = false;
      crosshair.visible = false;
      crossTarget = null;
      renderer.domElement.style.cursor = 'default';
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    hoverCell = null;
    crossTarget = null;
    if (previewStone) previewStone.visible = false;
    if (crosshair) crosshair.visible = false;
  });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    AudioEngine.ensure();
    if (e.button === 2) return;
    if (!canHumanPlay()) return;
    const c = cellFromPointer(e.clientX, e.clientY);
    if (!c || board[c.y][c.x] !== 0) return;
    humanPlay(c.x, c.y);
  });
  renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); });
}

/* ---- UI 事件 ---- */
function syncSeg() {
  document.querySelectorAll('#colorSeg button').forEach((b) => {
    b.classList.toggle('active', (b.dataset.color === 'black') === (playerColor === BLACK));
  });
  document.querySelectorAll('#levelSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.level === level);
  });
}

function currentColorAfter(nMoves) {
  return nMoves % 2 === 0 ? BLACK : WHITE;
}

function doUndo() {
  if (aiThinking || replay.active || history.length === 0) return;
  AudioEngine.ensure();
  AudioEngine.playUndo();
  if (gameOver) {
    while (history.length && history[history.length - 1].color !== playerColor) {
      const m = history.pop();
      board[m.y][m.x] = 0;
      removeStoneAnimated(m.x, m.y);
    }
    if (history.length) {
      const m = history.pop();
      board[m.y][m.x] = 0;
      removeStoneAnimated(m.x, m.y);
    }
    gameOver = false;
    gameResult = null;
    if (winOverlay) winOverlay.classList.add('hidden');
    clearWinBeam();
    clearParticles();
  } else {
    const m1 = history.pop();
    if (m1) { board[m1.y][m1.x] = 0; removeStoneAnimated(m1.x, m1.y); }
    // 常规：撤回 AI 的一步 + 你的一步，确保轮到你
    if (history.length) {
      const top = history[history.length - 1];
      if (top && top.color !== playerColor) {
        const m = history.pop();
        board[m.y][m.x] = 0;
        removeStoneAnimated(m.x, m.y);
      }
    }
  }
  currentColor = currentColorAfter(history.length);
  lastMove = history.length ? history[history.length - 1] : null;
  while (!gameOver && currentColor !== playerColor && history.length) {
    const m = history.pop();
    board[m.y][m.x] = 0;
    removeStoneAnimated(m.x, m.y);
    currentColor = currentColorAfter(history.length);
    lastMove = history.length ? history[history.length - 1] : null;
  }
  rebuildHistory();
  moveCountEl.textContent = '手数 ' + history.length;
  updateLastMoveHalo();
  updateUI('已悔棋，轮到你落子');
}

function bindUI() {
  document.getElementById('restartBtn').onclick = () => { AudioEngine.ensure(); AudioEngine.playClick(); resetGame(); };
  document.getElementById('againBtn').onclick = () => { AudioEngine.ensure(); AudioEngine.playClick(); resetGame(); };
  const reviewBtn = document.getElementById('reviewBtn');
  if (reviewBtn) reviewBtn.onclick = () => { AudioEngine.ensure(); AudioEngine.playClick(); enterReplay(); };

  document.getElementById('undoBtn').onclick = doUndo;

  document.getElementById('hintBtn').onclick = () => {
    if (gameOver || replay.active || aiThinking || currentColor !== playerColor) return;
    AudioEngine.ensure();
    AudioEngine.playClick();
    aiMove(true);
  };

  document.getElementById('swapBtn').onclick = () => {
    playerColor = playerColor === BLACK ? WHITE : BLACK;
    aiColor = aiColor === BLACK ? WHITE : BLACK;
    syncSeg();
    resetGame();
  };

  document.getElementById('colorSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.dataset.color) {
      playerColor = btn.dataset.color === 'black' ? BLACK : WHITE;
      aiColor = playerColor === BLACK ? WHITE : BLACK;
      syncSeg();
      resetGame();
    }
  });
  document.getElementById('levelSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.dataset.level) { level = btn.dataset.level; syncSeg(); AudioEngine.playClick(); }
  });

  if (renjuToggle) {
    renjuToggle.addEventListener('change', () => {
      renjuEnabled = !!renjuToggle.checked;
      AudioEngine.ensure();
      AudioEngine.playClick();
      showForbidTip(renjuEnabled ? '禁手规则已开启：黑棋三三·四四·长连判犯规（落子时拦截提示）' : '禁手规则已关闭：自由规则', 2400);
      if (!gameOver) updateUI(renjuEnabled ? '禁手已开启，轮到' + (currentColor === playerColor ? '你' : 'AI') + '落子' : '禁手已关闭，轮到' + (currentColor === playerColor ? '你' : 'AI') + '落子');
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      AudioEngine.ensure();
      AudioEngine.setVolume((Number(volumeSlider.value) || 55) / 100);
    });
  }

  if (resetViewBtn) resetViewBtn.onclick = () => resetView(false);
  if (rotateBtn) {
    rotateBtn.onclick = () => {
      autoRotateWanted = !autoRotateWanted;
      controls.autoRotate = autoRotateWanted;
      rotateBtn.classList.toggle('active', autoRotateWanted);
      rotateBtn.setAttribute('aria-pressed', String(autoRotateWanted));
    };
  }
  if (topViewBtn) {
    topViewBtn.onclick = () => {
      camAnim = {
        fromPos: camera.position.clone(), toPos: new THREE.Vector3(0, 22, 0.8),
        fromTg: controls.target.clone(), toTg: new THREE.Vector3(0, 0, 0.3),
        t: 0, dur: 0.9
      };
    };
  }
  if (soundBtn) {
    AudioEngine.syncButton();
    soundBtn.onclick = () => {
      AudioEngine.ensure();
      AudioEngine.setMuted(!AudioEngine.muted);
      if (!AudioEngine.muted) AudioEngine.playClick();
    };
  }
  if (shotBtn) shotBtn.onclick = saveScreenshot;

  const sgfBtn = document.getElementById('sgfBtn');
  if (sgfBtn) sgfBtn.onclick = () => {
    AudioEngine.playClick();
    downloadText('gobang.sgf', exportSGF());
  };
  const pgnBtn = document.getElementById('pgnBtn');
  if (pgnBtn) pgnBtn.onclick = () => {
    AudioEngine.playClick();
    downloadText('gobang.txt', exportPGN());
  };
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) copyBtn.onclick = async () => {
    AudioEngine.playClick();
    try {
      await navigator.clipboard.writeText(exportSGF());
      showForbidTip('SGF 棋谱已复制到剪贴板', 1600);
    } catch (e) {
      downloadText('gobang.sgf', exportSGF());
    }
  };
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  if (importBtn && importFile) {
    importBtn.onclick = () => importFile.click();
    importFile.addEventListener('change', () => {
      const f = importFile.files && importFile.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { importSGFFromText(String(rd.result || '')); importFile.value = ''; };
      rd.readAsText(f);
    });
  }

  // 复盘条
  if (replayPrevBtn) replayPrevBtn.onclick = () => replayStep(-1);
  if (replayNextBtn) replayNextBtn.onclick = () => replayStep(1);
  if (replayAutoBtn) replayAutoBtn.onclick = toggleReplayAuto;
  if (replayExitBtn) replayExitBtn.onclick = () => {
    // 退出复盘：恢复终局完整局面
    const list = replay.list.slice();
    exitReplay(true);
    initState();
    clearAllStones();
    if (historyEl) historyEl.innerHTML = '';
    for (const mv of list) {
      board[mv.y][mv.x] = mv.color;
      history.push({ x: mv.x, y: mv.y, color: mv.color });
      dropStoneAnimated(mv.x, mv.y, mv.color, true);
    }
    lastMove = history.length ? history[history.length - 1] : null;
    currentColor = currentColorAfter(history.length);
    // 恢复胜负判定显示
    if (lastMove) {
      const w = checkWin(board, lastMove.x, lastMove.y, history[history.length - 1].color);
      if (w) {
        gameOver = true;
        gameResult = { winner: history[history.length - 1].color, winCells: w, extra: null };
        buildWinBeam(w, gameResult.winner === playerColor ? 'win' : 'loss');
        updateLastMoveHalo();
        if (winOverlay) winOverlay.classList.remove('hidden');
      } else if (history.length >= SIZE * SIZE) {
        gameOver = true;
        gameResult = { winner: 0, winCells: null, extra: null };
        if (winOverlay) winOverlay.classList.remove('hidden');
      }
    }
    moveCountEl.textContent = '手数 ' + history.length;
    rebuildHistory();
    resetView(false);
    updateUI(gameOver ? '复盘结束，已回到终局' : '已退出复盘');
  };

  // 首次交互即解锁 AudioContext（浏览器自动播放策略）
  window.addEventListener('pointerdown', () => AudioEngine.ensure(), { passive: true });
  window.addEventListener('keydown', () => AudioEngine.ensure());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') resetView(false);
    if (e.key === 't' || e.key === 'T') {
      camAnim = {
        fromPos: camera.position.clone(), toPos: new THREE.Vector3(0, 22, 0.8),
        fromTg: controls.target.clone(), toTg: new THREE.Vector3(0, 0, 0.3),
        t: 0, dur: 0.9
      };
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (rotateBtn) rotateBtn.click();
    }
    if (replay.active && e.key === 'ArrowLeft') replayStep(-1);
    if (replay.active && e.key === 'ArrowRight') replayStep(1);
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
  });
}

/* ---- 自适应 ---- */
function onResize() {
  if (!renderer || !container) return;
  const w = container.clientWidth || 640;
  const h = container.clientHeight || 640;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

/* ---- 主循环 ---- */
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.elapsed += dt;
    const t = Math.min(1, tw.elapsed / tw.dur);
    tw.update(t);
    if (t >= 1) {
      tweens.splice(i, 1);
      if (tw.complete) tw.complete();
    }
  }
}

function updateRipples(dt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.t += dt;
    const k = Math.min(1, r.t / r.dur);
    const s = 1 + k * 2.6;
    r.mesh.scale.set(s, s, s);
    r.mesh.material.opacity = 0.85 * (1 - k);
    if (k >= 1) {
      fxGroup.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      ripples.splice(i, 1);
    }
  }
}

let firstFrame = true;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateTweens(dt);
  updateRipples(dt);
  updateParticles(dt);

  if (grainPass) grainPass.uniforms.uTime.value = t;

  // 复盘自动播放
  if (replay.active && replay.auto) {
    replay.autoTimer += dt;
    if (replay.autoTimer >= 0.95) {
      replay.autoTimer = 0;
      if (replay.index >= replay.list.length) {
        replay.auto = false;
        if (replayAutoBtn) {
          replayAutoBtn.textContent = '▶ 自动';
          replayAutoBtn.classList.remove('active');
        }
      } else {
        replayGoto(replay.index + 1);
      }
    }
  }

  // 十字微光 Lerp 平滑追踪
  if (crosshair && crosshair.visible && crossTarget) {
    crosshair.position.x += (crossTarget.x - crosshair.position.x) * Math.min(1, dt * 14);
    crosshair.position.z += (crossTarget.z - crosshair.position.z) * Math.min(1, dt * 14);
    const pulse = 0.45 + Math.sin(t * 5) * 0.15;
    crosshairMat.opacity = pulse;
  }

  // 相机缓动（胜利特写 / 重置视角 / 复盘追踪）
  if (camAnim) {
    camAnim.t += dt;
    const k = Math.min(1, camAnim.t / camAnim.dur);
    const e = easeInOutCubic(k);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromTg, camAnim.toTg, e);
    if (k >= 1) camAnim = null;
  }

  // 落败震屏：相机抖动
  if (shakeTime > 0) {
    shakeTime -= dt;
    const k = Math.max(0, shakeTime / shakeDuration);
    const s = shakeStrength * k;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s * 0.6;
    if (shakeTime <= 0) resetView(false);
  }

  // 最后一手金色光环：悬浮旋转 + 呼吸
  if (lastMoveHalo && lastMoveHalo.visible) {
    lastMoveHalo.rotation.z = t * 1.2;
    lastMoveHalo.position.y = STONE_Y + 0.62 + Math.sin(t * 2.4) * 0.07;
    const pulse = 0.75 + Math.sin(t * 3.2) * 0.25;
    haloMaterial.opacity = pulse;
    const sc = 1 + Math.sin(t * 3.2) * 0.04;
    lastMoveHalo.scale.set(sc, sc, 1);
  }

  // 胜负光柱脉冲
  if (winBeamGroup) {
    const pulse = 0.7 + Math.sin(t * 5) * 0.3;
    winBeamGroup.children.forEach((child, chIdx) => {
      if (child.material) child.material.opacity = (chIdx === 0 ? 0.95 : 0.35) * pulse + 0.15;
    });
    if (winBeamLight) winBeamLight.intensity = 24 + Math.sin(t * 5) * 10;
  }

  // AI 思考呼吸光
  if (aiMoodLight) {
    const target = aiThinking ? 14 + Math.sin(t * 4) * 6 : 0;
    aiMoodLight.intensity += (target - aiMoodLight.intensity) * Math.min(1, dt * 5);
  }

  // 悬停预览棋轻浮
  if (previewStone && previewStone.visible && canHumanPlay() && hoverCell) {
    previewStone.position.y = STONE_Y + 0.12 + Math.sin(t * 4) * 0.05;
  }

  controls.update();
  composer.render();
  if (firstFrame) {
    firstFrame = false;
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

/* ================= 启动 ================= */
initState();
try {
  initThree();
  initWorker();
  bindInteraction();
  bindUI();
  syncSeg();
  if (volumeSlider) AudioEngine.setVolume((Number(volumeSlider.value) || 55) / 100);
  resetGame();
  animate();
} catch (err) {
  if (loadingEl) loadingEl.innerHTML = '<p>WebGL 初始化失败：' + String(err && err.message ? err.message : err) + '</p>';
  throw err;
}
