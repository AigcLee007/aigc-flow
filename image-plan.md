# 图片节点工具栏 — 功能开发计划

> 本文档是 Flow Canvas 图片节点工具栏的完整功能开发规划。
> 工具栏按钮：裁剪 | 多角度 | 重绘 | 打光 | ···更多 | 文件夹 | 下载 | 全屏

---

## 总览

| # | 功能 | 阶段 | 难度 | 依赖 | 新文件 |
|---|------|------|------|------|--------|
| 1 | 下载 | P0 | ⭐ | 无 | — |
| 2 | 全屏查看 | P0 | ⭐⭐ | 无 | — |
| 3 | 裁剪 | P1 | ⭐⭐⭐ | 无 | `ImageCropOverlay.tsx` |
| 4 | 重绘 (Inpaint) | P2 | ⭐⭐⭐⭐ | `/api/edit` | `ImageRepaintOverlay.tsx` |
| 5 | 打光 (Relight) | P2 | ⭐⭐⭐ | Gemini img2img | `ImageLightingOverlay.tsx` |
| 6 | 多角度 | P2 | ⭐⭐⭐ | Gemini img2img | `ImageMultiAngleOverlay.tsx` |
| 7 | 更多菜单 | P1 | ⭐⭐⭐⭐ | 混合 | `ImageMoreMenu.tsx` |
| 8 | 添加到文件夹 | P3 | ⭐⭐⭐⭐ | 素材库模块 | 待定 |

**执行顺序**: 下载 → 全屏 → 裁剪 → 更多菜单 → 重绘 → 打光 → 多角度 → 文件夹

---

## 阶段一：纯前端功能 (P0/P1)

### 1. 下载 (Download)

**目标**: 将节点图片保存到用户本地。

**实现**:
```
FlowNodes.tsx → ImageNodeComponent
  新增 handleDownload():
    1. fetch(d.thumbnailUrl) → blob
    2. URL.createObjectURL(blob) → 临时 <a> 标签
    3. a.download = `image-${id}-${Date.now()}.png`
    4. a.click() → 触发下载
    5. URL.revokeObjectURL() 清理
```

**修改文件**:
- `FlowNodes.tsx`: 在 `download` 按钮添加 `onClick={handleDownload}`

**代码量**: ~20 行

---

### 2. 全屏查看 (Fullscreen)

**目标**: 全屏 Overlay 查看大图。

**实现**:
```
FlowNodes.tsx → ImageNodeComponent
  新增 state: fullscreenOpen
  新增 ImageFullscreenOverlay 组件:
    - createPortal → document.body
    - 黑色背景 rgba(0,0,0,0.92)
    - 居中原图 object-fit:contain, max 90vw/90vh
    - 右上角 X 关闭
    - 点击背景关闭
    - Escape 关闭
```

**修改文件**:
- `FlowNodes.tsx`: 新增 `ImageFullscreenOverlay` 内联组件 + state + 按钮绑定

**代码量**: ~60 行

---

### 3. 裁剪 (Crop) — 基础矩形裁剪

**目标**: 交互式矩形裁剪，支持预设比例。

**实现**:
```
新文件: src/flowCanvas/nodes/ImageCropOverlay.tsx

组件结构:
├─ Portal 全屏 Overlay (createPortal → document.body)
│  ├─ 暗色背景
│  ├─ 图片层 (居中显示原图)
│  ├─ 裁剪框层
│  │  ├─ 虚线矩形边框
│  │  ├─ 四角拖柄 (nw/ne/sw/se)
│  │  ├─ 四边拖柄 (n/s/e/w)
│  │  └─ 框外暗色遮罩
│  └─ 底部工具栏
│     ├─ 比例预设: 自由 | 1:1 | 4:3 | 3:4 | 16:9 | 9:16
│     ├─ 取消按钮
│     └─ 确认按钮

交互逻辑:
  1. 打开时: 裁剪框 = 图片完整区域
  2. 拖拽四角/四边 → 调整裁剪框
  3. 拖拽框内部 → 移动裁剪框
  4. 选择比例预设 → 锁定宽高比
  5. 确认:
     a. canvas = document.createElement('canvas')
     b. canvas.width/height = 裁剪区域实际像素
     c. ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)
     d. canvas.toBlob() → URL.createObjectURL()
     e. 在原节点右侧创建新的 Cropped Image 图片节点
     f. 将原图片节点 out 连线到新图片节点 in，保留原图与逻辑链路

Props:
  interface ImageCropOverlayProps {
    imageUrl: string;
    onConfirm: (croppedUrl: string, width: number, height: number) => void;
    onCancel: () => void;
  }
```

**修改文件**:
- [NEW] `src/flowCanvas/nodes/ImageCropOverlay.tsx` (~200 行)
- `FlowNodes.tsx`: import + state `cropOpen` + 按钮绑定

**代码量**: ~230 行

---

## 阶段二：AI 驱动功能 (P2)

### 4. 重绘 / Inpaint

**目标**: 用户画笔涂抹选区 + 填写 prompt → AI 重绘选区。

