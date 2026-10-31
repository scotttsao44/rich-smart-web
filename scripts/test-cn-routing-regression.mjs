import assert from 'node:assert/strict';

const baseUrl = (process.argv[2] || process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const LOGIN = '/cn/login';
const HOME = '/cn/shop';
const MEMBER_HOME = '/cn/home';

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
}

function locationPath(response) {
  const location = response.headers.get('location');
  assert.ok(location, `expected ${response.url || 'response'} to include a Location header`);
  return new URL(location, baseUrl).pathname;
}

function locationUrl(response) {
  const location = response.headers.get('location');
  assert.ok(location, `expected ${response.url || 'response'} to include a Location header`);
  return new URL(location, baseUrl);
}

async function assertRedirect(path, expectedPath, options = {}) {
  const response = await request(path, options);
  assert.ok([307, 308].includes(response.status), `${path} should redirect, got ${response.status}`);
  assert.equal(locationPath(response), expectedPath, `${path} should redirect to ${expectedPath}`);
  return response;
}

async function assertPublic(path) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} should be publicly browsable`);
  return response;
}

async function assertProtected(path) {
  const response = await assertRedirect(path, LOGIN);
  const location = locationUrl(response);
  assert.equal(location.searchParams.get('next'), path, `${path} should preserve a safe next target`);
}

async function testTemporaryLogin(action) {
  const response = await request('/api/auth/test-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-caomi-mini-env': 'trial' },
    body: JSON.stringify({ action }),
  });
  assert.equal(response.status, 200, `${action} temporary login should be available in local/test mode`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, `${action} should receive a session cookie`);
  await assertRedirect(LOGIN, HOME, { headers: { cookie } });
  await assertRedirect(`${LOGIN}?next=%2Fcn%2Fmember`, '/cn/member', { headers: { cookie } });
  return cookie;
}

await assertRedirect('/cn', HOME);
await assertRedirect('/', HOME);
await assertPublic(HOME);
await assertPublic(MEMBER_HOME);
await assertPublic('/cn/shop?category=%E7%9B%8A%E7%94%9F%E8%8F%8C');

const productsResponse = await request('/api/products');
assert.equal(productsResponse.status, 200, 'public product API should stay available for the shop');
const products = await productsResponse.json();
const firstProduct = Array.isArray(products) ? products[0] : null;
if (firstProduct?.id) await assertPublic(`/cn/shop/${firstProduct.id}`);
const brandedProduct = Array.isArray(products) ? products.find((product) => product.brandSlug) : null;
if (brandedProduct?.brandSlug) await assertPublic(`/cn/brands/${encodeURIComponent(brandedProduct.brandSlug)}`);

const memberWorkspaceApi = await request('/api/cn/workspaces/member');
assert.equal(memberWorkspaceApi.status, 401, 'member workspace API should remain protected');

for (const path of ['/cn/member', '/cn/brand/apply', '/cn/store', '/cn/ops', '/cn/orders', '/cn/cart', '/cn/promoter', '/cn/experience', '/vendor']) {
  await assertProtected(path);
}

const loginPage = await request(LOGIN);
assert.equal(loginPage.status, 200, 'login page should stay public');

const withSession = { headers: { cookie: 'richsmart_session=route-regression' } };

await assertRedirect('/cn', HOME, withSession);
await assertRedirect(LOGIN, HOME, withSession);
await assertRedirect(`${LOGIN}?next=%2Fcn%2Forders`, '/cn/orders', withSession);
await assertRedirect(`${LOGIN}?next=https%3A%2F%2Fevil.example%2Fsteal`, HOME, withSession);
const switchLogin = await request(`${LOGIN}?switch=1`, withSession);
assert.equal(switchLogin.status, 200, 'account switch login should remain accessible');

const shop = await request(HOME);
assert.equal(shop.status, 200, 'shop should stay public without a session');

await testTemporaryLogin('login');
await testTemporaryLogin('login_admin');

console.log(JSON.stringify({
  ok: true,
  tested: [
    'unauthenticated /cn and site root redirect to /cn/shop',
    'shop, category, brand front page, and product detail pages are public',
    'public product API remains available while member workspace API remains protected',
    'unauthenticated member, brand application, store, checkout, orders, referral, platform, and vendor pages redirect to /cn/login with safe next',
    'signed-in login honors safe next and rejects malicious external next',
    'temporary member and super-admin test entries land on /cn/shop by default and honor protected return targets',
    'account switch login remains available with switch=1',
  ],
}, null, 2));
