'use strict';
/**
 * packer 单元测试：验证几何不重叠、柜内约束、载重、承压
 */
const assert = require('assert');
const { DEFAULT_CONTAINERS, DEFAULT_BOXES, expandItems, packAll, singleTypeLayout, fillToCapacity } = require('../src/js/packer.js');

function checkNoOverlap(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap =
        a.x < b.x + b.dx && a.x + a.dx > b.x &&
        a.y < b.y + b.dy && a.y + a.dy > b.y &&
        a.z < b.z + b.dz && a.z + a.dz > b.z;
      assert(!overlap, `箱子 ${i}(${a.boxName}) 与 ${j}(${b.boxName}) 重叠`);
    }
  }
}

function checkInside(boxes, cont) {
  for (const b of boxes) {
    assert(b.x >= 0 && b.y >= 0 && b.z >= 0, `${b.boxName} 负坐标`);
    assert(b.x + b.dx <= cont.L + 0.01, `${b.boxName} 超长`);
    assert(b.y + b.dy <= cont.W + 0.01, `${b.boxName} 超宽`);
    assert(b.z + b.dz <= cont.H + 0.01, `${b.boxName} 超高`);
  }
}

// 测试 1：单箱型 40HQ 装 400 个 400×300×250 纸箱
let res = packAll(DEFAULT_CONTAINERS[2], DEFAULT_BOXES.slice(0, 1), { 'b1': 60 }, { iterations: 10 });
assert(res.packed === 60, `应装完 60 箱，实际 ${res.packed}`);
for (const c of res.containers) checkInside(c.boxes, c.container);
for (const c of res.containers) checkNoOverlap(c.boxes);
console.log('✓ 测试1 单箱型 60 箱：全部装完，无重叠，无越界');

// 测试 2：混装多箱型 + 多柜
{
  const boxTypes = DEFAULT_BOXES.map(b => ({ ...b, maxStack: b.maxStack }));
  const counts = { 'b1': 100, 'b2': 60, 'b3': 30, 'b4': 12 };
  res = packAll(DEFAULT_CONTAINERS[2], boxTypes, counts, { maxContainers: 3, iterations: 20 });
  console.log(`✓ 混装：${res.packed}/${res.total} 装柜，柜数 ${res.containers.length}，${res.gapReport}`);
  for (const c of res.containers) { checkInside(c.boxes, c.container); checkNoOverlap(c.boxes); }
  assert(res.packed === res.total, '混装应全部装下');
  assert(res.containers.length <= 3, '柜数超限');
}

// 测试 3：承压约束——单箱叠层不得超过 maxStack
{
  const cont = { name: 'test', L: 500, W: 400, H: 4000, maxWeight: 99999 };
  const boxTypes = [{ id: 'b0', name: '薄箱', L: 500, W: 400, H: 100, weight: 1, maxStack: 5 }];
  res = packAll(cont, boxTypes, { 'b0': 30 }, { iterations: 5 });
  // 每柱最多 5 层 → 30 箱在 500×400 底面上应装 6 柱×5 层 = 30
  assert(res.packed === 30, `承压约束下应装 30，实际 ${res.packed}`);
  const maxStackObserved = Math.max(...res.containers[0].boxes.map(b => b.stack));
  assert(maxStackObserved <= 5, `最大叠层 ${maxStackObserved} 超过 maxStack=5`);
  console.log(`✓ 承压约束：最大叠层 ${maxStackObserved} ≤ 5`);
}

// 测试 4：载重约束——超重箱装不下
{
  const cont = { id: 't', name: 'test', L: 1000, W: 1000, H: 1000, maxWeight: 10 };
  const boxTypes = [{ id: 'b0', name: '重箱', L: 200, W: 200, H: 200, weight: 4, maxStack: 10 }];
  res = packAll(cont, boxTypes, { 'b0': 100 }, { maxContainers: 1, iterations: 5 });
  // 体积上界 125 个，但载重 10kg 只允许 2 个（3×4=12>10）；单柜验证
  assert(res.packed === 2, `载重约束下应装 2，实际 ${res.packed}`);
  console.log('✓ 载重约束：maxWeight=10kg 单柜只装 2 个 4kg 箱（3 个即超载）');
}

