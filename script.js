/* 3D 沉浸式五子棋 — Three.js 场景 + 启发式 AI 引擎 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ================= 基础常量与 DOM ================= */
const SIZE = 15;
const SPACING = 1;
const HALF = (SIZE - 1) / 2; // 7
const STONE_Y = 0.30;
const DROP_HEIGHT = 6.0;

const container = document.getElementById('scene-container');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const moveCountEl = document.getElementById('moveCount');
const turnInfoEl = document.getElementById('turnInfo');
const youAreEl = document.getElementById('youAre');
const aiStateEl = document.getElementById('aiState');
const aiBar = document.getElementById('aiBar');
const historyEl = document.getElementById('history');
const winOverlay = document.getElementById('winOverlay');
const winTitle = document.getElementById('winTitle');
const winDesc = document.getElementById('winDesc');
const winIcon = document.getElementById('winIcon');
const winCard = winOverlay ? winOverlay.querySelector('.win-card') : null;
const loadingEl = document.getElementById('loading');
const aiGlowEl = document.getElementById('aiGlow');
const flashEl = document.getElementById('flash');
const resetViewBtn = document.getElementById('resetViewBtn');
const rotateBtn = document.getElementById('rotateBtn');
const topViewBtn = document.getElementById('topViewBtn');
const soundBtn = document.getElementById('soundBtn');

const ICON_WIN = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" stroke="currentColor" stroke-width="1.6"/><path d="M7 5H4.5A1.5 1.5 0 0 0 4.6 8c.8.4 1.6.7 2.4.9M17 5h2.5A1.5 1.5 0 0 1 19.4 8c-.8.4-1.6.7-2.4.9M12 14v3M8.5 20.5h7M10 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LOSS = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';
const ICON_DRAW = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const ICON_SOUND_ON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6v4h2.5L9 13.5v-11L5 6H2.5z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON_SOUND_OFF = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6v4h2.5L9 13.5v-11L5 6H2.5z" fill="currentColor"/><path d="M11.5 6.5l3 3M14.5 6.5l-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