**前端实现**:
```
新文件: src/flowCanvas/nodes/ImageRepaintOverlay.tsx

组件结构:
├─ Portal 全屏 Overlay
│  ├─ Canvas 画布 (双层)
│  │  ├─ 底层: 原图
│  │  └─ 顶层: 用户涂抹的 mask (半透明红色)
│  ├─ 左侧工具栏
│  │  ├─ 画笔 (默认选中)
│  │  ├─ 橡皮擦
│  │  ├─ 画笔大小滑块 (5px ~ 100px)
│  │  └─ 清除全部
│  ├─ 底部提示词输入框
│  │  ├─ textarea: "描述你想在选区生成的内容"
│  │  └─ 确认/取消按钮
│  └─ 右上角关闭

交互逻辑:
  1. 用户用画笔在图上涂抹要重绘的区域
  2. 涂抹区域显示为半透明红色覆盖
  3. 橡皮擦可以撤销涂抹
  4. 输入重绘 prompt
  5. 确认时:
     a. 从涂抹 canvas 导出 mask (白色=重绘区, 黑色=保留区)
     b. 原图转 base64
     c. 调用 editImageApi(apiKey, { image, mask, prompt, modelId })
     d. 轮询结果
     e. 成功 → updateNodeData(id, { thumbnailUrl: resultUrl })

Props:
  interface ImageRepaintOverlayProps {
    imageUrl: string;
    nodeId: string;
    onComplete: (resultUrl: string) => void;
    onCancel: () => void;
  }
```

**后端调用链**:
```
ImageRepaintOverlay
  → editImageApi(apiKey, { image, mask, prompt, modelId })
  → services/api.ts → POST /api/edit
  → server.cjs → 上游 API (支持 inpaint)
```

**修改文件**:
- [NEW] `src/flowCanvas/nodes/ImageRepaintOverlay.tsx` (~350 行)
- `FlowNodes.tsx`: import + state + 按钮绑定
- `graphExecutor.ts`: 新增 `runImageEdit()` 函数

**代码量**: ~400 行

---

### 5. 打光 (Relighting)

**目标**: 调整图片光照 (方向/强度/色温)，TapNow 风格 UI。

**前端实现**:
```
新文件: src/flowCanvas/nodes/ImageLightingOverlay.tsx

组件结构:
├─ Portal 全屏 Overlay
│  ├─ 左侧: 原图预览
│  ├─ 右侧控制面板
│  │  ├─ 光源方向 (圆盘拖拽, 12 点钟方向起)
│  │  │  └─ 圆盘中心 = 图片缩略图
│  │  │  └─ 拖拽手柄 = 光源位置
│  │  ├─ 光照强度滑块 (0% ~ 200%)
│  │  ├─ 色温滑块 (冷蓝 ←→ 暖黄, 2700K~7500K)
│  │  └─ 环境光开关
│  └─ 底部: 确认/取消

调用方式:
  将光照参数转化为 prompt:
  "Relight this image with [warm/cool] light from the [direction],
   intensity [value]%, color temperature [value]K"
  + 原图 → Gemini img2img API
```

**后端调用链**:
```
ImageLightingOverlay
  → generateImageApi(apiKey, {
      image: base64Image,
      prompt: lightingPrompt,
      modelId: 'gemini-...'
    })
  → /api/generate → Gemini API
```

**修改文件**:
- [NEW] `src/flowCanvas/nodes/ImageLightingOverlay.tsx` (~250 行)
- `FlowNodes.tsx`: import + state + 按钮绑定

**代码量**: ~280 行

---

### 6. 多角度 (Multi-Angle)

**目标**: 以当前图为参考，生成不同视角的变体。

**前端实现**:
```
新文件: src/flowCanvas/nodes/ImageMultiAngleOverlay.tsx

组件结构:
├─ Portal 全屏 Overlay
│  ├─ 顶部: 原图参考 (缩略图)
│  ├─ 角度选择网格
│  │  ├─ 正面 (默认)    ├─ 左侧 45°
│  │  ├─ 右侧 45°       ├─ 背面
│  │  ├─ 俯视           ├─ 仰视
│  │  ├─ 左侧 90°       └─ 右侧 90°
│  ├─ 结果预览区 (生成后显示)
│  │  └─ 点击任意结果 → 替换节点图片
│  └─ 底部: 生成按钮 / 取消

调用方式:
  prompt = "Generate the same subject from a [angle] view,
            maintain consistency in appearance and style"
  + 原图 → img2img API
```

**修改文件**:
- [NEW] `src/flowCanvas/nodes/ImageMultiAngleOverlay.tsx` (~200 行)
- `FlowNodes.tsx`: import + state + 按钮绑定

**代码量**: ~230 行

---

## 阶段一补充：更多菜单 (P1)

### 7. 更多菜单 (···)

**目标**: 折叠式功能菜单，包含 7 个子功能。

**菜单项及实现方式**:

```
更多菜单
├─ 扩图 (Outpaint)
│  └─ 方向选择 (上/下/左/右/全方向) + prompt
│  └─ 调用: editImageApi({ image, prompt, outpaint_direction })
│
├─ 擦除 (Erase)
│  └─ 复用 Inpaint 组件, prompt 固定为 "remove the selected area seamlessly"
│  └─ 调用: editImageApi({ image, mask, prompt: 擦除prompt })
│
├─ 标注 (Annotate)
│  └─ Canvas 画布叠加绘制层
│  └─ 工具: 箭头/矩形/圆形/文字/马赛克
│  └─ 纯前端, canvas.toBlob() 导出，创建新的标注后图片节点并连线
│
├─ 抠图 (Remove Background)
│  └─ 调用: editImageApi({ image, prompt: "remove background" })
│  └─ 或接入专用 matting API
│
├─ 切分 (Split Grid)
│  └─ 预设: 2×2 / 3×3 / 4×4
│  └─ 纯前端 canvas 切割
│  └─ 每个切片生成新的图片节点, 自动排列在原节点右侧
│
├─ 增强 (Enhance / Upscale)
│  └─ 调用: editImageApi({ image, prompt: "enhance", upscale: true })
│  └─ 或 2x/4x 超分辨率 API
│
└─ 调整像素 (Resize)
   └─ 输入目标宽高 (锁定/解锁比例)
   └─ 纯前端 canvas.drawImage() 缩放
   └─ 创建新的调整后图片节点并连线，保留原图链路
```

