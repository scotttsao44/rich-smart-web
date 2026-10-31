import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

export type LocalCnAddress = {
  id: string;
  userId: number;
  name: string;
  phone: string;
  region: string;
  provinceCode?: string;
  province?: string;
  cityCode?: string;
  city?: string;
  districtCode?: string;
  district?: string;
  address: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

function dataFilePath() {
  const dataDir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'cn-addresses.json');
}

function readAll(): LocalCnAddress[] {
  const filePath = dataFilePath();
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(addresses: LocalCnAddress[]) {
  const filePath = dataFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(addresses, null, 2));
  renameSync(temporary, filePath);
}

export function listLocalCnAddresses(userId: number) {
  return readAll()
    .filter((item) => item.userId === userId)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

export function saveLocalCnAddress(userId: number, input: Partial<LocalCnAddress>) {
  const now = new Date().toISOString();
  const addresses = readAll();
  const id = String(input.id || `addr-${Date.now()}`);
  const existingIndex = addresses.findIndex((item) => item.id === id && item.userId === userId);
  const shouldDefault = Boolean(input.isDefault) || !addresses.some((item) => item.userId === userId);

  if (shouldDefault) {
    addresses.forEach((item) => {
      if (item.userId === userId) item.isDefault = false;
    });
  }

  const province = String(input.province || '').trim();
  const city = String(input.city || '').trim();
  const district = String(input.district || '').trim();
  const structuredRegion = [province, city === province ? '' : city, district].filter(Boolean).join('');
  const next: LocalCnAddress = {
    id,
    userId,
    name: String(input.name || '').trim(),
    phone: String(input.phone || '').trim(),
    region: structuredRegion || String(input.region || '').trim(),
    provinceCode: String(input.provinceCode || '').trim(),
    province,
    cityCode: String(input.cityCode || '').trim(),
    city,
    districtCode: String(input.districtCode || '').trim(),
    district,
    address: String(input.address || '').trim(),
    isDefault: shouldDefault || Boolean(existingIndex >= 0 && addresses[existingIndex]?.isDefault),
    createdAt: existingIndex >= 0 ? addresses[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) addresses[existingIndex] = next;
  else addresses.push(next);
  writeAll(addresses);
  return next;
}

export function deleteLocalCnAddress(userId: number, id: string) {
  const addresses = readAll();
  const target = addresses.find((item) => item.userId === userId && item.id === id);
  if (!target) return false;
  const next = addresses.filter((item) => !(item.userId === userId && item.id === id));
  if (target.isDefault) {
    const replacement = next.find((item) => item.userId === userId);
    if (replacement) replacement.isDefault = true;
  }
  writeAll(next);
  return true;
}

export function setDefaultLocalCnAddress(userId: number, id: string) {
  const addresses = readAll();
  const target = addresses.find((item) => item.userId === userId && item.id === id);
  if (!target) return null;
  addresses.forEach((item) => {
    if (item.userId === userId) item.isDefault = item.id === id;
  });
  target.updatedAt = new Date().toISOString();
  writeAll(addresses);
  return target;
}
