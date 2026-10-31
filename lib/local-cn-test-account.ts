import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import {
  CAOMI_TEST_ACCOUNT_USER_ID,
  ensureLocalCnTestAccount,
} from './local-cn-users';

type JsonObject = Record<string, unknown>;

export function isCnTestAccountEnabled() {
  if (process.env.CN_ENABLE_TEST_LOGIN === 'true') return true;
  if (process.env.CN_ENABLE_TEST_LOGIN === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function isCnAdminTestAccountOpenWithoutCode() {
  return process.env.NODE_ENV !== 'production' || process.env.CN_ALLOW_WEB_ADMIN_TEST_LOGIN === 'true';
}

export function isCnPrivateAdminLoginEnabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.CN_PRIVATE_ADMIN_LINK_ENABLED === 'true'
    && Boolean(String(process.env.CN_ADMIN_TEST_ACCESS_CODE || '').trim());
}

export function isAllowedCnTestMiniEnvironment(value: string | null) {
  return value === 'develop' || value === 'trial';
}

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function readJson<T>(fileName: string, fallback: T): T {
  const target = path.join(dataDir(), fileName);
  if (!existsSync(target)) return fallback;
  try { return JSON.parse(readFileSync(target, 'utf8')) as T; }
  catch { return fallback; }
}

function writeJson(fileName: string, value: unknown) {
  const target = path.join(dataDir(), fileName);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, target);
}

function removeMatchingFiles(directory: string, match: (name: string) => boolean) {
  if (!existsSync(directory)) return 0;
  let removed = 0;
  for (const name of readdirSync(directory)) {
    if (!match(name)) continue;
    rmSync(path.join(directory, name), { force: true, recursive: true });
    removed += 1;
  }
  return removed;
}

function numericSet(values: unknown[]) {
  return new Set(values.map((value) => Number(value)).filter(Number.isFinite));
}