**UI 实现**:
```
FlowNodes.tsx → ImageNodeComponent

点击 ··· 按钮:
  显示下拉菜单 (absolute 定位, 在按钮上方弹出)

菜单样式:
├─ 背景: rgba(28,28,38,0.98) + backdrop-blur
├─ 圆角: 16px
├─ 每项: 图标 + 文字, hover 高亮
├─ 分隔线 (纯前端功能 / AI 功能之间)
└─ 动画: opacity + translateY 入场
```

**新文件**:
- [NEW] `src/flowCanvas/nodes/ImageMoreMenu.tsx` — 菜单组件
- 各子功能 Overlay 按需新建:
  - `ImageOutpaintOverlay.tsx` — 扩图
  - `ImageAnnotateOverlay.tsx` — 标注
  - `ImageSplitOverlay.tsx` — 切分
  - `ImageResizeOverlay.tsx` — 调整像素
  - 擦除复用 `ImageRepaintOverlay.tsx` (传入固定 prompt)
  - 抠图/增强 仅需调 API, 无需独立 Overlay

---

## 共享基础设施

### 工具函数 (`src/flowCanvas/utils/imageUtils.ts`)

```typescript
// 图片 URL → base64
export async function imageUrlToBase64(url: string): Promise<string>

// 图片 URL → Blob
export async function imageUrlToBlob(url: string): Promise<Blob>

// Canvas → Blob URL
export function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string>

// 下载图片
export function downloadImage(url: string, filename: string): Promise<void>

// 获取图片自然尺寸
export function getImageNaturalSize(url: string): Promise<{w: number, h: number}>
```

### graphExecutor 扩展

```typescript
// graphExecutor.ts 新增:
export async function runImageEdit(
  nodeId: string,
  editType: 'inpaint' | 'outpaint' | 'erase' | 'enhance' | 'removeBackground',
  params: {
    image: string;       // base64
    mask?: string;       // base64 (inpaint/erase)
    prompt?: string;
    direction?: string;  // outpaint
    scale?: number;      // enhance
  }
): Promise<void>
```

### FlowNodeData 类型扩展 (`types.ts`)

```typescript
// 在 FlowNodeData 中新增:
editHistory?: string[];           // 编辑历史 (URL 栈, 支持撤销)
originalImageUrl?: string;        // 原始未编辑图片
lastEditType?: string;            // 最后一次编辑类型
```

---

## 文件清单

```
src/flowCanvas/
├── nodes/
│   ├── FlowNodes.tsx                 [MODIFY] 主组件, 按钮绑定
│   ├── ImageCropOverlay.tsx          [NEW] 裁剪
│   ├── ImageRepaintOverlay.tsx       [NEW] 重绘/擦除
│   ├── ImageLightingOverlay.tsx      [NEW] 打光
│   ├── ImageMultiAngleOverlay.tsx    [NEW] 多角度
│   ├── ImageMoreMenu.tsx             [NEW] 更多菜单
│   ├── ImageOutpaintOverlay.tsx      [NEW] 扩图
│   ├── ImageAnnotateOverlay.tsx      [NEW] 标注
│   ├── ImageSplitOverlay.tsx         [NEW] 切分
│   └── ImageResizeOverlay.tsx        [NEW] 调整像素
├── utils/
│   └── imageUtils.ts                 [NEW] 图片工具函数
├── runtime/
│   └── graphExecutor.ts              [MODIFY] 新增 runImageEdit
├── store/
│   └── flowCanvasStore.ts            [MODIFY] 可能需要新增 action
└── types.ts                          [MODIFY] FlowNodeData 扩展

services/
└── api.ts                            [已有] editImageApi 可直接使用
```

---

## 开发里程碑

### Sprint 1: 基础功能 (预计 1.5h)
- [x] 工具栏 UI 复刻 (已完成)
- [x] 1.1 下载功能 (~10min)
- [x] 1.2 全屏查看 (~20min)
- [x] 1.3 `imageUtils.ts` 工具函数 (~15min)
- [x] 1.4 裁剪功能 (~40min)
- [ ] 1.5 浏览器验证

### Sprint 2: 更多菜单 — 纯前端部分 (预计 2h)
- [x] 2.1 更多菜单 UI + 交互 (~20min)
- [x] 2.2 调整像素 (~20min)
- [x] 2.3 切分 2×2/3×3/4×4 (~30min)
- [x] 2.4 标注 (~40min)
- [x] 2.5 浏览器验证

#### Sprint 2 完成说明

- 更多菜单已改为 TapNow 风格的向下展开面板，包含调整像素、快速切分、标注等纯前端能力。
- 调整像素会创建新的下游图片节点，并保留原图节点与逻辑连线。
- 快速切分支持 2×2 / 3×3 / 4×4，切片会批量生成图片节点并连接原图。
- 标注已升级为图层编辑器模型，支持选择工具、画笔、形状下拉、文字、马赛克、橡皮、撤销、前进、删除与保存。
- 文字图层支持 TapNow 风格选中框、8 向缩放、旋转、双击编辑、横向/竖向切换。
- 非文字图层支持 hover 高亮、选中框、整体拖动、选择性删除。
- 画笔图层已改为多段路径 `segments`，橡皮支持局部擦除画笔路径与马赛克点集。
- 标注保存会生成新的“标注后的”图片节点，并从原图节点连线到新节点，保留画布逻辑链路。
- Sprint 2 浏览器验证已通过。

### Sprint 3: AI 编辑功能 (预计 3h)
- [ ] 3.1 梳理现有 API 调用链与模型能力边界 (~20min)
- [ ] 3.2 `graphExecutor.ts` 扩展 `runImageEdit`，统一 AI 图片编辑入口 (~30min)
- [ ] 3.3 重绘 (Inpaint)：遮罩绘制 + prompt + 新节点输出 (~70min)
- [ ] 3.4 AI 擦除：复用 Inpaint 遮罩，固定 remove prompt，输出新节点 (~25min)
- [x] 3.5 扩图 (Outpaint)：方向选择 + 画布扩展预览 + AI 补全（第一版已接入）
- [ ] 3.6 抠图：优先确认现有后端/API 能力，再接入 remove background 流程 (~30min)
- [ ] 3.7 增强/超分：确认 API 能力，支持 2×/4× 输出新节点 (~30min)
- [ ] 3.8 浏览器验证

