# Flow Canvas 无限工作流画布 — 开发计划

> 第三创作界面：AI 工作流画布（`/create/flow`）

---

## 1. 项目定位

| 界面 | 路径 | 定位 |
|------|------|------|
| 经典版 | `/create/classic` | 单次生成，表单式操作 |
| 当前画布版 | `/create/canvas`（`/`） | 生成结果画布，摆放/编辑/对比 |
| **Flow 画布版** | **`/create/flow`** | **节点工作流，可复用/可运行/可分享** |

核心价值：**把 AI 创作过程沉淀成可复用的节点工作流**，对标 TapNow。

---

## 2. 技术路线

### 2.1 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 主画布引擎 | `@xyflow/react` (React Flow) | 节点/边/分组/缩放/连线 |
| 状态管理 | `zustand` | 已有，复用 |
| 请求/缓存 | `@tanstack/react-query` | 已有，复用 |
| 自动布局 | `dagre` | 第一版；后续可用 `elkjs` |
| ID 生成 | `nanoid` | 节点/边/运行 ID |
| 数据校验 | `zod` | 节点参数/接口校验 |
| 图像编辑子模块 | `konva` + `react-konva` | 已有，保留给遮罩/裁切/局部重绘 |
| 后端 | 现有 Express (`server.cjs`) | 新增 Flow 项目/运行接口 |
| 数据库 | 现有 MySQL | 新增 `flow_projects` / `flow_runs` / `flow_node_runs` 表 |
| 资产存储 | 现有 OSS + Sharp | 复用 |

### 2.2 新增依赖

```json
{
  "@xyflow/react": "^12",
  "dagre": "^0.8",
  "zod": "^3",
  "nanoid": "^5"
}
```

可选（后续按需）：`elkjs`, `react-hotkeys-hook`, `use-debounce`

### 2.3 为什么不继续用 Konva 做主画布

- Konva 适合图像编辑/标注/遮罩，不适合工作流连线/分组/运行状态
- React Flow 原生支持：节点拖拽、连线、分组、MiniMap、onlyRenderVisibleElements、自定义 nodeTypes/edgeTypes
- 与 TapNow 交互范式高度一致

**结论**：React Flow = 主工作流画布，Konva = 图像编辑器子模块。

---

## 3. 前端目录结构

```
src/flowCanvas/
  FlowCanvasPage.tsx              # 页面入口

  canvas/
    AiFlowCanvas.tsx              # React Flow 主画布
    FlowBackground.tsx            # 背景网格
    FlowMiniMap.tsx               # 小地图
    FlowTopToolbar.tsx            # 顶部工具栏
    FlowLeftAddPanel.tsx          # 左侧添加节点面板
    FlowPromptDock.tsx            # 底部 Prompt 输入区
    FlowContextMenu.tsx           # 右键菜单
    FlowSelectionToolbar.tsx      # 选中工具栏

  nodes/
    BaseNodeShell.tsx             # 节点通用外壳
    TextNode.tsx                  # 文本节点
    ImageNode.tsx                 # 图片节点
    VideoNode.tsx                 # 视频节点
    AudioNode.tsx                 # 音频节点
    UploadNode.tsx                # 上传节点
    ImageEditorNode.tsx           # 图像编辑器节点
    ImageGenerateNode.tsx         # 图像生成节点
    VideoGenerateNode.tsx         # 视频生成节点
    AudioGenerateNode.tsx         # 音频生成节点
    PromptEnhanceNode.tsx         # 提示词增强节点
    OutputNode.tsx                # 输出节点
    GroupNode.tsx                 # 分组节点

  edges/
    SmartEdge.tsx                 # 默认连线
    RunningEdge.tsx               # 运行中动画边
    ErrorEdge.tsx                 # 错误状态边

  store/
    flowCanvasStore.ts            # 画布状态
    flowSelectionStore.ts         # 选中状态
    flowRuntimeStore.ts           # 运行时状态
    flowAssetStore.ts             # 资产状态

  runtime/
    graphValidator.ts             # 图验证
    graphExecutor.ts              # 图执行器
    topologicalSort.ts            # 拓扑排序
    staleMarker.ts                # 过期标记
    nodeRunners/
      imageRunner.ts
      videoRunner.ts
      audioRunner.ts
      promptRunner.ts
      editorRunner.ts

  services/
    flowProjectApi.ts             # 项目 CRUD
    flowRunApi.ts                 # 运行接口
    flowAssetApi.ts               # 资产接口

  utils/
    nodeFactory.ts                # 节点工厂
    edgeFactory.ts                # 边工厂
    viewport.ts                   # 视口工具
    layout.ts                     # 布局工具
    performance.ts                # 性能工具

  types.ts                        # Flow 类型定义
```

