/* 五子棋 AI 引擎 · Web Worker（Zobrist + 置换表 + Negamax Alpha-Beta + 迭代加深 + VCF/VCT 算杀）
 * 运行环境：DedicatedWorker（classic），无任何外部依赖。
 * 协议：
 *   主线程 -> Worker: { type:'search', reqId, flat:Array(225), aiColor, level, timeLimitMs, renju:bool, moveCount }
 *                    { type:'stop' }
 *   Worker -> 主线程: { type:'info', reqId, depth, score, best:{x,y}, nodes, nps, pv }
 *                     { type:'result', reqId, x,y, score, depth, nodes, nps, pv, timeMs, vcf, method }
 * 设计要点：
 *   - 棋盘为 Int8Array(225)，idx = y*15+x，0 空 / 1 黑 / 2 白
 *   - Zobrist 采用双 32 位异或模拟 64 位哈希，增量维护
 *   - 置换表 Map<key, {depth, flag, value, best}>，上限裁剪
 *   - 着法排序：TT 最佳 > VCF 杀招 > 历史启发 + 杀手启发 > 启发式评分
 *   - 迭代加深 + 时间控制 + 节点计数 NPS
 *   - VCF（连续冲四必胜）深度优先算杀 + VCT（连续活三追杀）浅层扩展
 *   - 禁手（renju=true 且 aiColor 为黑）时过滤禁手着法
 */
'use strict';

var SIZE = 15;
var N = SIZE * SIZE;
var EMPTY = 0, BLACK = 1, WHITE = 2;
var WIN_SCORE = 10000000;
var INF = 30000000;

var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

/* ---------------- 伪随机数（确定性种子，保证 Zobrist 跨会话一致） ---------------- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

var ZOB_LO = new Uint32Array(N * 2);
var ZOB_HI = new Uint32Array(N * 2);
(function initZobrist() {
  var rnd = mulberry32(0x9E3779B9);
  for (var i = 0; i < N * 2; i++) {
    ZOB_LO[i] = rnd();
    ZOB_HI[i] = rnd();
  }
})();

function zobKey(lo, hi) { return (hi >>> 0).toString(36) + ':' + (lo >>> 0).toString(36); }

/* ---------------- 基础读写 ---------------- */
function idx(x, y) { return y * SIZE + x; }
function inBoard(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }
function opp(c) { return c === BLACK ? WHITE : BLACK; }

/* ---------------- 胜负判定 ---------------- */
function checkWinFlat(bd, x, y, color) {
  for (var d = 0; d < 4; d++) {
    var dx = DIRS[d][0], dy = DIRS[d][1];
    var count = 1;
    var cells = [{ x: x, y: y }];
    for (var s = 0; s < 2; s++) {
      var sgn = s === 0 ? 1 : -1;
      var nx = x + dx * sgn, ny = y + dy * sgn;
      while (inBoard(nx, ny) && bd[idx(nx, ny)] === color) {
        count++;
        cells.push({ x: nx, y: ny });
        nx += dx * sgn; ny += dy * sgn;
      }
    }
    if (count >= 5) return cells;
  }
  return null;
}

/* ---------------- 禁手判定（Renju：黑棋三三 / 四四 / 长连） ---------------- */
function countDir(bd, x, y, dx, dy, color) {
  var c = 0;
  var nx = x + dx, ny = y + dy;
  while (inBoard(nx, ny) && bd[idx(nx, ny)] === color) { c++; nx += dx; ny += dy; }
  return c;
}

// 该点落子后是否形成五连（含长连）
function lineLen(bd, x, y, dx, dy, color) {
  return 1 + countDir(bd, x, y, dx, dy, color) + countDir(bd, x, y, -dx, -dy, color);
}

