import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

// 共享设备「留资料洽谈」线索（LOCAL_CN JSON 存储）
export type LocalCnProductLead = {
  id: string;
  productId: number;
  productName: string;
  brandId: number;
  brandName: string;
  name: string;
  phone: string;
  city: string;
  note: string;
  memberId: number | null;
  referrerMemberId: number | null;
  referralCode: string | null;
  attributionId: string | null;
  linkId: string | null;
  sourcePath: string | null;
  createdAt: string;
};

type LeadState = { leads: LocalCnProductLead[] };

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function filePath() {
  return path.join(path.resolve(dataDir()), 'cn-product-leads.json');
}

function readState(): LeadState {
  const file = filePath();
  if (!existsSync(file)) return { leads: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { leads: Array.isArray(parsed?.leads) ? parsed.leads : [] };
  } catch {
    return { leads: [] };
  }
}

function writeState(state: LeadState) {
  const file = filePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, file);
}

export function createProductLead(input: Omit<LocalCnProductLead, 'id' | 'createdAt'>) {
  const state = readState();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentSame = state.leads.filter((row) => row.productId === input.productId && row.phone === input.phone && Date.parse(row.createdAt) > dayAgo);
  if (recentSame.length >= 1) {
    return { lead: recentSame[0], duplicate: true };
  }
  const recentPhone = state.leads.filter((row) => row.phone === input.phone && Date.parse(row.createdAt) > dayAgo);
  if (recentPhone.length >= 10) throw new Error('提交次数过多，请稍后再试');
  const lead: LocalCnProductLead = { ...input, id: `lead-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, createdAt: new Date().toISOString() };
  state.leads.unshift(lead);
  writeState(state);
  return { lead, duplicate: false };
}

export function listProductLeads(filter: { brandId?: number | null; all?: boolean }) {
  const leads = readState().leads;
  if (filter.all) return leads;
  if (!filter.brandId) return [];
  return leads.filter((row) => row.brandId === filter.brandId);
}
