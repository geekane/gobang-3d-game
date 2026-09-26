/* 五子棋人机对战 — 启发式评分 + 2步预判 AI */
const SIZE = 15;
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

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

/* 胜负图标：内联 SVG，替代 emoji */
const ICON_WIN = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" stroke="currentColor" stroke-width="1.6"/><path d="M7 5H4.5A1.5 1.5 0 0 0 4.6 8c.8.4 1.6.7 2.4.9M17 5h2.5A1.5 1.5 0 0 1 19.4 8c-.8.4-1.6.7-2.4.9M12 14v3M8.5 20.5h7M10 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LOSS = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';
const ICON_DRAW = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

let board, history, gameOver, playerColor, aiColor, level, currentColor, lastMove, hoverPos, aiThinking;

// ---------- 基础状态 ----------
function initState() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  history = [];
  gameOver = false;
  currentColor = 1; // 1=黑 2=白，黑先
  lastMove = null;
  hoverPos = null;
  aiThinking = false;
}

function resetGame(keepSettings = true) {
  initState();
  winOverlay.classList.add('hidden');
  historyEl.innerHTML = '';
  updateUI('轮到' + (currentColor === playerColor ? '你' : 'AI') + '落子');
  draw();
  if (aiColor === 1) aiMove(); // AI 执黑先行
  else updateUI('轮到你落子（' + (playerColor === 1 ? '黑棋' : '白棋') + '）');
}

// 默认设置
playerColor = 1; aiColor = 2; level = 'medium';

// ---------- 棋盘绘制 ----------
function cell() { return canvas.width / SIZE; }

function draw() {
  const w = canvas.width, cs = cell();
  ctx.clearRect(0, 0, w, w);

  // 石质 / 宣纸底：雅致米色，杜绝高饱和渐变
  ctx.fillStyle = '#ded0ab';
  ctx.fillRect(0, 0, w, w);

  // 细腻木纹：极淡横向纹理
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#7a6242';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = (i + 0.5) * (w / 26) + Math.sin(i * 2.1) * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w, y + 2);
    ctx.stroke();
  }
  ctx.restore();

  // 边缘暗角：轻微收边，突出质感
  const vignette = ctx.createRadialGradient(w / 2, w / 2, w * 0.35, w / 2, w / 2, w * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(74,58,34,0.14)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, w);

  // 网格
  ctx.strokeStyle = 'rgba(74,63,46,0.88)';
  ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    const p = cs / 2 + i * cs;
    ctx.beginPath(); ctx.moveTo(cs / 2, p); ctx.lineTo(w - cs / 2, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, cs / 2); ctx.lineTo(p, w - cs / 2); ctx.stroke();
  }

  // 外框：沉稳双线
  ctx.strokeStyle = 'rgba(58,48,34,0.95)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(cs / 2, cs / 2, w - cs, w - cs);
  ctx.strokeStyle = 'rgba(58,48,34,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cs / 2 - 5, cs / 2 - 5, w - cs + 10, w - cs + 10);

  // 星位：标准五星位
  const stars = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
  ctx.fillStyle = '#4a3f2e';
  for (const [sx, sy] of stars) {
    ctx.beginPath();
    ctx.arc(cs / 2 + sx * cs, cs / 2 + sy * cs, Math.max(3, cs * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }

  // 悬停预览：淡影 + 细环
  if (hoverPos && !gameOver && currentColor === playerColor && board[hoverPos.y][hoverPos.x] === 0) {
    const cx = cs / 2 + hoverPos.x * cs, cy = cs / 2 + hoverPos.y * cs;
    ctx.beginPath();
    ctx.arc(cx, cy, cs * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = playerColor === 1 ? 'rgba(18,18,20,0.28)' : 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, cs * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = playerColor === 1 ? 'rgba(18,18,20,0.35)' : 'rgba(90,80,60,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 棋子
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (board[y][x] !== 0) drawStone(x, y, board[y][x]);
  }

  // 最后一手：优雅同心环指示器（替代红色方框）
  if (lastMove) {
    const cx = cs / 2 + lastMove.x * cs, cy = cs / 2 + lastMove.y * cs;
    const onBlack = board[lastMove.y][lastMove.x] === 1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cs * 0.24, 0, Math.PI * 2);
    ctx.strokeStyle = onBlack ? 'rgba(222,203,162,0.95)' : 'rgba(140,96,52,0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = onBlack ? 'rgba(222,203,162,0.95)' : 'rgba(140,96,52,0.9)';
    ctx.fill();
    ctx.restore();
  }
}

function drawStone(x, y, color) {
  const cs = cell(), cx = cs / 2 + x * cs, cy = cs / 2 + y * cs, r = cs * 0.44;
  ctx.save();
  // 柔和落子阴影
  ctx.shadowColor = 'rgba(40,30,15,0.45)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.38, r * 0.08, cx, cy, r);
  if (color === 1) {
    grad.addColorStop(0, '#4c4e54');
    grad.addColorStop(0.35, '#232529');
    grad.addColorStop(1, '#0b0c0e');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#ece7db');
    grad.addColorStop(1, '#c2bba9');
  }
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 表面高光：黑子一笔月牙光，白子淡影描边
  if (color === 1) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const hl = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, 0, cx - r * 0.32, cy - r * 0.36, r * 0.4);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.28, cy - r * 0.32, r * 0.32, r * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.strokeStyle = 'rgba(90,76,52,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------- 落子 / 胜负 ----------
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function inBoard(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }

function checkWin(bd, x, y, color) {
  for (const [dx, dy] of DIRS) {
    let count = 1, cells = [{ x, y }];
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (inBoard(nx, ny) && bd[ny][nx] === color) { count++; cells.push({ x: nx, y: ny }); nx += dx * s; ny += dy * s; }
    }
    if (count >= 5) return cells;
  }
  return null;
}