export function resetLocalCnTestAccountData() {
  const testUser = ensureLocalCnTestAccount();
  const result = {
    brands: 0,
    products: 0,
    stores: 0,
    orders: 0,
    addresses: 0,
    teamRecords: 0,
    healthWorkspace: 0,
    uploadedFiles: 0,
  };

  const marketplace = readJson<JsonObject>('cn-brand-marketplace.json', { schemaVersion: 1, revision: 1, brands: [], products: [], audits: [] });
  const brands = Array.isArray(marketplace.brands) ? marketplace.brands as JsonObject[] : [];
  const removedBrands = brands.filter((brand) => Number(brand.applicantUserId) === CAOMI_TEST_ACCOUNT_USER_ID || Number(brand.accountUserId) === CAOMI_TEST_ACCOUNT_USER_ID);
  const removedBrandIds = numericSet(removedBrands.map((brand) => brand.id));
  const products = Array.isArray(marketplace.products) ? marketplace.products as JsonObject[] : [];
  const removedProducts = products.filter((product) => removedBrandIds.has(Number(product.brandId)) || Number(product.ownerUserId) === CAOMI_TEST_ACCOUNT_USER_ID);
  const removedProductIds = numericSet(removedProducts.map((product) => product.id));
  result.brands = removedBrands.length;
  result.products = removedProducts.length;
  marketplace.brands = brands
    .filter((brand) => !removedBrandIds.has(Number(brand.id)))
    .map((brand) => removedBrandIds.has(Number(brand.referrerBrandId))
      ? { ...brand, referrerBrandId: null, referrerBrandName: '', referrerBrandCode: '' }
      : brand);
  marketplace.products = products.filter((product) => !removedProductIds.has(Number(product.id)));
  marketplace.audits = (Array.isArray(marketplace.audits) ? marketplace.audits as JsonObject[] : []).filter((audit) => {
    if (Number(audit.actorId) === CAOMI_TEST_ACCOUNT_USER_ID) return false;
    if (audit.entityType === 'brand' && removedBrandIds.has(Number(audit.entityId))) return false;
    return !(audit.entityType === 'product' && removedProductIds.has(Number(audit.entityId)));
  });
  marketplace.revision = Number(marketplace.revision || 0) + 1;
  writeJson('cn-brand-marketplace.json', marketplace);

  const stores = readJson<JsonObject[]>('cn-store-applications.json', []);
  const removedStores = stores.filter((store) => Number(store.applicantId) === CAOMI_TEST_ACCOUNT_USER_ID);
  const removedStoreIds = new Set(removedStores.map((store) => String(store.id || '')));
  result.stores = removedStores.length;
  writeJson('cn-store-applications.json', stores
    .filter((store) => !removedStoreIds.has(String(store.id || '')))
    .map((store) => ({
      ...store,
      participants: (Array.isArray(store.participants) ? store.participants as JsonObject[] : []).filter((participant) => Number(participant.userId) !== CAOMI_TEST_ACCOUNT_USER_ID),
    })));

  const addresses = readJson<JsonObject[]>('cn-addresses.json', []);
  result.addresses = addresses.filter((address) => Number(address.userId) === CAOMI_TEST_ACCOUNT_USER_ID).length;
  writeJson('cn-addresses.json', addresses.filter((address) => Number(address.userId) !== CAOMI_TEST_ACCOUNT_USER_ID));

  const organizations = readJson<{ members?: JsonObject[]; invites?: JsonObject[] }>('cn-organization-members.json', { members: [], invites: [] });
  const members = Array.isArray(organizations.members) ? organizations.members : [];
  const invites = Array.isArray(organizations.invites) ? organizations.invites : [];
  const shouldRemoveOrganization = (row: JsonObject) => (row.organizationType === 'brand' && removedBrandIds.has(Number(row.organizationId))) || (row.organizationType === 'store' && removedStoreIds.has(String(row.organizationId)));
  const nextMembers = members.filter((row) => Number(row.userId) !== CAOMI_TEST_ACCOUNT_USER_ID && Number(row.invitedBy) !== CAOMI_TEST_ACCOUNT_USER_ID && !shouldRemoveOrganization(row));
  const nextInvites = invites.filter((row) => Number(row.inviterId) !== CAOMI_TEST_ACCOUNT_USER_ID && Number(row.acceptedBy) !== CAOMI_TEST_ACCOUNT_USER_ID && !shouldRemoveOrganization(row));
  result.teamRecords = members.length + invites.length - nextMembers.length - nextInvites.length;
  writeJson('cn-organization-members.json', { members: nextMembers, invites: nextInvites });

  const commerce = readJson<JsonObject>('cn-commerce.json', {
    schemaVersion: 4, revision: 1, orders: [], partnerships: [], curatedProducts: [], walletEntries: [], withdrawals: [], paymentEvents: [], refunds: [], auditEvents: [], jobRuns: [], idempotency: {},
  });
  const orders = Array.isArray(commerce.orders) ? commerce.orders as JsonObject[] : [];
  const removedOrders = orders.filter((order) => Number(order.userId) === CAOMI_TEST_ACCOUNT_USER_ID || (Array.isArray(order.items) && (order.items as JsonObject[]).some((item) => removedBrandIds.has(Number(item.brandId)) || removedProductIds.has(Number(item.productId)))));
  const removedOrderIds = numericSet(removedOrders.map((order) => order.id));
  const removedOrderNos = new Set(removedOrders.map((order) => String(order.orderNo || '')));
  result.orders = removedOrders.length;
  commerce.orders = orders.filter((order) => !removedOrderIds.has(Number(order.id)));
  commerce.partnerships = (Array.isArray(commerce.partnerships) ? commerce.partnerships as JsonObject[] : []).filter((row) => !removedBrandIds.has(Number(row.referrerBrandId)) && !removedBrandIds.has(Number(row.ownerBrandId)));
  commerce.curatedProducts = (Array.isArray(commerce.curatedProducts) ? commerce.curatedProducts as JsonObject[] : []).filter((row) => !removedBrandIds.has(Number(row.referrerBrandId)) && !removedProductIds.has(Number(row.productId)));
  commerce.walletEntries = (Array.isArray(commerce.walletEntries) ? commerce.walletEntries as JsonObject[] : []).filter((row) => Number(row.userId) !== CAOMI_TEST_ACCOUNT_USER_ID && !removedOrderIds.has(Number(row.orderId)));
  commerce.withdrawals = (Array.isArray(commerce.withdrawals) ? commerce.withdrawals as JsonObject[] : []).filter((row) => Number(row.userId) !== CAOMI_TEST_ACCOUNT_USER_ID);
  commerce.paymentEvents = (Array.isArray(commerce.paymentEvents) ? commerce.paymentEvents as JsonObject[] : []).filter((row) => !removedOrderIds.has(Number(row.orderId)));
  commerce.refunds = (Array.isArray(commerce.refunds) ? commerce.refunds as JsonObject[] : []).filter((row) => !removedOrderIds.has(Number(row.orderId)) && !removedOrderNos.has(String(row.orderNo || '')));
  commerce.auditEvents = (Array.isArray(commerce.auditEvents) ? commerce.auditEvents as JsonObject[] : []).filter((row) => Number(row.actorId) !== CAOMI_TEST_ACCOUNT_USER_ID && !(row.entityType === 'order' && removedOrderIds.has(Number(row.entityId))));
  commerce.jobRuns = (Array.isArray(commerce.jobRuns) ? commerce.jobRuns as JsonObject[] : []).map((row) => ({ ...row, confirmedOrderIds: (Array.isArray(row.confirmedOrderIds) ? row.confirmedOrderIds : []).filter((id) => !removedOrderIds.has(Number(id))) }));
  const idempotency = commerce.idempotency && typeof commerce.idempotency === 'object' ? commerce.idempotency as Record<string, unknown> : {};
  commerce.idempotency = Object.fromEntries(Object.entries(idempotency).filter(([key, value]) => {
    const text = `${key}:${String(value || '')}`;
    return !text.includes(String(CAOMI_TEST_ACCOUNT_USER_ID)) && !Array.from(removedOrderIds).some((id) => text.includes(String(id))) && !Array.from(removedOrderNos).some((orderNo) => orderNo && text.includes(orderNo));
  }));
  commerce.revision = Number(commerce.revision || 0) + 1;
  writeJson('cn-commerce.json', commerce);

  const workspaceFile = path.join(dataDir(), `workspace-member-${CAOMI_TEST_ACCOUNT_USER_ID}.json`);
  if (existsSync(workspaceFile)) {
    rmSync(workspaceFile, { force: true });
    result.healthWorkspace = 1;
  }
  result.uploadedFiles += removeMatchingFiles(path.join(dataDir(), 'brand-documents'), (name) => name.includes(`-${CAOMI_TEST_ACCOUNT_USER_ID}-`) || Array.from(removedBrandIds).some((id) => name.includes(`-${id}-`)));
  result.uploadedFiles += removeMatchingFiles(path.join(dataDir(), 'store-documents'), (name) => name.includes(`-${CAOMI_TEST_ACCOUNT_USER_ID}-`) || Array.from(removedStoreIds).some((id) => id && name.includes(id)));

  return { user: testUser, removed: result };
}
