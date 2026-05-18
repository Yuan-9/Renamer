# 照片视频重命名工具开发技术文档

## 1. 文档目标

本文档基于 `docs/requirements-analysis.md`，定义首期开发的技术方案、模块边界、关键算法、IPC 契约、测试策略和打包发布方式。

项目定位为 Windows 桌面端批量重命名工具，使用 JavaScript + React + Electron 开发。应用只修改文件名或文件路径，不修改照片、视频内容和元数据。

## 2. 技术版本基线

版本选择原则：

1. 选择官方稳定版本，不使用 alpha、beta、nightly。
2. 优先选择业界存量更大、资料更多、第三方库兼容更充分的版本。
3. 不选择已经 EOL 的运行时或 Electron 版本，即使它们历史使用量更大。
4. 生产依赖锁定主版本和关键小版本，使用 lockfile 固定实际安装的补丁版本。
5. Electron 无长期 LTS，需在开发周期内定期评估升级到当前受支持稳定线，避免落入 EOL。

截至 2026-05-17，推荐首期采用以下“业界主流保守”组合：

| 技术 | 建议版本 | 用途 | 选择理由 |
| --- | --- | --- | --- |
| Node.js | `22.x LTS` | 开发、构建、脚本运行 | 相比 Node 24，Node 22 在企业项目和 CI 环境中存量更大，仍处于 LTS |
| Electron | `41.x` | Windows 桌面壳、主进程、预加载脚本 | 在官方支持期内的保守版本；更老的 Electron 39 及以下已 EOL，不建议新项目使用 |
| React | `18.3.1` | 渲染进程 UI | React 18 是当前企业存量最多的 React 主版本，第三方库兼容最充分 |
| Vite | `6.4.x` | 前端开发服务器和构建 | Vite 6 生态成熟，官方仍回传安全补丁，比 Vite 7/8 更保守 |
| electron-builder | `26.x` | Windows 安装包打包 | Electron 桌面应用常用打包方案 |
| Vitest | `3.x` | 单元测试 | 与 Vite 6 生态搭配更常见 |
| Playwright | `1.x` | Electron/UI 集成测试 | 可验证桌面窗口和关键交互 |

推荐包管理器使用 `pnpm`，以获得更快安装速度和更严格的依赖解析。若团队更熟悉 npm，也可以使用 npm，但需要提交 `package-lock.json`。

兼容性确认：

1. Node.js `22.x LTS` 是官方建议可用于生产的 LTS 版本，适合作为开发和 CI 运行时。
2. Electron `41.x` 内置 Node.js 24 系列，Electron `41.0.0` 对应 Node.js `24.14.0`；后续 `41.x` 补丁版本可能继续升级 Node.js 补丁版本。
3. Vite `6.4.x` 与 `@vitejs/plugin-react` `4.x` 搭配使用，React `18.3.1` 是官方为迁移 React 19 准备的 React 18 最后稳定线。
4. Electron 渲染进程最终加载的是 Vite 构建后的静态资源，React/Vite 与 Electron 主进程之间不存在运行时版本绑定。
5. Electron 40 虽然仍在短期支持内，但距离 EOL 太近；Electron 41 是更合适的保守起点。
6. 由于开发环境 Node 22 与 Electron 运行时 Node 24 不完全一致，主进程和预加载脚本代码只使用 Node 22 已支持的 API，避免出现开发可用但 CI 或构建脚本不可用的情况。

## 3. 总体架构

应用采用 Electron 三层结构：

```text
┌──────────────────────────────────────────────┐
│ React Renderer                               │
│ 设置表单、预览表格、过滤、进度、结果展示      │
└───────────────────────▲──────────────────────┘
                        │ 安全 IPC
┌───────────────────────┴──────────────────────┐
│ Preload                                       │
│ 暴露 window.renamer API，屏蔽 Node 能力       │
└───────────────────────▲──────────────────────┘
                        │ ipcRenderer / ipcMain
┌───────────────────────┴──────────────────────┐
│ Electron Main                                 │
│ 文件扫描、ExifTool、命名预览、重命名执行、日志 │
└──────────────────────────────────────────────┘
```

主进程负责所有本地敏感操作：

1. 系统文件夹选择。
2. 文件系统扫描。
3. 元数据读取。
4. 命名预览计算。
5. 冲突检测。
6. 批量重命名或移动。
7. 操作日志生成和撤销。

渲染进程只负责用户界面和用户输入，不直接访问 Node.js 文件系统 API。

