'use strict';

/**
 * packer.js — 自动装载算法（纯 JS，无依赖，Node/浏览器通用）
 *
 * 策略：体积优先降序 + 最深最左最下(DBL)放置 + 剩余空间分割(guillotine)
 *       + 局部搜索迭代（随机扰动排序 N 轮取最优）+ 载重/承压校验 + 多柜分装
 *
 * 3D 装箱为 NP-Hard，本算法为启发式逼近，输出与体积上界的差距报告。
 */

// 默认柜型库（mm / kg，内径）
const DEFAULT_CONTAINERS = [
  { id: '20GP', name: '20GP', L: 5898, W: 2352, H: 2393, maxWeight: 28000 },
  { id: '40GP', name: '40GP', L: 12032, W: 2352, H: 2393, maxWeight: 26700 },
  { id: '40HQ', name: '40HQ', L: 12032, W: 2352, H: 2690, maxWeight: 26700 },
  { id: '45HQ', name: '45HQ', L: 13556, W: 2352, H: 2690, maxWeight: 29500 }
];

// 默认箱型示例
const DEFAULT_BOXES = [
  { id: 'b1', name: '纸箱 S', L: 400, W: 300, H: 250, weight: 12, color: '#4f9df7', maxStack: 8 },
  { id: 'b2', name: '纸箱 M', L: 500, W: 400, H: 300, weight: 22, color: '#7fd18c', maxStack: 6 },
  { id: 'b3', name: '纸箱 L', L: 600, W: 450, H: 350, weight: 35, color: '#f7c04f', maxStack: 5 },
  { id: 'b4', name: '中空板箱', L: 900, W: 600, H: 500, weight: 60, color: '#ee8a8a', maxStack: 4 }
];

/** 由箱型清单 + 数量生成物品实例列表 */
function expandItems(boxTypes, counts) {
  const items = [];
  let id = 0;
  for (const bt of boxTypes) {
    const bid = bt.id || bt.name;
    const n = counts[bid] || 0;
    for (let i = 0; i < n; i++) {
      items.push({
        id: id++,
        boxId: bid,
        boxName: bt.name,
        dx: bt.L, dy: bt.W, dz: bt.H,
        weight: bt.weight || 0,
        color: bt.color || '#888888',
        maxStack: Math.max(1, bt.maxStack || 10),
        vol: bt.L * bt.W * bt.H
      });
    }
  }
  return items;
}

/** 箱子 6 种朝向（去重） */
function orientations(it) {
  const { dx, dy, dz } = it;
  const perms = [
    [dx, dy, dz], [dx, dz, dy], [dy, dx, dz],
    [dy, dz, dx], [dz, dx, dy], [dz, dy, dx]
  ];
  const seen = new Set();
  const list = [];
  for (const p of perms) {
    const key = p.join('x');
    if (!seen.has(key)) { seen.add(key); list.push(p); }
  }
  return list;
}

/** 单柜装载：把 items 尽量塞进 container。返回 {boxes, usedVolume, usedWeight, remaining} */
function packContainer(container, items) {
  const spaces = [{ x: 0, y: 0, z: 0, w: container.L, d: container.W, h: container.H }];
  const placed = [];
  const columns = []; // 每根承压柱：{x,y,w,d,count,maxStack}
  let usedWeight = 0;
  const remaining = [];

  for (const it of items) {
    // 载重约束
    if (container.maxWeight && usedWeight + it.weight > container.maxWeight) {
      remaining.push(it);
      continue;
    }
    let bestSpace = -1, bestO = null;
    for (let s = 0; s < spaces.length && bestSpace === -1; s++) {
      const sp = spaces[s];
      for (const o of orientations(it)) {
        if (o[0] <= sp.w && o[1] <= sp.d && o[2] <= sp.h) {
          // 承压校验：若放在支撑物之上，检查该柱已叠层数
          if (sp.z > 0) {
            const col = columns.find(c =>
              Math.abs(c.topZ - sp.z) < 1 &&
              c.x < sp.x + o[0] && sp.x < c.x + c.w &&
              c.y < sp.y + o[1] && sp.y < c.y + c.d);
            if (col && col.count + 1 > col.maxStack) continue;
          }
          bestSpace = s; bestO = o;
        }
      }
    }
    if (bestSpace === -1) { remaining.push(it); continue; }

    const sp = spaces[bestSpace];
    const [sw, sd, sh] = bestO;
    // 计算该位置的承压柱层数（重叠的最大 count）
    let colCount = 1;
    if (sp.z > 0) {
      const cols = columns.filter(c =>
        Math.abs(c.topZ - sp.z) < 1e-9 &&
        c.x < sp.x + sw && sp.x < c.x + c.w &&
        c.y < sp.y + sd && sp.y < c.y + c.d);
      if (cols.length) colCount = Math.max(...cols.map(c => c.count)) + 1;
    }
    placed.push({
      id: it.id, boxId: it.boxId, boxName: it.boxName,
      x: sp.x, y: sp.y, z: sp.z,
      dx: sw, dy: sd, dz: sh,
      weight: it.weight, color: it.color,
      stack: colCount,
      rotLabel: rotLabel(it, sw, sd, sh)
    });
    usedWeight += it.weight;
    columns.push({
      x: sp.x, y: sp.y, w: sw, d: sd,
      topZ: sp.z + sh, count: colCount, maxStack: it.maxStack
    });

    // guillotine 分割剩余空间
    const r1 = { x: sp.x + sw, y: sp.y, z: sp.z, w: sp.w - sw, d: sp.d, h: sp.h };
    const r2 = { x: sp.x, y: sp.y + sd, z: sp.z, w: sw, d: sp.d - sd, h: sp.h };
    const r3 = { x: sp.x, y: sp.y, z: sp.z + sh, w: sw, d: sd, h: sp.h - sh };
    const rem = [r1, r2, r3].filter(r => r.w > 0 && r.d > 0 && r.h > 0);
    spaces.splice(bestSpace, 1);
    spaces.push(...rem);
    spaces.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  }

  const usedVolume = placed.reduce((s, p) => s + p.dx * p.dy * p.dz, 0);
  return { container, boxes: placed, usedVolume, usedWeight, remaining };
}

