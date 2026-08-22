'use strict';

/* global THREE, Scene3D, packer */
/* 全局状态 */
window.state = {
  boxes: [],        // 箱型库 [{id,name,L,W,H,weight,max,color,rotatable}]
  containers: [],   // 柜型库 [{id,name,L,W,H,maxWeight}]
  cabinets: [],     // 方案柜实例 [{container, boxes:[{id,boxId,boxName,x,y,z,dx,dy,dz,weight,color,stack,rotLabel}]}]
  currentCab: 0,
  currentContainerId: null,  // 当前选中的装载柜型 id（一键装载/添加货柜使用）
  loadQty: {},      // 装载清单数量 {boxId: n}（卡片徽章与自动装载面板双向同步）
  planName: '未命名方案'
};

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 3200);
}

let boxSeq = 1;
function nextBoxId() {
  let max = 0;
  window.state.cabinets.forEach(c => c.boxes.forEach(b => { if (b.id > max) max = b.id; }));
  return max + 1;
}

async function boot() {
  // 加载箱型/柜型库
  const savedBoxes = await window.clAPI.readJson('boxes.json');
  const savedCons = await window.clAPI.readJson('containers.json');
  window.state.boxes = savedBoxes && savedBoxes.length ? savedBoxes : packer.DEFAULT_BOXES.map((b, i) => ({
    id: 'b' + (i + 1), ...b, rotatable: true
  }));
  window.state.containers = savedCons && savedCons.length ? savedCons : packer.DEFAULT_CONTAINERS.map(c => ({ ...c }));
  window.state.currentContainerId = (window.state.containers[0] || {}).id || null;

  // 3D 场景
  window.scene = new Scene3D($('#scene-container'));
  window.scene.onChange = () => syncFromScene();

  newPlan();
  bindUI();
  window.__APP_BOOTED__ = true;
}

function syncFromScene() {
  const cab = window.state.cabinets[window.state.currentCab];
  if (!cab) return;
  // 从场景的 boxMeshes 同步坐标回状态（scene 是拖拽后的权威数据）
  cab.boxes = window.scene.boxMeshes.map(m => ({
    id: m.box.id, boxId: m.box.boxId, boxName: m.box.boxName,
    x: m.box.x, y: m.box.y, z: m.box.z,
    dx: m.box.dx, dy: m.box.dy, dz: m.box.dz,
    weight: m.box.weight, color: m.box.color,
    stack: m.box.stack, rotLabel: m.box.rotLabel
  }));
  refreshStats();
}

/* ---------------- 方案 ---------------- */

function currentContainer() {
  return window.state.containers.find(c => c.id === window.state.currentContainerId) || window.state.containers[0] || null;
}

function newPlan() {
  const cont = currentContainer() || { name: '默认柜', L: 12032, W: 2352, H: 2690, maxWeight: 26700 };
  window.state.cabinets = [{ container: { ...cont }, boxes: [] }];
  window.state.currentCab = 0;
  window.state.planName = '未命名方案';
  refreshAll();
}

function refreshAll() {
  renderBoxList();
  renderContainerList();
  renderTabs();
  renderCabinet();
  refreshStats();
}

function renderTabs() {
  const el = $('#container-tabs');
  el.innerHTML = window.state.cabinets.map((c, i) =>
    `<div class="tab ${i === window.state.currentCab ? 'active' : ''}" data-i="${i}">货柜-${i + 1} ${esc(c.container.name)}</div>`
  ).join('');
  el.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    window.state.currentCab = +t.dataset.i;
    refreshAll();
  }));
}

function renderCabinet() {
  const cab = window.state.cabinets[window.state.currentCab];
  if (!cab) return;
  window.scene.setContainer(cab.container);
  // scene 内部会维护 box 的实时坐标；用深拷贝给 scene，scene 修改后经 onChange 同步回来
  window.scene.setBoxes(cab.boxes.map(b => ({
    ...b,
    id: b.id,
    boxId: b.boxId, boxName: b.boxName,
    x: b.x, y: b.y, z: b.z,
    dx: b.dx, dy: b.dy, dz: b.dz,
    weight: b.weight, color: b.color, stack: b.stack
  })));
}