## 4. 推荐目录结构

```text
Renamer/
├─ docs/
│  ├─ requirements-analysis.md
│  └─ development-technical-design.md
├─ package.json
├─ pnpm-lock.yaml
├─ electron-builder.yml
├─ vite.config.js
├─ src/
│  ├─ main/
│  │  ├─ index.js
│  │  ├─ ipc.js
│  │  ├─ dialog-service.js
│  │  ├─ scan-service.js
│  │  ├─ metadata-service.js
│  │  ├─ naming-service.js
│  │  ├─ rename-service.js
│  │  ├─ log-service.js
│  │  └─ settings-service.js
│  ├─ preload/
│  │  └─ index.js
│  ├─ renderer/
│  │  ├─ main.jsx
│  │  ├─ App.jsx
│  │  ├─ api/
│  │  │  └─ renamer-api.js
│  │  ├─ components/
│  │  │  ├─ Toolbar.jsx
│  │  │  ├─ SettingsPanel.jsx
│  │  │  ├─ RenameModePanel.jsx
│  │  │  ├─ FilePreviewTable.jsx
│  │  │  ├─ StatusFilter.jsx
│  │  │  └─ BottomBar.jsx
│  │  ├─ state/
│  │  │  └─ use-renamer-store.js
│  │  └─ styles/
│  │     └─ app.css
│  └─ shared/
│     ├─ constants.js
│     ├─ schemas.js
│     └─ path-utils.js
└─ tests/
   ├─ unit/
   ├─ integration/
   └─ fixtures/
```

说明：

1. `src/main` 放置主进程服务，所有文件系统写操作只能出现在这里。
2. `src/preload` 只暴露经过白名单限制的 API。
3. `src/renderer` 放置 React 代码。
4. `src/shared` 放置纯函数、常量和可在主进程/渲染进程复用的数据校验。
5. `tests/fixtures` 放置测试用沙盒文件，不使用用户真实照片视频作为自动化测试样本。

## 5. 依赖建议

核心依赖示例：

```json
{
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.0",
    "electron": "^41.0.0",
    "vite": "^6.4.0",
    "vitest": "^3.2.0"
  }
}
```

辅助依赖在初始化项目时安装最新稳定版，并通过 lockfile 固定实际版本：

| 依赖 | 用途 |
| --- | --- |
| `exiftool-vendored` | 随应用调用 ExifTool，降低用户手动安装成本 |
| `@tanstack/react-virtual` | 预览列表虚拟滚动，支撑数千文件 |
| `zustand` | 管理设置、扫描状态、文件列表、过滤条件和执行进度 |
| `lucide-react` | 工具栏图标和按钮图标 |
| `electron-builder` | Windows 安装包打包 |
| `vitest` | 命名规则、模板解析、冲突分配等纯逻辑测试 |
| `playwright` | 验证 Electron 窗口、选择目录后的 UI 状态、执行确认流程 |

## 6. 安全模型

Electron 配置必须遵循以下规则：

```js
webPreferences: {
  preload: path.join(__dirname, "../preload/index.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

安全约束：

1. 渲染进程不能直接使用 `fs`、`path`、`child_process`。
2. IPC 通道使用白名单，禁止动态拼接任意通道名。
3. 所有来自渲染进程的参数必须校验。
4. 执行重命名前必须基于最新文件系统状态重新检查目标路径。
5. 默认禁止覆盖已有文件。
6. 日志中记录完整路径，但 UI 可根据空间展示文件名或相对路径。

## 7. IPC API 设计

预加载脚本暴露统一 API：

```js
window.renamer = {
  selectInputDirectory,
  selectOutputDirectory,
  scanDirectory,
  buildPreview,
  executeRename,
  cancelCurrentTask,
  exportLog,
  undoLastRun,
  loadSettings,
  saveSettings,
  onTaskProgress
};
```

IPC 通道建议：

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `dialog:select-input-directory` | renderer -> main | 选择输入目录 |
| `dialog:select-output-directory` | renderer -> main | 选择输出目录 |
| `scan:start` | renderer -> main | 扫描目录并读取元数据 |
| `preview:build` | renderer -> main | 根据设置重新生成预览 |
| `rename:execute` | renderer -> main | 执行重命名或移动 |
| `task:cancel` | renderer -> main | 取消当前扫描或执行任务 |
| `log:export` | renderer -> main | 导出本次日志 |
| `rename:undo-last` | renderer -> main | 撤销上一次成功操作 |
| `settings:load` | renderer -> main | 加载用户设置 |
| `settings:save` | renderer -> main | 保存用户设置 |
| `task:progress` | main -> renderer | 推送进度和阶段变化 |

所有响应对象使用统一结构：

```js
{
  ok: true,
  data: {}
}
```

失败响应：

```js
{
  ok: false,
  error: {
    code: "TARGET_EXISTS",
    message: "目标文件已存在",
    detail: {}
  }
}
```

## 8. 数据模型

内部数据使用 JavaScript 对象，并通过 JSDoc 或 schema 校验维护结构。

```js
/**
 * @typedef {Object} RenameItem
 * @property {string} id
 * @property {string} originalPath
 * @property {string} directory
 * @property {string} originalName
 * @property {string} extension
 * @property {"photo"|"video"|"unknown"} mediaType
 * @property {string|null} capturedAt
 * @property {number} millisecond
 * @property {string|null} timeSource
 * @property {string|null} proposedName
 * @property {string|null} proposedPath
 * @property {"in-place"|"move-to-directory"} renameMode
 * @property {string|null} outputDirectory
 * @property {number|null} conflictIndex
 * @property {"ready"|"conflict"|"warning"|"error"|"skipped"|"renamed"} status
 * @property {string=} message
 */