/* ================= 原生 Web Audio 拟真合成系统（零外部 mp3/wav 依赖） ================= */
const AudioEngine = {
  ctx: null,
  master: null,
  muted: false,
  lastHoverAt: 0,

  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        // 轻微压缩，防止胜利和弦叠加爆音
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (e) { return false; }
  },

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    }
    this.syncButton();
  },

  syncButton() {
    if (!soundBtn) return;
    soundBtn.innerHTML = (this.muted ? ICON_SOUND_OFF : ICON_SOUND_ON) + '<span>' + (this.muted ? '静音' : '音效开') + '</span>';
    soundBtn.classList.toggle('muted', this.muted);
    soundBtn.setAttribute('aria-pressed', String(!this.muted));
    soundBtn.title = this.muted ? '开启音效' : '静音（关闭合成音效）';
  },

  // 基础：包络音调
  tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.2, vol = 0.2, delay = 0, attack = 0.004 }) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },

  // 基础：滤波噪声敲击瞬态
  noise({ dur = 0.05, vol = 0.25, freq = 2500, q = 1.2, type = 'bandpass', delay = 0 }) {
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
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.master);
    src.start(t0);
  },

  // 落子：木石共振敲击感（黑棋低沉 / 白棋清亮）
  playStone(color) {
    if (this.muted || !this.ensure()) return;
    const dark = color === 1;
    const bodyFreq = dark ? 540 : 760;
    // 木质腔体共鸣
    this.tone({ freq: bodyFreq, freqEnd: bodyFreq * 0.55, type: 'triangle', dur: 0.16, vol: 0.42 });
    this.tone({ freq: dark ? 162 : 196, type: 'sine', dur: 0.18, vol: 0.38 });
    // 石质清脆瞬态
    this.noise({ dur: 0.045, vol: 0.30, freq: dark ? 2300 : 3100, q: 1.1 });
    // 高频泛音尾韵
    this.tone({ freq: dark ? 1620 : 2080, type: 'sine', dur: 0.09, vol: 0.07, delay: 0.008 });
  },

  // 悬停：交叉点微弱轻音（节流由调用方 + 内部双保险）
  playHover() {
    if (this.muted) return;
    const now = performance.now();
    if (now - this.lastHoverAt < 90) return;
    this.lastHoverAt = now;
    this.tone({ freq: 2350, type: 'sine', dur: 0.06, vol: 0.035 });
  },

  // 悔棋：回溯升调（宫商角式上行三音）
  playUndo() {
    if (this.muted || !this.ensure()) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', dur: 0.16, vol: 0.20, delay: i * 0.07 });
      this.tone({ freq: f * 2, type: 'sine', dur: 0.10, vol: 0.05, delay: i * 0.07 });
    });
  },

  // 获胜：金色三和弦胜利共鸣（C-E-G-C 琶音 + 高频 shimmer，长衰减）
  playWin() {
    if (this.muted || !this.ensure()) return;
    const chord = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    chord.forEach((f, i) => {
      const dl = i * 0.13;
      this.tone({ freq: f, type: 'triangle', dur: 2.4, vol: 0.24, delay: dl });
      this.tone({ freq: f, type: 'sine', dur: 2.8, vol: 0.16, delay: dl + 0.02 });
      this.tone({ freq: f * 2, type: 'sine', dur: 1.6, vol: 0.05, delay: dl + 0.03 });
    });
    // 金色 shimmer
    [1318.5, 1568, 2093].forEach((f, i) => {
      this.tone({ freq: f, type: 'sine', dur: 1.8, vol: 0.06, delay: 0.55 + i * 0.16 });
    });
    this.noise({ dur: 0.5, vol: 0.05, freq: 6000, q: 0.8, type: 'highpass', delay: 0.1 });
  },

  // 落败：深沉低频阻尼衰减震荡（下扫 + 低通轰鸣）
  playLose() {
    if (this.muted || !this.ensure()) return;
    this.tone({ freq: 110, freqEnd: 44, type: 'triangle', dur: 2.0, vol: 0.42 });
    this.tone({ freq: 68, type: 'sine', dur: 2.4, vol: 0.44 });
    this.tone({ freq: 51, type: 'sine', dur: 2.6, vol: 0.30, delay: 0.05 });
    this.tone({ freq: 220, freqEnd: 55, type: 'sawtooth', dur: 1.2, vol: 0.06 });
    this.noise({ dur: 0.35, vol: 0.10, freq: 320, q: 0.7, type: 'lowpass' });
  },

  // 和棋：中性完全五度，温和收尾
  playDraw() {
    if (this.muted || !this.ensure()) return;
    this.tone({ freq: 392, type: 'triangle', dur: 1.2, vol: 0.20 });
    this.tone({ freq: 587.33, type: 'triangle', dur: 1.4, vol: 0.18, delay: 0.12 });
  },

  playClick() {
    this.tone({ freq: 1250, type: 'sine', dur: 0.05, vol: 0.06 });
  }
};

/* ================= 对局状态 ================= */
let board;
let history;
let gameOver;
let playerColor = 1;
let aiColor = 2;
let level = 'medium';
let currentColor = 1;
let lastMove = null;
let hoverCell = null;
let aiThinking = false;

function initState() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  history = [];
  gameOver = false;
  currentColor = 1;
  lastMove = null;
  hoverCell = null;
  aiThinking = false;
}

/* ================= 规则判定 ================= */
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

/* ================= AI 启发式引擎（保留：新手/进阶/大师2-ply） ================= */
function lineScore(count, openEnds) {
  if (count >= 5) return 1000000;
  if (count === 4) return openEnds === 2 ? 100000 : 10000;
  if (count === 3) return openEnds === 2 ? 5000 : 500;
  if (count === 2) return openEnds === 2 ? 200 : 20;
  if (count === 1) return openEnds === 2 ? 10 : 2;
  return 0;
}

function evalPoint(bd, x, y, color) {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1;
    let ends = 0;
    for (const s of [1, -1]) {
      let nx = x + dx * s;
      let ny = y + dy * s;
      while (inBoard(nx, ny) && bd[ny][nx] === color) {
        count += 1;
        nx += dx * s;
        ny += dy * s;
      }
      if (inBoard(nx, ny) && bd[ny][nx] === 0) ends += 1;
    }
    total += lineScore(count, ends);
  }
  return total;
}

