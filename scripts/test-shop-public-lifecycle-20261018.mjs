import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript'), { NextResponse } = require('next/server');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const source = file => readFileSync(path.join(root, file), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const slices = {};
function functions(file, names) {
  const text = source(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `${file}:${name}`); const body = declaration.getText(ast); slices[`${file}:${name}`] = fingerprint(body); return body;
  }).join('\n');
}
function evaluate(code, imports = {}, context = {}) {
  const exports = {};
  vm.runInNewContext(compile(code), { exports, URL, URLSearchParams, console: { error() {} }, ...context,
    require(name) { assert.ok(Object.hasOwn(imports, name), `Non-allowlisted import ${name}`); return imports[name]; } });
  return exports;
}
const catalog = evaluate(source('lib/catalog.ts'));
const dto = evaluate(source('lib/product-public.ts'));
const categories = evaluate(source('lib/shop-categories.ts'));
const temporary = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'shop-lifecycle-20261018-')));
const output = path.join(root, 'tmp/workstation-reports/shop-public-lifecycle-20261018'); mkdirSync(output, { recursive: true });
const repository = evaluate(source('lib/local-brand-page-repository.ts'), { fs, path }, { process: { pid: process.pid } });
const store = repository.createLocalBrandMarketplaceRepository(temporary);
const localFile = 'lib/local-cn-brand-marketplace.ts';
const localNames = ['dataDir', 'readState', 'withWrite', 'audit', 'getApprovedBrandById', 'listPublicBrandProducts', 'getPublicBrandProduct', 'updateBrandProduct'];
const local = evaluate(`${functions(localFile, localNames)}\nexport { readState, updateBrandProduct };`, {}, {
  process: { env: { LOCAL_CN_DATA_DIR: temporary }, cwd() { throw Error('Unscoped CWD forbidden'); } }, path,
  ...repository, ...catalog, getOrganizationRole: () => null,
});
const fixtureImage = '/images/brand-templates/product-focus-hero.png';
const brand = (id, user, status = 'approved') => ({ id, status, brandName: `隔離品牌${id}`, slug: `isolated-brand-${id}`, applicantUserId: user, accountUserId: user, companyName: 'PRIVATE_COMPANY_SENTINEL', phone: 'PRIVATE_PHONE_SENTINEL' });
const product = (id, brandId, category = '益生菌', extra = {}) => ({ id, brandId, brandName: `隔離品牌${brandId}`, name: `隔離商品${id}`, slug: `isolated-item-${id}`, sku: `isolated-${id}`, category, description: '公開合成商品說明',
  priceCny: '299.00', priceTwd: '299.00', stockQuantity: 8, supplierName: null, imageUrl: fixtureImage, images: [fixtureImage], imageIsTest: false, status: 'approved', reviewStatus: 'approved', isActive: false, salesStatus: 'archived', ownerUserId: brandId + 100,
  phone: 'PRIVATE_PHONE_SENTINEL', internalNote: 'PRIVATE_NOTE_SENTINEL', reviewNote: 'PRIVATE_REVIEW_SENTINEL', supplyPriceCny: 'PRIVATE_SUPPLY_SENTINEL', ...extra });