```

设置模型：

```js
/**
 * @typedef {Object} RenameSettings
 * @property {string} template
 * @property {"preserve"|"lower"|"upper"} extensionCase
 * @property {"in-place"|"move-to-directory"} renameMode
 * @property {string|null} outputDirectory
 * @property {boolean} recursive
 * @property {boolean} useModifiedTimeFallback
 * @property {"all"|"photo"|"video"} mediaFilter
 */
```

默认设置：

```js
{
  template: "{yyyy}_{MMdd}_{HHmmss}_{SSS}_{index}",
  extensionCase: "preserve",
  renameMode: "in-place",
  outputDirectory: null,
  recursive: true,
  useModifiedTimeFallback: false,
  mediaFilter: "all"
}
```

## 9. 核心业务流程

### 9.1 首次扫描流程

```text
选择输入目录
  -> 主进程校验目录存在
  -> 扫描文件路径
  -> 过滤支持格式
  -> 对支持格式读取元数据
  -> 生成基础 RenameItem
  -> 根据当前设置生成预览名
  -> 返回列表和统计
```

扫描过程需要分阶段推送进度：

1. `collecting-files`：枚举目录。
2. `reading-metadata`：读取 ExifTool 和文件系统时间。
3. `building-preview`：生成新名称并检测冲突。
4. `completed`：扫描完成。
5. `cancelled`：用户取消。
6. `failed`：任务失败。

### 9.2 实时预览流程

当用户修改命名模板、扩展名大小写、重命名模式、输出目录或兜底时间设置时：

```text
renderer 更新设置
  -> 防抖 150ms
  -> 调用 preview:build
  -> main 重新计算 proposedName/proposedPath/conflictIndex/status
  -> renderer 替换预览结果
```

预览计算应使用已有元数据，不重复调用 ExifTool。

### 9.3 执行重命名流程

```text
点击执行重命名
  -> renderer 弹出确认
  -> main 获取 ready 项
  -> 执行前重新检查目标目录和目标路径
  -> 逐个 fs.rename
  -> 每项记录成功或失败
  -> 写入操作日志
  -> 返回汇总结果
```

执行策略：

1. 首期采用串行执行，降低文件系统冲突风险。
2. 每个文件执行前重新确认源文件存在、目标文件不存在。
3. 单个文件失败不终止整个批次。
4. 失败项记录错误码和错误信息。
5. 执行后列表状态更新为 `renamed`、`error` 或 `skipped`。

## 10. 文件扫描设计

支持格式常量放在 `src/shared/constants.js`：

```js
export const PHOTO_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff",
  ".webp", ".dng", ".raw", ".cr2", ".cr3", ".nef", ".arw",
  ".orf", ".rw2"
];