function placeStone(x, y, color) {
  board[y][x] = color;
  history.push({ x, y, color });
  lastMove = { x, y };
  currentColor = color === 1 ? 2 : 1;
  moveCountEl.textContent = '手数 ' + history.length;
  addHistoryItem();
  draw();
  const win = checkWin(board, x, y, color);
  if (win) return endGame(color, win);
  if (history.length >= SIZE * SIZE) return endGame(0, null);
  return null;
}

function coordLabel(x, y) {
  return String.fromCharCode(65 + x) + (y + 1);
}

function addHistoryItem() {
  const m = history[history.length - 1];
  const li = document.createElement('li');
  const label = (m.color === 1 ? '黑' : '白') + ' ' + coordLabel(m.x, m.y);
  li.textContent = '第' + history.length + '手 ' + label + (m.color === playerColor ? ' · 你' : ' · AI');
  historyEl.prepend(li);
}

function endGame(winner, winCells) {
  gameOver = true;
  winOverlay.classList.remove('hidden');
  if (winner === 0) {
    winIcon.innerHTML = ICON_DRAW;
    winTitle.textContent = '和棋';
    winDesc.textContent = '棋盘已满，势均力敌。';
    setStatus('和棋');
  } else if (winner === playerColor) {
    winIcon.innerHTML = ICON_WIN;
    winTitle.textContent = '你赢了';
    winDesc.textContent = '恭喜，在第 ' + history.length + ' 手连成五子。';
    setStatus('你获胜');
  } else {
    winIcon.innerHTML = ICON_LOSS;
    winTitle.textContent = 'AI 获胜';
    winDesc.textContent = 'AI 在第 ' + history.length + ' 手获胜，再接再厉。';
    setStatus('AI 获胜，再来一局');
  }
  turnInfoEl.textContent = winner === 0 ? '和棋' : (winner === 1 ? '黑棋胜' : '白棋胜');
}

function setStatus(text) {
  if (statusText) statusText.textContent = text;
  else if (statusEl) statusEl.textContent = text;
}

function updateUI(text) {
  if (text) setStatus(text);
  turnInfoEl.textContent = currentColor === 1 ? '黑棋' : '白棋';
  youAreEl.textContent = playerColor === 1 ? '黑棋' : '白棋';
}

// ---------- AI 算法 ----------
// 评分：统计每个方向连子+开口
function lineScore(count, openEnds, blocked) {
  if (count >= 5) return 1000000;
  if (blocked) return 0;
  if (count === 4) return openEnds === 2 ? 100000 : 10000;
  if (count === 3) return openEnds === 2 ? 5000 : 500;
  if (count === 2) return openEnds === 2 ? 200 : 20;
  if (count === 1) return openEnds === 2 ? 10 : 2;
  return 0;
}