#### Sprint 3 开发顺序建议

1. 先做 `runImageEdit` 与节点输出链路，确保所有 AI 编辑功能都遵循“保留原图、生成新图、自动连线”的统一逻辑。
2. 优先实现 Inpaint，因为 AI 擦除可以复用同一套遮罩与调用链。
3. 再实现 Outpaint，它需要额外处理画布扩展和方向参数，复杂度高于 Inpaint。
4. 最后接入抠图与增强/超分，这两项依赖后端或上游 API 的实际能力，需要先确认接口是否已经可用。

### Sprint 4: 高级 AI 功能 (预计 2h)
- [ ] 4.1 打光 — UI + 圆盘交互 (~40min)
- [ ] 4.2 打光 — Gemini API 对接 (~20min)
- [ ] 4.3 多角度 — UI + 角度选择 (~30min)
- [ ] 4.4 多角度 — API 对接 (~20min)
- [ ] 4.5 浏览器验证

### Sprint 5: 完善 (预计 1h)
- [ ] 5.1 编辑历史 (撤销/重做)
- [ ] 5.2 Loading 状态 + 错误提示统一
- [ ] 5.3 全功能联调
- [ ] 5.4 添加到文件夹 (待素材库模块)

---

## Sprint 3 开发进度（2026-05-03）

- [x] 3.1 已确认现有 AI 编辑调用链：前端已有 `editImageApi`，后端已有 `POST /api/edit`，支持 `image`、`mask`、`prompt` 并兼容即时 URL 与 taskId 轮询。
- [x] 3.2 已新增统一执行入口 `runImageEdit()`：AI 编辑结果会生成新的下游图片节点，并从原图片节点自动连线，保留原图与逻辑链路。
- [x] 3.3 重绘 / Inpaint 第一版已接入：新增 `ImageRepaintOverlay.tsx`，支持图片放大、画笔涂抹遮罩、橡皮修正遮罩、提示词输入、提交后生成新节点。
- [x] 3.4 AI 擦除第一版已接入：复用重绘遮罩 Overlay，使用固定擦除 prompt，输出新的下游图片节点。
- [x] 3.6 抠图第一版已接入入口：更多菜单 `抠图` 会调用统一 AI 编辑链路，具体效果取决于当前后端编辑模型能力。
- [x] 3.7 增强第一版已接入入口：更多菜单 `增强` 会调用统一 AI 编辑链路，具体超分/增强强度取决于当前后端编辑模型能力。
- [x] 3.5 扩图 / Outpaint 第一版已接入：方向选择、扩展画布预览、prompt 输入与新节点输出链路已完成。
- [ ] 3.8 浏览器验证：需要在本地画布中实测重绘遮罩、AI 擦除、增强、抠图的完整提交与结果回填。

### Sprint 3 当前实现说明

- `runImageEdit()` 遵循 TapNow 链路逻辑：原图不替换，编辑结果创建为新的图片节点，并通过 edge 连接到源节点。
- 遮罩导出采用透明区域表示 AI 可编辑区域、非透明区域表示保留区域，优先兼容 OpenAI-style image edit mask。
- AI 擦除与重绘共用同一个遮罩交互组件，后续可继续扩展为局部擦除、扩图、重打光等更复杂编辑模式。
- 构建验证：`npm run build` 已通过；仍存在项目原有 Vite 警告，包括 `.env NODE_ENV=production`、大 chunk、`assetStorage.ts` 动静态混合导入。

### Sprint 3 下一步建议

1. 浏览器实测重绘/擦除：确认 mask 透明语义是否与当前后端默认编辑线路完全匹配。
2. 如果发现模型需要“白色=编辑区域”的 mask，则在 `ImageRepaintOverlay.tsx` 增加 mask 输出模式转换。
3. 开发 `ImageOutpaintOverlay.tsx`：方向选择、扩展画布预览、prompt 输入、调用 `runImageEdit('outpaint')`。
4. 为增强/抠图补独立轻量确认面板：显示点数/模型提示、生成中状态与错误提示，避免误点直接扣点。

### Sprint 3 补充进度（Outpaint）

- [x] 3.5 扩图 / Outpaint 第一版已接入：新增 `ImageOutpaintOverlay.tsx`，支持向左/向右/向上/向下/四周扩展，支持扩展比例滑杆与 prompt 输入。
- 扩图会在前端生成透明扩展画布与 OpenAI-style mask，再调用 `runImageEdit('outpaint')`，结果同样输出为新的下游图片节点。
- 二次构建验证：`npm run build` 已通过。

### Sprint 3 补充进度（确认面板与 Mask 模式）

- [x] 增强 / 抠图已补确认面板：点击更多菜单中的 `增强` 或 `抠图` 时，会先显示预览、模型信息和点数消耗提醒，用户确认后才提交 AI 编辑任务。
- [x] 重绘 / AI 擦除已支持 Mask 输出模式切换：可选择 `透明=编辑区` 或 `白色=编辑区`。
- [x] 扩图已支持 Mask 输出模式切换：扩展区域可按不同模型需要导出为透明编辑区或白色编辑区。
- [x] 新增 Overlay 文案乱码已清理，`src/flowCanvas/nodes/*.tsx` 乱码扫描无命中。
- [x] 构建验证：`npm run build` 已通过。

### Sprint 4 开发进度（打光 Relight）