function candidates(bd, range = 2) {
  if (history.length === 0) return [{ x: 7, y: 7 }];
  const seen = new Set();
  const list = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (bd[y][x] !== 0) {
        for (let dy = -range; dy <= range; dy++) {
          for (let dx = -range; dx <= range; dx++) {
            const nx = x + dx;
            const ny = y + dy;
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

function scoreMove(bd, x, y, ai, human) {
  bd[y][x] = ai;
  const atk = evalPoint(bd, x, y, ai);
  const winNow = checkWin(bd, x, y, ai) ? 5000000 : 0;
  bd[y][x] = human;
  const def = evalPoint(bd, x, y, human);
  const loseNext = checkWin(bd, x, y, human) ? 4000000 : 0;
  bd[y][x] = 0;
  return atk + winNow + (def + loseNext) * 0.9 + Math.random() * 4;
}

function bestMove(bd, ai, human, difficulty) {
  const cands = candidates(bd, 2);
  if (difficulty === 'easy' && Math.random() < 0.45) {
    return cands[Math.floor(Math.random() * cands.length)];
  }
  const scored = cands.map((p) => ({ x: p.x, y: p.y, s: scoreMove(bd, p.x, p.y, ai, human) }));
  scored.sort((a, b) => b.s - a.s);
  if (difficulty === 'hard') {
    const top = scored.slice(0, 8);
    let best = top[0];
    let bestVal = -Infinity;
    for (const m of top) {
      bd[m.y][m.x] = ai;
      if (checkWin(bd, m.x, m.y, ai)) { bd[m.y][m.x] = 0; return m; }
      const opp = candidates(bd, 2).map((p) => ({ x: p.x, y: p.y, s: scoreMove(bd, p.x, p.y, human, ai) }));
      opp.sort((a, b) => b.s - a.s);
      const oppBest = opp.length ? opp[0].s : 0;
      const val = m.s - oppBest * 0.85;
      bd[m.y][m.x] = 0;
      if (val > bestVal) { bestVal = val; best = m; }
    }
    return best;
  }
  return scored[0];
}

/* ================= Three.js 场景 ================= */
let renderer;
let scene;
let camera;
let controls;
let raycaster;
let pointerNDC;
let boardGroup;
let stoneGroup;
let fxGroup;
let hitPlane;
let previewStone;
let previewMatBlack;
let previewMatWhite;
let lastMoveHalo;
let winBeamGroup = null;
let winBeamLight = null;
let aiMoodLight;
let keyLight;

const stoneMeshes = new Map(); // key "x,y" -> Mesh
const tweens = [];
const ripples = [];
const particleSystems = [];
const clock = new THREE.Clock();

let camAnim = null; // { fromPos, toPos, fromTg, toTg, t, dur, onDone }
let shakeTime = 0;
let shakeDuration = 0;
let shakeStrength = 0;
let autoRotateWanted = false;

const DEFAULT_CAM_POS = new THREE.Vector3(0, 15.5, 13.5);
const DEFAULT_CAM_TG = new THREE.Vector3(0, 0, 0.6);

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
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
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

  raycaster = new THREE.Raycaster();
  pointerNDC = new THREE.Vector2(-10, -10);

  buildLights();
  buildEnvironment();
  buildBoard();
  buildStonesAssets();
  buildHalo();
  buildHitPlane();

  boardGroup = boardGroup || new THREE.Group();
  stoneGroup = new THREE.Group();
  fxGroup = new THREE.Group();
  scene.add(stoneGroup);
  scene.add(fxGroup);

  onResize();
  if (loadingEl) loadingEl.classList.add('hidden');
}

function buildLights() {
  const ambient = new THREE.AmbientLight(0xcfd8e6, 0.55);
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
  // 地面：深色微反光大圆盘，承接阴影
  const groundGeo = new THREE.CircleGeometry(34, 72);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f14, roughness: 0.85, metalness: 0.25
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.85;
  ground.receiveShadow = true;
  scene.add(ground);

  // 氛围光环底座
  const ringGeo = new THREE.RingGeometry(12.4, 12.7, 128);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xc9ae7e, transparent: true, opacity: 0.22, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.82;
  ring.name = 'ambient-ring';
  scene.add(ring);

  // 星空微尘
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

let blackStoneMat;
let whiteStoneMat;
let stoneGeometry;

function buildBoard() {
  boardGroup = new THREE.Group();
  scene.add(boardGroup);

  // 黑曜石底座：带厚度的盒体 + 物理材质清漆
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

  // 实木棋盘面
  const topGeo = new THREE.BoxGeometry(15.4, 0.12, 15.4);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x8a6a3e, roughness: 0.62, metalness: 0.05
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = 0.02;
  top.receiveShadow = true;
  boardGroup.add(top);

  // 棋盘面细纹理：浅色罩
  const faceGeo = new THREE.PlaneGeometry(14.6, 14.6);
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0xd9b87a, roughness: 0.7, metalness: 0.02
  });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.085;
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

  // 金丝网格线：高对比微发光
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x3a2c14, roughness: 0.5, metalness: 0.3,
    emissive: 0xcf9f4a, emissiveIntensity: 0.22
  });
  const lineLen = (SIZE - 1) * SPACING;
  for (let i = 0; i < SIZE; i++) {
    const c = (i - HALF) * SPACING;
    const hGeo = new THREE.BoxGeometry(lineLen, 0.014, 0.028);
    const h = new THREE.Mesh(hGeo, lineMat);
    h.position.set(0, 0.095, c);
    boardGroup.add(h);
    const vGeo = new THREE.BoxGeometry(0.028, 0.014, lineLen);
    const v = new THREE.Mesh(vGeo, lineMat);
    v.position.set(c, 0.095, 0);
    boardGroup.add(v);
  }

  // 星位标记：5 个金色小钉
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
  // 双凸扁球体：高细分球体压扁
  stoneGeometry = new THREE.SphereGeometry(0.44, 48, 32);
  stoneGeometry.scale(1, 0.58, 1);

  blackStoneMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b0c10, roughness: 0.22, metalness: 0.25,
    clearcoat: 1.0, clearcoatRoughness: 0.12
  });
  whiteStoneMat = new THREE.MeshPhysicalMaterial({
    color: 0xf3ede0, roughness: 0.28, metalness: 0.0,
    clearcoat: 0.85, clearcoatRoughness: 0.2
  });

  previewMatBlack = new THREE.MeshStandardMaterial({
    color: 0x22242a, transparent: true, opacity: 0.45,
    roughness: 0.4, metalness: 0.1, depthWrite: false
  });
  previewMatWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.45,
    roughness: 0.4, metalness: 0.0, depthWrite: false
  });
  previewStone = new THREE.Mesh(stoneGeometry, previewMatBlack);
  previewStone.visible = false;
  previewStone.position.y = STONE_Y;
  scene.add(previewStone);
}

