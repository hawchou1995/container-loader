# container-loader 设计文档

- 日期：2026-08-22
- 状态：待审阅（用户 review gate）
- 参照原型：https://zhangdezhi.ficp.fun/（手动装柜工具）

## 1. 目标

基于参照站（手动 3D 装柜工具）开发一版**完整装箱优化**桌面软件：

- 多箱型混装、重量/承压约束、多柜规划
- 手动 3D 摆柜 + 一键自动装载（启发式 + 局部搜索迭代）
- 导出 PDF 方案报告 / PNG 截图 / Excel 装箱明细 / HTML 可视化报告
- 打包为 EXE，发布到 GitHub Release

## 2. 已确认决策（grill 结论）

| # | 分支 | 决策 |
|---|------|------|
| 1 | 功能范围 | C 档：完整装箱优化。3D 装箱 NP-Hard，算法采用启发式+局部搜索逼近最优，报告与体积上界差距，不承诺数学最优 |
| 2 | 技术栈 | Electron + three.js + electron-builder（NSIS 安装包 + portable zip 双发） |
| 3 | 数据持久化 | 本地 JSON（箱型库/柜型库/装柜方案，含 .bak 自动备份） |
| 4 | 导出产物 | PDF 方案报告 + PNG/JPEG 截图 + Excel 装箱明细 + HTML 可视化报告，全做 |
| 5 | 发布规范 | GitHub 公开仓库 + NSIS Setup.exe + portable.zip；仓库名 `container-loader`；License MIT |
| 6 | 目标架构 | Windows x64 单架构 |
| 7 | 算法核心 | 体积优先降序 → DBL 放置 → 剩余空间分割 → 局部搜索迭代（随机扰动 N 轮取最优） |
| 8 | 承压约束 | 每箱型可设最大堆叠层数/单箱承压，算法自动校验 |
| 9 | 多柜规划 | 输入总需求 → 自动逐柜分装（贪心填柜），每柜可手动微调 |
| 10 | UI 布局 | 沿用参考站：左栏箱型/柜型管理，中央 3D 场景，右栏装载信息+操作 |

## 3. 功能清单

### 3.1 箱型管理
- 箱型 CRUD：长×宽×高（mm）、重量（kg）、颜色、最大堆叠层数/单箱承压
- 内置常见箱型模板

### 3.2 柜型管理
- 内置：20GP / 40GP / 40HQ / 45HQ（内径 + 最大载重）
- 自定义柜型 CRUD

### 3.3 装柜
- 手动模式（继承参考站）：3D 场景拖拽放置、Q/E 旋转 90°、吸附地面/顶面/侧面、锁定/解锁柜、分层复制、六视图、滚轮缩放、Delete 删除
- 自动模式：输入各箱型数量 → 自动分柜装载 → 生成每柜布局
- 约束：体积利用率、载重、承压（堆叠层数）

### 3.4 统计与导出
- 每柜：已装体积/容积占比/已装总重/剩余空间
- 导出 PDF：柜型参数、装载率、箱型分布、逐层装载明细
- 导出 PNG：3D 截图 + 六视图
- 导出 Excel：装箱明细（箱型、坐标、旋转、层）
- 导出 HTML：自包含单文件可视化报告

### 3.5 数据持久化
- 箱型库/柜型库：`data/boxes.json`、`data/containers.json`
- 方案文件：`.cload` 格式（JSON），支持新建/打开/另存
- 自动备份：保存时生成 `*.bak`

## 4. 架构

```
container-loader/
├── package.json
├── electron/
│   ├── main.js            # Electron 主进程
│   ├── preload.js         # IPC 桥
│   └── export/
│       ├── pdf.js         # PDF 导出
│       ├── excel.js       # Excel 导出
│       └── png.js         # PNG 截图
├── src/
│   ├── index.html
│   ├── css/
│   ├── js/
│   │   ├── app.js         # 应用入口
│   │   ├── state.js       # 状态管理
│   │   ├── storage.js     # JSON 持久化
│   │   ├── packer.js      # 自动装载算法
│   │   ├── scene3d.js     # three.js 3D 场景
│   │   ├── ui.js          # UI 逻辑
│   │   └── export.js      # 导出触发
│   └── lib/               # three.js 等第三方库
├── assets/                # 图标
├── data/                  # 运行时数据目录
└── build/                 # electron-builder 输出
```

## 5. 技术要点

- **three.js**：3D 场景渲染（拖拽、拾取、旋转）
- **装箱算法**：`packer.js` 实现 DBL + 空间分割 + 局部搜索（多轮随机扰动取最优），输入箱型清单与柜型 → 输出每柜布局（坐标、旋转、层）
- **PDF**：使用 Electron 主进程打印渲染好的报告 HTML 到 PDF（`webContents.printToPDF`，零额外依赖）
- **Excel**：CSV 或 SheetJS 生成
- **IPC**：contextBridge + preload 隔离

## 6. 里程碑

1. 项目脚手架 + Electron 主进程 + 3D 场景
2. 手动装柜交互（拖拽/旋转/吸附）
3. 自动装载算法（多柜）
4. 数据持久化
5. 导出（PDF/PNG/Excel/HTML）
6. electron-builder 打包 EXE + 发布 GitHub Release
7. 文档（README + 使用教程）

## 7. 发布物

- GitHub 仓库：`container-loader`（公开，MIT）
- Release 资产：
  - `container-loader-Setup-<ver>.exe`（NSIS 安装版）
  - `container-loader-portable-<ver>.zip`（免安装）
  - 源代码（tag）

## 8. 风险

- three.js 拖拽交互复杂度高（拾取 + 吸附），必要时简化拖拽为「选中→坐标面板微调」
- 装箱算法性能：箱数多时局部搜索慢，限制搜索轮数
- printToPDF 依赖 Electron 渲染，打包后需自测
