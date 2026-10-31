import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

type Role = 'brand' | 'store' | 'agent' | 'member' | 'admin';

const defaults: Record<Role, any> = {
  admin: { customRules: [] },
  brand: { metrics: [], products: [], orders: [], channels: [], notices: [], settlementRules: [] },
  store: { metrics: [], appointments: [], followUps: [], members: [], orders: [], settlements: [] },
  agent: { metrics: [], stores: [], referrals: [], appointments: [], orders: [], settlements: [], channelFees: [] },
  member: { metrics: [{ label: '直接推荐', value: '0' }, { label: '推荐预约', value: '0' }, { label: '推荐订单', value: '0' }, { label: '可提现收益', value: '¥0.00' }], referralCode: '', referrals: [], appointments: [], orders: [], commissions: [] },
};

function file(role: Role) { const dir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'); return path.join(dir, `workspace-${role}.json`); }
export function getWorkspace(role: Role) { const target = file(role); if (!existsSync(target)) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(defaults[role], null, 2)); return defaults[role]; } try { const saved = JSON.parse(readFileSync(target, 'utf8')); const merged = { ...defaults[role], ...saved }; if (role === 'store' && Array.isArray(merged.settlements)) merged.settlements = merged.settlements.filter((row: any) => row.type !== '商城分润'); if (Object.keys(defaults[role]).some((key) => saved[key] === undefined) || (role === 'store' && JSON.stringify(saved.settlements || []) !== JSON.stringify(merged.settlements))) writeFileSync(target, JSON.stringify(merged, null, 2)); return merged; } catch { return defaults[role]; } }
export function updateWorkspace(role: Role, pathKey: string, id: string, updates: Record<string, unknown>) { const data = getWorkspace(role); const rows = Array.isArray(data[pathKey]) ? data[pathKey] : []; const index = rows.findIndex((row: any) => String(row.id || row.name) === id); if (index < 0) return null; rows[index] = { ...rows[index], ...updates }; data[pathKey] = rows; writeFileSync(file(role), JSON.stringify(data, null, 2)); return rows[index]; }
export function addWorkspaceItem(role: Role, pathKey: string, item: Record<string, unknown>) { const data = getWorkspace(role); const rows = Array.isArray(data[pathKey]) ? data[pathKey] : []; rows.unshift(item); data[pathKey] = rows; mkdirSync(path.dirname(file(role)), { recursive: true }); writeFileSync(file(role), JSON.stringify(data, null, 2)); return item; }
export function isWorkspaceRole(value: string): value is Role { return ['brand', 'store', 'agent', 'member', 'admin'].includes(value); }
