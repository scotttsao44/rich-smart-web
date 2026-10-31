import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const brandFrontJs = read('wechat-miniprogram/pages/brand-front/brand-front.js');
const brandFrontWxml = read('wechat-miniprogram/pages/brand-front/brand-front.wxml');
const brandFrontWxss = read('wechat-miniprogram/pages/brand-front/brand-front.wxss');
const builderJs = read('wechat-miniprogram/pages/brand-page-builder/brand-page-builder.js');
const builderWxml = read('wechat-miniprogram/pages/brand-page-builder/brand-page-builder.wxml');
const brandPageApi = read('app/api/cn/brand-page/route.ts');
const brandPageBuilder = read('lib/brand-page-builder.ts');

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} missing ${value}`);
  }
}

includesAll(brandPageBuilder, [
  "'ai_generated'",
  "selectedTemplateId: 'ai_generated'",
  "createBrandPageBlock('image'",
  "createBrandPageBlock('text'",
  "createBrandPageBlock('image_text'",
  "createBrandPageBlock('products'",
  "createBrandPageLayer('text'",
  "createBrandPageLayer('shape'",
], 'web AI brand-page document contract');

includesAll(brandFrontJs, [
  "request({ url: `/api/cn/brand-page?slug=${encodeURIComponent(brand.slug)}` })",
  'normalizePublishedDocument(data.document || (data.brand.brandPage && data.brand.brandPage.published))',
  "const knownBlockTypes = ['image', 'text', 'image_text', 'products', 'spacer'];",
  "const knownLayerTypes = ['text', 'image', 'shape'];",
  'layer.hidden !== true',
], 'mini published brand-page reader');

includesAll(brandFrontWxml, [
  "block.type === 'image'",
  "block.type === 'text'",
  "block.type === 'image_text'",
  "block.type === 'products'",
  "block.type === 'spacer'",
  "layer.type === 'text'",
  "layer.type === 'image'",
], 'mini published brand-page renderer');

assert(/searchParams\.get\('slug'\)/.test(brandPageApi), 'brand-page API must expose slug lookup for mini public pages');
assert(/document:\s*page\.published/.test(brandPageApi), 'brand-page API must return the published document for public mini pages');
assert(/page\.status\s*===\s*'published'/.test(brandPageApi), 'brand-page API must only expose published pages publicly');
assert(!brandFrontJs.includes('/api/cn/brand-page/ai-design'), 'mini brand front must not call the AI design endpoint directly');

const customerFacingMiniBrandSources = [
  ['wechat-miniprogram/pages/brand-front/brand-front.js', brandFrontJs],
  ['wechat-miniprogram/pages/brand-front/brand-front.wxml', brandFrontWxml],
  ['wechat-miniprogram/pages/brand-front/brand-front.wxss', brandFrontWxss],
  ['wechat-miniprogram/pages/brand-page-builder/brand-page-builder.js', builderJs],
  ['wechat-miniprogram/pages/brand-page-builder/brand-page-builder.wxml', builderWxml],
];

const forbiddenMonetizationCopy = [
  '付费模板',
  '付費模板',
  '月费',
  '月費',
  '订阅',
  '訂閱',
  '会员价',
  '會員價',
  'AI 价格',
  'AI價格',
  '付费锁',
  '付費鎖',
  '订阅锁',
  '訂閱鎖',
  'premium template',
  'subscription lock',
];

for (const [path, source] of customerFacingMiniBrandSources) {
  for (const phrase of forbiddenMonetizationCopy) {
    assert(!source.toLowerCase().includes(phrase.toLowerCase()), `${path} contains forbidden monetization copy: ${phrase}`);
  }
}

if (failures.length) {
  console.error('Mini brand-page AI contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Mini brand-page AI contract check passed.');