function refreshStats() {
  const cab = window.state.cabinets[window.state.currentCab];
  if (!cab) return;
  const c = cab.container;
  const capVol = c.L * c.W * c.H;
  const usedVol = cab.boxes.reduce((s, b) => s + b.dx * b.dy * b.dz, 0);
  const weight = cab.boxes.reduce((s, b) => s + b.weight, 0);
  $('#info-name').textContent = c.name;
  $('#info-dims').textContent = `${c.L}×${c.W}×${c.H} mm`;
  $('#info-volume').textContent = (capVol / 1e9).toFixed(2) + ' m³';
  $('#info-maxw').textContent = c.maxWeight + ' kg';
  $('#info-usedvol').textContent = (usedVol / 1e9).toFixed(2) + ' m³';
  $('#info-rate').textContent = (usedVol / capVol * 100).toFixed(1) + '%';
  $('#info-weight').textContent = weight + ' kg';
  $('#info-count').textContent = cab.boxes.length + ' 箱';

  const byBox = {};
  cab.boxes.forEach(b => {
    const k = b.boxName || b.boxId;
    byBox[k] = byBox[k] || { n: 0, w: 0 };
    byBox[k].n++; byBox[k].w += b.weight;
  });
  $('#cargo-stats').innerHTML = Object.entries(byBox).map(([name, g]) =>
    `<div>${esc(name)}：${g.n} 箱 · ${g.w} kg</div>`
  ).join('') || '<div style="color:#aaa">暂无</div>';
}

/* ---------------- 箱型库 ---------------- */

/* 装载清单数量：卡片徽章 + 自动装载面板输入框统一从这里读写 */
function setLoadQty(id, n) {
  window.state.loadQty[id] = Math.max(0, Math.floor(n) || 0);
  renderBoxList();
  renderAutoBoxes();
}
function stepBoxQty(id, delta) {
  setLoadQty(id, (window.state.loadQty[id] || 0) + delta);
}

function renderBoxList() {
  const el = $('#box-list');
  el.innerHTML = window.state.boxes.map(b => `
    <div class="card" data-id="${b.id}" title="点击加箱 1 个">
      <span class="color-dot" style="background:${b.color}"></span>
      <span class="card-title">${esc(b.name)}</span>
      <div class="card-sub">${b.L}×${b.W}×${b.H}mm · ${b.weight}kg${b.rotatable ? '' : ' · 禁旋转'}</div>
      <div class="card-qty">
        <button data-op="minus-box" title="减 1 箱">−</button>
        <span class="qty-badge ${(window.state.loadQty[b.id] || 0) ? '' : 'zero'}" data-qty="${b.id}">${window.state.loadQty[b.id] || 0}</span>
        <button data-op="plus-box" title="加 1 箱">＋</button>
      </div>
      <div class="card-ops">
        <button data-op="edit-box" title="编辑">✎</button>
        <button data-op="del-box" title="删除">🗑</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // 按钮各自处理，不触发加箱
      stepBoxQty(card.dataset.id, +1);
      toast(`已加入 1 个「${window.state.boxes.find(b => b.id === card.dataset.id)?.name || ''}」，合计 ${window.state.loadQty[card.dataset.id] || 0} 个`);
    });
  });
  el.querySelectorAll('[data-op]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.closest('.card').dataset.id;
      const op = btn.dataset.op;
      if (op === 'edit-box') openBoxModal(id);
      else if (op === 'del-box') delBox(id);
      else if (op === 'plus-box') stepBoxQty(id, 1);
      else if (op === 'minus-box') stepBoxQty(id, -1);
    });
  });
  renderAutoBoxes();
}

function renderAutoBoxes() {
  // 数量以 state.loadQty 为准（卡片步进与输入框双向同步）
  const ab = $('#auto-boxes');
  ab.innerHTML = window.state.boxes.map(b => `
    <div class="ab-row">
      <span class="color-dot" style="background:${b.color}"></span>
      <label title="${esc(b.name)}">${esc(b.name)}</label>
      <input type="number" min="0" value="${window.state.loadQty[b.id] || 0}" data-boxid="${b.id}">
      <span class="unit">箱</span>
    </div>`).join('');
  ab.querySelectorAll('input[data-boxid]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.boxid;
      window.state.loadQty[id] = Math.max(0, Math.floor(+inp.value) || 0);
      // 同步卡片徽章（不重建输入框，避免打断输入）
      document.querySelectorAll(`[data-qty="${id}"]`).forEach(badge => {
        badge.textContent = window.state.loadQty[id];
        badge.classList.toggle('zero', !window.state.loadQty[id]);
      });
    });
  });
}

function currentContainerName() {
  const c = currentContainer();
  return c ? c.name : '无';
}

/* 选中柜型为当前装载柜：切换当前柜子的柜型（有货时先确认清空） */
function selectContainer(id) {
  const c = window.state.containers.find(x => x.id === id);
  if (!c) return;
  window.state.currentContainerId = id;
  const cab = window.state.cabinets[window.state.currentCab];
  if (cab && cab.boxes.length) {
    if (!confirm(`更换为「${c.name}」将清空当前柜已装的 ${cab.boxes.length} 箱，继续？`)) {
      renderContainerList();
      return;
    }
    cab.boxes = [];
  }
  if (cab) cab.container = { ...c };
  refreshAll();
  toast(`当前柜已设为「${c.name}」`);
}

function renderContainerList() {
  const el = $('#container-list');
  el.innerHTML = window.state.containers.map(c => {
    const active = c.id === window.state.currentContainerId;
    return `
    <div class="card ${active ? 'active' : ''}" data-id="${c.id}" title="${active ? '当前装载柜' : '点击设为当前装载柜'}">
      <span class="card-title">${esc(c.name)}</span>
      <div class="card-sub">${c.L}×${c.W}×${c.H}mm · 载重${c.maxWeight}kg</div>
      ${active ? '<div class="card-check">✓ 当前柜</div>' : ''}
      <div class="card-ops">
        <button data-op="edit-container" title="编辑">✎</button>
        <button data-op="del-container" title="删除">🗑</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selectContainer(card.dataset.id);
    });
  });
  el.querySelectorAll('[data-op]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.closest('.card').dataset.id;
      if (btn.dataset.op === 'edit-container') openContainerModal(id);
      else if (btn.dataset.op === 'del-container') delContainer(id);
    });
  });
  $('#menubar-status').textContent = `当前柜：${currentContainerName()}`;
}