export const VIDEO_EXTENSIONS = [
  ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mts",
  ".m2ts", ".3gp"
];
```

扫描实现要求：

1. 使用 `fs.promises.opendir` 递归遍历，避免一次性读取超大目录造成内存峰值。
2. 跳过目录符号链接，防止循环扫描。
3. 文件扩展名匹配统一转为小写。
4. 不支持格式可不读取元数据，但在预览中可显示为 `skipped`。
5. 中文路径、空格路径必须全流程使用原始字符串，不自行转义。

## 11. 元数据读取设计

优先使用 `exiftool-vendored`。读取字段建议：

| 类型 | 字段 | 用途 |
| --- | --- | --- |
| 照片 | `DateTimeOriginal` | 首选拍摄时间 |
| 照片 | `CreateDate` | 备选拍摄/创建时间 |
| 照片 | `ModifyDate` | 备选修改时间 |
| 照片 | `SubSecTimeOriginal` | 首选亚秒 |
| 照片 | `SubSecCreateDate` | 备选亚秒 |
| 视频 | `CreateDate` | 视频容器创建时间 |
| 视频 | `MediaCreateDate` | 视频媒体创建时间 |
| 视频 | `TrackCreateDate` | 视频轨道创建时间 |
| 文件系统 | `birthtime` | 文件创建时间 |
| 文件系统 | `mtime` | 文件修改时间 |

时间选择优先级：

1. `EXIF DateTimeOriginal`。
2. `EXIF CreateDate`。
3. `EXIF ModifyDate`。
4. `Video creation_time`，由视频相关字段映射。
5. `File created time`。
6. `File modified time`，仅当用户允许兜底时使用。

异常处理：

1. ExifTool 不存在或启动失败：返回可读错误，允许用户仅基于文件系统时间继续。
2. 单文件读取超时：该文件标记为 `error`，不影响其他文件。
3. 元数据时间解析失败：尝试下一个来源。
4. 完全无可用时间：标记为 `skipped` 或 `error`，不生成最终文件名。

并发策略：

1. 元数据读取使用受限并发，默认并发数为 `min(4, CPU 核心数)`。
2. 可在设置中后续加入高级并发选项。
3. 大批量扫描中每处理固定数量文件推送一次进度，避免 IPC 过于频繁。

## 12. 命名模板设计

模板默认值：

```text
{yyyy}_{MMdd}_{HHmmss}_{SSS}_{index}
```

支持变量：

| 变量 | 示例 |
| --- | --- |
| `{yyyy}` | `2026` |
| `{MM}` | `05` |
| `{dd}` | `17` |
| `{MMdd}` | `0517` |
| `{HH}` | `19` |
| `{mm}` | `30` |
| `{ss}` | `25` |
| `{HHmmss}` | `193025` |
| `{SSS}` | `128` |
| `{index}` | `00` |
| `{original}` | `IMG_0001` |

模板校验规则：

1. 模板不能为空。
2. 模板不能包含 Windows 非法文件名字符：`< > : " / \ | ? *`。
3. 未识别变量保留为错误，不静默输出。
4. 扩展名不允许写入模板，统一由系统追加。
5. `{index}` 首期建议强制存在；如果后续允许省略，也必须内部保留冲突处理能力。

毫秒处理：

```text
"1"   -> "100"
"12"  -> "120"
"128" -> "128"
无    -> "000"
```

扩展名处理：

```js
function applyExtensionCase(extension, mode) {
  if (mode === "lower") return extension.toLowerCase();
  if (mode === "upper") return extension.toUpperCase();
  return extension;
}
```

## 13. 冲突处理算法

冲突需要同时考虑预览列表内部冲突和目标目录已存在文件。

算法输入：

1. 待处理文件列表。
2. 当前设置。
3. 目标目录已有文件名集合。

排序规则：

```text
目标目录升序
拍摄时间升序
原文件名升序
原完整路径升序
```

处理步骤：

```text
for each group by targetDirectory:
  usedNames = existing file names in targetDirectory
  sortedItems = sort(items)

  for each item in sortedItems:
    base = renderTemplateWithoutIndex(item)
    index = 0

    while true:
      indexText = formatIndex(index)
      candidate = renderTemplateWithIndex(item, indexText) + extension

      if candidate not in usedNames:
        assign candidate to item
        usedNames.add(candidate)
        break

      index += 1
```

序号格式：

1. `0` 到 `99` 使用两位：`00`、`01`、`99`。
2. `100` 起自然扩展为三位及以上：`100`、`101`。

Windows 大小写注意：

1. 冲突集合比较应默认大小写不敏感。
2. 原地重命名如果只是大小写变化，需要走临时文件名两段式重命名。
3. 临时文件名必须同目录唯一，例如：`.renamer-tmp-${id}.tmp`。

## 14. 重命名执行设计