function buildHalo() {
  const geo = new THREE.TorusGeometry(0.58, 0.035, 16, 72);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe9c576, transparent: true, opacity: 0.95 });
  lastMoveHalo = new THREE.Mesh(geo, mat);
  lastMoveHalo.rotation.x = Math.PI / 2;
  lastMoveHalo.visible = false;
  scene.add(lastMoveHalo);
}

function buildHitPlane() {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE);
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  hitPlane = new THREE.Mesh(geo, mat);
  hitPlane.rotation.x = -Math.PI / 2;
  hitPlane.position.y = 0.12;
  scene.add(hitPlane);
}

/* ================= 3D 落子 / 涟漪 / 光环 ================= */
function stoneKey(x, y) { return x + ',' + y; }

function createStoneMesh(color) {
  const mesh = new THREE.Mesh(stoneGeometry, color === 1 ? blackStoneMat : whiteStoneMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function dropStoneAnimated(x, y, color, instant = false) {
  const p = gridToWorld(x, y);
  const mesh = createStoneMesh(color);
  mesh.position.set(p.x, instant ? STONE_Y : DROP_HEIGHT, p.z);
  stoneGroup.add(mesh);
  stoneMeshes.set(stoneKey(x, y), mesh);
  if (!instant) {
    addTween({
      dur: 0.62,
      update: (t) => {
        const e = easeOutBounce(t);
        mesh.position.y = DROP_HEIGHT + (STONE_Y - DROP_HEIGHT) * e;
      },
      complete: () => { mesh.position.y = STONE_Y; }
    });
    spawnRipple(p.x, p.z, color === 1 ? 0xc9ae7e : 0xffffff);
  } else {
    mesh.position.y = STONE_Y;
  }
  updateLastMoveHalo();
  return mesh;
}

function removeStoneAnimated(x, y) {
  const k = stoneKey(x, y);
  const mesh = stoneMeshes.get(k);
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
      updateLastMoveHalo();
    }
  });
}