// 活三判定：落子后在该方向形成“两端可成活四”的三（用于三三计数）
function isOpenThreeAt(bd, x, y, dx, dy, color) {
  // 扫描该方向 9 格窗口，判断是否存在可落一子成活四的活三形态
  // 简化但严谨的实现：在 [x-4..x+4] 线段上枚举所有连续 5 格窗口，
  // 若存在窗口内 color 恰为 3 且空位恰为 2，且两个空位落子后都能形成“非禁手的四”，则视为一个活三方向。
  var cells = [];
  for (var k = -5; k <= 5; k++) {
    var nx = x + dx * k, ny = y + dy * k;
    if (!inBoard(nx, ny)) { cells.push(-1); continue; }
    if (nx === x && ny === y) { cells.push(color); continue; }
    cells.push(bd[idx(nx, ny)]);
  }
  var center = 5;
  // 以包含落子点的每个 5 连窗口检查
  for (var s = center - 4; s <= center; s++) {
    if (s < 0 || s + 4 >= cells.length) continue;
    var cntC = 0, cntE = 0, cntO = 0;
    var empties = [];
    for (var j = 0; j < 5; j++) {
      var v = cells[s + j];
      if (v === color) cntC++;
      else if (v === EMPTY) { cntE++; empties.push(s + j); }
      else cntO++;
    }
    if (cntC === 3 && cntE === 2 && cntO === 0) {
      // 两个空位必须都在“落子可达且不成对方子”的前提下能形成四
      var ok = true;
      for (var e = 0; e < empties.length; e++) {
        var pos = empties[e];
        var px = x + dx * (pos - center), py = y + dy * (pos - center);
        // 临时落子判断是否形成四（含眠四即可）
        bd[idx(px, py)] = color;
        var four = formsFour(bd, px, py, color);
        bd[idx(px, py)] = EMPTY;
        if (!four) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

function formsFour(bd, x, y, color) {
  for (var d = 0; d < 4; d++) {
    var dx = DIRS[d][0], dy = DIRS[d][1];
    var len = lineLen(bd, x, y, dx, dy, color);
    if (len >= 5) return true;
    // 眠四/活四：5 格窗口内有 4 子
    var cells = [];
    for (var k = -4; k <= 4; k++) {
      var nx = x + dx * k, ny = y + dy * k;
      if (!inBoard(nx, ny)) { cells.push(-1); continue; }
      cells.push(bd[idx(nx, ny)]);
    }
    for (var s = 0; s + 4 < cells.length; s++) {
      var cc = 0, ee = 0;
      for (var j = 0; j < 5; j++) {
        if (cells[s + j] === color) cc++;
        else if (cells[s + j] === EMPTY) ee++;
      }
      if (cc === 4 && ee === 1) return true;
    }
  }
  return false;
}

function countOpenThrees(bd, x, y, color) {
  var n = 0;
  for (var d = 0; d < 4; d++) {
    if (isOpenThreeAt(bd, x, y, DIRS[d][0], DIRS[d][1], color)) n++;
  }
  return n;
}

// 落子后在某方向是否形成“四”（5 窗口 4 子或已连五，供四四计数；长连单独处理）
function isFourDir(bd, x, y, dx, dy, color) {
  var cells = [];
  for (var k = -5; k <= 5; k++) {
    var nx = x + dx * k, ny = y + dy * k;
    if (!inBoard(nx, ny)) { cells.push(-1); continue; }
    if (nx === x && ny === y) { cells.push(color); continue; }
    cells.push(bd[idx(nx, ny)]);
  }
  var center = 5;
  for (var s = center - 4; s <= center; s++) {
    if (s < 0 || s + 4 >= cells.length) continue;
    var cc = 0, ee = 0, oo = 0;
    for (var j = 0; j < 5; j++) {
      var v = cells[s + j];
      if (v === color) cc++;
      else if (v === EMPTY) ee++;
      else oo++;
    }
    if (cc === 4 && ee === 1 && oo === 0) return true;
  }
  return false;
}

function countFours(bd, x, y, color) {
  var n = 0;
  for (var d = 0; d < 4; d++) {
    if (isFourDir(bd, x, y, DIRS[d][0], DIRS[d][1], color)) n++;
  }
  return n;
}

// 返回禁手类型：null | 'overline' | 'double-three' | 'double-four'
// 注意：形成五连（恰五）时一切禁手豁免，直接算胜。
function forbiddenType(bd, x, y, color) {
  if (color !== BLACK) return null;
  if (bd[idx(x, y)] !== EMPTY) return null;
  bd[idx(x, y)] = color;
  var exactFive = false;
  var overline = false;
  for (var d = 0; d < 4; d++) {
    var len = lineLen(bd, x, y, DIRS[d][0], DIRS[d][1], color);
    if (len === 5) exactFive = true;
    if (len >= 6) overline = true;
  }
  if (exactFive) { bd[idx(x, y)] = EMPTY; return null; }
  if (overline) { bd[idx(x, y)] = EMPTY; return 'overline'; }
  var threes = countOpenThrees(bd, x, y, color);
  if (threes >= 2) { bd[idx(x, y)] = EMPTY; return 'double-three'; }
  var fours = countFours(bd, x, y, color);
  if (fours >= 2) { bd[idx(x, y)] = EMPTY; return 'double-four'; }
  bd[idx(x, y)] = EMPTY;
  return null;
}

/* ---------------- 启发式评估 ---------------- */
function lineScore(count, openEnds) {
  if (count >= 5) return 1000000;
  if (count === 4) return openEnds === 2 ? 100000 : 12000;
  if (count === 3) return openEnds === 2 ? 6000 : 600;
  if (count === 2) return openEnds === 2 ? 220 : 24;
  if (count === 1) return openEnds === 2 ? 12 : 2;
  return 0;
}

function evalPointOn(bd, x, y, color) {
  var total = 0;
  for (var d = 0; d < 4; d++) {
    var dx = DIRS[d][0], dy = DIRS[d][1];
    var count = 1, ends = 0;
    var nx = x + dx, ny = y + dy;
    while (inBoard(nx, ny) && bd[idx(nx, ny)] === color) { count++; nx += dx; ny += dy; }
    if (inBoard(nx, ny) && bd[idx(nx, ny)] === EMPTY) ends++;
    nx = x - dx; ny = y - dy;
    while (inBoard(nx, ny) && bd[idx(nx, ny)] === color) { count++; nx -= dx; ny -= dy; }
    if (inBoard(nx, ny) && bd[idx(nx, ny)] === EMPTY) ends++;
    total += lineScore(count, ends);
  }
  return total;
}

// 候选着法：距已有棋子 range 内的空点；附带中心距离微调保证开局占优
function genCandidates(bd, hasStone, range) {
  if (!hasStone) return [{ x: 7, y: 7, s: 0 }];
  var seen = new Uint8Array(N);
  var list = [];
  for (var y = 0; y < SIZE; y++) {
    for (var x = 0; x < SIZE; x++) {
      if (bd[idx(x, y)] !== EMPTY) {
        for (var dy = -range; dy <= range; dy++) {
          for (var dx = -range; dx <= range; dx++) {
            var nx = x + dx, ny = y + dy;
            if (inBoard(nx, ny) && bd[idx(nx, ny)] === EMPTY && !seen[idx(nx, ny)]) {
              seen[idx(nx, ny)] = 1;
              list.push({ x: nx, y: ny, s: 0 });
            }
          }
        }
      }
    }
  }
  if (!list.length) return [{ x: 7, y: 7, s: 0 }];
  return list;
}

function heuristicMoveScore(bd, x, y, me, op) {
  bd[idx(x, y)] = me;
  var atk = evalPointOn(bd, x, y, me);
  var winNow = checkWinFlat(bd, x, y, me) ? 5000000 : 0;
  bd[idx(x, y)] = op;
  var def = evalPointOn(bd, x, y, op);
  var mustBlock = checkWinFlat(bd, x, y, op) ? 4000000 : 0;
  bd[idx(x, y)] = EMPTY;
  var centerBias = 12 - (Math.abs(x - 7) + Math.abs(y - 7));
  return atk + winNow + (def + mustBlock) * 0.92 + centerBias;
}

// 静态局面评估（从 me 视角）：仅扫描候选邻域，速度与棋力兼顾
function staticEval(bd, me, op, cands) {
  var score = 0;
  for (var i = 0; i < cands.length; i++) {
    var p = cands[i];
    bd[idx(p.x, p.y)] = me;
    score += evalPointOn(bd, p.x, p.y, me);
    bd[idx(p.x, p.y)] = op;
    score -= evalPointOn(bd, p.x, p.y, op) * 0.94;
    bd[idx(p.x, p.y)] = EMPTY;
  }
  // 已落子加成
  for (var y = 0; y < SIZE; y++) {
    for (var x = 0; x < SIZE; x++) {
      var v = bd[idx(x, y)];
      if (v === me) score += 6;
      else if (v === op) score -= 6;
    }
  }
  return score;
}

/* ---------------- 搜索状态 ---------------- */
var TT = new Map();
var TT_MAX = 120000;
var historyScore = new Int32Array(N * 2 + 16);
var killerMoves = [];
var nodes = 0;
var stopFlag = false;
var deadline = 0;
var renjuOn = false;

function ttGet(key) { return TT.get(key); }
function ttSet(key, entry) {
  if (TT.size > TT_MAX) {
    var n = 0;
    for (var k of TT.keys()) { TT.delete(k); if (++n > 20000) break; }
  }
  TT.set(key, entry);
}

/* ---------------- VCF 算杀（连续冲四必胜深度优先） ---------------- */
// 冲四点：落子后形成四（活四/冲四/成五）的所有空点
function fourAttackMoves(bd, attacker) {
  var cands = genCandidates(bd, true, 2);
  var out = [];
  for (var i = 0; i < cands.length; i++) {
    var p = cands[i];
    bd[idx(p.x, p.y)] = attacker;
    var win = checkWinFlat(bd, p.x, p.y, attacker);
    var four = win ? true : formsFour(bd, p.x, p.y, attacker);
    bd[idx(p.x, p.y)] = EMPTY;
    if (win) return [{ x: p.x, y: p.y, mate: true }];
    if (four) out.push({ x: p.x, y: p.y, mate: false });
  }
  return out;
}

// 防守方必须落子的点：阻挡攻击方四威胁的所有防守点
function defenseMoves(bd, attacker, ax, ay) {
  // 攻击方在 (ax,ay) 形成四后，防守方必须在该四形的空位中落子
  var def = opp(attacker);
  var set = new Map();
  bd[idx(ax, ay)] = attacker;
  for (var d = 0; d < 4; d++) {
    var dx = DIRS[d][0], dy = DIRS[d][1];
    var cells = [];
    for (var k = -4; k <= 4; k++) {
      var nx = ax + dx * k, ny = ay + dy * k;
      if (!inBoard(nx, ny)) { cells.push(null); continue; }
      cells.push({ x: nx, y: ny, v: bd[idx(nx, ny)] });
    }
    for (var s = 0; s + 4 < cells.length; s++) {
      var cc = 0, ee = 0, bad = false;
      var ept = null;
      for (var j = 0; j < 5; j++) {
        var c = cells[s + j];
        if (!c) { bad = true; break; }
        if (c.v === attacker) cc++;
        else if (c.v === EMPTY) { ee++; ept = c; }
        else { bad = true; break; }
      }
      if (!bad && cc === 4 && ee === 1) set.set(ept.y * SIZE + ept.x, ept);
    }
  }
  bd[idx(ax, ay)] = EMPTY;
  var arr = Array.from(set.values());
  // 若攻击方已成五，无防守点
  if (!arr.length) {
    // 检查是否成五：若成五则返回空（杀棋成立）
    bd[idx(ax, ay)] = attacker;
    var w = checkWinFlat(bd, ax, ay, attacker);
    bd[idx(ax, ay)] = EMPTY;
    if (w) return [];
  }
  // 白方防守点若包含禁手（黑攻）不影响；黑方防守不受禁手限制（防守允许填禁手点判胜规则下防守有效，此处不过滤）
  return arr.filter(function (p) { return bd[idx(p.x, p.y)] === EMPTY; });
}

function vcfSearch(bd, attacker, maxDepth, line) {
  if (stopFlag) return null;
  nodes++;
  if ((nodes & 1023) === 0 && Date.now() > deadline) { stopFlag = true; return null; }
  var atkMoves = fourAttackMoves(bd, attacker);
  if (!atkMoves.length) return null;
  for (var i = 0; i < atkMoves.length; i++) {
    var m = atkMoves[i];
    if (renjuOn && attacker === BLACK && forbiddenType(bd, m.x, m.y, BLACK)) continue;
    bd[idx(m.x, m.y)] = attacker;
    if (m.mate || checkWinFlat(bd, m.x, m.y, attacker)) {
      bd[idx(m.x, m.y)] = EMPTY;
      return line.concat([{ x: m.x, y: m.y }]);
    }
    if (maxDepth <= 1) { bd[idx(m.x, m.y)] = EMPTY; continue; }
    var defs = defenseMoves(bd, attacker, m.x, m.y);
    bd[idx(m.x, m.y)] = EMPTY;
    if (!defs.length) return line.concat([{ x: m.x, y: m.y }]); // 无可防之点
    var allHold = true;
    var bestLine = null;
    for (var j = 0; j < defs.length; j++) {
      var d = defs[j];
      bd[idx(d.x, d.y)] = opp(attacker);
      // 防守方落子即胜？则此攻击分支失败
      if (checkWinFlat(bd, d.x, d.y, opp(attacker))) {
        bd[idx(d.x, d.y)] = EMPTY;
        allHold = false; bestLine = null; break;
      }
      var sub = vcfSearch(bd, attacker, maxDepth - 1, line.concat([{ x: m.x, y: m.y }, { x: d.x, y: d.y }]));
      bd[idx(d.x, d.y)] = EMPTY;
      if (!sub) { allHold = false; bestLine = null; break; }
      bestLine = sub;
    }
    if (allHold && bestLine) return bestLine;
  }
  return null;
}

// VCT 浅层：活三追杀（攻击方仅尝试形成活三/冲四的着法，防守方取启发式前 N 个应法）
function vctSearch(bd, attacker, maxDepth, line) {
  if (stopFlag || maxDepth <= 0) return null;
  nodes++;
  var cands = genCandidates(bd, true, 2);
  var scored = [];
  for (var i = 0; i < cands.length; i++) {
    var p = cands[i];
    if (renjuOn && attacker === BLACK && forbiddenType(bd, p.x, p.y, BLACK)) continue;
    bd[idx(p.x, p.y)] = attacker;
    var win = checkWinFlat(bd, p.x, p.y, attacker);
    var atk = evalPointOn(bd, p.x, p.y, attacker);
    bd[idx(p.x, p.y)] = EMPTY;
    if (win) return line.concat([{ x: p.x, y: p.y }]);
    if (atk >= 6000) scored.push({ x: p.x, y: p.y, s: atk });
  }
  scored.sort(function (a, b) { return b.s - a.s; });
  var top = scored.slice(0, 6);
  for (var t = 0; t < top.length; t++) {
    var m = top[t];
    bd[idx(m.x, m.y)] = attacker;
    // 防守方：取启发式前 5 个应法，必须全部被攻破才算杀
    var defC = genCandidates(bd, true, 2);
    var ds = [];
    for (var k = 0; k < defC.length; k++) {
      var q = defC[k];
      ds.push({ x: q.x, y: q.y, s: heuristicMoveScore(bd, q.x, q.y, opp(attacker), attacker) });
    }
    ds.sort(function (a, b) { return b.s - a.s; });
    var replies = ds.slice(0, 5);
    var hold = true;
    var fin = null;
    for (var r = 0; r < replies.length; r++) {
      var rp = replies[r];
      bd[idx(rp.x, rp.y)] = opp(attacker);
      if (checkWinFlat(bd, rp.x, rp.y, opp(attacker))) {
        bd[idx(rp.x, rp.y)] = EMPTY;
        bd[idx(m.x, m.y)] = EMPTY;
        hold = false; fin = null; break;
      }
      var sub = vcfSearch(bd, attacker, 6, line.concat([{ x: m.x, y: m.y }, { x: rp.x, y: rp.y }])) ||
                (maxDepth > 1 ? vctSearch(bd, attacker, maxDepth - 1, line.concat([{ x: m.x, y: m.y }, { x: rp.x, y: rp.y }])) : null);
      bd[idx(rp.x, rp.y)] = EMPTY;
      if (!sub) { hold = false; fin = null; break; }
      fin = sub;
    }
    bd[idx(m.x, m.y)] = EMPTY;
    if (hold && fin) return fin;
  }
  return null;
}

/* ---------------- Negamax + Alpha-Beta + PVS ---------------- */
function orderMoves(bd, moves, me, op, ply, ttBest) {
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    var key = idx(m.x, m.y);
    m.s = heuristicMoveScore(bd, m.x, m.y, me, op);
    if (ttBest && m.x === ttBest.x && m.y === ttBest.y) m.s += 9000000;
    m.s += (historyScore[key * 2 + (me === BLACK ? 0 : 1)] || 0) * 0.02;
    var kl = killerMoves[ply];
    if (kl && kl.x === m.x && kl.y === m.y) m.s += 50000;
  }
  moves.sort(function (a, b) { return b.s - a.s; });
  return moves;
}

function negamax(bd, depth, alpha, beta, me, op, ply, lo, hi, pv) {
  if (stopFlag) return 0;
  nodes++;
  if ((nodes & 1023) === 0 && Date.now() > deadline) { stopFlag = true; return 0; }

  var key = zobKey(lo, hi);
  var tt = ttGet(key);
  var ttBest = null;
  if (tt && tt.depth >= depth) {
    if (tt.flag === 0) return tt.value;
    if (tt.flag === 1 && tt.value > alpha) alpha = tt.value;
    else if (tt.flag === 2 && tt.value < beta) beta = tt.value;
    if (alpha >= beta) return tt.value;
    ttBest = tt.best;
  } else if (tt) {
    ttBest = tt.best;
  }

  if (depth <= 0) {
    var cands = genCandidates(bd, true, 1);
    return staticEval(bd, me, op, cands);
  }

  var moves = genCandidates(bd, true, 2);
  // 禁手过滤（黑方搜索）
  if (renjuOn && me === BLACK) {
    moves = moves.filter(function (m) { return !forbiddenType(bd, m.x, m.y, BLACK); });
    if (!moves.length) return -WIN_SCORE + ply; // 无棋可下判负
  }
  orderMoves(bd, moves, me, op, ply, ttBest);
  // 宽度限制：深层只搜前 N 个
  var width = depth >= 4 ? 12 : depth === 3 ? 14 : moves.length;
  if (moves.length > width) moves.length = width;

  var bestVal = -INF;
  var bestMove = null;
  var localPV = [];
  var flag = 2; // upperbound

  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    var k = idx(m.x, m.y);
    bd[k] = me;
    var nlo = lo ^ ZOB_LO[k * 2 + (me === BLACK ? 0 : 1)];
    var nhi = hi ^ ZOB_HI[k * 2 + (me === BLACK ? 0 : 1)];

    // 取胜剪枝
    if (checkWinFlat(bd, m.x, m.y, me)) {
      bd[k] = EMPTY;
      var mateVal = WIN_SCORE - (ply + 1) * 1000 - (4 - depth) * 10;
      ttSet(key, { depth: depth, flag: 0, value: mateVal, best: { x: m.x, y: m.y } });
      if (pv) { pv.length = 0; pv.push({ x: m.x, y: m.y }); }
      return mateVal;
    }

    var childPV = [];
    var val;
    if (i === 0) {
      val = -negamax(bd, depth - 1, -beta, -alpha, op, me, ply + 1, nlo, nhi, childPV);
    } else {
      // PVS 零窗口验证
      val = -negamax(bd, depth - 1, -alpha - 1, -alpha, op, me, ply + 1, nlo, nhi, null);
      if (val > alpha && val < beta) {
        val = -negamax(bd, depth - 1, -beta, -alpha, op, me, ply + 1, nlo, nhi, childPV);
      } else if (childPV.length === 0 && val > alpha) {
        childPV = [];
      }
    }
    bd[k] = EMPTY;
    if (stopFlag) return 0;

    if (val > bestVal) {
      bestVal = val;
      bestMove = { x: m.x, y: m.y };
      localPV = [{ x: m.x, y: m.y }].concat(childPV);
    }
    if (val > alpha) {
      alpha = val;
      flag = 0; // exact
      historyScore[k * 2 + (me === BLACK ? 0 : 1)] += depth * depth;
      if (!killerMoves[ply]) killerMoves[ply] = { x: m.x, y: m.y };
    }
    if (alpha >= beta) {
      flag = 1; // lowerbound
      killerMoves[ply] = { x: m.x, y: m.y };
      break;
    }
  }

  if (bestMove) ttSet(key, { depth: depth, flag: flag, value: bestVal, best: bestMove });
  if (pv) { pv.length = 0; for (var p = 0; p < localPV.length; p++) pv.push(localPV[p]); }
  return bestVal;
}

/* ---------------- 顶层搜索：VCF/VCT 先行 + 迭代加深 ---------------- */
function searchBest(bd, hasStone, me, timeLimitMs, maxDepth, reqId, postInfo) {
  nodes = 0;
  stopFlag = false;
  historyScore = new Int32Array(N * 2 + 16);
  killerMoves = [];
  var start = Date.now();
  deadline = start + timeLimitMs;

  // 空盘 / 开局库：中心 + 邻星快速应答
  var stones = 0;
  for (var i = 0; i < N; i++) if (bd[i] !== EMPTY) stones++;
  if (stones === 0) {
    return { x: 7, y: 7, score: 0, depth: 0, nodes: 1, pv: [{ x: 7, y: 7 }], method: 'opening', vcf: false };
  }

  var op = opp(me);

  // 1) 己方直接成五
  var cands = genCandidates(bd, true, 2);
  for (var a = 0; a < cands.length; a++) {
    var p = cands[a];
    bd[idx(p.x, p.y)] = me;
    var w = checkWinFlat(bd, p.x, p.y, me);
    bd[idx(p.x, p.y)] = EMPTY;
    if (w) {
      return { x: p.x, y: p.y, score: WIN_SCORE, depth: 0, nodes: nodes, pv: [{ x: p.x, y: p.y }], method: 'mate-in-1', vcf: false };
    }
  }
  // 2) 必须堵对方成五
  var mustBlocks = [];
  for (var b = 0; b < cands.length; b++) {
    var q = cands[b];
    bd[idx(q.x, q.y)] = op;
    if (checkWinFlat(bd, q.x, q.y, op)) mustBlocks.push({ x: q.x, y: q.y });
    bd[idx(q.x, q.y)] = EMPTY;
  }
  if (mustBlocks.length === 1) {
    var only = mustBlocks[0];
    if (!(renjuOn && me === BLACK && forbiddenType(bd, only.x, only.y, BLACK))) {
      return { x: only.x, y: only.y, score: WIN_SCORE - 1000, depth: 0, nodes: nodes, pv: [only], method: 'block-mate', vcf: false };
    }
  } else if (mustBlocks.length >= 2) {
    // 双杀：尽量堵一个（无法全堵），选启发式最优
    var scoredB = mustBlocks.map(function (m) { return { x: m.x, y: m.y, s: heuristicMoveScore(bd, m.x, m.y, me, op) }; });
    scoredB.sort(function (x, y) { return y.s - x.s; });
    for (var bi = 0; bi < scoredB.length; bi++) {
      if (!(renjuOn && me === BLACK && forbiddenType(bd, scoredB[bi].x, scoredB[bi].y, BLACK))) {
        return { x: scoredB[bi].x, y: scoredB[bi].y, score: -WIN_SCORE + 500, depth: 0, nodes: nodes, pv: [scoredB[bi]], method: 'block-double', vcf: false };
      }
    }
  }

  // 3) VCF 算杀（己方）
  var vcfLine = vcfSearch(bd, me, 10, []);
  if (vcfLine && vcfLine.length) {
    var first = vcfLine[0];
    return { x: first.x, y: first.y, score: WIN_SCORE - 500, depth: vcfLine.length, nodes: nodes, pv: vcfLine, method: 'vcf', vcf: true };
  }
  if (Date.now() > deadline) { /* 时间耗尽则直接用当前最佳启发式 */ }

  // 4) 对方 VCF 威胁：强制防守（找对方的 VCF 首步并阻截）
  var foeVcf = vcfSearch(bd, op, 8, []);
  var forcedDefense = null;
  if (foeVcf && foeVcf.length) {
    // 对方杀招首步 (fx,fy)：我方若能直接占据则阻断
    var fx = foeVcf[0].x, fy = foeVcf[0].y;
    if (bd[idx(fx, fy)] === EMPTY && !(renjuOn && me === BLACK && forbiddenType(bd, fx, fy, BLACK))) {
      forcedDefense = { x: fx, y: fy, pv: foeVcf };
    }
  }

  // 5) 迭代加深 Negamax
  var lo = 0, hi = 0;
  for (var s = 0; s < N; s++) {
    if (bd[s] !== EMPTY) {
      lo ^= ZOB_LO[s * 2 + (bd[s] === BLACK ? 0 : 1)];
      hi ^= ZOB_HI[s * 2 + (bd[s] === BLACK ? 0 : 1)];
    }
  }
  var best = forcedDefense ? { x: forcedDefense.x, y: forcedDefense.y } : null;
  var bestScore = forcedDefense ? (WIN_SCORE - 2000) : -INF;
  var bestPV = forcedDefense && forcedDefense.pv ? forcedDefense.pv.slice() : [];
  var reached = 0;

  // 初始排序供首层使用
  var rootMoves = genCandidates(bd, true, 2);
  if (renjuOn && me === BLACK) rootMoves = rootMoves.filter(function (m) { return !forbiddenType(bd, m.x, m.y, BLACK); });
  if (!rootMoves.length) {
    return { x: -1, y: -1, score: -WIN_SCORE, depth: 0, nodes: nodes, pv: [], method: 'no-move', vcf: false };
  }
  orderMoves(bd, rootMoves, me, op, 0, forcedDefense);
  best = best || { x: rootMoves[0].x, y: rootMoves[0].y };

  for (var depth = 2; depth <= maxDepth; depth++) {
    if (stopFlag || Date.now() > deadline) break;
    var alpha = -INF, beta = INF;
    var localBest = null, localScore = -INF;
    var ordered = orderMoves(bd, rootMoves.slice(), me, op, 0, best);
    if (ordered.length > 14 && depth >= 4) ordered = ordered.slice(0, 14);
    var curPV = [];
    for (var r = 0; r < ordered.length; r++) {
      if (stopFlag || Date.now() > deadline) break;
      var m = ordered[r];
      var k = idx(m.x, m.y);
      bd[k] = me;
      if (checkWinFlat(bd, m.x, m.y, me)) {
        bd[k] = EMPTY;
        var mate = WIN_SCORE - 100;
        best = { x: m.x, y: m.y }; bestScore = mate; bestPV = [{ x: m.x, y: m.y }];
        reached = depth;
        stopFlag = true;
        break;
      }
      var nlo = lo ^ ZOB_LO[k * 2 + (me === BLACK ? 0 : 1)];
      var nhi = hi ^ ZOB_HI[k * 2 + (me === BLACK ? 0 : 1)];
      var childPV = [];
      var val = -negamax(bd, depth - 1, -beta, -alpha, op, me, 1, nlo, nhi, childPV);
      bd[k] = EMPTY;
      if (stopFlag) break;
      if (val > localScore) {
        localScore = val;
        localBest = { x: m.x, y: m.y };
        curPV = [{ x: m.x, y: m.y }].concat(childPV);
      }
      if (val > alpha) alpha = val;
    }
    if (stopFlag) break;
    if (localBest) {
      best = localBest; bestScore = localScore; bestPV = curPV;
      reached = depth;
      // 置顶最佳着法供下一轮
      rootMoves.sort(function (a, b) {
        var ab = (a.x === best.x && a.y === best.y) ? 1 : 0;
        var bb = (b.x === best.x && b.y === best.y) ? 1 : 0;
        return bb - ab;
      });
      if (postInfo) {
        var el = Date.now() - start;
        postInfo({ depth: depth, score: Math.round(localScore), best: best, nodes: nodes, nps: Math.round(nodes / Math.max(0.05, el / 1000)), pv: curPV.slice(0, 8) });
      }
    }
    if (bestScore >= WIN_SCORE - 2000) break;
    if (Date.now() > deadline) break;
  }

  // 6) VCT 补强：若主搜索未发现杀机但存在 VCT，优先杀招
  if (!stopFlag && Date.now() < deadline && bestScore < WIN_SCORE - 2000) {
    var vctLine = vctSearch(bd, me, 3, []);
    if (vctLine && vctLine.length) {
      best = { x: vctLine[0].x, y: vctLine[0].y };
      bestPV = vctLine;
      bestScore = WIN_SCORE - 800;
      return { x: best.x, y: best.y, score: Math.round(bestScore), depth: vctLine.length, nodes: nodes, pv: vctLine, method: 'vct', vcf: true };
    }
  }

  // 防守兜底：若对方存在 VCF 而我方搜索未选防守点，强制回退到防守点
  if (forcedDefense && bestScore < 0 && !(best.x === forcedDefense.x && best.y === forcedDefense.y)) {
    best = { x: forcedDefense.x, y: forcedDefense.y };
    bestPV = forcedDefense.pv.slice();
  }

  return { x: best.x, y: best.y, score: Math.round(bestScore), depth: reached, nodes: nodes, pv: bestPV.slice(0, 10), method: forcedDefense ? 'defense+search' : 'search', vcf: false };
}

/* ---------------- 消息处理 ---------------- */
var LEVEL_CONF = {
  easy: { maxDepth: 2, time: 180 },
  medium: { maxDepth: 4, time: 650 },
  hard: { maxDepth: 6, time: 1400 }
};

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === 'stop') { stopFlag = true; return; }
  if (msg.type !== 'search') return;
  try {
    renjuOn = !!msg.renju;
    var conf = LEVEL_CONF[msg.level] || LEVEL_CONF.medium;
    var timeLimit = Math.max(80, Math.min(5000, msg.timeLimitMs || conf.time));
    var maxDepth = Math.max(1, Math.min(7, msg.maxDepth || conf.maxDepth));
    var bd = new Int8Array(N);
    var flat = msg.flat || [];
    var hasStone = false;
    for (var i = 0; i < N && i < flat.length; i++) {
      bd[i] = flat[i] | 0;
      if (bd[i] !== EMPTY) hasStone = true;
    }
    TT = new Map();
    var reqId = msg.reqId || 0;
    var start = Date.now();
    var infoCount = 0;
    var res = searchBest(bd, hasStone, msg.aiColor === 1 ? BLACK : WHITE, timeLimit, maxDepth, reqId, function (info) {
      infoCount++;
      self.postMessage({ type: 'info', reqId: reqId, depth: info.depth, score: info.score, best: info.best, nodes: info.nodes, nps: info.nps, pv: info.pv });
    });
    var timeMs = Date.now() - start;
    self.postMessage({
      type: 'result', reqId: reqId,
      x: res.x, y: res.y, score: res.score, depth: res.depth,
      nodes: nodes, nps: Math.round(nodes / Math.max(0.05, timeMs / 1000)),
      pv: res.pv || [], timeMs: timeMs, vcf: !!res.vcf, method: res.method || 'search'
    });
  } catch (err) {
    self.postMessage({ type: 'result', reqId: (e.data && e.data.reqId) || 0, x: 7, y: 7, score: 0, depth: 0, nodes: 0, nps: 0, pv: [], timeMs: 0, vcf: false, method: 'fallback-error', error: String((err && err.message) || err) });
  }
};
