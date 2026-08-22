'use strict';

/**
 * csv.js — 箱型 CSV 导入解析（纯 JS，无依赖，Node/浏览器通用）
 *
 * 期望格式（表头行 + 数据行），分隔符自动识别逗号/分号，兼容带引号字段：
 *   名称,长,宽,高,重量,最大堆叠,颜色,可旋转
 *   name,L,W,H,weight,maxStack,color,rotatable
 *
 * 列名别名：名称/name、长/L、宽/W、高/H、重量/weight、最大堆叠|堆叠/maxStack、
 *           颜色/color、可旋转/rotatable（1/true/是/允许 = 可旋转）
 * 必需列：名称、长、宽、高（重量缺省 0）
 */

const HEADER_ALIASES = {
  name: ['name', '名称', '箱型名称', '箱名'],
  L: ['l', '长', 'length'],
  W: ['w', '宽', 'width'],
  H: ['h', '高', 'height'],
  weight: ['weight', '重量', 'kg', '单重'],
  maxStack: ['maxstack', '最大堆叠', '堆叠层数', '堆叠', '承压层数', 'max'],
  color: ['color', '颜色', 'colour'],
  rotatable: ['rotatable', '可旋转', '允许旋转', '旋转']
};

/** 简单 CSV 解析：支持引号包裹字段、字段内逗号/分号、CRLF，自动探测分隔符 */
function parseCSV(text) {
  if (!text) return [];
  // 去 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // 分隔符探测：看第一行逗号/分号谁多
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.split(',').length - 1) >= (firstLine.split(';').length - 1) ? ',' : ';';

  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

/** 表头行 → 标准键索引映射 */
function parseHeader(row) {
  const map = {};
  const unknown = [];
  row.forEach((cell, idx) => {
    const key = String(cell).trim().toLowerCase();
    let hit = false;
    for (const [std, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key)) { map[std] = idx; hit = true; break; }
    }
    if (!hit && key) unknown.push(String(cell).trim());
  });
  return { map, unknown };
}

function toNum(v) {
  const n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 把 CSV 数据合并进箱型库。
 * @param {Array} boxes  现有箱型库（会被追加/更新）
 * @param {Array} rows   parseCSV 输出（首行为表头）
 * @returns {{boxes, added, updated, skipped, errors, unknown}}
 *   同名（name）箱型 → 更新（保留原 id）；否则新增（id: 'b' + 时间戳 + 序号）。
 */
function mergeBoxesFromCSV(boxes, rows) {
  if (!rows.length) return { boxes, added: 0, updated: 0, skipped: 0, errors: ['空文件'] };
  const { map, unknown } = parseHeader(rows[0]);
  if (!('name' in map) || !('L' in map) || !('W' in map) || !('H' in map)) {
    return {
      boxes, added: 0, updated: 0, skipped: 0, unknown,
      errors: ['表头缺少必需列：名称/长/宽/高（格式示例：名称,长,宽,高,重量,最大堆叠,颜色,可旋转）']
    };
  }
  const out = boxes.slice();
  let added = 0, updated = 0, skipped = 0;
  const errors = [];
  const ts = Date.now();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (key) => (key in map && map[key] < row.length) ? String(row[map[key]]).trim() : '';
    const name = get('name');
    if (!name) { skipped++; continue; }
    const L = toNum(get('L'));
    const W = toNum(get('W'));
    const H = toNum(get('H'));
    if (!(L > 0) || !(W > 0) || !(H > 0)) {
      skipped++;
      errors.push(`第 ${r + 1} 行「${name}」尺寸非法（长=${get('L')} 宽=${get('W')} 高=${get('H')}）`);
      continue;
    }
    const weight = toNum(get('weight'));
    const maxStack = toNum(get('maxStack'));
    const rotRaw = get('rotatable').toLowerCase();
    const rotatable = !rotRaw || ['1', 'yes', 'true', '是', '允许'].includes(rotRaw);
    const rec = {
      name,
      L, W, H,
      weight: Number.isFinite(weight) && weight >= 0 ? weight : 0,
      max: Number.isFinite(maxStack) && maxStack >= 1 ? Math.round(maxStack) : 8,
      color: get('color') || '#4f9df7',
      rotatable
    };
    const idx = out.findIndex(b => b.name === name);
    if (idx >= 0) {
      out[idx] = { ...out[idx], ...rec, id: out[idx].id }; // 同名更新，保留原 id
      updated++;
    } else {
      out.push({ id: 'b' + ts + added, ...rec });
      added++;
    }
  }
  return { boxes: out, added, updated, skipped, errors, unknown };
}

// 浏览器 / Node 双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCSV, parseHeader, mergeBoxesFromCSV, HEADER_ALIASES };
} else {
  window.csvImporter = { parseCSV, parseHeader, mergeBoxesFromCSV, HEADER_ALIASES };
}
