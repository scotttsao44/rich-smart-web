import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { createLocalCnInvitedMember, findLocalCnUserByReferralCode, normalizeCnReferrerCode, type LocalCnUser } from './local-cn-users';
import type { SessionUser } from './auth';

export type PartnerInvitationStatus = 'pending' | 'used' | 'expired';

export type PartnerInvitation = {
  id: string;
  tokenHash: string;
  referralCode: string;
  inviteeName: string;
  inviteeContact: string;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByMemberId: number | null;
};

type InvitationState = {
  schemaVersion: 1;
  invitations: PartnerInvitation[];
};

export function isPartnerInvitationLoginEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.CN_PARTNER_INVITE_LOGIN_ENABLED === 'true';
}

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function filePath() {
  return path.join(dataDir(), 'cn-partner-invitations.json');
}

function readState(): InvitationState {
  try {
    if (!existsSync(filePath())) return { schemaVersion: 1, invitations: [] };
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8'));
    return { schemaVersion: 1, invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [] };
  } catch {
    return { schemaVersion: 1, invitations: [] };
  }
}

function writeState(state: InvitationState) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${filePath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filePath());
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}

function statusOf(invitation: PartnerInvitation, now = new Date()) : PartnerInvitationStatus {
  if (invitation.usedAt) return 'used';
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

function publicInvitation(invitation: PartnerInvitation, token?: string) {
  return {
    id: invitation.id,
    referralCode: invitation.referralCode,
    inviteeName: invitation.inviteeName,
    inviteeContact: invitation.inviteeContact,
    createdBy: invitation.createdBy,
    createdByName: invitation.createdByName,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    usedAt: invitation.usedAt,
    usedByMemberId: invitation.usedByMemberId,
    status: statusOf(invitation),
    ...(token ? { token, acceptUrl: `/cn/partner-invite?token=${encodeURIComponent(token)}` } : {}),
  };
}

export function listPartnerInvitations() {
  return readState().invitations
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((invitation) => publicInvitation(invitation));
}

export function createPartnerInvitation(user: SessionUser, input: Record<string, unknown>) {
  const referralCode = normalizeCnReferrerCode(String(input.referralCode || ''));
  if (!findLocalCnUserByReferralCode(referralCode) && referralCode !== 'RS-CN-OFFICIAL') throw new Error('推荐码不存在');
  const inviteeName = String(input.inviteeName || '').trim().slice(0, 80);
  const inviteeContact = String(input.inviteeContact || '').trim().slice(0, 120);
  if (!inviteeName) throw new Error('请填写受邀名称');
  if (!inviteeContact) throw new Error('请填写受邀联络方式');
  const days = Math.min(30, Math.max(1, Number(input.expiresInDays || 7) || 7));
  const now = new Date();
  const token = randomBytes(32).toString('base64url');
  const invitation: PartnerInvitation = {
    id: `PINV-${Date.now()}-${randomBytes(4).toString('hex')}`,
    tokenHash: hashToken(token),
    referralCode,
    inviteeName,
    inviteeContact,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedByMemberId: null,
  };
  const state = readState();
  state.invitations.unshift(invitation);
  writeState(state);
  return publicInvitation(invitation, token);
}

export function consumePartnerInvitation(token: string): { invitation: PartnerInvitation; user: LocalCnUser } {
  const tokenHash = hashToken(String(token || ''));
  if (!tokenHash) throw new Error('邀请链接不正确');
  const state = readState();
  const invitation = state.invitations.find((item) => item.tokenHash === tokenHash);
  if (!invitation) throw new Error('邀请不存在或已失效');
  const status = statusOf(invitation);
  if (status === 'used') throw new Error('邀请已使用');
  if (status === 'expired') throw new Error('邀请已过期');
  const user = createLocalCnInvitedMember({
    name: invitation.inviteeName,
    contact: invitation.inviteeContact,
    referrerCode: invitation.referralCode,
    invitationId: invitation.id,
  });
  invitation.usedAt = new Date().toISOString();
  invitation.usedByMemberId = user.id;
  writeState(state);
  return { invitation, user };
}