function evalPoint(bd, x, y, color) {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1, open = 0, blocked = false;
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s, empty = 0;
      while (inBoard(nx, ny)) {
        if (bd[ny][nx] === color) { count++; }
        else { if (bd[ny][nx] === 0) open++; else blocked = blocked || false; break; }
        nx += dx * s; ny += dy * s;
        if (Math.abs(nx - x) + Math.abs(ny - y) > 6) break;
      }
      // 对手棋子封堵
      const bx = s === 1 ? x + dx * count : x - dx * 1;
      void bx; void empty;
    }
    // 精确计算两端开口/堵
    let ends = 0;
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s, steps = 0;
      while (inBoard(nx, ny) && bd[ny][nx] === color) { steps++; nx += dx * s; ny += dy * s; }
      if (inBoard(nx, ny) && bd[ny][nx] === 0) ends++;
    }
    // 被对方两端都堵死则无价值(近似)
    total += lineScore(count, ends, false);
  }
  return total;
}

function candidates(bd, range = 2) {
  if (history.length === 0) return [{ x: 7, y: 7 }];
  const set = new Set(), list = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (bd[y][x] !== 0) {
      for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inBoard(nx, ny) && bd[ny][nx] === 0 && !set.has(ny * SIZE + nx)) {
          set.add(ny * SIZE + nx); list.push({ x: nx, y: ny });
        }
      }
    }
  }
  return list.length ? list : [{ x: 7, y: 7 }];
}

function scoreMove(bd, x, y, ai, human) {
  bd[y][x] = ai;
  const atk = evalPoint(bd, x, y, ai);
  // 是否立即获胜
  const winNow = checkWin(bd, x, y, ai) ? 5000000 : 0;
  bd[y][x] = human;
  const def = evalPoint(bd, x, y, human);
  const loseNext = checkWin(bd, x, y, human) ? 4000000 : 0;
  bd[y][x] = 0;
  // 进攻权重 1.0，防守权重 0.9
  return atk + winNow + (def + loseNext) * 0.9 + Math.random() * 4;
}