执行使用 Node.js `fs.promises.rename`。

原地重命名：

```text
D:\Photos\IMG_0001.JPG
-> D:\Photos\2026_0517_193025_128_00.JPG
```

移动到指定目录：

```text
D:\Photos\IMG_0001.JPG
-> D:\Output\2026_0517_193025_128_00.JPG
```

执行前检查：

1. 源文件存在。
2. 目标目录存在。
3. 目标目录可写。
4. 目标路径不存在。
5. 源路径和目标路径不是同一路径，除非仅大小写变化。
6. 当前 item 状态为 `ready`。

错误码建议：

| 错误码 | 说明 |
| --- | --- |
| `SOURCE_NOT_FOUND` | 源文件不存在 |
| `TARGET_EXISTS` | 目标文件已存在 |
| `TARGET_DIRECTORY_MISSING` | 目标目录不存在 |
| `PERMISSION_DENIED` | 无权限 |
| `CASE_ONLY_RENAME_FAILED` | 仅大小写变化重命名失败 |
| `RENAME_FAILED` | 通用重命名失败 |
| `TASK_CANCELLED` | 用户取消 |

取消策略：

1. 扫描阶段可立即停止后续任务。
2. 执行阶段只在两个文件之间响应取消，不中断正在进行的单个文件系统操作。
3. 已成功重命名的文件保留结果，并写入日志。

## 15. 操作日志与撤销

每次执行生成一个日志文件，默认放在应用数据目录：

```text
%APPDATA%\Renamer\logs\rename-20260517-193025.json
```

日志结构：

```js
{
  appVersion: "0.1.0",
  startedAt: "2026-05-17T11:30:25.128Z",
  finishedAt: "2026-05-17T11:30:31.200Z",
  settings: {},
  summary: {
    total: 128,
    success: 124,
    failed: 1,
    skipped: 3
  },
  entries: [
    {
      id: "item-id",
      originalPath: "D:\\Photos\\IMG_0001.JPG",
      targetPath: "D:\\Photos\\2026_0517_193025_128_00.JPG",
      status: "success",
      error: null
    }
  ]
}
```

撤销规则：

1. 首期只支持撤销上一次执行。
2. 只撤销日志中 `success` 的条目。
3. 撤销前检查当前路径存在、原路径不存在。
4. 撤销也必须生成新的日志。
5. 如果任一条撤销失败，继续处理后续条目并汇总失败原因。

## 16. 用户界面设计

首屏即为工具界面，不做营销页或欢迎页。

布局：

1. 顶部工具栏：选择文件夹、重新扫描、清空列表、设置入口。
2. 设置区：命名模板、扩展名大小写、递归扫描、兜底时间、媒体类型过滤。
3. 模式区：原地重命名、移动到指定目录。
4. 中央表格：原文件名、新文件名、类型、拍摄时间、时间来源、状态、提示。
5. 底部操作栏：统计、执行重命名、导出日志。

交互细节：

1. 选择输入目录后自动开始扫描。
2. 扫描时先显示文件名，再逐步补齐元数据和预览名。
3. 修改模板后实时刷新预览。
4. 模板错误时禁用执行按钮，并在设置区显示错误。
5. 移动模式下输出目录必填。
6. 执行前弹出确认，说明将处理的文件数量。
7. 执行中显示进度条和取消按钮。
8. 执行完成后显示成功、失败、跳过数量。

视觉原则：

1. 不显示缩略图。
2. 表格优先保证文件名对比效率。
3. 使用紧凑、稳定的工具型界面。
4. 状态用颜色和文本同时表达，避免仅靠颜色区分。
5. 表格使用虚拟滚动，大量文件时保持流畅。

## 17. 设置持久化

设置存储位置：

```text
%APPDATA%\Renamer\settings.json
```

保存内容：

1. 最近使用的命名模板。
2. 扩展名大小写策略。
3. 是否递归扫描。
4. 是否允许文件修改时间兜底。
5. 媒体类型过滤。
6. 最近窗口大小。
7. 深色模式偏好。

不建议保存：

1. 用户最近输入目录，除非后续明确需要。
2. 输出目录，可后续通过“记住输出目录”选项控制。
3. 文件列表扫描结果。

## 18. 测试策略

单元测试重点：

1. 模板解析和非法字符校验。
2. 日期格式化。
3. 毫秒补零。
4. 扩展名大小写处理。
5. 冲突序号分配。
6. Windows 大小写不敏感冲突判断。
7. 时间来源优先级选择。