let dbState = { brands: [], brandProducts: [], brandProductImages: [], products: [] };
const tables = Object.fromEntries(Object.keys(dbState).map(table => [table, new Proxy({ table }, { get: (target, key) => key === 'table' ? target.table : { table, key } })]));
const eq = (column, value) => row => row[column.key] === value;
const gt = (column, value) => row => row[column.key] > value;
const inArray = (column, values) => row => values.includes(row[column.key]);
const and = (...conditions) => row => conditions.every(fn => fn(row));
let dbQueries = 0;
const db = { select() { dbQueries++; let table, condition = () => true, count = Infinity;
  const query = { from(value) { table = value.table; return query; }, where(value) { condition = value; return query; }, orderBy() { return query; }, limit(value) { count = value; return query; },
    then(resolve, reject) { return Promise.resolve(dbState[table].filter(condition).slice(0, count)).then(resolve, reject); } }; return query;
} };
const dbNames = ['imageList', 'dbProductDto', 'productsWithImages', 'listDbPublicBrandProducts', 'getDbPublicBrandProduct', 'getDbApprovedBrandById'];
const dbPublic = evaluate(functions('lib/brand-pilot-db.ts', dbNames), {}, { db, ...tables, eq, gt, inArray, and, desc: () => null });
function wire(databaseEnabled) {
  const env = { env: databaseEnabled ? { DATABASE_URL: 'synthetic-only-no-connection' } : {} };
  const publicLookup = evaluate(source('lib/public-products.ts'), {
    'drizzle-orm': { and, eq, gt }, '@/lib/db': { db }, '@/lib/schema': { products: tables.products }, '@/lib/catalog': catalog,
    '@/lib/local-cn-brand-marketplace': local, '@/lib/brand-pilot-db': dbPublic, '@/lib/product-public': dto,
  }, { process: env });
  const list = evaluate(source('app/api/products/route.ts'), {
    'next/server': { NextResponse }, '@/lib/db': { db }, '@/lib/schema': { products: tables.products }, '@/lib/catalog': catalog, '@/lib/product-public': dto,
    'drizzle-orm': { and, eq, gt }, '@/lib/local-cn-brand-marketplace': local, '@/lib/brand-pilot-db': dbPublic,
  }, { process: env });
  const apiDetail = evaluate(source('app/api/products/[id]/route.ts'), { 'next/server': { NextResponse }, '@/lib/public-products': publicLookup });
  const ssrPage = evaluate(source('app/cn/shop/[id]/page.tsx'), { 'next/navigation': { notFound() { throw Error('NOT_FOUND'); } },
    './ProductDetailClient': { __esModule: true, default: props => React.createElement('section', null, props.product.name) }, '@/lib/public-products': publicLookup,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) } });
  return { list, apiDetail, ssrPage, publicLookup };
}
const markets = evaluate(source('lib/cn-market.ts'));
const imageComponent = evaluate(source('components/ShopProductImage.tsx'), { react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  'next/image': { __esModule: true, default: ({ fill, priority, quality, unoptimized, ...props }) => React.createElement('img', props) },
  'lucide-react': { Package: props => React.createElement('span', props) } });
const icons = Object.fromEntries(['ArrowLeft', 'BadgeCheck', 'Check', 'Minus', 'Plus', 'ShoppingCart'].map(name => [name, props => React.createElement('span', { className: props.className })]));
const client = evaluate(source('app/cn/shop/[id]/ProductDetailClient.tsx'), { react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': { __esModule: true, default: props => React.createElement('a', props) }, 'next/navigation': { useSearchParams: () => new URLSearchParams() }, 'lucide-react': icons,
  '@/app/providers': { useCart: () => ({ addItem() { throw Error('Cart writes forbidden'); } }) }, '@/lib/cn-market': markets, '@/components/ShopProductImage': imageComponent });