function clearAllStones(instant = true) {
  for (const [, mesh] of stoneMeshes) {
    if (instant) {
      stoneGroup.remove(mesh);
    } else {
      removeStoneAnimatedByMesh(mesh);
    }
  }
  stoneMeshes.clear();
  clearWinBeam();
  if (lastMoveHalo) lastMoveHalo.visible = false;
  clearParticles();
}

function removeStoneAnimatedByMesh(mesh) {
  const startY = mesh.position.y;
  addTween({
    dur: 0.4,
    update: (t) => {
      const e = easeOutCubic(t);
      mesh.position.y = startY + e * 3.0;
      const s = 1 - e * 0.4;
      mesh.scale.set(s, s, s);
    },
    complete: () => { stoneGroup.remove(mesh); }
  });
}

function updateLastMoveHalo() {
  if (!lastMoveHalo) return;
  if (!lastMove || gameOver && winBeamGroup) {
    // 胜负时光环仍保留在最后一手（除非被特效接管位置）
  }
  if (!lastMove) { lastMoveHalo.visible = false; return; }
  const p = gridToWorld(lastMove.x, lastMove.y);
  lastMoveHalo.position.set(p.x, STONE_Y + 0.62, p.z);
  lastMoveHalo.visible = true;
}

function spawnRipple(x, z, colorHex) {
  const geo = new THREE.RingGeometry(0.32, 0.44, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.14, z);
  fxGroup.add(ring);
  ripples.push({ mesh: ring, t: 0, dur: 0.7 });
}

/* ================= 粒子特效系统 ================= */
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
    depthWrite: false, blending: THREE.AdditiveBlending
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
      // 回旋
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

/* ================= 胜负光柱 / 镜头 / 震屏 ================= */
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

  // 五子节点光柱
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

function focusCameraOn(worldPos, dist = 9) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const toPos = new THREE.Vector3().copy(worldPos).addScaledVector(dir, dist);
  toPos.y = Math.max(toPos.y, worldPos.y + 6.5);
  const toTg = new THREE.Vector3(worldPos.x, 0.4, worldPos.z);
  camAnim = {
    fromPos: camera.position.clone(), toPos,
    fromTg: controls.target.clone(), toTg,
    t: 0, dur: 1.6
  };
}