function saveLibraries() {
  window.clAPI.writeJson('boxes.json', window.state.boxes);
  window.clAPI.writeJson('containers.json', window.state.containers);
}

function delBox(id) {
  window.state.boxes = window.state.boxes.filter(b => b.id !== id);
  saveLibraries(); renderBoxList(); toast('箱型已删除');
}

function delContainer(id) {
  window.state.containers = window.state.containers.filter(c => c.id !== id);
  if (window.state.currentContainerId === id) {
    window.state.currentContainerId = (window.state.containers[0] || {}).id || null;
  }
  saveLibraries(); renderContainerList(); toast('柜型已删除');
}

/* ---------------- 弹窗 ---------------- */

function openBoxModal(id) {
  const b = id ? window.state.boxes.find(x => x.id === id) : null;
  $('#modal-box-title').textContent = b ? '编辑箱型' : '新增箱型';
  $('#b-name').value = b ? b.name : '';
  $('#b-L').value = b ? b.L : 400;
  $('#b-W').value = b ? b.W : 300;
  $('#b-H').value = b ? b.H : 250;
  $('#b-weight').value = b ? b.weight : 15;
  $('#b-maxstack').value = b ? (b.maxStack || b.max || 8) : 8;
  $('#b-color').value = b ? b.color : '#4f9df7';
  $('#b-norot').checked = b ? !b.rotatable : false;
  $('#modal-box').classList.remove('hidden');
  window._editBoxId = id || null;
}

function openContainerModal(id) {
  const c = id ? window.state.containers.find(x => x.id === id) : null;
  $('#modal-container-title').textContent = c ? '编辑柜型' : '新增柜型';
  $('#c-name').value = c ? c.name : '';
  $('#c-L').value = c ? c.L : 12032;
  $('#c-W').value = c ? c.W : 2352;
  $('#c-H').value = c ? c.H : 2690;
  $('#c-weight').value = c ? c.maxWeight : 26700;
  $('#modal-container').classList.remove('hidden');
  $('#modal-container').dataset.editId = id || '';
}

function closeModals() {
  $('#modal-box').classList.add('hidden');
  $('#modal-container').classList.add('hidden');
}

/* ---------------- 操作 ---------------- */