const results = [], snapshots = [];
async function test(name, fn) { try { await fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } }
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const noPrivate = value => assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|ownerUserId|reviewNote|accountUserId|applicantUserId|supplyPriceCny|phone|companyName|internalNote/);
async function observe(wiring, expectedIds, hiddenIds, label) {
  const response = await wiring.list.GET(); assert.ok(response instanceof NextResponse); assert.equal(response.status, 200); const rows = await response.json();
  same(rows.map(row => row.id).sort(), [...expectedIds].sort()); noPrivate(rows);
  const visible = categories.buildVisibleShopCategories(rows, false);
  for (const id of expectedIds) {
    const detail = await wiring.apiDetail.GET(new Request(`http://fixture.invalid/api/products/${id}`), { params: { id: String(id) } });
    assert.equal(detail.status, 200); const data = await detail.json(); noPrivate(data);
    const matched = rows.find(row => row.id === id); assert.equal(data.name, matched.name); assert.equal(data.imageUrl, matched.imageUrl); assert.equal(data.category, matched.category);
    const ssr = await wiring.ssrPage.default({ params: { id: String(id) } }); assert.equal(ssr.props.product.id, id);
    const html = renderToStaticMarkup(React.createElement(client.default, { product: ssr.props.product }));
    assert.ok(html.includes(data.name)); if (data.imageUrl) assert.ok(html.includes(`src="${data.imageUrl}"`)); else assert.ok(html.includes('品牌商品'));
    noPrivate(html);
  }
  for (const id of hiddenIds) {
    const detail = await wiring.apiDetail.GET(new Request(`http://fixture.invalid/api/products/${id}`), { params: { id: String(id) } }); assert.equal(detail.status, 404, `hidden ${id}`);
    await assert.rejects(wiring.ssrPage.default({ params: { id: String(id) } }), /NOT_FOUND/);
  }
  snapshots.push({ label, publicIds: rows.map(row => row.id), categories: [...visible], hiddenIds }); return { rows, visible };
}
try {
 store.withWrite(state => {
   state.brands = [brand(1, 101), brand(2, 102), brand(3, 103, 'pending')];
   state.products = [product(1001, 1), product(1002, 2), product(1003, 3, '私有分類', { isActive: true, salesStatus: 'active' }),
     product(1004, 1, '未審分類', { status: 'pending', reviewStatus: 'pending', isActive: true, salesStatus: 'active' }), product(1005, 1, '售罄分類', { stockQuantity: 0, isActive: true, salesStatus: 'active' })];
 });
 const localWiring = wire(false);
 await test('actual repository -> public list/detail APIs and SSR hide unpublished/pending brand/out-of-stock data', async () => {
   const result = await observe(localWiring, [], [1001, 1002, 1003, 1004, 1005], 'initial-hidden'); same(result.visible, ['全部']);
 });
 await test('actual owner publish toggle -> fresh API -> categories -> detail DTO/image and SSR data', async () => {
   local.updateBrandProduct({ id: 101, name: '合成擁有人' }, 1001, 'toggle', { isActive: true });
   const result = await observe(localWiring, [1001], [1002, 1003, 1004, 1005], 'first-published'); same(result.visible, ['全部', '健康优选', '益生菌']);
   const png = readFileSync(path.join(root, 'public', fixtureImage)); assert.equal(png.subarray(1, 4).toString(), 'PNG');
 });
 await test('same-category second owner publication keeps public/private fields separated', async () => {
   local.updateBrandProduct({ id: 102, name: '合成第二擁有人' }, 1002, 'toggle', { isActive: true });
   const result = await observe(localWiring, [1001, 1002], [1003, 1004, 1005], 'second-published'); same(result.visible, ['全部', '健康优选', '益生菌']);
 });
 await test('unpublish first product -> detail unavailable while remaining category stays', async () => {
   local.updateBrandProduct({ id: 101, name: '合成擁有人' }, 1001, 'toggle', { isActive: false });
   const result = await observe(localWiring, [1002], [1001, 1003, 1004, 1005], 'first-unpublished'); assert.ok(result.visible.includes('益生菌'));
 });
 await test('unpublish last product -> empty category disappears and direct stale detail cannot leak', async () => {
   local.updateBrandProduct({ id: 102, name: '合成第二擁有人' }, 1002, 'toggle', { isActive: false });
   const result = await observe(localWiring, [], [1001, 1002, 1003, 1004, 1005], 'last-unpublished'); same(result.visible, ['全部']);
 });
 await test('fresh module read uses same persisted published state, then approved-brand revocation hides its product', async () => {
   local.updateBrandProduct({ id: 101, name: '合成擁有人' }, 1001, 'toggle', { isActive: true });
   await observe(wire(false), [1001], [1002, 1003, 1004, 1005], 'fresh-reader');
   store.withWrite(state => { state.brands.find(row => row.id === 1).status = 'pending'; });
   const result = await observe(wire(false), [], [1001, 1002, 1003, 1004, 1005], 'brand-fixture-revoked'); same(result.visible, ['全部']);
 });
 const enabledProduct = (id, brandId, extra = {}) => ({ ...product(id, brandId, '益生菌', { isActive: true, salesStatus: 'active', ...extra }), ownerMemberId: brandId + 100 });
 dbState = { brands: [brand(11, 111), brand(12, 112, 'pending')], products: [],
   brandProducts: [enabledProduct(2001, 11), enabledProduct(2002, 11, { name: 'TEST qa-private-candidate' }), enabledProduct(2003, 12), enabledProduct(2004, 11, { isActive: false, salesStatus: 'archived' })],
   brandProductImages: [2001, 2002, 2003, 2004].map(id => ({ productId: id, url: fixtureImage, sortOrder: 0 })) };
 await test('actual DB public function slices -> public API/detail agree and hide TEST/unapproved/offline rows', async () => {
   await observe(wire(true), [2001], [2002, 2003, 2004], 'db-public-filtered');
 });
 await test('direct API and SSR lookup reject DB TEST product even without a catalog click', async () => {
   const wiring = wire(true);
   const response = await wiring.apiDetail.GET(new Request('http://fixture.invalid/api/products/2002'), { params: { id: '2002' } });
   assert.equal(response.status, 404);
   await assert.rejects(wiring.ssrPage.default({ params: { id: '2002' } }), /NOT_FOUND/);
 });
 await test('DB fixture unpublish -> no category or direct-detail leak after fresh query', async () => {
   dbState.brandProducts.find(row => row.id === 2001).isActive = false;
   const result = await observe(wire(true), [], [2001, 2002, 2003, 2004], 'db-all-hidden'); same(result.visible, ['全部']);
 });
 const files = ['lib/local-cn-brand-marketplace.ts', 'lib/local-brand-page-repository.ts', 'lib/product-public.ts', 'lib/public-products.ts', 'lib/shop-categories.ts', 'lib/brand-pilot-db.ts', 'lib/catalog.ts', 'app/api/products/route.ts', 'app/api/products/[id]/route.ts', 'app/cn/shop/[id]/page.tsx', 'app/cn/shop/[id]/ProductDetailClient.tsx', 'components/ShopProductImage.tsx'];
 const report = { checkedAt: new Date().toISOString(), phase: process.env.LIFECYCLE_PHASE || 'after', status: results.every(row => row.status === 'PASS') ? 'LOCAL_CONNECTED_PRODUCT_MODULES_PASS_NOT_FORMAL_E2E' : 'REPRODUCED_CONNECTED_SOURCE_FAILURE',
   results, counts: { pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status === 'FAIL').length }, snapshots,
   sourceHashes: Object.fromEntries(files.map(file => [file, fingerprint(source(file))])), slices, dbQueries,
   method: 'Real isolated JSON repository lock/write/rename/read; exact owner toggle/public functions; actual public DTO/lookup/list+detail handlers returning real NextResponse; actual SSR page and React detail/image components. DB source query/function bodies use in-memory predicate query adapter, not SQL/DB.',
   limits: ['Owner identity/organization predicates are synthetic; no real login/auth grants tested.', 'Brand/stock/DB status setup changes are fixture preconditions, not real moderation or DB transactions.', 'No HTTP server, browser, Next routing/image optimizer, physical image fetch or pixel checks.', 'Image assertion proves packaged PNG bytes and DTO-to-rendered-src only, not actual image network loading.', 'No real accounts/products/network/deployment/data/recognition or v6.'],
   cleanup: { temporaryRepositoryRemoved: true, productionOrProjectDataRead: false, localServerStarted: false, browserAttempted: false } };
 writeFileSync(path.join(output, `${report.phase}-results.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, counts: report.counts, results }, null, 2)); process.exitCode = report.counts.fail ? 1 : 0;
} finally { rmSync(temporary, { recursive: true, force: true }); }