function resetView(instant = false) {
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

function startShake(duration = 0.55, strength = 0.35) {
  shakeTime = duration;
  shakeDuration = duration;
  shakeStrength = strength;
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

/* ================= 对局流程 ================= */
function setStatus(text) {
  if (statusText) statusText.textContent = text;
  else if (statusEl) statusEl.textContent = text;
}

function setThinkingUI(on) {
  if (aiGlowEl) aiGlowEl.classList.toggle('hidden', !on);
  if (statusEl) statusEl.classList.toggle('thinking', on);
  if (aiStateEl) {
    aiStateEl.textContent = on ? '思考中' : '待机';
    aiStateEl.classList.toggle('on', on);
  }
  const label = document.getElementById('thinkingLabel');
  if (label) label.textContent = on ? '演算中…' : '';
}

function updateUI(text) {
  if (text) setStatus(text);
  if (turnInfoEl) turnInfoEl.textContent = currentColor === 1 ? '黑棋' : '白棋';
  if (youAreEl) youAreEl.textContent = playerColor === 1 ? '黑棋' : '白棋';
}

function addHistoryItem() {
  const m = history[history.length - 1];
  const li = document.createElement('li');
  const label = (m.color === 1 ? '黑' : '白') + ' ' + coordLabel(m.x, m.y);
  li.textContent = '第' + history.length + '手 ' + label + (m.color === playerColor ? ' · 你' : ' · AI');
  historyEl.prepend(li);
}

function rebuildHistory() {
  historyEl.innerHTML = '';
  history.forEach((m, i) => {
    const li = document.createElement('li');
    li.textContent = '第' + (i + 1) + '手 ' + (m.color === 1 ? '黑' : '白') + ' ' + coordLabel(m.x, m.y) + (m.color === playerColor ? ' · 你' : ' · AI');
    historyEl.prepend(li);
  });
}

function placeStone(x, y, color, instant = false) {
  board[y][x] = color;
  history.push({ x, y, color });
  lastMove = { x, y };
  currentColor = color === 1 ? 2 : 1;
  moveCountEl.textContent = '手数 ' + history.length;
  addHistoryItem();
  dropStoneAnimated(x, y, color, instant);
  AudioEngine.playStone(color);
  const win = checkWin(board, x, y, color);
  if (win) { endGame(color, win); return win; }
  if (history.length >= SIZE * SIZE) { endGame(0, null); return []; }
  return null;
}

function endGame(winner, winCells) {
  gameOver = true;
  previewStone.visible = false;
  if (winCard) winCard.classList.remove('loss', 'draw');

  if (winner === 0) {
    if (winIcon) winIcon.innerHTML = ICON_DRAW;
    if (winTitle) winTitle.textContent = '和棋';
    if (winDesc) winDesc.textContent = '棋盘已满，势均力敌。';
    setStatus('和棋');
    if (turnInfoEl) turnInfoEl.textContent = '和棋';
    spawnDrawParticles();
    AudioEngine.playDraw();
    flashScreen('taiji');
  } else if (winner === playerColor) {
    if (winIcon) winIcon.innerHTML = ICON_WIN;
    if (winTitle) winTitle.textContent = '你赢了';
    if (winDesc) winDesc.textContent = '恭喜，在第 ' + history.length + ' 手连成五子。';
    setStatus('你获胜');
    if (turnInfoEl) turnInfoEl.textContent = winner === 1 ? '黑棋胜' : '白棋胜';
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
    if (turnInfoEl) turnInfoEl.textContent = winner === 1 ? '黑棋胜' : '白棋胜';
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
  setTimeout(() => { if (winOverlay) winOverlay.classList.remove('hidden'); }, winner === 0 ? 900 : 1400);
}

function resetGame() {
  initState();
  clearAllStones(true);
  if (previewStone) previewStone.visible = false;
  if (winOverlay) winOverlay.classList.add('hidden');
  if (historyEl) historyEl.innerHTML = '';
  if (moveCountEl) moveCountEl.textContent = '手数 0';
  if (aiBar) aiBar.style.width = '0';
  setThinkingUI(false);
  resetView(true);
  updateUI('轮到' + (currentColor === playerColor ? '你' : 'AI') + '落子');
  if (playerColor !== 1) {
    updateUI('AI 执黑先行…');
    aiMove();
  } else {
    updateUI('轮到你落子（黑棋）');
  }
}

/* ================= AI 行棋 ================= */
function aiMove(hintOnly = false) {
  if (gameOver) return Promise.resolve(null);
  if (aiThinking && !hintOnly) return Promise.resolve(null);
  aiThinking = true;
  if (!hintOnly) {
    setThinkingUI(true);
    if (aiBar) aiBar.style.width = '35%';
  } else if (aiStateEl) {
    aiStateEl.textContent = '支招中';
  }
  return new Promise((resolve) => {
    const delay = level === 'hard' ? 450 : level === 'medium' ? 300 : 200;
    setTimeout(() => {
      const mover = hintOnly ? playerColor : aiColor;
      const other = mover === 1 ? 2 : 1;
      const mv = bestMove(board, mover, other, hintOnly ? 'hard' : level);
      if (aiBar) aiBar.style.width = '100%';
      setTimeout(() => { if (aiBar) aiBar.style.width = '0'; }, 400);
      aiThinking = false;
      if (!hintOnly) {
        setThinkingUI(false);
        if (mv) {
          placeStone(mv.x, mv.y, aiColor);
          if (!gameOver) updateUI('轮到你落子（' + (playerColor === 1 ? '黑棋' : '白棋') + '）');
        }
      } else if (aiStateEl) {
        aiStateEl.textContent = '待机';
      }
      resolve(mv);
    }, delay);
  });
}

/* ================= 3D 交互（Raycaster 拾取） ================= */
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
  return !gameOver && !aiThinking && currentColor === playerColor;
}

function bindInteraction() {
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!canHumanPlay()) { previewStone.visible = false; return; }
    const c = cellFromPointer(e.clientX, e.clientY);
    const prevKey = hoverCell ? hoverCell.x + ',' + hoverCell.y : null;
    const nextKey = c ? c.x + ',' + c.y : null;
    hoverCell = c;
    if (c && board[c.y][c.x] === 0) {
      const p = gridToWorld(c.x, c.y);
      previewStone.visible = true;
      previewStone.position.set(p.x, STONE_Y + 0.12 + Math.sin(performance.now() * 0.005) * 0.05, p.z);
      previewStone.material = playerColor === 1 ? previewMatBlack : previewMatWhite;
      renderer.domElement.style.cursor = 'pointer';
      // 进入新交叉点时播放微弱轻音
      if (nextKey !== prevKey) AudioEngine.playHover();
    } else {
      previewStone.visible = false;
      renderer.domElement.style.cursor = 'default';
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    hoverCell = null;
    previewStone.visible = false;
  });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    AudioEngine.ensure();
    if (e.button === 2) return;
    if (!canHumanPlay()) return;
    const c = cellFromPointer(e.clientX, e.clientY);
    if (!c || board[c.y][c.x] !== 0) return;
    previewStone.visible = false;
    placeStone(c.x, c.y, playerColor);
    if (!gameOver) {
      updateUI('AI 思考中…');
      aiMove();
    }
  });
  renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); });
}