集成测试重点：

1. 沙盒目录扫描。
2. 原地重命名。
3. 移动到指定目录。
4. 目标文件已存在时不覆盖。
5. 仅大小写变化重命名。
6. 失败项写入日志。
7. 撤销日志反向执行。

UI 测试重点：

1. 启动后主界面可见。
2. 选择目录后列表出现。
3. 修改模板后新文件名刷新。
4. 模板非法时执行按钮禁用。
5. 切换移动模式后输出目录控件出现。

## 19. 打包发布

使用 `electron-builder` 打包 Windows 安装包。

目标产物：

```text
dist/
├─ Renamer Setup 0.1.0.exe
└─ latest.yml
```

建议配置：

```yaml
appId: com.local.renamer
productName: Renamer
directories:
  output: dist
files:
  - dist-renderer/**
  - dist-main/**
  - package.json
win:
  target:
    - nsis
  artifactName: "${productName} Setup ${version}.${ext}"
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
```

ExifTool 打包：

1. 优先通过 `exiftool-vendored` 随应用分发。
2. 打包后在干净 Windows 环境验证无需用户手动安装 ExifTool。
3. 启动时执行一次健康检查，失败时给出明确提示。

## 20. 开发里程碑

### M1：项目骨架

1. 初始化 Electron + React + Vite。
2. 配置主进程、预加载脚本、渲染进程。
3. 建立安全 IPC 通道。
4. 完成主界面静态布局。

验收：应用可启动，窗口显示完整工具界面。

### M2：扫描与元数据

1. 实现目录选择。
2. 实现递归扫描和格式过滤。
3. 接入 ExifTool。
4. 实现时间来源优先级。
5. 显示扫描进度。

验收：选择目录后可展示文件列表、拍摄时间和时间来源。

### M3：预览命名

1. 实现模板解析。
2. 实现毫秒处理。
3. 实现扩展名大小写策略。
4. 实现冲突序号分配。
5. 实现实时预览刷新。

验收：默认生成 `YYYY_MMDD_HHmmss_SSS_NN.ext` 格式名称，冲突稳定递增。

### M4：批量执行

1. 实现执行前校验。
2. 实现原地重命名。
3. 实现移动到指定目录。
4. 实现执行进度和取消。
5. 实现执行结果汇总。

验收：点击执行后只改变文件名或路径，不修改文件内容。

### M5：日志、撤销与打包

1. 实现 JSON 操作日志。
2. 实现导出日志。
3. 实现撤销上一次重命名。
4. 完成 Windows 安装包。
5. 完成核心单元测试和集成测试。

验收：可安装运行，可通过日志追踪每次操作，可撤销上一次成功执行。

## 21. 首期风险与处理

| 风险 | 影响 | 处理方案 |
| --- | --- | --- |
| 不同设备元数据字段差异大 | 拍摄时间识别不稳定 | 使用 ExifTool，多字段兜底，预览显示来源 |
| Windows 大小写重命名特殊 | 部分文件重命名失败 | 两段式临时文件名处理 |
| 大量文件 UI 卡顿 | 用户体验差 | 扫描并发限制、IPC 节流、虚拟滚动 |
| 目标文件冲突 | 覆盖用户文件风险 | 预览和执行前双重检测，默认禁止覆盖 |
| ExifTool 打包失败 | 用户无法读取元数据 | 使用 vendored 包，打包后做健康检查 |
| 用户误操作 | 批量文件难恢复 | 执行前确认、日志、撤销 |

## 22. 待确认技术问题

1. 默认日期字段是否继续使用 `MMdd`，还是改为 `MM_dd`。
2. 是否首期就内置 ExifTool。当前建议首期内置。
3. 移动到指定目录时是否需要保留原目录结构。当前首期建议不保留。
4. 是否需要从 0.1.0 起支持自动更新。当前建议首期不做。
5. 是否需要保存最近输入目录。当前建议默认不保存，降低隐私顾虑。

## 23. 官方参考资料

1. Node.js Releases：https://nodejs.org/en/about/previous-releases
2. Electron Release Schedule：https://releases.electronjs.org/schedule
3. React 19 Upgrade Guide，包含 React 18.3 说明：https://react.dev/blog/2024/04/25/react-19-upgrade-guide
4. Vite Releases：https://vite.dev/releases.html
5. Vite 6 Documentation：https://v6.vite.dev/
