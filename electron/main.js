'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const XLSX = require('xlsx');

let mainWindow = null;
let pdfWindow = null;

// 无 GPU 环境（远程/虚拟机）用 SwiftShader 软渲染兜底，保证 WebGL 3D 可用
if (process.env.CL_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

const dataDir = () => {
  // 便携版：exe 同级 data/；安装版：用户目录。统一用 userData 更稳，但便携希望数据跟着走。
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  const dir = portable ? path.join(portable, 'data') : path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '装柜大师 v1.2.0',
    backgroundColor: '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });

  // SMOKE_TEST: 启动后 3.5s 输出渲染进程 console 并退出（用于自动验证）
  if (process.env.SMOKE_TEST === '1') {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const snap = await mainWindow.webContents.executeJavaScript(
            `JSON.stringify({ready: document.readyState, boot: window.__APP_BOOTED__||false, err: window.__APP_ERROR__||null})`
          );
            console.log('[SMOKE] boot=' + snap);
          // 自动执行一次装柜（b1×80, b2×40, b3×10）验证算法+UI 集成
          const loadResult = await mainWindow.webContents.executeJavaScript(`(async () => {
            const inp = [...document.querySelectorAll('#auto-boxes input[data-boxid]')];
            const setV = (id, n) => { const i = inp.find(x => x.dataset.boxid === id); if (i) i.value = n; i.dispatchEvent(new Event('input', {bubbles:true})); };
            setV('b1', 80); setV('b2', 40); setV('b3', 10);
            const ui = {
              rotateChk: !!document.querySelector('#auto-rotate'),
              modeSel: !!document.querySelector('#auto-mode'),
              importBtn: !!document.querySelector('#btn-import-csv'),
              csvScript: typeof window.csvImporter !== 'undefined',
              menubar: document.querySelectorAll('#menus .menu').length,
              menubarText: [...document.querySelectorAll('#menus .menu-btn')].map(b=>b.textContent).join(','),
              brandNoEn: !/ContainerLoader/i.test(document.querySelector('.brand').textContent),
              bodyEnLeft: /ContainerLoader|Auto-?load|One-?click/i.test(document.body.innerText),
              qtyInput: !!document.querySelector('#box-list input[data-qty]'),
              maxBtn: !!document.querySelector('[data-op="max-box"]'),
              fillBtn: !!document.querySelector('#btn-fill-remain'),
              selChk: document.querySelectorAll('#auto-boxes .ab-sel').length,
              boxCardStep: (() => { const c = document.querySelector('#box-list .card'); if(!c) return 'no-card'; c.click(); return window.state.loadQty[c.dataset.id]; })(),
              contSelect: (() => { const cs=[...document.querySelectorAll('#container-list .card')]; if(cs.length<2) return 'only-'+cs.length; cs[1].click(); return window.state.currentContainerId + '|' + (document.querySelector('#container-list .card.active')?.dataset.id || 'no-active'); })()
            };
            document.querySelector('#btn-auto-run').click();
            await new Promise(r => setTimeout(r, 400));
            const r1 = { cabs: window.state.cabinets.length, boxes: window.state.cabinets.reduce((s,c)=>s+c.boxes.length,0), status: document.getElementById('auto-status').textContent };
            // 重量优先模式再跑一次
            document.querySelector('#auto-mode').value = 'weight';
            const modeNow = document.querySelector('#auto-mode').value;
            document.querySelector('#auto-rotate').checked = false;
            const rotNow = document.querySelector('#auto-rotate').checked;
            document.querySelector('#btn-auto-run').click();
            await new Promise(r => setTimeout(r, 400));
            const r2 = { modeNow, rotNow, boxes: window.state.cabinets.reduce((s,c)=>s+c.boxes.length,0), status: document.getElementById('auto-status').textContent };
            // 仅装勾选：取消 b2 → 一键装载只装 b1+b3
            [...document.querySelectorAll('#auto-boxes .ab-sel')].find(c => c.dataset.sel === 'b2').click();
            document.querySelector('#btn-auto-run').click();
            await new Promise(r => setTimeout(r, 400));
            const r3 = { boxes: window.state.cabinets.reduce((s,c)=>s+c.boxes.length,0), boxIds: [...new Set(window.state.cabinets.flatMap(c=>c.boxes.map(b=>b.boxId)))].join(',') };
            // ⚡ 满载测算（第一个箱型）
            document.querySelector('[data-op="max-box"]').click();
            await new Promise(r => setTimeout(r, 500));
            const r4 = { qty: window.state.loadQty['b1'], boxes: window.state.cabinets.reduce((s,c)=>s+c.boxes.length,0), status: document.getElementById('auto-status').textContent };
            // 🧱 填满剩余（恢复全部勾选）
            Object.keys(window.state.loadSel).forEach(k => window.state.loadSel[k] = true);
            document.querySelector('#btn-fill-remain').click();
            await new Promise(r => setTimeout(r, 700));
            const r5 = { boxes: window.state.cabinets.reduce((s,c)=>s+c.boxes.length,0), status: document.getElementById('auto-status').textContent };
            // r6: 三档旋转 UI 链路——编辑 b1 → 选「仅水平转」→ 保存 → 卡片标记 → 恢复 all
            const b1Card = document.querySelector('#box-list [data-id="b1"]');
            b1Card.querySelector('[data-op="edit-box"]').click();
            const radioCount = document.querySelectorAll('input[name="b-rot"]').length;
            document.querySelector('input[name="b-rot"][value="flat"]').checked = true;
            document.querySelector('#b-ok').click();
            const rotAfterFlat = window.state.boxes.find(b=>b.id==='b1').rotatable;
            const cardMark = document.querySelector('#box-list [data-id="b1"] .card-sub').textContent;
            b1Card.querySelector('[data-op="edit-box"]').click();
            document.querySelector('input[name="b-rot"][value="all"]').checked = true;
            document.querySelector('#b-ok').click();
            const rotRestored = window.state.boxes.find(b=>b.id==='b1').rotatable;
            const r6 = { radioCount, rotAfterFlat, cardMark, rotRestored };
            const scene3d = { meshes: window.scene ? window.scene.boxMeshes.length : -1 };
            return JSON.stringify({ ui, r1, r2, r3, r4, r5, r6, scene3d });
          })()`);
          console.log('[SMOKE] autoload=' + loadResult);
          await new Promise(r => setTimeout(r, 800));
          const img = await mainWindow.webContents.capturePage();
          const png = img.toPNG();
          console.log('[SMOKE] png bytes=' + png.length);
          // 截图写到临时目录（打包后 docs/ 在 asar 内不可写）
          try {
            const shot = path.join(os.tmpdir(), 'container-loader-smoke.png');
            fs.writeFileSync(shot, png);
            console.log('[SMOKE] screenshot saved ' + shot);
          } catch (e) {
            console.log('[SMOKE] screenshot skip ' + e.message);
          }
        } catch (e) {
          console.log('[SMOKE] error ' + e.message);
        }
        app.exit(0);
      }, 3500);
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- IPC：存储 ---------------- */

