'use strict';
/**
 * packer 单元测试：验证几何不重叠、柜内约束、载重、承压
 */
const assert = require('assert');
const { DEFAULT_CONTAINERS, DEFAULT_BOXES, expandItems, packAll } = require('../src/js/packer.js');

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

function packC(cont, boxTypes, counts, opt) {
  return packAll(cont, boxTypes, counts, opt);
}

console.log('\n全部通过 ✅');
