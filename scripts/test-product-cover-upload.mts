import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brandAssetUrlFromUploadResponse } from '../lib/brand-asset-public-url.ts';
import { serializeBrandAssetUploadResponse } from '../lib/brand-asset-upload-core.ts';

const saved = {
  provider: 'local',
  objectKey: 'brand-assets/1/product/2026-11-06/abc.jpg',
  publicUrl: '/api/cn/brand-assets?key=brand-assets%2F1%2Fproduct%2F2026-11-06%2Fabc.jpg',
  contentType: 'image/jpeg',
  byteSize: 1200,
  sha256: 'abc',
  width: 800,
  height: 800,
  productionReady: true,
};

const body = serializeBrandAssetUploadResponse(saved);
assert.equal('asset' in body, false, 'API success body has no asset wrapper');
assert.equal(brandAssetUrlFromUploadResponse(body), saved.publicUrl);
assert.equal(brandAssetUrlFromUploadResponse({ asset: { url: '/legacy.jpg' } }), '/legacy.jpg');
assert.equal(brandAssetUrlFromUploadResponse({ url: '  /direct.jpg  ' }), '/direct.jpg');
assert.equal(brandAssetUrlFromUploadResponse({ error: '仅支持 JPG、PNG、WebP 图片' }), '');
assert.equal(brandAssetUrlFromUploadResponse(null), '');

const newPage = readFileSync(new URL('../app/vendor/products/new/page.tsx', import.meta.url), 'utf8');
const editPage = readFileSync(new URL('../app/vendor/products/[id]/edit/page.tsx', import.meta.url), 'utf8');
assert.match(newPage, /brandAssetUrlFromUploadResponse/);
assert.match(editPage, /brandAssetUrlFromUploadResponse/);
assert.doesNotMatch(newPage, /data\.asset\.url/);
assert.doesNotMatch(editPage, /data\.asset\.url/);
assert.match(newPage, /没有读到图片文件/);
assert.match(newPage, /opacity-0/);
assert.doesNotMatch(newPage, /封面图 \*[\s\S]{0,500}className="hidden"/);

console.log('product cover upload contract checks passed');