**核心原则**：独立模块，不污染现有 `InfiniteCanvas.tsx` 和 `CanvasNode.tsx`。

---

## 4. 节点系统设计

### 4.1 节点类型

```typescript
type FlowNodeKind =
  | 'text' | 'image' | 'video' | 'audio' | 'upload'
  | 'image_generate' | 'video_generate' | 'audio_generate'
  | 'image_editor' | 'prompt_enhance' | 'output' | 'group';
```

### 4.2 第一批必做节点

| 节点 | 输入 | 输出 | 说明 |
|------|------|------|------|
| 文本节点 | 手动文本 | text | 提示词/脚本 |
| 图片节点 | image asset | image | 上传/生成图 |
| 视频节点 | video asset | video | 上传/生成视频 |
| 音频节点 | audio asset | audio | 上传/配音 |
| 上传节点 | file | asset | 拖入文件 |
| 图像生成节点 | text + image refs | image | 文生图/图生图 |
| 视频生成节点 | text + image/video | video | 文/图生视频 |
| 图像编辑器节点 | image + mask + params | image | 局部重绘/扩图 |
| 提示词增强节点 | text | text/json | 优化 prompt |
| 输出节点 | any | export | 汇总结果 |

### 4.3 节点数据模型

```typescript
type FlowNodeData = {
  id: string;
  kind: FlowNodeKind;
  title: string;
  width: number;
  height: number;
  collapsed?: boolean;
  locked?: boolean;
  status: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stale';
  progress?: number;
  errorMessage?: string;
  assetIds?: string[];
  thumbnailUrl?: string;
  posterUrl?: string;
  modelId?: string;
  routeId?: string;
  params?: Record<string, unknown>;
  text?: string;
  createdAt: number;
  updatedAt: number;
};
```

### 4.4 连线数据模型

```typescript
type FlowEdgeData = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  dataType: 'text' | 'image' | 'video' | 'audio' | 'json' | 'any';
  status?: 'idle' | 'running' | 'success' | 'error';
};
```

**关键**：节点只存 `assetId` 和缩略图 URL，不存 base64/原始文件。

---

## 5. 工作流运行机制

### 5.1 运行模式

1. **运行当前节点** — 只跑选中节点
2. **从当前节点往后运行** — 跑当前 + 所有下游
3. **运行整个工作流** — 拓扑排序后全量跑

### 5.2 运行规则

1. 校验连线合法性
2. 检查必填输入
3. 检测循环依赖
4. 计算上游依赖
5. 拓扑排序
6. 按序提交任务（支持并发限制）
7. 支持失败重试、取消、刷新恢复

### 5.3 节点状态

```
idle → queued → running → success / error
                              ↓
                            stale（上游变更时）
```

上游节点修改（改提示词/换参考图）→ 下游自动标记 `stale` → 提示重新运行。

---

## 6. 后端接口规划

### 6.1 项目接口

```
POST   /api/flow-projects                    创建项目
GET    /api/flow-projects                    项目列表
GET    /api/flow-projects/:projectId         获取项目
PATCH  /api/flow-projects/:projectId         更新项目
DELETE /api/flow-projects/:projectId         删除项目
```

### 6.2 图结构保存

```
PATCH  /api/flow-projects/:projectId/graph
```

请求体：
```json
{
  "nodes": [],
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "version": 12
}
```

### 6.3 运行接口

```
POST   /api/flow-projects/:projectId/run          运行整个工作流
POST   /api/flow-projects/:projectId/run-node      运行单节点
POST   /api/flow-runs/:runId/cancel                取消运行
GET    /api/flow-runs/:runId                       查询运行状态
GET    /api/flow-runs/:runId/events                事件流
```