ipcMain.handle('data:readJson', (_e, name) => {
  const file = path.join(dataDir(), name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
});

ipcMain.handle('data:writeJson', (_e, name, obj) => {
  const file = path.join(dataDir(), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); // 自动备份
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  return { ok: true, file };
});

ipcMain.handle('dialog:save', async (_e, opts) => {
  const r = await dialog.showSaveDialog(mainWindow, opts);
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
});

ipcMain.handle('dialog:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, opts);
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('fs:write', (_e, file, content) => {
  fs.writeFileSync(file, content, 'utf8');
  return { ok: true, file };
});

ipcMain.handle('fs:readAny', (_e, file) => {
  return fs.readFileSync(file, 'utf8');
});

ipcMain.handle('fs:writeBuf', (_e, file, b64) => {
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return { ok: true, file };
});

ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));

/* ---------------- IPC：Excel 导出 ---------------- */

ipcMain.handle('export:excel', (_e, { file, plan }) => {
  const wb = XLSX.utils.book_new();

  // 总览表
  const summary = plan.containers.map((c, i) => ({
    '柜号': '货柜-' + (i + 1),
    '柜型': c.container.name,
    '内径 L×W×H (mm)': `${c.container.L}×${c.container.W}×${c.container.H}`,
    '内容积 (m³)': +(c.container.L * c.container.W * c.container.H / 1e9).toFixed(2),
    '最大载重 (kg)': c.container.maxWeight,
    '已装体积 (m³)': +(c.usedVolume / 1e9).toFixed(3),
    '容积率': (c.usedVolume / (c.container.L * c.container.W * c.container.H) * 100).toFixed(1) + '%',
    '已装总重 (kg)': c.usedWeight,
    '箱数': c.boxes.length
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '总览');

  // 明细表
  const rows = [];
  plan.containers.forEach((c, i) => {
    c.boxes.forEach((b) => {
      rows.push({
        '柜号': '货柜-' + (i + 1),
        '箱型': b.boxName,
        '长 (mm)': b.dx, '宽 (mm)': b.dy, '高 (mm)': b.dz,
        '坐标 X (mm)': b.x, '坐标 Y (mm)': b.y, '坐标 Z (mm)': b.z,
        '重量 (kg)': b.weight,
        '旋转': b.rotLabel || ''
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '装箱明细');

  XLSX.writeFile(wb, file);
  return { ok: true, file };
});

/* ---------------- IPC：PDF 导出（printToPDF 零依赖） ---------------- */

ipcMain.handle('export:pdf', async (_e, { file, html }) => {
  const tmp = path.join(os.tmpdir(), 'cl-report-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false }
  });
  await win.loadFile(tmp);
  const pdfData = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { marginType: 'default' }
  });
  win.destroy();
  fs.writeFileSync(file, pdfData);
  return { ok: true, file };
});

/* ---------------- 路径 ---------------- */

ipcMain.handle('paths:data', () => dataDir());
ipcMain.handle('paths:userData', () => app.getPath('userData'));