function addCabinet() {
  const cont = currentContainer();
  if (!cont) { toast('请先配置柜型', 'err'); return; }
  window.state.cabinets.push({ container: { ...cont }, boxes: [] });
  window.state.currentCab = window.state.cabinets.length - 1;
  refreshAll();
  toast('已添加货柜');
}

function delCurrentCabinet() {
  if (window.state.cabinets.length <= 1) { toast('至少保留一个货柜', 'err'); return; }
  window.state.cabinets.splice(window.state.currentCab, 1);
  window.state.currentCab = Math.max(0, window.state.currentCab - 1);
  refreshAll();
  toast('已删除货柜');
}

function dupLayer() {
  const cab = window.state.cabinets[window.state.currentCab];
  if (!cab || !cab.boxes.length) return;
  const maxTop = Math.max(...cab.boxes.map(b => b.z + b.dz));
  const topBoxes = cab.boxes.filter(b => b.z + b.dz === maxTop);
  const cont = cab.container;
  const added = [];
  for (const b of topBoxes) {
    const nz = b.z + b.dz;
    if (nz + b.dz > cont.H) continue;
    cab.boxes.push({ ...b, id: nextBoxId(), z: nz });
    added.push(1);
  }
  refreshAll();
  toast(added.length ? `已复制 ${added.length} 箱到上一层` : '上层已到柜顶，无法复制', added.length ? 'ok' : 'err');
}

/* ---------------- 自动装载 ---------------- */

function autoLoad() {
  const inputs = [...document.querySelectorAll('#auto-boxes input[data-boxid]')];
  const counts = {};
  let total = 0;
  inputs.forEach(i => {
    const n = parseInt(i.value, 10) || 0;
    if (n > 0) { counts[i.dataset.boxid] = n; total += n; }
  });
  if (!total) { toast('请先在下方面板填写各箱型数量', 'err'); return; }
  const cont = currentContainer();
  if (!cont) { toast('请先配置柜型', 'err'); return; }

  const boxTypes = window.state.boxes.map(b => ({
    id: b.id, name: b.name, L: b.L, W: b.W, H: b.H,
    weight: b.weight, color: b.color, maxStack: (b.max || b.maxStack || 8), rotatable: b.rotatable !== false
  }));
  const container = { ...cont };
  const allowRotate = $('#auto-rotate').checked;
  const mode = $('#auto-mode').value;

  $('#auto-status').textContent = '计算中…';
  // 让 UI 先刷新
  setTimeout(() => {
    const result = window.packer.packAll(container, boxTypes, counts, { maxContainers: 10, iterations: 60, allowRotate, mode });
    window.state.cabinets = result.containers.map(c => ({
      container: { ...c.container },
      boxes: c.boxes.map(b => ({
        id: nextBoxId(),
        boxId: b.boxId, boxName: b.boxName,
        x: b.x, y: b.y, z: b.z,
        dx: b.dx, dy: b.dy, dz: b.dz,
        weight: b.weight, color: b.color,
        stack: b.stack, rotLabel: b.rotLabel
      }))
    }));
    if (!window.state.cabinets.length) {
      window.state.cabinets = [{ container, boxes: [] }];
    }
    window.state.currentCab = 0;
    refreshAll();
    $('#auto-status').textContent = result.gapReport;
    if (result.remaining.length) {
      toast(`⚠ ${result.remaining.length} 箱装不下：${result.gapReport}`, 'err');
    } else {
      toast('✓ ' + result.gapReport, 'ok');
    }
  }, 30);
}

/* ---------------- CSV 导入箱型 ---------------- */

