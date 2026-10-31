import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const require = createRequire(import.meta.url);

const brandPageBuilderSource = read('lib/brand-page-builder.ts');
const brandFrontJs = read('wechat-miniprogram/pages/brand-front/brand-front.js');
const brandFrontWxml = read('wechat-miniprogram/pages/brand-front/brand-front.wxml');
const brandFrontWxss = read('wechat-miniprogram/pages/brand-front/brand-front.wxss');

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

function loadBrandPageBuilder() {
  const compiled = ts.transpileModule(brandPageBuilderSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, require, console, Date, Math };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: 'lib/brand-page-builder.ts' });
  return sandbox.module.exports;
}

function miniNormalize(document) {
  const width = Number(document.designWidth || 1040);
  const scale = 750 / width;
  const knownBlockTypes = ['image', 'text', 'image_text', 'products', 'spacer'];
  const knownLayerTypes = ['text', 'image', 'shape'];
  const blocks = document.blocks.filter((block) => block && knownBlockTypes.includes(block.type)).map((block) => ({
    ...block,
    heightRpx: Math.round(Number(block.height || 320) * scale),
    paddingRpx: Math.round(Number(block.padding || 0) * scale),
    sideImageWidthPct: Math.min(68, Math.max(32, Number(block.imageWidth || 48))),
    productColumns: Math.max(1, Math.min(2, Number(block.columns || 2))),
  }));
  const layers = (document.pageLayers || []).filter((layer) => layer && layer.hidden !== true && knownLayerTypes.includes(layer.type)).map((layer) => ({
    ...layer,
    leftRpx: Number(layer.xPct || 0) / 100 * 750,
    topRpx: Math.round(Number(layer.y || 0) * scale),
    widthRpx: Number(layer.widthPct || 20) / 100 * 750,
    heightRpx: Math.round(Number(layer.height || 80) * scale),
    fontSizeRpx: Math.round(Number(layer.fontSize || 24) * scale),
  }));
  return { scale, blocks, layers };
}

const { BRAND_PAGE_TEMPLATES, createTemplateDocument } = loadBrandPageBuilder();
const requiredTemplates = ['brand_story', 'product_focus', 'editorial', 'blank'];
const knownBlockTypes = ['image', 'text', 'image_text', 'products', 'spacer'];
const knownLayerTypes = ['text', 'image', 'shape'];
const fixturePattern = /(TEST|测试|測試|虚构|虛構|青芽健康|青芽|example\.com\/assets\/test-)/i;

assert(requiredTemplates.every((id) => BRAND_PAGE_TEMPLATES.some((template) => template.id === id)), 'web template registry must contain brand_story, product_focus, editorial, and blank');

for (const templateId of requiredTemplates) {
  const document = createTemplateDocument(templateId, '真实品牌', '真实品牌介绍，用于验证模板数据契约。');
  const normalized = miniNormalize(document);
  assert(document.designWidth === 1040, `${templateId} web template should publish with desktop designWidth 1040`);
  assert(document.selectedTemplateId === templateId, `${templateId} selectedTemplateId must be preserved`);
  assert(normalized.blocks.length === document.blocks.length, `${templateId} all blocks must be supported by mini renderer`);
  assert(normalized.layers.length === (document.pageLayers || []).filter((layer) => !layer.hidden).length, `${templateId} all visible layers must be supported by mini renderer`);
  assert(!fixturePattern.test(JSON.stringify(document)), `${templateId} must not include test brand or fixture copy`);
  for (const block of document.blocks) {
    assert(knownBlockTypes.includes(block.type), `${templateId} has unsupported block type ${block.type}`);
    assert(Number(block.height) > 0, `${templateId} block ${block.id} must have positive height`);
  }
  for (const layer of document.pageLayers || []) {
    assert(knownLayerTypes.includes(layer.type), `${templateId} has unsupported layer type ${layer.type}`);
    assert(Number(layer.xPct) >= 0 && Number(layer.xPct) + Number(layer.widthPct) <= 100, `${templateId} layer ${layer.id} must stay within logical canvas width`);
    assert(Number(layer.y) >= 0 && Number(layer.height) > 0, `${templateId} layer ${layer.id} must keep positive logical geometry`);
  }
  for (const layer of normalized.layers) {
    assert(layer.leftRpx >= 0 && layer.leftRpx + layer.widthRpx <= 750.01, `${templateId} mini layer ${layer.id} must stay within 390px/750rpx canvas width`);
    assert(layer.topRpx >= 0 && layer.heightRpx > 0, `${templateId} mini layer ${layer.id} must scale y/height proportionally`);
    assert(layer.fontSizeRpx > 0, `${templateId} mini text geometry must scale from designWidth`);
  }
}

assert(brandFrontJs.includes('const scale = 750 / width;'), 'mini renderer must scale published desktop/mobile documents by designWidth into the 390px/750rpx canvas');
assert(brandFrontJs.includes('sideImageStyle'), 'mini renderer must preserve image_text imageWidth from the published document');
assert(brandFrontJs.includes('productGridStyle'), 'mini renderer must preserve product block columns within mobile limits');
assert(brandFrontWxml.includes('style="{{block.sideImageStyle}}"'), 'mini image_text block must bind side image width style');
assert(brandFrontWxml.includes('style="{{block.productGridStyle}}"'), 'mini product block must bind grid column style');
assert(/\.published-canvas\{[^}]*position:relative[^}]*width:750rpx/.test(brandFrontWxss), 'mini published canvas must be a fixed 390px/750rpx relative canvas');
assert(/\.published-layer\{[^}]*position:absolute/.test(brandFrontWxss), 'mini free layers must stay absolutely positioned, not reflowed');
assert(brandFrontJs.includes('!isDemoProduct(item)'), 'mini brand front must filter demo products from public products');
assert(brandFrontJs.includes('!isDemoProduct(item.product)'), 'mini brand front must filter demo products from curated products');

if (failures.length) {
  console.error('Mini brand template contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Mini brand template contract check passed.');
