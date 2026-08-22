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

---

## 9. v1.1.0 追加功能（2026-08-22）

用户指令「功能都加上」，在 v1.0.0 基础上新增三项：

1. **箱子 90° 旋转选项**
   - 自动装载面板新增「允许箱子旋转90°」开关（默认开）
   - 算法层 `packContainer/packAll` 增加 `allowRotate` 参数；`orientations()` 在关闭时仅返回标准朝向
   - 单个箱型「禁止旋转」标记（`rotatable=false`）此前 UI 有但算法未生效，本轮真正接入算法（`expandItems` 透传）
2. **重量优先模式**
   - 自动装载面板新增模式选择：体积优先（默认）/ 重量优先
   - `packAll` 增加 `mode` 参数：重量优先按重量降序排箱（同重按体积降序）
   - 评分函数区分模式：重量模式 `packed*1e15 + usedWeight*1e6 + usedVol/1e9`
   - 踩坑：`usedVol` 单位为 mm³（数值巨大），若直接相加会淹没重量项（实测 3.4e9 mm³ 体积 > 75kg×1e6），必须归一化为 m³ 后比较
   - 报告新增「载重利用率」指标
3. **CSV 导入箱型**
   - 左栏「📥 导入 CSV 箱型」按钮 + 格式提示
   - 新增 `src/js/csv.js`（独立模块，Node/浏览器双导出）：BOM/CRLF/引号字段/逗号分号自动探测；中英文表头别名；同名更新（保留 id）、非法行跳过、错误汇总
   - 表头：名称,长,宽,高,重量,最大堆叠,颜色,可旋转

### 附带改进
- 自动装载后数量输入框不再清空（`renderAutoBoxes` 保留已填值，便于改数重跑）
- 冒烟测试扩展：验证三个新 UI 元素在位 + 体积/重量双模式各跑一次装载
- 版本升 v1.1.0，package.json / index.html 同步

### 验证记录
- packer 单测 7/7（新增：旋转开关、rotatable 标记、重量优先评分）
- csv 单测 5/5（BOM/引号/分号/合并/边界）
- Electron 冒烟：boot 无错误，UI 三元素在位，体积模式 130 箱 + 重量模式 130 箱均装载成功，截图正常

## v1.2.0 变更记录（2026-08-22 用户 grill 定稿）

用户反馈两条：① 布局左栏占位不合理、界面有英文；② 箱/柜添加与模拟装柜不便捷。经 grill 四项确认：

1. **布局**：顶部双行 —— 第一行下拉菜单栏（文件/编辑/视图/装载/帮助），第二行快捷工具栏；左栏/右栏收为「库与信息」，视图最大化。
2. **汉化边界**：界面文案全中文；保留标准符号 mm/kg/m³、格式名 PDF/Excel/CSV、柜型代号 40HQ/20GP、按键名 Q/E/Delete、版本号。
3. **加箱子**：箱型卡片单击 = 加入装载 +1，卡片内嵌 ＋/− 步进与数量徽章，与右下角自动装载面板输入框双向同步（`state.loadQty` 单一数据源）。
4. **柜子**：柜型卡片点选 = 设为当前装载柜（`state.currentContainerId`，高亮 + ✓ 当前柜 + 顶栏状态同步）；「一键装载」「添加货柜」均改用当前柜；换柜时已有货先 confirm 清空。

### 验证记录（v1.2.0）
- packer 单测 7/7、csv 单测 5/5 不变
- Electron 冒烟：菜单 5 项（文件,编辑,视图,装载,帮助）、品牌无英文、页面无 ContainerLoader/Auto-load 残留、点卡加箱 81、柜型选中 40HQ|40HQ、关于弹窗可开、双模式装载 131 箱
- 视觉代理复核新截图：双行布局、数量徽章、选中高亮均确认