/**
 * 多柜分装：依次开柜，能放就放，放不下开下一个柜。
 * 局部搜索：多轮随机扰动物品顺序，取「装进箱数最多 + 占用体积最大」的布局。
 */
function packAll(container, boxTypes, counts, { maxContainers = 10, iterations = 60 } = {}) {
  const allItems = expandItems(boxTypes, counts);
  allItems.sort((a, b) => b.vol - a.vol); // 体积降序

  const capVol = container.L * container.W * container.H;
  const totalVol = allItems.reduce((s, i) => s + i.vol, 0);
  const upperBound = Math.ceil(totalVol / capVol);

  let best = null;
  for (let iter = 0; iter < iterations; iter++) {
    const items = iter === 0 ? allItems : shuffle(allItems, iter);
    const containers = [];
    let remaining = items;

    for (let ci = 0; ci < maxContainers && remaining.length; ci++) {
      const res = packContainer(container, remaining);
      if (res.boxes.length) {
        containers.push({
          container,
          boxes: res.boxes,
          usedVolume: res.usedVolume,
          usedWeight: res.usedWeight,
          volumeRate: res.usedVolume / capVol
        });
      }
      remaining = res.remaining;
    }

    const packed = items.length - remaining.length;
    const usedVol = containers.reduce((s, c) => s + c.usedVolume, 0);
    const score = packed * 1e15 + usedVol;
    if (!best || score > best.score) {
      best = { score, containers, remaining, packed, total: items.length, usedVol };
    }
    if (remaining.length === 0) {
      const singleOk = containers.length <= 1;
      if (singleOk || iter > iterations / 2) break; // 单柜装完或已过半轮数
    }
  }

  const volumeUtil = best.containers.length
    ? best.usedVol / (capVol * best.containers.length)
    : 0;
  return {
    containers: best.containers,
    remaining: best.remaining,
    packed: best.packed,
    total: best.total,
    usedVol: best.usedVol,
    volumeUtil,
    upperBound,
    gapReport: best.remaining.length
      ? `已用 ${best.containers.length} 柜装 ${best.packed}/${best.total} 箱，剩余 ${best.remaining.length} 箱未装下（超出最大柜数 ${maxContainers} 或几何/承压限制）`
      : `已用 ${best.containers.length} 柜装完 ${best.total} 箱，平均容积利用率 ${(volumeUtil * 100).toFixed(1)}%，理论体积上界 ${upperBound} 柜`
  };
}

function shuffle(arr, seed) {
  const a = arr.slice();
  let s = (seed * 2654435761) >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rotLabel(it, sw, sd, sh) {
  if (sw === it.dx && sd === it.dy && sh === it.dz) return '标准';
  if (sw === it.dy && sd === it.dx && sh === it.dz) return '水平转90°';
  if (sw === it.dx && sd === it.dz && sh === it.dy) return '绕长轴90°';
  return '旋转';
}

// 浏览器 / Node 双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_CONTAINERS, DEFAULT_BOXES, expandItems, packContainer, packAll };
} else {
  window.packer = { DEFAULT_CONTAINERS, DEFAULT_BOXES, expandItems, packContainer, packAll };
}