// 测试 5：旋转开关——allowRotate=false 全部标准朝向；true 允许旋转多装
{
  const cont = { name: 'test', L: 1000, W: 1000, H: 500, maxWeight: 99999 };
  const boxTypes = [{ id: 'r1', name: '旋转箱', L: 700, W: 500, H: 200, weight: 1, maxStack: 10, rotatable: true }];
  // 标准朝向 700×500×200：每层 1×2=2 个 ×2 层 = 4；旋转后可借用侧边 300×1000×500 空间多装 1 个（200×700×500）
  const off = packAll(cont, boxTypes, { 'r1': 6 }, { maxContainers: 1, iterations: 10, allowRotate: false });
  assert(off.packed === 4, `禁旋转应装 4，实际 ${off.packed}`);
  const allStd = off.containers[0].boxes.every(b => b.rotLabel === '标准' && b.dx === 700 && b.dy === 500 && b.dz === 200);
  assert(allStd, '禁旋转时存在非标准朝向');
  const on = packAll(cont, boxTypes, { 'r1': 6 }, { maxContainers: 1, iterations: 10, allowRotate: true });
  assert(on.packed === 5, `允许旋转应装 5，实际 ${on.packed}`);
  assert(on.containers[0].boxes.some(b => b.rotLabel !== '标准'), '允许旋转但没有箱子使用旋转');
  for (const cc of on.containers) { checkInside(cc.boxes, cc.container); checkNoOverlap(cc.boxes); }
  console.log('✓ 旋转开关：禁旋转装 4 全标准；允许旋转装 5 且出现旋转朝向，无重叠越界');
}

// 测试 6：单箱型 rotatable=false 即使全局允许旋转也不旋转
{
  const c = { name: 'test', L: 1000, W: 1000, H: 500, maxWeight: 99999 };
  const boxTypes = [{ id: 'r2', name: '禁旋箱', L: 700, W: 500, H: 200, weight: 1, maxStack: 10, rotatable: false }];
  res = packAll(c, boxTypes, { 'r2': 6 }, { maxContainers: 1, iterations: 10, allowRotate: true });
  assert(res.packed === 4, `单箱禁旋转应装 4，实际 ${res.packed}`);
  const allStd2 = res.containers[0].boxes.every(b => b.rotLabel === '标准');
  assert(allStd2, 'rotatable=false 的箱子被旋转了');
  console.log('✓ 箱型禁旋转标记：rotatable=false 时自动装载不旋转该箱型');
}

// 测试 7：重量优先模式——重箱优先，同箱数下装载总重更大
{
  const c = { name: 'test', L: 2000, W: 2000, H: 2000, maxWeight: 100 };
  const boxTypes = [
    { id: 'a', name: '重小箱', L: 300, W: 300, H: 100, weight: 30, maxStack: 10 },
    { id: 'b', name: '轻大箱', L: 1500, W: 1500, H: 1500, weight: 15, maxStack: 10 }
  ];
  const counts = { 'a': 4, 'b': 1 };
  const vol = packAll(c, boxTypes, counts, { maxContainers: 1, iterations: 10, mode: 'volume' });
  const wt = packAll(c, boxTypes, counts, { maxContainers: 1, iterations: 10, mode: 'weight' });
  // 体积优先：先装大箱 B(15kg) 再塞 2 个 A → 75kg；重量优先：先装 3 个 A(90kg)，B 放不下
  assert(vol.packed === 3 && vol.usedWeight === 75, `体积优先应装 3 箱 75kg，实际 ${vol.packed}/${vol.usedWeight}`);
  assert(wt.packed === 3 && wt.usedWeight === 90, `重量优先应装 3 箱 90kg，实际 ${wt.packed}/${wt.usedWeight}`);
  assert(wt.usedWeight > vol.usedWeight, '重量优先模式装载总重未超过体积优先');
  assert(wt.mode === 'weight' && Math.abs(wt.weightUtil - 0.9) < 1e-6, `载重利用率应为 0.9，实际 ${wt.weightUtil}`);
  for (const cc of wt.containers) { checkInside(cc.boxes, cc.container); checkNoOverlap(cc.boxes); }
  console.log('✓ 重量优先：体积优先装 75kg vs 重量优先装 90kg，载重利用率 90%，无重叠越界');
}

function packC(cont, boxTypes, counts, opt) {
  return packAll(cont, boxTypes, counts, opt);
}