- [x] 已参考 TapNow 打光录屏抽帧分析 UI：圆形灯光舞台、锥形光束、中心缩略图、亮度/色温滑杆、主光源方向、轮廓光开关、点数提交按钮。
- [x] 新增 `ImageLightingOverlay.tsx`：支持透视/正面切换、亮度、色温、左侧/顶部/右侧/前方/底部/后方主光源、轮廓光、重置与提交。
- [x] 图片节点工具栏 `打光` 已接入 Overlay。
- [x] `graphExecutor.ts` 已扩展 `relight` 编辑类型，提交后生成新的“打光后的”下游图片节点并自动连线。
- [x] 乱码扫描通过，`npm run build` 已通过。

### Sprint 4 下一步

- [ ] 继续开发多角度 Multi-Angle：角度选择面板、参考图预览、prompt 拼接、下游图片节点输出。
- [ ] 等图像生成模型接入后，统一验证 Sprint 3 / Sprint 4 的 AI 输出效果与 prompt 参数映射。

### Sprint 4 打光升级（伪 3D 光照球）

- [x] 打光圆盘已从平面预览升级为伪 3D 光照球。
- [x] 支持直接拖拽球面光源点，按球面投影计算 `x/y/z` 光源向量。
- [x] 拖拽光源点会自动同步右侧 `左侧 / 顶部 / 右侧 / 前方 / 底部 / 后方` 方向按钮。
- [x] 光束宽度、模糊、层级、高光、中心阴影会随光源深度变化，视觉更接近 TapNow 的 3D 滚动灯光控制。
- [x] prompt 中会附带光源向量，方便后续模型对接时更精确表达打光方向。
- [x] 乱码扫描通过，`npm run build` 已通过。

### Sprint 4 多角度 Multi-Angle 进度

- [x] 新增 `ImageMultiAngleOverlay.tsx`：采用 TapNow 风格深色高级面板，包含轨道相机预览、中心参考图、当前视角徽标、角度卡片与补充要求输入。
- [x] 支持 8 个常用视角：正面、左侧 45°、右侧 45°、左侧 90°、右侧 90°、背面、俯视、仰视。
- [x] 多角度 prompt 已自动拼接视角语义，并强调保持主体身份、材质、风格、光照和场景一致性。
- [x] 图片节点工具栏 `多角度` 已接入 Overlay。
- [x] `graphExecutor.ts` 已扩展 `multiAngle` 编辑类型，提交后生成新的“多角度后的”下游图片节点并自动连线。
- [x] 顺手修复 `graphExecutor.ts` 中影响构建和用户可见文案的历史乱码字符串。
- [x] 构建验证：`npm run build` 已通过；仍存在项目原有 Vite 警告，包括 `.env NODE_ENV=production`、大 chunk、`assetStorage.ts` 动静态混合导入。

### Sprint 4 下一步建议（Multi-Angle 后续）

1. 等图像生成模型正式接入后，实测不同视角是否需要更细的参数字段，例如 `camera_angle`、`view_direction`、`reference_strength`。
2. 给 Multi-Angle 增加高级选项：镜头距离、背景一致性强度、主体一致性强度、是否保持原构图。
3. 浏览器验证 Multi-Angle 面板在不同图片比例、不同画布缩放下的显示位置和交互手感。

### Sprint 4 参考 TapNow-PictureEdit 升级

- [x] 已参考开源项目 `harryluo163/TapNow-PictureEdit` 的实现思路：多角度使用 Three.js 立方体/相机球面控制，打光使用 Three.js 球面网格、光源球与 additive 光线。
- [x] 新增 `LightingThreeScene.tsx`：打光 Overlay 改为真实 Three.js 预览，支持拖拽光源、亮度、色温联动光线颜色和强度。
- [x] 新增 `MultiAngleThreeScene.tsx`：多角度 Overlay 改为真实 Three.js 预览，支持主体模式与摄像头模式，拖拽可调整旋转/倾斜。
- [x] `ImageLightingOverlay.tsx` 已接入 Three.js 打光场景，替换原 CSS 伪 3D 光照球。
- [x] `ImageMultiAngleOverlay.tsx` 已接入 Three.js 多角度场景，并补充旋转、倾斜、缩放控制。
- [x] 新增运行时依赖 `three`。
- [x] 乱码扫描通过，`npm run build` 已通过。

### Sprint 4 继续优化方向

1. 对齐 TapNow-PictureEdit 的相机模型细节：圆角相机机身、前后屏幕贴图、连接线深度层级。
2. 对齐 TapNow-PictureEdit 的多角度参数逻辑：主体模式 / 摄像头模式分别维护旋转、倾斜、缩放，并把缩放吸附到特写 / 中等 / 广角三档。
3. 对齐 TapNow-PictureEdit 的打光参数逻辑：亮度吸附到 10 / 50 / 100，色温吸附到 2000 / 3000 / 4000 / 5600 / 7000 / 8000，并在 prompt 与 params 中保留这些离散值。
4. 后续可把 Three.js 场景懒加载，避免 FlowCanvas 首屏 chunk 因 three 增大。

### Sprint 4 高级感细化（吸附档位与参考图贴图）

- [x] 多角度缩放已改为 TapNow 风格三档吸附：`特写 / 中等 / 广角`，滑杆拖动后自动落到 `0 / 50 / 100`。
- [x] 多角度提交参数已补充 `mode / rotation / tilt / zoom / zoomLabel`，后续模型对接可直接读取主体或摄像头变换语义。
- [x] 修正 Multi-Angle Three.js 贴图逻辑：参考图会真实贴到立方体正面，并同步贴到摄像头模型前后屏幕，不再只是普通 2D 预览。
- [x] 打光亮度已改为 TapNow 风格离散档：`10 / 50 / 100`。
- [x] 打光色温已改为 TapNow 风格离散档：`2000 / 3000 / 4000 / 5600 / 7000 / 8000`。
- [x] 打光 Three.js 透视模式已修正：透视模式允许光源进入前后深度，正面模式保持前半球；场景相机会随透视 / 正面切换改变观察角度。
- [x] Three.js 场景回调已改为 ref 保存，避免每次参数变化都销毁重建场景，拖拽手感更稳定。
- [x] 构建验证：`npm run build` 已通过。

