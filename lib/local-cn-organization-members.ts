import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SessionUser } from './auth';

export type OrganizationType = 'brand' | 'store';
export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'service' | 'finance' | 'viewer';

type OrganizationMember = { organizationType: OrganizationType; organizationId: string; organizationName: string; userId: number; userName: string; role: OrganizationRole; joinedAt: string; invitedBy: number };
type OrganizationInvite = { token: string; organizationType: OrganizationType; organizationId: string; organizationName: string; role: OrganizationRole; inviterId: number; inviterName: string; expiresAt: string; acceptedAt: string | null; acceptedBy: number | null; createdAt: string };
type State = { members: OrganizationMember[]; invites: OrganizationInvite[] };

function targetFile() { return path.join(process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'), 'cn-organization-members.json'); }
function readState(): State { if (!existsSync(targetFile())) return { members: [], invites: [] }; try { const value = JSON.parse(readFileSync(targetFile(), 'utf8')); return { members: Array.isArray(value.members) ? value.members : [], invites: Array.isArray(value.invites) ? value.invites : [] }; } catch { return { members: [], invites: [] }; } }
function writeState(state: State) { mkdirSync(path.dirname(targetFile()), { recursive: true }); const temp = `${targetFile()}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(state, null, 2)); renameSync(temp, targetFile()); }

export function hasOrganizationMembership(type: OrganizationType, id: string | number, userId: number) { return readState().members.some((member) => member.organizationType === type && member.organizationId === String(id) && member.userId === userId); }
export function getOrganizationRole(type: OrganizationType, id: string | number, userId: number) { return readState().members.find((member) => member.organizationType === type && member.organizationId === String(id) && member.userId === userId)?.role || null; }
export function ensureOrganizationMembership(input: { organizationType: OrganizationType; organizationId: string | number; organizationName: string; userId: number; userName: string; role: OrganizationRole; invitedBy: number }) {
  const state = readState();
  const now = new Date().toISOString();
  const organizationId = String(input.organizationId);
  const existing = state.members.find((member) => member.organizationType === input.organizationType && member.organizationId === organizationId && member.userId === input.userId);
  if (existing) {
    existing.organizationName = input.organizationName;
    existing.userName = input.userName;
    existing.role = input.role;
  } else {
    state.members.push({ organizationType: input.organizationType, organizationId, organizationName: input.organizationName, userId: input.userId, userName: input.userName, role: input.role, joinedAt: now, invitedBy: input.invitedBy });
  }
  writeState(state);
  return existing || state.members[state.members.length - 1];
}
export function listOrganizationAccess(type: OrganizationType, id: string | number) { const state = readState(); return { members: state.members.filter((member) => member.organizationType === type && member.organizationId === String(id)), invites: state.invites.filter((invite) => invite.organizationType === type && invite.organizationId === String(id) && !invite.acceptedAt && invite.expiresAt > new Date().toISOString()) }; }
export function createOrganizationInvite(user: SessionUser, input: { organizationType: OrganizationType; organizationId: string; organizationName: string; role: OrganizationRole }) { const allowed: OrganizationRole[] = ['admin', 'editor', 'service', 'finance', 'viewer']; if (!allowed.includes(input.role)) throw new Error('邀请职位不正确'); const state = readState(); const now = new Date(); const invite: OrganizationInvite = { token: crypto.randomBytes(18).toString('hex'), organizationType: input.organizationType, organizationId: String(input.organizationId), organizationName: input.organizationName, role: input.role, inviterId: user.id, inviterName: user.name, expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(), acceptedAt: null, acceptedBy: null, createdAt: now.toISOString() }; state.invites.unshift(invite); writeState(state); return invite; }
export function getOrganizationInvite(token: string) { return readState().invites.find((invite) => invite.token === token) || null; }
export function acceptOrganizationInvite(user: SessionUser, token: string) { const state = readState(); const invite = state.invites.find((item) => item.token === token); if (!invite) throw new Error('邀请不存在'); if (invite.acceptedAt) throw new Error('邀请已经使用'); if (invite.expiresAt <= new Date().toISOString()) throw new Error('邀请已经过期'); const now = new Date().toISOString(); const existing = state.members.find((member) => member.organizationType === invite.organizationType && member.organizationId === invite.organizationId && member.userId === user.id); if (existing) existing.role = invite.role; else state.members.push({ organizationType: invite.organizationType, organizationId: invite.organizationId, organizationName: invite.organizationName, userId: user.id, userName: user.name, role: invite.role, joinedAt: now, invitedBy: invite.inviterId }); invite.acceptedAt = now; invite.acceptedBy = user.id; writeState(state); return { invite, member: existing || state.members[state.members.length - 1] }; }