/* ================= UI 事件 ================= */
function syncSeg() {
  document.querySelectorAll('#colorSeg button').forEach((b) => {
    b.classList.toggle('active', (b.dataset.color === 'black') === (playerColor === 1));
  });
  document.querySelectorAll('#levelSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.level === level);
  });
}

function bindUI() {
  document.getElementById('restartBtn').onclick = () => resetGame();
  document.getElementById('againBtn').onclick = () => resetGame();

  document.getElementById('undoBtn').onclick = () => {
    if (aiThinking || history.length === 0) return;
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
      winOverlay.classList.add('hidden');
      clearWinBeam();
      clearParticles();
    } else {
      const m1 = history.pop();
      if (m1) { board[m1.y][m1.x] = 0; removeStoneAnimated(m1.x, m1.y); }
      while (history.length && currentColorAfter(history.length) !== playerColor) {
        const m = history.pop();
        board[m.y][m.x] = 0;
        removeStoneAnimated(m.x, m.y);
      }
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
  };

  document.getElementById('hintBtn').onclick = async () => {
    if (gameOver || aiThinking || currentColor !== playerColor) return;
    const mv = await aiMove(true);
    if (mv) {
      hoverCell = mv;
      const p = gridToWorld(mv.x, mv.y);
      previewStone.visible = true;
      previewStone.material = playerColor === 1 ? previewMatBlack : previewMatWhite;
      previewStone.position.set(p.x, STONE_Y + 0.2, p.z);
      updateUI('建议落子：' + coordLabel(mv.x, mv.y) + '（点击棋盘落子）');
      setTimeout(() => { previewStone.visible = false; }, 2200);
    }
  };

  document.getElementById('swapBtn').onclick = () => {
    playerColor = playerColor === 1 ? 2 : 1;
    aiColor = aiColor === 1 ? 2 : 1;
    syncSeg();
    resetGame();
  };

  document.getElementById('colorSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.dataset.color) {
      playerColor = btn.dataset.color === 'black' ? 1 : 2;
      aiColor = playerColor === 1 ? 2 : 1;
      syncSeg();
      resetGame();
    }
  });
  document.getElementById('levelSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.dataset.level) { level = btn.dataset.level; syncSeg(); }
  });

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
  });
}

function currentColorAfter(nMoves) {
  return nMoves % 2 === 0 ? 1 : 2;
}

/* ================= 自适应 ================= */
function onResize() {
  if (!renderer || !container) return;
  const w = container.clientWidth || 640;
  const h = container.clientHeight || 640;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

/* ================= 主循环 ================= */
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

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateTweens(dt);
  updateRipples(dt);
  updateParticles(dt);

  // 相机缓动（胜利特写 / 重置视角）
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
    lastMoveHalo.material.opacity = pulse;
    const sc = 1 + Math.sin(t * 3.2) * 0.04;
    lastMoveHalo.scale.set(sc, sc, 1);
  }

  // 胜负光柱脉冲
  if (winBeamGroup) {
    const pulse = 0.7 + Math.sin(t * 5) * 0.3;
    winBeamGroup.children.forEach((child, idx) => {
      if (child.material) child.material.opacity = (idx === 0 ? 0.95 : 0.35) * pulse + 0.15;
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
  renderer.render(scene, camera);
}

/* ================= 启动 ================= */
initState();
try {
  initThree();
  bindInteraction();
  bindUI();
  syncSeg();
  resetGame();
  animate();
} catch (err) {
  if (loadingEl) loadingEl.innerHTML = '<p>WebGL 初始化失败：' + String(err && err.message ? err.message : err) + '</p>';
  throw err;
}