---

## 2026-05-03 更新：参考 TapNow-PictureEdit 的体验升级

### 已完成
- 清理 Flow 画布核心入口的乱码文案：顶部工具栏、左侧节点面板、右键菜单、连线菜单、空状态、统计信息、文本节点背景颜色 tooltip。
- 新增全局图片工具状态 `activeImageTool`，把裁剪、调整像素、切片、标注、重绘、擦除、扩图、打光、多角度统一收口，避免多个图片工具面板互相叠加。
- 画布底部控制条替代默认 React Flow 控件：支持小地图开关、适配视图、缩放按钮、缩放滑杆、缩放百分比。
- 小地图改为按需显示，减少画布常驻视觉噪音。
- 右键菜单和连线落点菜单改为统一暗色玻璃质感，并使用 lucide 图标替代乱码/emoji 图标。
- 打光 Overlay 重做为更接近 TapNow 的双栏面板：左侧 3D 光源球，右侧亮度、色温、主光源、轮廓光和积分提交按钮。
- 多角度 Overlay 重做为紧凑双栏面板：主体/摄像头模式、角度快捷芯片、旋转/倾斜/三档缩放、摄像头方向微调按钮。

### 验证
- `npm run build` 通过。
- `http://localhost:5188/create/flow` 返回 200。
- `http://localhost:3355/health` 返回 200。
- MySQL 容器 `image-pro-mysql` 状态 healthy。

### 下一步建议
- 对打光和多角度继续做浏览器实测，重点看面板尺寸、节点附近遮挡关系、3D 球拖拽手感。
- 将 Three.js 场景组件改为懒加载，降低 FlowCanvasPage chunk 体积。
- 把图片工具栏按钮激活态继续细化，让“更多 / 当前工具”状态更接近 TapNow。
- 打光 / 多角度面板已支持优先锚定到当前图片节点附近，空间不足时自动切到节点上方。

### 2026-05-03 补充：打光 / 多角度面板对齐 TapNow

- [x] 多角度与打光 Overlay 的锚点已从图片节点外层容器改为图片卡片本体，避免节点标题、工具栏和连接点影响面板定位。
- [x] 多角度面板已改为更接近 TapNow 的图片下方紧凑面板：标题、重置、主体/摄像头切换、3D 预览、视角芯片和控制区统一收紧。
- [x] 打光面板已收紧为更接近 TapNow 的双栏浮层，并将面板间距从 34px 降到 12px，优先贴近图片节点下方显示。
- [x] 修正 Multi-Angle Three.js 左右方向反转问题：选择左侧时预览向左，选择右侧时预览向右，主体模式与摄像头模式保持一致。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过，2 个测试文件、7 个测试全部通过。

### 2026-05-03 补充：打开工具时自动构图

- [x] 点击 `打光` / `多角度` 时，会先根据当前图片节点尺寸、窗口高度、左侧面板状态和工具面板高度计算目标 viewport。
- [x] 图片过大时自动缩小，图片过小时自动放大，让图片保持在画布上半区，并为下方工具面板预留完整空间。
- [x] 工具面板不再轻易翻到图片上方，优先固定显示在图片卡片正下方，更接近 TapNow 的操作构图。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过。

### 2026-05-03 补充：面板完整显示与控制条 UI 修复

- [x] 多角度面板改为固定 `640 × 360` 可视高度，提交按钮固定在面板右下角，避免被内容撑出窗口。
- [x] 打光面板改为固定 `720 × 404` 可视高度，提交按钮固定在面板右下角，避免底部操作区不可点击。
- [x] 打开 `打光` / `多角度` 时，自动构图现在按真实面板高度计算，并限制图片最大显示宽高，避免缩放到 145% / 150% 后面板被裁掉。
- [x] 多角度参数滑杆已重新排版为更稳定的 `标签 / 滑杆 / 数值` 三列结构，减少文字、滑杆和值互相挤压。
- [x] 左下角画布缩放控制条已收紧为 TapNow 风格：移除常驻百分比文本、加入九宫格按钮形态、调整小地图弹层尺寸与位置。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过。

### 2026-05-03 补充：缩放边界、小地图与 3D 参考图修复

- [x] 画布缩放范围已从 `0.02 ~ 4` 收紧为 `0.18 ~ 2.35`，避免缩到看不清或放大到失控。
- [x] 底部缩放滑杆同步使用相同的最小 / 最大值，按钮和滚轮缩放也受 React Flow `minZoom / maxZoom` 约束。
- [x] 小地图改为 React Flow `bottom-left` 定位，并在左侧宽面板打开时自动右移，避免被侧栏遮挡导致看起来像按钮失效。
- [x] 小地图 mask、边框、节点 stroke 已调整为更清晰的暗色浮层。
- [x] 多角度和打光的 Three.js 预览新增 DOM 参考图兜底层，WebGL texture 因跨域或加载失败时也能显示原参考图，不再只剩白块。
- [x] 打光 / 多角度自动构图进一步降低目标图片最大宽高，给下方工具面板和右下角提交按钮保留更多安全空间。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过。

### 2026-05-03 补充：底部输入与轮廓光说明