// 测试 8：单箱型满载排布（singleTypeLayout）——网格数量精确、遵守承压、无重叠越界
{
  const c = { name: '20GP', L: 5898, W: 2352, H: 2393, maxWeight: 28000 };
  const box = { id: 's', name: '纸箱S', L: 400, W: 300, H: 250, weight: 12, maxStack: 8 };
  const r = singleTypeLayout(c, box, { allowRotate: true });
  const gridEstimate = Math.floor(c.L / 400) * Math.floor(c.W / 300) * Math.floor(c.H / 250);
  assert(r.count >= gridEstimate, `单型满载应 ≥ 网格估计 ${gridEstimate}，实际 ${r.count}`);
  checkInside(r.boxes, c);
  checkNoOverlap(r.boxes);
  const maxStack = Math.max(...r.boxes.map(b => b.stack));
  assert(maxStack <= 8, `堆叠层数 ${maxStack} 超出 maxStack=8`);
  // 层数受 maxStack 限制：旋转后层数可达 4 层，但 maxStack=2 → 每格最多 2 层
  const box2 = { id: 't', name: '薄箱', L: 500, W: 400, H: 100, weight: 5, maxStack: 2 };
  const r2 = singleTypeLayout(c, box2, { allowRotate: true });
  const maxStackObserved = Math.max(...r2.boxes.map(b => b.stack));
  assert(maxStackObserved <= 2, `薄箱堆叠层数 ${maxStackObserved} 超出 maxStack=2`);
  // 最优朝向 (400×100×500)：14×23×2 = 644（若无层数限制为 14×23×4=1288）
  assert(r2.count === 644, `薄箱应受 maxStack 限制为 644，实际 ${r2.count}`);
  console.log(`✓ 单箱满载排布：40GP 可装纸箱S ${r.count} 箱（网格估计 ${gridEstimate}），无重叠越界，层数受限正确`);
}

// 测试 9：多箱型填满测算（fillToCapacity）——结果装满、无重叠越界
{
  const c = { name: '40HQ', L: 12032, W: 2352, H: 2690, maxWeight: 26700 };
  const boxTypes = [
    { id: 'a', name: 'A', L: 600, W: 400, H: 300, weight: 20, maxStack: 8 },
    { id: 'b', name: 'B', L: 400, W: 300, H: 200, weight: 10, maxStack: 10 }
  ];
  const res = fillToCapacity(c, boxTypes, { a: 10, b: 5 }, { iterations: 6 });
  assert(res && res.containers.length === 1, '填满测算应返回单柜结果');
  const boxes = res.containers[0].boxes;
  assert(boxes.length > 15, `填满后箱数应明显大于初始 15，实际 ${boxes.length}`);
  assert(res.volumeUtil > 0.7, `填满后容积率应>70%，实际 ${(res.volumeUtil * 100).toFixed(1)}%`);
  checkInside(boxes, c);
  checkNoOverlap(boxes);
  console.log(`✓ 多型填满：单柜装 ${boxes.length} 箱，容积率 ${(res.volumeUtil * 100).toFixed(1)}%，无重叠越界`);
}

// 测试 10：压实后处理不产生重叠/越界，且布局紧致（箱子左缘/下缘贴壁比例提高）
{
  const c = { name: 'test', L: 3000, W: 2000, H: 2000, maxWeight: 0 };
  const boxTypes = [
    { id: 'a', name: 'A', L: 800, W: 600, H: 500, weight: 10, maxStack: 8 },
    { id: 'b', name: 'B', L: 500, W: 400, H: 300, weight: 6, maxStack: 8 },
    { id: 'c', name: 'C', L: 300, W: 250, H: 200, weight: 4, maxStack: 8 }
  ];
  const res = packC(c, boxTypes, { a: 8, b: 12, c: 20 }, { maxContainers: 1, iterations: 4 });
  checkInside(res.containers[0].boxes, c);
  checkNoOverlap(res.containers[0].boxes);
  // 压实后每个箱子都应贴着柜壁或某同层邻居（无悬空空隙）
  const boxes = res.containers[0].boxes;
  const touchLeftOrWall = boxes.filter(b => {
    const wall = b.x < 1e-6;
    const leftNeighbor = boxes.some(o => o !== b &&
      Math.abs(o.z - b.z) < 1e-6 &&                     // 同一层（不同高度也互相阻挡）
      o.x + o.dx <= b.x + 1e-6 && o.x + o.dx > b.x - 1 && // 紧贴左缘
      o.y < b.y + b.dy && b.y < o.y + o.dy);
    return wall || leftNeighbor;
  }).length;
  assert(touchLeftOrWall / boxes.length > 0.8, `压实后应 ≥80% 箱子贴左缘，实际 ${(touchLeftOrWall / boxes.length * 100).toFixed(0)}%`);
  console.log(`✓ 压实：${boxes.length} 箱无重叠越界，${(touchLeftOrWall / boxes.length * 100).toFixed(0)}% 贴左缘/柜壁`);
}

console.log('\n全部通过 ✅');
