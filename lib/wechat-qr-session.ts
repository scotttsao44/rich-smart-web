import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export type WechatQrSession = {
  sid: string;
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'consumed' | 'denied';
  // 'admin'：电脑端「微信扫码验证管理员」；只能由 /api/auth/wechat/kefu-admin 以白名单 openid 确认
  purpose?: 'admin';
  adminOpenid?: string;
  referrerCode: string;
  returnTo: string;
  createdAt: number;
  expiresAt: number;
  scannedAt?: number;
  confirmedAt?: number;
  consumedAt?: number;
  memberId?: number;
  wxIdentityToken?: string;
  nickname?: string;
};

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function sessionsFilePath() {
  return path.join(dataDir(), 'cn-wechat-qr-sessions.json');
}

function readSessions(): WechatQrSession[] {
  try {
    const file = sessionsFilePath();
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: WechatQrSession[]) {
  mkdirSync(dataDir(), { recursive: true });
  const file = sessionsFilePath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(sessions, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}

export function createWechatQrSession(input: { referrerCode?: string; returnTo?: string; purpose?: 'admin' }): WechatQrSession {
  const now = Date.now();
  const sessions = readSessions().filter((s) => now - s.createdAt < 15 * 60 * 1000);
  const sid = randomBytes(12).toString('hex');
  const session: WechatQrSession = {
    sid,
    status: 'pending',
    referrerCode: String(input.referrerCode || '').trim().toUpperCase(),
    returnTo: String(input.returnTo || '/cn/member').trim() || '/cn/member',
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000,
    ...(input.purpose === 'admin' ? { purpose: 'admin' as const } : {}),
  };
  sessions.push(session);
  writeSessions(sessions);
  return session;
}

export function getWechatQrSession(sid: string): WechatQrSession | null {
  const cleanSid = String(sid || '').trim();
  if (!cleanSid) return null;
  const sessions = readSessions();
  const session = sessions.find((s) => s.sid === cleanSid) || null;
  if (!session) return null;
  if (Date.now() > session.expiresAt && session.status !== 'expired' && session.status !== 'consumed') {
    session.status = 'expired';
    writeSessions(sessions);
  }
  return session;
}

export function markWechatQrSessionScanned(sid: string, nicknameHint?: string): WechatQrSession | null {
  const cleanSid = String(sid || '').trim();
  if (!cleanSid) return null;
  const sessions = readSessions();
  const session = sessions.find((s) => s.sid === cleanSid) || null;
  if (!session) return null;
  if (Date.now() > session.expiresAt && session.status !== 'expired' && session.status !== 'consumed') {
    session.status = 'expired';
    writeSessions(sessions);
    return session;
  }
  if (session.status === 'pending') {
    session.status = 'scanned';
    session.scannedAt = Date.now();
  }
  if (nicknameHint) {
    session.nickname = String(nicknameHint).trim().slice(0, 80);
  }
  writeSessions(sessions);
  return session;
}

export function confirmWechatQrSession(
  sid: string,
  input: { memberId: number; wxIdentityToken?: string; nickname?: string; adminOpenid?: string },
): WechatQrSession | null {
  const cleanSid = String(sid || '').trim();
  if (!cleanSid) return null;
  const sessions = readSessions();
  const session = sessions.find((s) => s.sid === cleanSid) || null;
  if (!session) return null;
  if (Date.now() > session.expiresAt || session.status === 'expired' || session.status === 'consumed' || session.status === 'denied') return null;
  // 管理员扫码会话只接受带白名单 openid 的确认；会员扫码流程不能确认它，反之亦然
  if ((session.purpose === 'admin') !== Boolean(input.adminOpenid)) return null;
  if (input.adminOpenid) session.adminOpenid = input.adminOpenid;
  session.status = 'confirmed';
  session.confirmedAt = Date.now();
  session.memberId = input.memberId;
  if (input.wxIdentityToken) session.wxIdentityToken = input.wxIdentityToken;
  if (input.nickname) session.nickname = String(input.nickname).trim().slice(0, 80);
  writeSessions(sessions);
  return session;
}

// 扫码会话只能兑换一次登录 Cookie：首次读取 confirmed 即标记 consumed；过期一律拒绝
export function consumeConfirmedWechatQrSession(sid: string): WechatQrSession | null {
  const cleanSid = String(sid || '').trim();
  if (!cleanSid) return null;
  const sessions = readSessions();
  const session = sessions.find((s) => s.sid === cleanSid) || null;
  if (!session || session.status !== 'confirmed' || !session.memberId || session.consumedAt) return null;
  if (Date.now() > session.expiresAt) {
    session.status = 'expired';
    writeSessions(sessions);
    return null;
  }
  session.status = 'consumed';
  session.consumedAt = Date.now();
  const result = { ...session };
  delete session.wxIdentityToken;
  delete session.adminOpenid;
  delete result.wxIdentityToken;
  writeSessions(sessions);
  return result;
}

// 管理员扫码：非白名单微信扫码 → 标记 denied，电脑端轮询显示「无管理员权限」
export function denyWechatQrSession(sid: string): WechatQrSession | null {
  const cleanSid = String(sid || '').trim();
  if (!cleanSid) return null;
  const sessions = readSessions();
  const session = sessions.find((s) => s.sid === cleanSid) || null;
  if (!session || session.purpose !== 'admin' || session.status === 'consumed' || session.status === 'expired') return null;
  session.status = 'denied';
  writeSessions(sessions);
  return session;
}

export function getLatestConfirmedWechatQrSession(): WechatQrSession | null {
  const sessions = readSessions().filter((s) => s.status === "confirmed" && s.memberId);
  if (sessions.length === 0) return null;
  sessions.sort((a, b) => (b.confirmedAt || b.createdAt || 0) - (a.confirmedAt || a.createdAt || 0));
  return sessions[0] || null;
}