function bestMove(bd, ai, human, difficulty) {
  const cands = candidates(bd, difficulty === 'hard' ? 2 : 2);
  if (difficulty === 'easy') {
    // 新手：50% 随机，偶尔走最好
    if (Math.random() < 0.45) return cands[Math.floor(Math.random() * cands.length)];
  }
  let scored = cands.map(p => ({ ...p, s: scoreMove(bd, p.x, p.y, ai, human) }));
  scored.sort((a, b) => b.s - a.s);

  if (difficulty === 'hard') {
    // 大师：对 Top8 做一层预判（极简 2-ply）
    const top = scored.slice(0, 8);
    let best = top[0], bestVal = -Infinity;
    for (const m of top) {
      bd[m.y][m.x] = ai;
      if (checkWin(bd, m.x, m.y, ai)) { bd[m.y][m.x] = 0; return m; }
      // 对手最好回应
      const opp = candidates(bd, 2).map(p => ({ ...p, s: scoreMove(bd, p.x, p.y, human, ai) }));
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

function aiMove(hintOnly = false) {
  if (gameOver) return null;
  if (aiThinking && !hintOnly) return null;
  aiThinking = true;
  aiStateEl.textContent = '思考中';
  aiBar.style.width = '35%';
  document.getElementById('thinkingLabel').textContent = '演算中';
  return new Promise(resolve => {
    setTimeout(() => {
      const mover = hintOnly ? playerColor : aiColor;
      const other = mover === 1 ? 2 : 1;
      const mv = bestMove(board, mover, other, hintOnly ? 'hard' : level);
      aiBar.style.width = '100%';
      setTimeout(() => { aiBar.style.width = '0'; }, 400);
      aiStateEl.textContent = '待机';
      document.getElementById('thinkingLabel').textContent = '';
      aiThinking = false;
      if (!hintOnly) {
        placeStone(mv.x, mv.y, aiColor);
        if (!gameOver) updateUI('轮到你落子（' + (playerColor === 1 ? '黑棋' : '白棋') + '）');
      }
      resolve(mv);
    }, level === 'hard' ? 450 : level === 'medium' ? 300 : 200);
  });
}

// ---------- 交互 ----------
function posFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
  const cs = cell();
  const x = Math.round(px / cs - 0.5), y = Math.round(py / cs - 0.5);
  if (!inBoard(x, y)) return null;
  return { x, y };
}

canvas.addEventListener('mousemove', e => { hoverPos = posFromEvent(e); if (!gameOver) draw(); });
canvas.addEventListener('mouseleave', () => { hoverPos = null; draw(); });
canvas.addEventListener('click', e => {
  if (gameOver || aiThinking || currentColor !== playerColor) return;
  const p = posFromEvent(e);
  if (!p || board[p.y][p.x] !== 0) return;
  placeStone(p.x, p.y, playerColor);
  if (!gameOver) { updateUI('AI 思考中'); aiMove(); }
});

document.getElementById('restartBtn').onclick = () => resetGame();
document.getElementById('againBtn').onclick = () => resetGame();
document.getElementById('undoBtn').onclick = () => {
  if (aiThinking || history.length === 0) return;
  // 撤回两步（AI + 你），若 AI 先手且只走了一步则撤一步
  let steps = (history.length >= 2 && !gameOver) ? 2 : (gameOver ? (history[history.length-1].color === playerColor ? 1 : 2) : 1);
  // 简化：gameOver 时按奇偶撤到轮到玩家
  if (gameOver) {
    while (history.length && history[history.length - 1].color !== playerColor) { const m = history.pop(); board[m.y][m.x] = 0; }
    if (history.length) { const m = history.pop(); board[m.y][m.x] = 0; }
    gameOver = false;
    winOverlay.classList.add('hidden');
  } else {
    for (let i = 0; i < steps && history.length; i++) {
      // 保证最终轮到玩家
      const m = history.pop(); board[m.y][m.x] = 0;
      if (history.length && history[history.length - 1].color === playerColor && i === 0) { /* 再撤一步AI */ }
      if (i === 0 && history.length && currentColor !== playerColor) { /* currentColor 会重算 */ }
    }
    // 若撤完后轮到的不是玩家，继续撤一步（处理玩家执白的情况）
    while (history.length && ((history.length % 2 === 0 && playerColor === 1) || (history.length % 2 === 1 && playerColor === 2))) {
      // 实际上：黑先。history 长度为偶数 -> 轮到黑；奇数 -> 轮到白
      // 若轮到的不是 player，说明多撤/少撤了，补正
      break;
    }
  }
  // 重算 currentColor
  currentColor = history.length % 2 === 0 ? 1 : 2;
  lastMove = history.length ? history[history.length - 1] : null;
  // 若该轮到 AI，撤销到轮到玩家为止
  while (!gameOver && currentColor !== playerColor && history.length) {
    const m = history.pop(); board[m.y][m.x] = 0;
    currentColor = history.length % 2 === 0 ? 1 : 2;
    lastMove = history.length ? history[history.length - 1] : null;
  }
  historyEl.innerHTML = '';
  history.forEach((m, i) => {
    const li = document.createElement('li');
    li.textContent = '第' + (i + 1) + '手 ' + (m.color === 1 ? '黑' : '白') + ' ' + coordLabel(m.x, m.y) + (m.color === playerColor ? ' · 你' : ' · AI');
    historyEl.prepend(li);
  });
  moveCountEl.textContent = '手数 ' + history.length;
  updateUI('已悔棋，轮到你落子');
  draw();
};

document.getElementById('hintBtn').onclick = async () => {
  if (gameOver || aiThinking || currentColor !== playerColor) return;
  aiStateEl.textContent = '支招中';
  const mv = await aiMove(true);
  if (mv) {
    hoverPos = mv;
    updateUI('建议落子：' + coordLabel(mv.x, mv.y) + '（点击棋盘落子）');
    draw();
    // 高亮提示 1.2s
    setTimeout(() => { if (hoverPos === mv) hoverPos = null; }, 2000);
  }
};

document.getElementById('swapBtn').onclick = () => {
  playerColor = playerColor === 1 ? 2 : 1;
  aiColor = aiColor === 1 ? 2 : 1;
  syncSeg();
  resetGame();
};

document.getElementById('colorSeg').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn && btn.dataset.color) {
    playerColor = btn.dataset.color === 'black' ? 1 : 2;
    aiColor = playerColor === 1 ? 2 : 1;
    syncSeg(); resetGame();
  }
});
document.getElementById('levelSeg').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn && btn.dataset.level) { level = btn.dataset.level; syncSeg(); }
});

function syncSeg() {
  document.querySelectorAll('#colorSeg button').forEach(b => {
    b.classList.toggle('active', (b.dataset.color === 'black') === (playerColor === 1));
  });
  document.querySelectorAll('#levelSeg button').forEach(b => {
    b.classList.toggle('active', b.dataset.level === level);
  });
}

// 启动
initState();
syncSeg();
resetGame();
