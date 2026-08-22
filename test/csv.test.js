'use strict';
/**
 * csv.js 单元测试：CSV 解析（BOM/引号/分号分隔符）与箱型合并（新增/更新/跳过）
 */
const assert = require('assert');
const { parseCSV, parseHeader, mergeBoxesFromCSV } = require('../src/js/csv.js');

// 测试 1：BOM + CRLF + 引号字段 + 逗号分隔
{
  const text = '\uFEFF名称,长,宽,高,重量,最大堆叠,颜色,可旋转\r\n' +
    '"纸箱,加大",400,300,250,12,8,#4f9df7,是\r\n' +
    '中空板箱,900,600,500,60,4,,否\r\n';
  const rows = parseCSV(text);
  assert.strictEqual(rows.length, 3, `应解析 3 行（含表头），实际 ${rows.length}`);
  assert.strictEqual(rows[0][0], '名称', '表头解析错误');
  assert.strictEqual(rows[1][0], '纸箱,加大', '引号内逗号字段解析错误');
  assert.strictEqual(rows[1][1], '400');
  assert.strictEqual(rows[2][4], '60');
  console.log('✓ CSV 解析：BOM/CRLF/引号字段/逗号分隔');
}

// 测试 2：分号分隔 + 空行过滤
{
  const rows = parseCSV('名称;长;宽;高;重量\nA;100;200;300;5\n\nB;10;20;30;1\n');
  assert.strictEqual(rows.length, 3, `分号分隔应解析 3 行，实际 ${rows.length}`);
  assert.strictEqual(rows[0][0], '名称');
  assert.strictEqual(rows[2][0], 'B');
  console.log('✓ CSV 解析：分号分隔/空行过滤');
}

// 测试 3：合并——新增 + 同名更新（保留原 id）+ 非法行跳过
{
  const existing = [{ id: 'x1', name: '老箱', L: 100, W: 100, H: 100, weight: 1, max: 8, color: '#4f9df7', rotatable: true }];
  const rows = parseCSV('名称,长,宽,高,重量,最大堆叠,可旋转\n' +
    '老箱,200,200,200,9,6,否\n' +          // 同名 → 更新
    '新箱,300,300,300,3,,是\n' +          // 新增
    '坏箱,abc,300,300,1,,,\n' +          // 尺寸非法 → 跳过
    ',100,100,100,1,,,\n');             // 无名称 → 跳过
  const res = mergeBoxesFromCSV(existing, rows);
  assert.strictEqual(res.added, 1, `新增应 1，实际 ${res.added}`);
  assert.strictEqual(res.updated, 1, `更新应 1，实际 ${res.updated}`);
  assert.strictEqual(res.skipped, 2, `跳过应 2，实际 ${res.skipped}`);
  assert.strictEqual(res.boxes.length, 2);
  const old = res.boxes.find(b => b.name === '老箱');
  const upd = res.boxes.find(b => b.name === '老箱');
  assert.strictEqual(upd.id, 'x1', '同名更新应保留原 id');
  assert.strictEqual(upd.L, 200);
  assert.strictEqual(upd.rotatable, 'none', '可旋转=否 应解析为 none（禁旋转）');
  const fresh = res.boxes.find(b => b.name === '新箱');
  assert(fresh && fresh.id.startsWith('b'), '新增箱型 id 应以 b 开头');
  assert.strictEqual(fresh.weight, 3);
  assert.strictEqual(fresh.max, 8, '最大堆叠缺省应 8');
  console.log('✓ 箱型合并：新增/同名更新保 id/非法行跳过/可旋转解析');
}

// 测试 4：缺必需列报错 + 空文件
{
  const res1 = mergeBoxesFromCSV([], parseCSV('名称,重量\nA,5\n'));
  assert(res1.errors.length && res1.errors[0].includes('必需列'), '缺列未报错');
  const res2 = mergeBoxesFromCSV([], parseCSV(''));
  assert.strictEqual(res2.errors[0], '空文件');
  console.log('✓ 边界：缺必需列报错、空文件报错');
}

// 测试 5：表头别名（英文）与默认值（重量缺省 0、颜色缺省）
{
  const rows = parseCSV('name,L,W,H,weight,maxStack,rotatable\n' +
    'EN箱,400,300,250,12,8,0\n' +
    '轻箱,100,100,100,,,\n');
  const res = mergeBoxesFromCSV([], rows);
  assert.strictEqual(res.added, 2);
  const en = res.boxes.find(b => b.name === 'EN箱');
  assert.strictEqual(en.L, 400);
  assert.strictEqual(en.rotatable, 'none', 'rotatable=0 应解析为 none（禁旋转）');
  const light = res.boxes.find(b => b.name === '轻箱');
  assert.strictEqual(light.weight, 0, '重量缺省应 0');
  assert.strictEqual(light.color, '#4f9df7', '颜色缺省应默认色');
  console.log('✓ 英文表头/默认值（重量 0、默认颜色、rotatable 解析）');
}

// 测试 6：可旋转列三值解析（all / flat / none）
{
  const rows = parseCSV('名称,长,宽,高,可旋转\n' +
    '全转箱,100,100,100,是\n' +
    '水平箱,100,100,100,仅水平\n' +
    '立放箱,100,100,100,禁立放\n' +
    '禁转箱,100,100,100,禁止\n');
  const res = mergeBoxesFromCSV([], rows);
  assert.strictEqual(res.added, 4);
  assert.strictEqual(res.boxes.find(b => b.name === '全转箱').rotatable, 'all', '是 → all');
  assert.strictEqual(res.boxes.find(b => b.name === '水平箱').rotatable, 'flat', '仅水平 → flat');
  assert.strictEqual(res.boxes.find(b => b.name === '立放箱').rotatable, 'flat', '禁立放 → flat');
  assert.strictEqual(res.boxes.find(b => b.name === '禁转箱').rotatable, 'none', '禁止 → none');
  console.log('✓ 可旋转三值：是=all / 仅水平/禁立放=flat / 禁止=none');
}

console.log('\n全部通过 ✅');
