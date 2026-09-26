# 3D 沉浸式五子棋 · 3D Gobang Experience（全量重构版）

Three.js 打造的 3D 沉浸式五子棋：程序化 PBR 金丝楠木棋盘、墨玉 / 羊脂白玉棋子、EffectComposer 电影级后期、Web Worker Alpha-Beta + VCF 算杀引擎、禁手规则与对局复盘，开箱即用。

## 全量重构特性

### 图形渲染与着色器
- **程序化 PBR 纹理生成**：Canvas 2D + Value-Noise FBM 动态生成金丝楠木 BaseColor / Roughness / Bump 三贴图（细密年轮扰动 + 金丝亮筋）；棋子复用 256px 玉石微晶纹理做 roughness / bump。
- **墨玉黑子 / 凝脂白子**：`MeshPhysicalMaterial` 清漆 + Sheen 内散射近似 + 环境反射（RoomEnvironment），黑子隐约微晶反光，白子温润透光。
- **后期处理管线**：`EffectComposer` + `RenderPass` + `UnrealBloomPass`（阈值 0.82，仅金丝网格 / 星位 / 光环 / 光柱溢光）+ 自定义晕影 / 胶片颗粒 Shader Pass + `OutputPass`。
- **真实接触阴影**：每颗棋子正下方径向渐变 AO 阴影面（共享几何体 / 材质 / 贴图）+ 2048px PCFSoft 阴影贴图，杜绝漂浮感。

### AI 架构（`ai.worker.js`，独立 Web Worker）
- **Zobrist Hashing + 置换表**：15×15×2 双 32 位增量异或哈希，TT 含深度 / Exact-Lower-Upper 旗标 / 最佳着法，上限自动裁剪。
- **Negamax + Alpha-Beta + PVS**：历史启发 + 杀手启发 + TT 最佳着法排序，深层限宽。
- **迭代加深**：新手 2-ply / 进阶 4-ply / 大师 6-ply，时间控制 + NPS 统计，`info` 消息实时回传深度 / 评分 / PV。
- **VCF / VCT 算杀**：冲四连续追杀深度优先搜索 + 活三追杀扩展；开局直接成五 / 必堵对方成五 / 对方 VCF 强制防守优先。
- **零阻塞**：思考全程异步 `postMessage`，面板实时显示深度 / 评估 / 节点 / NPS / PV；`file://` 下 Worker 不可用时自动降级为主线程启发式兜底，对局不中断。

### 程序化音效（Web Audio，零外部音频文件）
- **落子**：1200Hz + 2800Hz 双正弦快衰减冲击 + 180Hz 实木低通共鸣 + 随机音调抖动，黑 / 白棋音色区分。
- **悔棋**：逆向气流带通扫频 + 小木槌微敲击 + 上行三音；**禁手**：低沉双音警示。
- **胜负**：胜利编钟五声音阶泛音（卷积混响大厅感），落败大提琴低频弦震 + 木鱼残响。
- 音效开关 + 音量滑杆，DynamicsCompressor 防爆音。

### 交互与微动效
- 落子弹跳 + 棋盘微震下沉 + 光圈涟漪三重同步。
- 悬停半透明预览棋 + 十字聚焦微光（Lerp 平滑追踪）+ 交叉点轻音；禁手点红色预览 + 悬浮提示。
- 终局面板**棋局复盘**：上一手 / 下一手 / 自动播放 / 退出，相机平滑追踪每手焦点（方向键 ←/→ 可步进，Ctrl+Z 悔棋）。

### 规则与棋谱
- **禁手规则开关**：黑棋三三 / 四四 / 长连判定（恰五豁免），人类落子实时拦截提示红色高亮，AI（黑）搜索自动过滤禁手着法。
- **导出 SGF / PGN 文本**（下载 + 复制到剪贴板）、**导入 SGF**（文件选择重建对局，含禁手局判定）。
- **一键高清截图**：`preserveDrawingBuffer` + 后期合成帧直接导出 PNG。

## 3D 操作说明

| 操作 | 说明 |
| --- | --- |
| 左键点击交叉点 | 落子 |
| 左键拖拽 | 旋转视角 |
| 右键拖拽 | 平移视角 |
| 滚轮 | 缩放 |
| `R` / 重置视角按钮 | 回到默认俯视角度 |
| `T` / 顶视按钮 | 切换正顶视 |
| `空格` / 自动旋转按钮 | 开关场景自动旋转 |
| `←` / `→`（复盘中） | 上一手 / 下一手 |
| `Ctrl/⌘ + Z` | 悔棋 |

窗口缩放时摄像机比例、渲染器与后期管线尺寸自适应。

## 运行

需要联网加载 Three.js CDN（unpkg），推荐本地服务启动（Worker 在 `http(s)` 下工作最完整；直接 `file://` 打开亦可游玩，AI 自动降级为本地启发式）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

> CDN（importmap）：`https://unpkg.com/three@0.160.0/build/three.module.js`
> 与 `https://unpkg.com/three@0.160.0/examples/jsm/`（OrbitControls / EffectComposer / RenderPass / UnrealBloomPass / ShaderPass / OutputPass / RoomEnvironment）

## 校验

```bash
node --check script.js
node --check ai.worker.js
```

引擎自检（空盘开局 / 直接成五 / 必堵 / 禁手三三·长连·恰五豁免）已通过 Node 实测：
空盘 → H8 开局；四连 → `mate-in-1` 即胜；对方活四 → 强制阻截；禁手判定四项全对。

## 文件结构

```
index.html    页面结构 + importmap CDN + 视口/工具条/复盘条/终局面板/AI 面板/禁手开关
style.css     暗夜轻奢新中式主题 + 工具条/复盘条/开关/音量/禁手提示/玻璃拟态
script.js     PBR纹理/音频引擎/禁手判定/Worker调度/Three场景/后期管线/复盘/SGF-PGN/截图/交互（ES Module）
ai.worker.js  Zobrist + 置换表 + Negamax/PVS + 迭代加深 + VCF/VCT 算杀（Classic Worker，无依赖）
```

## AI 算法说明

- 候选：距棋子 2 格邻域 + 中心偏置；着法排序 TT 最佳 > 历史 / 杀手 > 启发式攻防分。
- 叶节点静态评估：邻域攻防 pattern 求和（五连 1,000,000 / 活四 100,000 / 冲四 12,000 / 活三 6,000 …，防守 ×0.92~0.94）。
- 顶层流程：直接成五 → 必堵成五 → 己方 VCF → 对方 VCF 强制防守 → 迭代加深 PVS → VCT 补强。
- 主线程通过 `search` / `info` / `result` 协议与 Worker 通信，回传 `depth / score / nodes / nps / pv / method / vcf` 渲染至信息面板。