async function importBoxesCSV() {
  const file = await window.clAPI.openDialog({
    title: '导入箱型 CSV',
    filters: [
      { name: 'CSV / 文本', extensions: ['csv', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (!file) return;
  let text;
  try {
    text = await window.clAPI.readFileAny(file);
  } catch (e) {
    toast('读取文件失败：' + e.message, 'err');
    return;
  }
  const rows = window.csvImporter.parseCSV(text);
  const res = window.csvImporter.mergeBoxesFromCSV(window.state.boxes, rows);
  if (res.errors.length && res.added + res.updated === 0) {
    toast('导入失败：' + res.errors[0], 'err');
    return;
  }
  window.state.boxes = res.boxes;
  saveLibraries();
  renderBoxList();
  const msg = `导入完成：新增 ${res.added} 条，更新 ${res.updated} 条，跳过 ${res.skipped} 条`;
  toast(res.errors.length ? msg + '；' + res.errors[0] : msg, res.errors.length ? '' : 'ok');
}

/* ---------------- 持久化 ---------------- */

async function savePlan() {
  const file = await window.clAPI.saveDialog({
    title: '保存装柜方案',
    defaultPath: (window.state.planName || '装柜方案').replace(/[\\/:*?"<>|]/g, '_') + '.cload',
    filters: [{ name: '装柜方案', extensions: ['cload'] }]
  });
  if (!file) return;
  const plan = {
    app: 'container-loader', version: 1,
    name: window.state.planName,
    time: new Date().toISOString(),
    boxes: window.state.boxes,
    containers: window.state.containers,
    cabinets: window.state.cabinets
  };
  await window.clAPI.writeFile(file, JSON.stringify(plan, null, 2));
  toast('方案已保存：' + file, 'ok');
}

async function openPlan() {
  const file = await window.clAPI.openDialog({
    title: '打开装柜方案',
    filters: [{ name: '装柜方案', extensions: ['cload'] }]
  });
  if (!file) return;
  try {
    const txt = await window.clAPI.readFileAny(file);
    const plan = JSON.parse(txt);
    if (plan.app !== 'container-loader') throw new Error('文件不是 container-loader 方案');
    window.state.boxes = plan.boxes || window.state.boxes;
    window.state.containers = plan.containers || window.state.containers;
    window.state.cabinets = plan.cabinets && plan.cabinets.length ? plan.cabinets : [{ container: { ...window.state.containers[0] }, boxes: [] }];
    window.state.planName = plan.name || '未命名方案';
    window.state.currentCab = 0;
    if (!window.state.containers.find(c => c.id === window.state.currentContainerId)) {
      window.state.currentContainerId = (window.state.containers[0] || {}).id || null;
    }
    saveLibraries();
    refreshAll();
    toast('方案已打开：' + plan.name, 'ok');
  } catch (e) {
    toast('打开失败：' + e.message, 'err');
  }
}

/* ---------------- 导出 ---------------- */

async function doExport(kind) {
  const cabs = window.state.cabinets.map(cab => ({
    container: cab.container,
    boxes: cab.boxes.map(b => ({ ...b })),
    usedVolume: cab.boxes.reduce((s, b) => s + b.dx * b.dy * b.dz, 0),
    usedWeight: cab.boxes.reduce((s, b) => s + b.weight, 0)
  }));
  const meta = { time: new Date().toLocaleString('zh-CN'), name: window.state.planName };
  try {
    let file = null;
    if (kind === 'pdf') file = await window.__exportAPI.exportPDF(cabs, meta);
    else if (kind === 'excel') file = await window.__exportAPI.exportExcel(cabs, meta);
    else if (kind === 'png') file = await window.__exportAPI.exportPNG(window.scene, true);
    else if (kind === 'html') file = await window.__exportAPI.exportHTML(cabs, meta);
    if (file) { toast('导出成功：' + file, 'ok'); window.clAPI.showItem(file); }
  } catch (e) {
    console.error(e);
    toast('导出失败：' + e.message, 'err');
  }
}

/* ---------------- 事件绑定 ---------------- */

function toggleLock() {
  window.scene.locked = !window.scene.locked;
  $('#btn-lock').textContent = window.scene.locked ? '🔒 锁定' : '🔓 解锁';
  $('#btn-lock').classList.toggle('toggle-on', window.scene.locked);
}

function bindMenus() {
  const act = {
    'new-scheme': () => { if (confirm('新建方案将清空当前方案，继续？')) newPlan(); },
    'open-scheme': openPlan,
    'save-scheme': savePlan,
    'import-csv': importBoxesCSV,
    'open-data-dir': async () => {
      const d = await window.clAPI.dataDir();
      window.clAPI.showItem(d);
    },
    'quit': () => { window.close(); },
    'add-box': () => openBoxModal(null),
    'add-container': () => openContainerModal(null),
    'toggle-lock': toggleLock,
    'toggle-hint': () => {
      const h = $('#scene-hint');
      h.style.display = h.style.display === 'none' ? '' : 'none';
    },
    'auto-run': autoLoad,
    'toggle-rotate': () => {
      const chk = $('#auto-rotate');
      chk.checked = !chk.checked;
      toast(chk.checked ? '已允许箱子旋转 90°' : '已禁止箱子旋转');
    },
    'mode-volume': () => { $('#auto-mode').value = 'volume'; toast('装载模式：体积优先'); },
    'mode-weight': () => { $('#auto-mode').value = 'weight'; toast('装载模式：重量优先'); },
    'show-hint': () => toast('点箱型卡片加箱，点柜型卡片选柜；锁定状态拖箱子，Q/E 旋转，Delete 删除，双击空白切视角'),
    'about': () => { $('#modal-about').classList.remove('hidden'); }
  };
  document.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fn = act[btn.dataset.act];
      if (fn) fn();
    });
  });
}

function bindUI() {
  $('#btn-new').addEventListener('click', () => { if (confirm('新建方案将清空当前方案，继续？')) newPlan(); });
  $('#btn-open').addEventListener('click', openPlan);
  $('#btn-save').addEventListener('click', savePlan);
  $('#btn-export-pdf').addEventListener('click', () => doExport('pdf'));
  $('#btn-export-png').addEventListener('click', () => doExport('png'));
  $('#btn-export-excel').addEventListener('click', () => doExport('excel'));
  $('#btn-export-html').addEventListener('click', () => doExport('html'));
  $('#btn-data-dir').addEventListener('click', async (e) => {
    e.preventDefault();
    const d = await window.clAPI.dataDir();
    window.clAPI.showItem(d);
  });

  $('#btn-add-box').addEventListener('click', () => openBoxModal(null));
  $('#btn-import-csv').addEventListener('click', importBoxesCSV);
  $('#btn-add-container').addEventListener('click', () => openContainerModal(null));

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.scene.setView(btn.dataset.view);
    });
  });
  $('#btn-dup-layer').addEventListener('click', dupLayer);
  $('#btn-lock').addEventListener('click', toggleLock);
  $('#snap-select').addEventListener('change', (e) => { window.scene.snap = +e.target.value; });

  $('#btn-auto-run').addEventListener('click', autoLoad);
  $('#btn-add-cabinet').addEventListener('click', addCabinet);
  $('#btn-del-cabinet').addEventListener('click', delCurrentCabinet);

  $('#b-cancel').addEventListener('click', closeModals);
  $('#b-ok').addEventListener('click', () => {
    const id = window._editBoxId;
    const data = {
      id: id || ('b' + Date.now()),
      name: $('#b-name').value || '未命名',
      L: Math.round(+$('#b-L').value), W: Math.round(+$('#b-W').value), H: Math.round(+$('#b-H').value),
      weight: +$('#b-weight').value, max: Math.max(1, +$('#b-maxstack').value || 8),
      color: $('#b-color').value, rotatable: !$('#b-norot').checked
    };
    if (!data.L || !data.W || !data.H) { toast('尺寸必填', 'err'); return; }
    if (id) {
      const i = window.state.boxes.findIndex(x => x.id === id);
      if (i >= 0) window.state.boxes[i] = { ...window.state.boxes[i], ...data };
    } else {
      window.state.boxes.push(data);
    }
    saveLibraries(); renderBoxList(); closeModals(); toast('箱型已保存', 'ok');
  });
  $('#c-cancel').addEventListener('click', closeModals);
  $('#c-ok').addEventListener('click', () => {
    const editId = $('#modal-container').dataset.editId;
    const data = {
      id: editId || ('c' + Date.now()),
      name: $('#c-name').value || '自定义柜',
      L: Math.max(1, +$('#c-L').value), W: Math.max(1, +$('#c-W').value), H: Math.max(1, +$('#c-H').value),
      maxWeight: +$('#c-weight').value || 0
    };
    if (!data.L || !data.W || !data.H) { toast('尺寸必填', 'err'); return; }
    if (editId) {
      const i = window.state.containers.findIndex(x => x.id === editId);
      if (i >= 0) window.state.containers[i] = { ...window.state.containers[i], ...data };
    } else {
      window.state.containers.push(data);
    }
    saveLibraries(); renderContainerList(); closeModals(); toast('柜型已保存', 'ok');
  });
  $('#about-ok').addEventListener('click', () => $('#modal-about').classList.add('hidden'));

  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  }));

  bindMenus();
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch(e => {
    window.__APP_ERROR__ = e.message;
    console.error('boot failed', e);
    toast('初始化失败：' + e.message, 'err');
  });
});
