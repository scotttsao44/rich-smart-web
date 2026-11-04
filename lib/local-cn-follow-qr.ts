import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { findLocalCnUserById, findLocalCnUserByReferralCode, localCnPromotionQualification, referralOwnerForAttribution } from '@/lib/local-cn-users';
import { createMpLimitQr } from '@/lib/wechat-mp-api';

// 专属关注码：有推荐资格的会员生成服务号永久带参二维码（scene_str = ref_<推荐码>）。
// 扫码关注/已关注扫码 → 事件处理把该 openid 的首次来源绑定到推荐码（先到先得，不覆盖）；
// 之后该 openid 在网站登录/注册时，以此绑定作归属，优先于链接上的 ?ref。
// 不带参数的关注不做默认归属（走 AI 客服询问来源／后台核对，不默认官方直属）。

export const FOLLOW_QR_PAGE_PATH = '/cn/member/follow-qr';
export const FOLLOW_QR_PAGE_URL = `https://rich-smart.com.cn${FOLLOW_QR_PAGE_PATH}`;
export const FOLLOW_QR_HINT = `转发前请先生成您的专属二维码，再分享给朋友：${FOLLOW_QR_PAGE_URL}`;
const SCENE_PREFIX = 'ref_';

type MemberQr = { memberId: number; referralCode: string; sceneStr: string; ticket: string; url: string; createdAt: string };
type FollowBinding = { openid: string; referralCode: string; referrerMemberId: number; event: string; boundAt: string };
type State = { schemaVersion: 1; qrs: Record<string, MemberQr>; bindings: Record<string, FollowBinding> };

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}
function statePath() {
  return path.join(dataDir(), 'cn-follow-qr.json');
}
function readState(): State {
  try {
    if (existsSync(statePath())) {
      const parsed = JSON.parse(readFileSync(statePath(), 'utf8'));
      return { schemaVersion: 1, qrs: parsed.qrs && typeof parsed.qrs === 'object' ? parsed.qrs : {}, bindings: parsed.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {} };
    }
  } catch {}
  return { schemaVersion: 1, qrs: {}, bindings: {} };
}
function writeState(state: State) {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${statePath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, statePath());
}

// 与会员工作台发放推荐码的规则一致：归属已确认且已取得推广资格（购买或体验后授予）
export function followQrEligibility(memberId: number) {
  const user = findLocalCnUserById(memberId);
  if (!user) return { eligible: false as const, reason: 'member_not_found' };
  const q = localCnPromotionQualification(user);
  if (q.status !== 'granted') return { eligible: false as const, reason: q.reason || q.status };
  if (!referralOwnerForAttribution(memberId)) return { eligible: false as const, reason: 'referral_sharing_disabled' };
  return { eligible: true as const, user };
}

export function getMemberFollowQr(memberId: number): MemberQr | null {
  const user = findLocalCnUserById(memberId);
  const row = readState().qrs[String(memberId)];
  if (!row || !user || row.referralCode.toUpperCase() !== String(user.referralCode || '').toUpperCase()) return null;
  return row;
}

const inflight = new Map<number, Promise<{ ok: boolean; qr?: MemberQr; errcode?: string }>>();

export function ensureMemberFollowQr(memberId: number) {
  const running = inflight.get(memberId);
  if (running) return running;
  const task = (async () => {
    const check = followQrEligibility(memberId);
    if (!check.eligible) return { ok: false, errcode: check.reason };
    const cached = getMemberFollowQr(memberId);
    if (cached) return { ok: true, qr: cached };
    const referralCode = String(check.user.referralCode).toUpperCase();
    const sceneStr = `${SCENE_PREFIX}${referralCode}`.slice(0, 64);
    const r = await createMpLimitQr(sceneStr);
    if (!r.ok) {
      console.warn('[follow-qr] qrcode/create failed errcode=', r.errcode);
      return { ok: false, errcode: String(r.errcode) };
    }
    const qr: MemberQr = { memberId, referralCode, sceneStr, ticket: r.ticket, url: r.url, createdAt: new Date().toISOString() };
    const state = readState();
    state.qrs[String(memberId)] = qr;
    writeState(state);
    return { ok: true, qr };
  })().finally(() => inflight.delete(memberId));
  inflight.set(memberId, task);
  return task;
}

export function parseFollowRefScene(eventKey?: string | null) {
  const raw = String(eventKey || '').replace(/^qrscene_/, '').trim();
  if (!raw.startsWith(SCENE_PREFIX)) return null;
  const code = raw.slice(SCENE_PREFIX.length).trim();
  return code ? code : null;
}

// 首次来源绑定：先到先得，已有绑定不覆盖；推荐人须仍有推荐资格
export function bindFollowSource(openid: string, eventKey: string | null | undefined, event: string) {
  const code = parseFollowRefScene(eventKey);
  if (!openid || !code) return { bound: false, reason: 'no_ref_scene' };
  const state = readState();
  if (state.bindings[openid]) return { bound: false, reason: 'existing', referralCode: state.bindings[openid].referralCode };
  const owner = findLocalCnUserByReferralCode(code);
  if (!owner || !referralOwnerForAttribution(owner.id)) return { bound: false, reason: 'referrer_ineligible' };
  state.bindings[openid] = { openid, referralCode: owner.referralCode, referrerMemberId: owner.id, event, boundAt: new Date().toISOString() };
  writeState(state);
  return { bound: true, referralCode: owner.referralCode };
}

// 登录/注册时使用：该服务号 openid 的关注来源推荐码（推荐人失去资格则不用）
export function followBindingReferralCode(openid?: string | null) {
  if (!openid) return '';
  const row = readState().bindings[openid];
  if (!row) return '';
  const owner = findLocalCnUserById(row.referrerMemberId);
  if (!owner || !referralOwnerForAttribution(owner.id)) return '';
  return owner.referralCode;
}
