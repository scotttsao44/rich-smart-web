import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  path.resolve('wechat-miniprogram/pages'),
  path.resolve('app/mini-preview'),
];

const forbidden = [
  '功能介绍',
  '流程解释',
  '每次登录建立一个全新空白会员',
  '品牌资料、商品与合作推荐各自归属',
  '品牌独立呈现，商品审核后上架',
  '所有人从会员开始，功能依审核状态开放',
  '仅用于内部测试。系统会',
  '微信商家转账尚未开通：现在可测试',
  '流程验收',
  '测试模式',
  '测试支付',
  '测试示意图',
  '测试会员',
  '测试账号',
  '进入测试账号',
  '模拟微信支付',
  '继续测试',
  '不会真实扣款',
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(target));
    else if (/\.(wxml|js|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const failures = [];
for (const root of roots) {
  for (const file of await filesUnder(root)) {
    const source = await readFile(file, 'utf8');
    for (const phrase of forbidden) {
      if (source.includes(phrase)) failures.push(`${path.relative(process.cwd(), file)}: ${phrase}`);
    }
  }
}

if (failures.length) {
  console.error(`Customer-facing production copy check failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('Customer-facing production copy check passed.');
