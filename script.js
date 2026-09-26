/* 五子棋人机对战 — 启发式评分 + 2步预判 AI */
const SIZE = 15;
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const statusEl = document.getElementById('status');
const moveCountEl = document.getElementById('moveCount');
const turnInfoEl = document.getElementById('turnInfo');
const youAreEl = document.getElementById('youAre');
const aiStateEl = document.getElementById('aiState');
const aiBar = document.getElementById('aiBar');
const historyEl = document.getElementById('history');
const winOverlay = document.getElementById('winOverlay');
const winTitle = document.getElementById('winTitle');
const winDesc = document.getElementById('winDesc');
const winEmoji = document.getElementById('winEmoji');

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

  // 木纹底
  const g = ctx.createLinearGradient(0, 0, w, w);
  g.addColorStop(0, '#f3d08c'); g.addColorStop(0.5, '#e8b26a'); g.addColorStop(1, '#d99a4e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);

  // 网格
  ctx.strokeStyle = 'rgba(90,50,15,.85)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < SIZE; i++) {
    const p = cs / 2 + i * cs;
    ctx.beginPath(); ctx.moveTo(cs / 2, p); ctx.lineTo(w - cs / 2, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, cs / 2); ctx.lineTo(p, w - cs / 2); ctx.stroke();
  }

  // 星位
  const stars = [3, 7, 11];
  ctx.fillStyle = '#5a3210';
  for (const x of stars) for (const y of stars) {
    ctx.beginPath();
    ctx.arc(cs / 2 + x * cs, cs / 2 + y * cs, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 悬停预览
  if (hoverPos && !gameOver && currentColor === playerColor && board[hoverPos.y][hoverPos.x] === 0) {
    ctx.beginPath();
    ctx.arc(cs / 2 + hoverPos.x * cs, cs / 2 + hoverPos.y * cs, cs * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = playerColor === 1 ? 'rgba(20,20,20,.35)' : 'rgba(255,255,255,.55)';
    ctx.fill();
  }

  // 棋子
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (board[y][x] !== 0) drawStone(x, y, board[y][x]);
  }

  // 最后一手标记
  if (lastMove) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    const cx = cs / 2 + lastMove.x * cs, cy = cs / 2 + lastMove.y * cs;
    ctx.strokeRect(cx - 8, cy - 8, 16, 16);
  }
}

function drawStone(x, y, color) {
  const cs = cell(), cx = cs / 2 + x * cs, cy = cs / 2 + y * cs, r = cs * 0.44;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  if (color === 1) { grad.addColorStop(0, '#5b5b5b'); grad.addColorStop(0.4, '#232323'); grad.addColorStop(1, '#000'); }
  else { grad.addColorStop(0, '#fff'); grad.addColorStop(0.6, '#e8e8e8'); grad.addColorStop(1, '#b9b9b9'); }
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (color === 2) { ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
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

function addHistoryItem() {
  const m = history[history.length - 1];
  const li = document.createElement('li');
  const label = (m.color === 1 ? '●黑' : '○白') + ` (${String.fromCharCode(65 + m.x)}${m.y + 1})`;
  li.textContent = `第${history.length}手 ${label}` + (m.color === playerColor ? ' · 你' : ' · AI');
  historyEl.prepend(li);
}

function endGame(winner, winCells) {
  gameOver = true;
  winOverlay.classList.remove('hidden');
  if (winner === 0) {
    winEmoji.textContent = '🤝'; winTitle.textContent = '和棋！';
    winDesc.textContent = '棋盘已满，势均力敌。';
    statusEl.textContent = '和棋';
  } else if (winner === playerColor) {
    winEmoji.textContent = '🎉'; winTitle.textContent = '你赢了！';
    winDesc.textContent = `恭喜！你在第 ${history.length} 手连成五子。`;
    statusEl.textContent = '🎉 你获胜！';
  } else {
    winEmoji.textContent = '🤖'; winTitle.textContent = 'AI 获胜';
    winDesc.textContent = `AI 在第 ${history.length} 手获胜，再接再厉！`;
    statusEl.textContent = 'AI 获胜，再来一局吧';
  }
  turnInfoEl.textContent = winner === 0 ? '和棋' : (winner === 1 ? '黑棋胜' : '白棋胜');
}

function updateUI(text) {
  if (text) statusEl.textContent = text;
  turnInfoEl.textContent = currentColor === 1 ? '黑棋' : '白棋';
  youAreEl.textContent = playerColor === 1 ? '黑棋 ●' : '白棋 ○';
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
  aiStateEl.textContent = '思考中…';
  aiBar.style.width = '35%';
  document.getElementById('thinkingLabel').textContent = '…';

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
  if (!gameOver) { updateUI('AI 思考中…'); aiMove(); }
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
    li.textContent = `第${i + 1}手 ${(m.color === 1 ? '●黑' : '○白')} (${String.fromCharCode(65 + m.x)}${m.y + 1})` + (m.color === playerColor ? ' · 你' : ' · AI');
    historyEl.prepend(li);
  });
  moveCountEl.textContent = '手数 ' + history.length;
  updateUI('已悔棋，轮到你落子');
  draw();
};

document.getElementById('hintBtn').onclick = async () => {
  if (gameOver || aiThinking || currentColor !== playerColor) return;
  aiStateEl.textContent = '支招中…';
  const mv = await aiMove(true);
  if (mv) {
    hoverPos = mv;
    updateUI(`💡 建议落子：${String.fromCharCode(65 + mv.x)}${mv.y + 1}（点击棋盘落子）`);
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
  if (e.target.dataset.color) {
    playerColor = e.target.dataset.color === 'black' ? 1 : 2;
    aiColor = playerColor === 1 ? 2 : 1;
    syncSeg(); resetGame();
  }
});
document.getElementById('levelSeg').addEventListener('click', e => {
  if (e.target.dataset.level) { level = e.target.dataset.level; syncSeg(); }
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