- [x] 多角度底部补充信息输入框已给右下提交按钮预留空间，避免输入提示被按钮遮挡。
- [x] 打光轮廓光开关区域已避开右下提交按钮，防止开关被遮挡。
- [x] 轮廓光问号已补 TapNow 风格 hover 说明气泡：`轮廓光仅支持主光位于正位（前/左/右/顶/底）及 45° 标准光位，锁定为背部三点投射`。
- [x] 轮廓光提交参数已增加 `rimLightSetup`：使用 `back-three-point-projection`，投射点为 `rear-left / rear-right / rear-top`，并说明不改变当前主光方向。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过。

### 2026-05-03 修正：撤回错误兜底层与多角度底部遮挡

- [x] 已移除多角度 / 打光 Three.js 场景中的 DOM `<img>` 叠加兜底层，避免参考图与 3D 贴图叠加造成错乱。
- [x] 多角度底部从“绝对定位提交按钮”改为正常 footer 两列布局：左侧补充信息输入，右侧提交按钮。
- [x] 多角度面板高度同步调整为 `640 × 386`，并让自动构图按新高度计算。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过。

---

## Sprint 5 完整规划：收尾与产品化

### Sprint 5 目标

1. 把所有 AI 图片编辑工具的提交、失败、重试体验统一起来。
2. 补齐图片编辑历史的轻量回退能力，避免用户必须手动找上游节点。
3. 完成“添加到文件夹”入口，让工具栏上的文件夹按钮具备可用的第一版能力。
4. 做全功能联调与审查，确保前端编辑、AI 编辑、节点输出、自动连线和工具互斥保持一致。

### 5.1 Loading / Error / Retry 统一

- [x] 新增 `src/flowCanvas/utils/imageEditStatus.ts`，统一 AI 编辑错误消息与重试提示。
- [x] 重绘、AI 擦除、扩图、打光、多角度、增强、抠图确认面板统一失败文案：保留参数，可直接再次提交。
- [x] `runImageEdit()` 失败后会将下游输出节点标记为 `generationStatus: 'error'`、`status: 'error'`，并写入统一错误消息。
- [x] 同一源节点、同一 AI 编辑类型重试时，会复用最近一个失败的下游节点，避免每次重试都堆叠新的失败节点。

### 5.2 编辑历史 / 轻量回退

- [x] 图片节点工具栏新增“回退上一步”按钮，仅在 `editHistory` 存在时可用。
- [x] 回退会把当前图片节点切回上一张历史 URL，并弹出历史栈最后一项。
- [x] 回退时会重新读取图片自然尺寸并同步节点显示尺寸；读取失败时仍保留 URL 回退能力。
- [x] 替换上传图片时会重置 `originalImageUrl`、`editHistory`、`lastEditType` 与文件夹标记，避免新图继承旧图编辑链路。

### 5.3 添加到文件夹

- [x] 新增 `src/flowCanvas/store/imageFolderStore.ts`：本地素材夹 store，支持默认素材夹、新建文件夹、添加图片条目、按文件夹读取条目。
- [x] 新增 `src/flowCanvas/nodes/ImageFolderOverlay.tsx`：文件夹选择、新建文件夹、预览、备注、提交中、成功/失败反馈。
- [x] 文件夹条目会记录图片 URL、可选 IndexedDB assetId、源节点、源项目、原图 URL、最后编辑类型与自然尺寸。
- [x] 成功添加后，当前图片节点会记录 `imageFolderIds`，方便后续素材库模块读取或显示已收藏状态。
- [x] 如果图片无法缓存到 IndexedDB，会降级保存原始 URL，并在成功提示里说明。

### 5.4 全功能联调与审查

- [x] 修复 `ImageAiConfirmOverlay.tsx` 用户可见乱码文案。
- [x] 修复 `nodeFactory.ts` 默认节点标题乱码，新增节点会显示中文标题：文本、图片、视频、音频、上传、图片编辑器、分组。
- [x] 新增 `src/flowCanvas/store/imageFolderStore.test.ts`，覆盖文件夹创建、默认命名、图片加入与计数更新。
- [x] 构建验证：`npm run build` 已通过。
- [x] 单元测试验证：`npm test` 已通过，3 个测试文件、9 个测试全部通过。
- [x] 本地入口验证：`http://localhost:5188/create/flow` 返回 200，`http://localhost:3355/health` 返回 200。
- [ ] 浏览器手测：建议继续验证不同图片比例、不同画布缩放下的工具栏、回退按钮和文件夹 Overlay。

### Sprint 5 代码审查清单

- [x] AI 编辑失败不会清空用户输入，面板停留并允许再次提交。
- [x] AI 编辑重复提交有本地 `submitting` 防护。
- [x] AI 编辑失败重试复用失败输出节点，减少画布噪音。
- [x] 前端编辑与 AI 编辑继续遵循“保留原图，生成下游节点并连线”的主链路。
- [x] 文件夹入口不依赖尚未完成的远程素材库模块，先以本地 store + IndexedDB asset 缓存落地。
- [x] 现有构建警告仍属于项目原有 Vite 警告：`.env NODE_ENV=production`、大 chunk、`assetStorage.ts` 动静态混合导入。

---

## 2026-05-03 性能与产品化优化

### 已完成

