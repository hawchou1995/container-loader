'use strict';

/**
 * export.js — 导出：PDF / PNG / Excel / HTML 自包含报告
 * 依赖：window.clAPI（preload）、window.scene（Scene3D）、全局 cabinets 状态
 */

function fmtNum(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' m³';
  if (v >= 1e6) return (v / 1e6).toFixed(3) + ' m³';
  return v.toLocaleString('en-US') + ' mm';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 由柜列表生成报告数据 */
function buildReportData(cabs) {
  return cabs.map((cab, i) => {
    const cont = cab.container;
    const capVol = cont.L * cont.W * cont.H;
    return {
      idx: i + 1,
      name: '货柜-' + (i + 1),
      contName: cont.name,
      dims: `${cont.L}×${cont.W}×${cont.H} mm`,
      capVol,
      maxWeight: cont.maxWeight,
      usedVol: cab.usedVolume,
      rate: (cab.usedVolume / capVol) * 100,
      usedWeight: cab.usedWeight,
      boxCount: cab.boxes.length,
      boxes: cab.boxes
    };
  });
}

/** 生成自包含 HTML 报告（内嵌 CSS，无外部依赖） */
function buildReportHTML(cabs, meta) {
  const rep = buildReportData(cabs);
  const totalVol = rep.reduce((s, r) => s + r.usedVol, 0);
  const totalCap = rep.reduce((s, r) => s + r.capVol, 0);
  const totalWeight = rep.reduce((s, r) => s + r.usedWeight, 0);
  const totalBoxes = rep.reduce((s, r) => s + r.boxCount, 0);

  const cards = rep.map(r => {
    const rows = r.boxes.map(b => `
      <tr>
        <td>${escapeHtml(b.boxName)}</td>
        <td>${b.dx}×${b.dy}×${b.dz}</td>
        <td>(${b.x}, ${b.y}, ${b.z})</td>
        <td>${b.stack}层</td>
        <td>${b.weight}</td>
        <td>${b.rotLabel || '标准'}</td>
      </tr>`).join('');
    const rate = Math.max(0, Math.min(100, r.rate));
    const barColor = rate > 85 ? '#22a06b' : rate > 65 ? '#f7c04f' : '#d64545';
    return `
    <div class="cab">
      <h3>${r.name} · ${escapeHtml(r.contName)}（${r.dims}，内容积 ${(r.capVol / 1e9).toFixed(2)} m³，载重 ${r.maxWeight} kg）</h3>
      <div class="bar-wrap">
        <div class="bar" style="width:${rate}%;background:${barColor}"></div>
        <span class="bar-label">容积利用率 ${r.rate.toFixed(1)}%</span>
      </div>
      <table>
        <thead><tr><th>箱型</th><th>尺寸 L×W×H (mm)</th><th>坐标 (x,y,z)</th><th>层</th><th>重量 (kg)</th><th>朝向</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">空柜</td></tr>'}</tbody>
      </table>
      <p class="sum">已装体积 ${(r.usedVol / 1e9).toFixed(2)} m³（${r.rate.toFixed(1)}%）｜已装总重 ${r.usedWeight} kg｜箱数 ${r.boxCount}</p>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>装柜方案报告</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; color: #1f2d3d; margin: 24px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #7a8699; font-size: 12px; margin-bottom: 16px; }
  .overview { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat { background: #f4f6fa; border-radius: 8px; padding: 10px 16px; }
  .stat b { font-size: 20px; display: block; }
  .stat span { font-size: 12px; color: #7a8699; }
  .cab { border: 1px solid #e3e8ef; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; page-break-inside: avoid; }
  .cab h3 { margin: 0 0 8px; font-size: 14px; }
  .bar-wrap { position: relative; background: #eef2f8; border-radius: 6px; height: 18px; margin-bottom: 10px; overflow: hidden; }
  .bar { height: 100%; border-radius: 6px; }
  .bar-label { position: absolute; right: 8px; top: 2px; font-size: 11px; color: #fff; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.3); }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #e3e8ef; padding: 4px 8px; text-align: left; }
  th { background: #f4f6fa; }
  .sum { margin: 8px 0 0; font-size: 12px; color: #5b6b80; }
</style></head><body>
  <h1>装柜方案报告</h1>
  <div class="meta">生成时间：${escapeHtml(meta.time)} ｜ 方案：${escapeHtml(meta.name || '未命名')}</div>
  <div class="overview">
    <div class="stat"><b>${rep.length}</b><span>货柜数</span></div>
    <div class="stat"><b>${totalBoxes}</b><span>总箱数</span></div>
    <div class="stat"><b>${(totalVol / 1e9).toFixed(2)} m³</b><span>总装载体积</span></div>
    <div class="stat"><b>${totalCap ? (totalVol / totalCap * 100).toFixed(1) : 0}%</b><span>综合容积率</span></div>
    <div class="stat"><b>${totalWeight} kg</b><span>总重量</span></div>
  </div>
  ${cards}
</body></html>`;
}

/** 统一导出入口：cabs = [{container, boxes, usedVolume, usedWeight}] */
async function exportPDF(cabs, meta) {
  const html = buildReportHTML(cabs, meta);
  const file = await window.clAPI.saveDialog({
    title: '导出 PDF 报告',
    defaultPath: '装柜方案报告.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (!file) return null;
  await window.clAPI.exportPdf({ file, html });
  return file;
}

async function exportExcel(cabs, meta) {
  const plan = { containers: cabs };
  const file = await window.clAPI.saveDialog({
    title: '导出 Excel 装箱明细',
    defaultPath: '装柜装箱明细.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (!file) return null;
  await window.clAPI.exportExcel({ file, plan });
  return file;
}

async function exportPNG(scene, withViews) {
  const file = await window.clAPI.saveDialog({
    title: '导出截图',
    defaultPath: '装柜截图.png',
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });
  if (!file) return null;
  let dataUrl;
  if (withViews) {
    const imgs = scene.screenshotViews(['front', 'left', 'top', 'iso']);
    dataUrl = composeViews(imgs);
  } else {
    dataUrl = scene.screenshot();
  }
  await window.clAPI.writeFileBuf(file, dataUrl.split(',')[1]);
  return file;
}

async function exportHTML(cabs, meta) {
  const html = buildReportHTML(cabs, meta);
  const file = await window.clAPI.saveDialog({
    title: '导出 HTML 报告',
    defaultPath: '装柜方案报告.html',
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });
  if (!file) return null;
  await window.clAPI.writeFile(file, html);
  return file;
}

/** 四视图拼图（PNG） */
function composeViews(imgs) {
  const c = document.createElement('canvas');
  const per = 560;
  const cols = 2, rows = Math.ceil(imgs.length / cols);
  c.width = cols * per; c.height = rows * per * 0.75;
  const ctx = c.getContext('2d');
  const labels = ['前视', '左视', '顶视', '立体'];
  imgs.forEach((src, i) => {
    const img = new Image();
    img.src = src;
    const cx = (i % cols) * per, cy = Math.floor(i / cols) * per * 0.75;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx, cy, per, per * 0.75);
    ctx.drawImage(img, cx, cy, per, per * 0.75);
    ctx.fillStyle = '#1f2d3d';
    ctx.font = 'bold 24px "Microsoft YaHei"';
    ctx.fillText(labels[i] || '', cx + 12, cy + 34);
  });
  return c.toDataURL('image/png');
}

// 导出 API 挂载（app.js 使用）
window.__exportAPI = {
  buildReportHTML,
  exportPDF,
  exportExcel,
  exportPNG,
  exportHTML
};