### 6.4 资产接口

```
POST   /api/assets/upload                          上传资产
GET    /api/assets/:assetId                        获取资产
POST   /api/assets/:assetId/thumbnail              生成缩略图
```

### 6.5 uiMode 扩展

所有生成任务增加 `uiMode = 'classic' | 'canvas' | 'flow'`。

---

## 7. 数据库表设计

### 7.1 flow_projects

```sql
CREATE TABLE IF NOT EXISTS flow_projects (
  id            VARCHAR(36)  PRIMARY KEY,
  user_id       VARCHAR(64)  NOT NULL,
  title         VARCHAR(255) NOT NULL DEFAULT 'Untitled',
  cover_asset_id VARCHAR(36) DEFAULT NULL,
  graph_json    LONGTEXT     DEFAULT NULL,
  viewport_json TEXT         DEFAULT NULL,
  version       INT          NOT NULL DEFAULT 1,
  created_at    DATETIME(3)  NOT NULL,
  updated_at    DATETIME(3)  NOT NULL,
  deleted_at    DATETIME(3)  DEFAULT NULL,
  INDEX idx_user (user_id),
  INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 7.2 flow_runs

```sql
CREATE TABLE IF NOT EXISTS flow_runs (
  id            VARCHAR(36)  PRIMARY KEY,
  project_id    VARCHAR(36)  NOT NULL,
  user_id       VARCHAR(64)  NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
  start_node_id VARCHAR(36)  DEFAULT NULL,
  run_mode      VARCHAR(20)  NOT NULL DEFAULT 'full',
  total_cost    DECIMAL(12,2) DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL,
  updated_at    DATETIME(3)  NOT NULL,
  INDEX idx_project (project_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 7.3 flow_node_runs

```sql
CREATE TABLE IF NOT EXISTS flow_node_runs (
  id            VARCHAR(36)  PRIMARY KEY,
  run_id        VARCHAR(36)  NOT NULL,
  node_id       VARCHAR(36)  NOT NULL,
  node_kind     VARCHAR(30)  NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
  input_json    LONGTEXT     DEFAULT NULL,
  output_json   LONGTEXT     DEFAULT NULL,
  cost          DECIMAL(12,2) DEFAULT 0,
  error_message TEXT         DEFAULT NULL,
  started_at    DATETIME(3)  DEFAULT NULL,
  finished_at   DATETIME(3)  DEFAULT NULL,
  INDEX idx_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> `graph_json` 第一版直接存 nodes/edges JSON，项目成熟后再拆成独立节点表/边表。

---

## 8. 性能规划

### 8.1 第一版性能目标

| 场景 | 指标 |
|------|------|
| 200 媒体节点 + 300 边 | 缩放/拖动肉眼流畅 |
| 500 普通节点 + 800 边 | 可操作不崩溃 |
| 1000 普通节点 | 开启 `onlyRenderVisibleElements` 后可浏览 |
| 10 视频节点 | 默认只显示 poster |
| 单项目 `graph_json` | ≤ 5MB |
| 保存 | 停止操作 800ms 后节流保存 |

### 8.2 前端性能规则

1. 自定义节点全部 `React.memo`
2. `nodeTypes` / `edgeTypes` 定义在组件外部
3. `onNodeClick` / `onConnect` / `onNodesChange` 全部 `useCallback`
4. 节点内部不订阅完整 `nodes/edges` 数组
5. 大图只显示缩略图，双击加载高清
6. 视频默认 poster，选中后播放
7. 出视口的音视频自动暂停
8. 边动画仅 `running` 状态，平时无全局动画
9. 节点阴影/毛玻璃/`backdrop-filter` 克制使用
10. 保存 debounce/throttle
11. 撤销重做用 command/diff，不做全量快照
12. 生成进度统一 task store，不做逐节点 interval

### 8.3 媒体资源策略

| 类型 | 画布内 | 放大/选中时 |
|------|--------|------------|
| 图片 | 512px 缩略图 | 加载高清 |
| 视频 | poster 静帧 | 播放（同屏最多 2 个） |
| 音频 | 波形/封面/时长 | 全局 audio controller |

---

## 9. UI 布局规划

```
┌──────────────────────────────────────────────────┐
│  顶部工具栏: 选择/移动/连接/分组/对齐/撤销/重做/下载/分享  │
├────────┬─────────────────────────────┬───────────┤
│        │                             │           │
│  左侧   │     React Flow 画布         │  右侧属性  │
│  添加   │     节点 + 连线 + 分组       │   面板    │
│  节点   │     运行状态 + 悬浮工具      │  (选中时)  │
│  上传   │                             │           │
│  素材   │                             │           │
│  模板   │                             │           │
│        │                             │           │
├────────┴─────────────────────────────┴───────────┤
│  底部 Prompt Dock: 模型选择/比例/模式/运行按钮/点数预估   │
└──────────────────────────────────────────────────┘
```

---

## 10. 路由集成

在 `App.tsx` / `vite.config.ts` 中新增 `/create/flow` 路由：

```
/create/classic       经典版（已有）
/create/canvas        当前画布版（已有，`/` 默认）
/create/flow          新的 Flow 工作流画布版
/admin                后台（已有）
/billing              计费中心（已有）
```

保持"一个后端、一个用户系统、一个管理后台、三个创作界面"。

---

## 11. 分阶段开发计划

### Phase 0：技术验证（3-5 天）

> **目标**：确认 React Flow 能达到丝滑标准

- [ ] 独立 demo 页面
- [ ] 200 图片节点 + 300 边 + 20 文本节点 + 10 视频 poster 节点
- [ ] 分组 / 缩放 / 平移 / 拖拽
- [ ] `onlyRenderVisibleElements` 开关对比
- [ ] Chrome Profiler 验证：无全局重渲染，CPU 不满载，内存不异常增长

**验收**：缩放平移流畅、拖动不卡、React Profiler 无明显全局重渲染。

**⚠️ 此阶段不可跳过。**

---

### Phase 1：画布基础（1-2 周）

- [ ] `/create/flow` 路由注册
- [ ] `FlowCanvasPage` 页面骨架
- [ ] React Flow 基础画布（背景/缩放/平移）
- [ ] 左侧添加节点面板
- [ ] 基础节点：文本 / 图片 / 视频 / 音频 / 上传
- [ ] 节点选择 / resize / 删除 / 复制
- [ ] 右键菜单
- [ ] 顶部浮动工具栏
- [ ] 底部 Prompt Dock
- [ ] 项目本地保存（IndexedDB）
- [ ] 云端保存接口（`flow_projects` 表 + CRUD API）

**验收**：可创建项目、添加节点、拖动/缩放/选择/分组，刷新不丢失。

---

### Phase 2：接入生成能力（1-2 周）

- [ ] 图像生成节点（文生图/图生图）
- [ ] 视频生成节点
- [ ] 提示词增强节点
- [ ] 参考图输入连线
- [ ] 模型/线路选择 UI
- [ ] 任务提交 → 轮询/事件流 → 状态更新
- [ ] 生成中状态显示（进度条/动画边）
- [ ] 成功后输出 asset 自动挂载
- [ ] 失败提示
- [ ] 点数扣减（复用现有 billing 系统）
- [ ] `uiMode=flow` 记录

**验收**：文本 → 图像生成 → 结果回画布，后台可见 `uiMode=flow`。

---

### Phase 3：真正工作流（2-3 周）

- [ ] 图验证（连线合法性/必填检查）
- [ ] 防循环检测
- [ ] 拓扑排序
- [ ] 运行当前节点 / 从当前往后运行 / 运行整个工作流
- [ ] 上游变更 → 下游标记 `stale`
- [ ] 失败重试
- [ ] 取消任务
- [ ] 运行日志面板
- [ ] 节点输入/输出面板
- [ ] `flow_runs` / `flow_node_runs` 表 + API
- [ ] 刷新后恢复运行状态

**验收**：A→B→C 链路顺序运行；A 改后 B/C 自动过期；失败不导致状态混乱。

---

### Phase 4：TapNow 体验增强（2-4 周）

- [ ] 边上加号快速插入节点
- [ ] 拖拽上传到画布自动成节点
- [ ] 节点 hover 工具栏
- [ ] 自动排版（dagre）
- [ ] 模板保存/加载
- [ ] 项目克隆
- [ ] 工作流分享
- [ ] 封面图自动生成
- [ ] 教程引导
- [ ] 快捷键体系
- [ ] MiniMap
- [ ] 运行时边动画

**验收**：搭积木式 AI 创作流程，工作流可保存/复制/复用。

---

### Phase 5：高级能力（长期）

- [ ] 多人协作 / 实时光标
- [ ] 版本历史
- [ ] 模板市场
- [ ] 角色/商品一致性节点
- [ ] 一键拉片 / 分镜表
- [ ] 视频剪辑时间线
- [ ] 音频混音
- [ ] 批量生成 / 多平台裁切
- [ ] 企业团队空间
- [ ] 移动端完整体验

---

## 12. 第一版最小可行功能（MVP）

**必做**：
1. `/create/flow` 路由
2. React Flow 画布
3. 文本 / 图片 / 上传节点
4. 图像生成节点
5. 节点连线
6. 右键删除/复制/锁定
7. 多选/拖拽/框选
8. 分组
9. 保存/打开项目
10. 运行单个图像生成节点
11. 上游文本/图片作为输入
12. 生成结果自动成为新图片节点
13. 任务状态显示
14. 点数扣减接现有系统
15. `uiMode=flow` 记录

**不做**（后续迭代）：
- 多人协作、复杂自动布局、模板市场
- 视频剪辑时间线、音频混音
- PSD/SVG 导出、移动端完整体验

---

## 13. 关键工程原则

### 原则 1：第三界面独立

不改 `InfiniteCanvas.tsx`。新建 `src/flowCanvas/`，旧画布继续稳定运行。

### 原则 2：React Flow 只做交互层

业务真相源 = `flow_project.graph_json` + `assets` + `flow_runs` + `generation_records` + `billing_records`。

### 原则 3：所有生成任务走后端

前端只提交 `{ projectId, nodeId, modelId, routeId, inputs, params, uiMode }`。后端负责鉴权/扣点/提交/轮询/保存/失败返还。

### 原则 4：资产和节点分离

节点引用 `assetId`，资产单独存储。不把图片/视频塞到节点 JSON。

### 原则 5：性能优先于视觉特效

TapNow 的丝滑靠的是克制。毛玻璃、阴影、渐变、视频自动播放都要限制。

---

## 14. 风险与应对

| 风险 | 应对策略 |
|------|---------|
| 节点太重导致卡顿 | 全部 memo，只渲染视野内，媒体缩略图化，视频 poster 化 |
| 工作流状态混乱 | UI 状态与运行状态分离，runId 独立，失败可重试，上游变化标 stale |
| 保存频繁导致卡顿 | 拖动中不保存，onMoveEnd 后保存，graph_json patch 节流 |
| 范围失控 | 第一版只做三条链路：文本→图像生成→图片、图片→图像编辑→新图片、图片→视频生成→视频 |

---

## 15. 开发时间线总览

```
Phase 0  技术验证          3-5 天     ← 必须通过后才进入正式开发
Phase 1  画布基础          1-2 周
Phase 2  接入生成能力      1-2 周
Phase 3  真正工作流        2-3 周
Phase 4  TapNow 体验增强   2-4 周
Phase 5  高级能力          长期迭代
```

**总计 MVP（Phase 0-2）约 3-5 周，完整工作流（Phase 3）约 5-8 周。**

---

## 16. 技术定稿总结

| 决策项 | 定稿 |
|--------|------|
| 主画布引擎 | `@xyflow/react` |
| 状态管理 | Zustand |
| 请求缓存 | TanStack Query |
| 后端 | 现有 Express，新增 Flow 接口 |
| 数据库 | 现有 MySQL，新增 3 张表 |
| 资产存储 | 现有 OSS + 缩略图 |
| 图像编辑 | 复用 Konva 能力 |
| 工作流运行 | 自研 Graph Runner，后端为主 |
| 路由 | `/create/flow` |
| 开发起点 | Phase 0 性能原型验证 |

---

*最后更新：2026-05-01*