- [x] Three.js 预览懒加载：`ImageLightingOverlay.tsx` 与 `ImageMultiAngleOverlay.tsx` 不再静态导入 3D 场景组件，打开打光 / 多角度面板时才加载 Three.js 预览。
- [x] FlowCanvas chunk 拆分：`vite.config.ts` 新增 `three-vendor` manual chunk，构建后 Three.js 独立为 `three-vendor-*.js`。
- [x] FlowCanvas 主 chunk 降低：构建后 `FlowCanvasPage-*.js` 约 `397.97 kB`，Three.js 独立 chunk 约 `517.16 kB`，避免 FlowCanvas 首屏直接吞下 Three.js。
- [x] 素材库正式页面：新增 `/assets`，支持文件夹切换、搜索、图片网格、预览、下载、查看来源信息，读取 Sprint 5 的本地素材夹 store 与 IndexedDB asset 缓存。
- [x] Flow 顶部工具栏新增“素材库”入口。
- [x] AI 模型参数映射：新增 `imageEditModelMapping.ts`，`runImageEdit()` 会按模型族映射 `size / image_size / aspect_ratio / quality / output_format / maskMode` 等字段，并在节点 params 中保留调试映射信息。
- [x] 模型映射正式页面：新增 `/model-mapping`，按模型、线路、编辑类型展示模型族、映射字段和 payload 示例。
- [x] Flow 顶部工具栏新增“模型映射”入口。

### 验证

- [x] `npm test` 已通过，3 个测试文件、9 个测试全部通过。
- [x] `npm run build` 已通过。
- [x] `http://localhost:5188/assets` 返回 200。
- [x] `http://localhost:5188/model-mapping` 返回 200。

### 剩余注意

- 构建仍存在项目原有警告：`.env NODE_ENV=production` 不受 Vite 支持、`assetStorage.ts` 同时静态和动态导入、主 `index` chunk 仍大于 500 kB。
- 下一步若继续做性能，应优先拆 Classic Canvas 入口、ControlPanel、SettingsModal 与历史/批量弹窗，降低主 `index-*.js` 体积。

---

## 2026-05-03 性能优化 Sprint 2：主应用 Chunk 拆分

### 已完成

- [x] Classic Canvas 主画布懒加载：`InfiniteCanvas` 从 `App.tsx` 静态导入改为 `React.lazy()`。
- [x] `ControlPanel` 懒加载：经典画布与移动端作品流打开时才加载控制面板代码。
- [x] 重型弹窗懒加载：`SettingsModal`、`ReversePromptModal`、`BatchProcessModal`、`InstructionsModal` 改为按打开状态条件渲染并动态加载。
- [x] 批量处理弹窗二次拆分：`fileParser` 中的 `xlsx / mammoth` 解析库改为上传文件时才动态加载；`geminiService` 也改为开始批处理时才加载。
- [x] `assetStorage.ts` 混合导入警告已处理：`SettingsModal` 不再动态 import `assetStorage`，改为静态导入，构建时不再出现该混合导入警告。

### 构建结果

- [x] 主 `index-*.js` 从约 `1,940.93 kB` 降到约 `687.33 kB`。
- [x] `ControlPanel` 独立 chunk：约 `80.59 kB`。
- [x] `InfiniteCanvas` 独立 chunk：约 `330.98 kB`。
- [x] `SettingsModal` 独立 chunk：约 `23.31 kB`。
- [x] `BatchProcessModal` 从约 `754.06 kB` 降到约 `15.85 kB`，重型文件解析库独立为 `fileParser-*.js`，约 `738.56 kB`，只在解析 Excel / Word 文件时加载。

### 验证

- [x] `npm test` 已通过，3 个测试文件、9 个测试全部通过。
- [x] `npm run build` 已通过。
- [x] `http://localhost:5188/create/classic` 返回 200。
- [x] `http://localhost:5188/create/flow` 返回 200。
- [x] `http://localhost:5188/assets` 返回 200。
- [x] `http://localhost:5188/model-mapping` 返回 200。

### 剩余注意

- 构建仍提示超过 500 kB 的 chunk：`index-*.js`、`three-vendor-*.js`、`fileParser-*.js`。其中 `three-vendor` 与 `fileParser` 已是按需加载包；主 `index` 后续可继续拆 `MobileView`、`Toolbar`、账号/计费相关模块。
- `.env NODE_ENV=production` 仍是项目原有 Vite 警告，可后续移到 Vite config 或从 `.env` 移除。

---

## 2026-05-03 Flow 文本模型接入

### 已完成

- [x] 新增文本模型配置 `src/config/textModels.ts`，文本节点模型下拉框支持 `gemini-3.1-pro-preview`、`gemini-3.1-flash-lite-preview`、`gpt-5.5`、`gpt-5.4`、`claude-opus-4-6`。用户给出的重复 `gpt-5.5` 已按同一模型去重。
- [x] 文本节点默认模型改为 `gemini-3.1-pro-preview`，新建文本节点会自动带上默认 `modelId`。
- [x] 文本节点底部生成栏从写死的 `Gemini Flash Lite` 改为真实 `<select>` 模型选择。
- [x] 新增前端 `generateTextApi()`，文本生成不再复用图片生成接口。
- [x] `graphExecutor.ts` 文本生成改为调用 `/api/text/generate`，生成成功后写回 `results` 并把首条结果同步到文本节点正文。
- [x] 文本节点连线逻辑第一版：上游文本节点内容会作为 `upstreamTexts` 传入模型，上游图片仍保持原有图片/视频节点输入逻辑。
- [x] 后端新增 `GET /api/text-models` 与 `POST /api/text/generate`。
- [x] Gemini 文本模型复用现有 `GEMINI_API_KEY` 与 Gemini `generateContent` 调用链。
- [x] OpenAI 文本模型支持 `OPENAI_API_KEY` 与 Responses API。
- [x] Claude 文本模型支持 `ANTHROPIC_API_KEY` 或 `CLAUDE_API_KEY` 与 Messages API。

### 验证

- [x] `node --check server.cjs` 已通过。
- [x] `npm run build` 已通过。
- [x] `npm test` 已通过，3 个测试文件、9 个测试全部通过。

### 后续建议

- [ ] 启动前后端后，用真实 key 实测 4 个模型的返回格式、耗时、错误提示与扣点退款路径。
- [ ] 继续扩展节点间连线：文本 → 图片/视频 prompt 增强、多文本上游排序、图片 → 文本的图片理解输入。
