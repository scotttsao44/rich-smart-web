import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getRequestSession } from '@/lib/auth';
import { peekPendingReferrerMemberId } from '@/lib/local-cn-referral-attribution';
import { findLocalCnUserById, findLocalCnUserByReferralCode, referralOwnerForAttribution } from '@/lib/local-cn-users';
import { getKefuConversation } from '@/lib/local-cn-wechat-kefu';
import { STORE_APPLY_SCENE, startStoreApply } from '@/lib/wechat-kefu-store-apply';
import { createMpTempQr, getMpUserSubscribed } from '@/lib/wechat-mp-api';

// 门店申请页「联系糙米健康服务」：服务号临时带参二维码（scene=store_apply[:m会员|:r推荐人]），服务端按需生成并缓存。
// 扫码关注/已关注扫码 → 消息接口收到 subscribe/SCAN 事件 → 自动发门店申请问题模板（lib/wechat-kefu-store-apply.ts）。
// 不在日志或响应里输出 ticket、access_token。

export const dynamic = 'force-dynamic';

const QR_TTL_SECONDS = 30 * 24 * 60 * 60;
const CACHE_MARGIN_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
// 生成失败时的退路：原服务号永久二维码内容（与 /wechat-official-qr.jpg 相同，重新生成干净的图，不带参数）
const STATIC_FALLBACK_URL = 'http://weixin.qq.com/q/02VlSeBsEMegs10000w07f';

type CachedQr = { png: Buffer; expiresAt: number };
const qrCache = new Map<string, CachedQr>();
const inflight = new Map<string, Promise<CachedQr | null>>();
const followerCache = new Map<string, { value: boolean | null; at: number }>();

function memberOf(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session || !(session.id > 0) || session.role !== 'member') return null;
  return findLocalCnUserById(session.id);
}

function sceneFor(request: NextRequest) {
  const member = memberOf(request);
  if (member) return `${STORE_APPLY_SCENE}:m${member.id}`;
  const ref = String(request.nextUrl.searchParams.get('ref') || '').trim().slice(0, 100);
  const owner = ref ? findLocalCnUserByReferralCode(ref) : null;
  if (owner && referralOwnerForAttribution(owner.id)) return `${STORE_APPLY_SCENE}:r${owner.id}`;
  const pending = peekPendingReferrerMemberId(request);
  if (pending) return `${STORE_APPLY_SCENE}:r${pending}`;
  return STORE_APPLY_SCENE;
}

function png(url: string) {
  return QRCode.toBuffer(url, { type: 'png', width: 480, margin: 2, errorCorrectionLevel: 'M' });
}

async function qrForScene(scene: string): Promise<CachedQr | null> {
  const hit = qrCache.get(scene);
  if (hit && hit.expiresAt - CACHE_MARGIN_MS > Date.now()) return hit;
  const running = inflight.get(scene);
  if (running) return running;
  const task = (async () => {
    const r = await createMpTempQr(scene, QR_TTL_SECONDS);
    if (!r.ok) {
      console.warn('[store-apply-qr] qrcode/create failed errcode=', r.errcode);
      return null;
    }
    const entry = { png: await png(r.url), expiresAt: Date.now() + r.expireSeconds * 1000 };
    if (qrCache.size >= CACHE_MAX) {
      const oldest = qrCache.keys().next().value;
      if (oldest !== undefined) qrCache.delete(oldest);
    }
    qrCache.set(scene, entry);
    return entry;
  })().finally(() => inflight.delete(scene));
  inflight.set(scene, task);
  return task;
}

function inWechat(request: NextRequest) {
  return /MicroMessenger/i.test(request.headers.get('user-agent') || '');
}

async function followerStatus(request: NextRequest) {
  if (!inWechat(request)) return null;
  const openid = memberOf(request)?.wechatOfficialOpenId || '';
  if (!openid) return null;
  const hit = followerCache.get(openid);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;
  const value = await getMpUserSubscribed(openid);
  followerCache.set(openid, { value, at: Date.now() });
  return value;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('status') === '1') {
    return NextResponse.json({ follower: await followerStatus(request) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const scene = sceneFor(request);
  const qr = await qrForScene(scene).catch(() => null);
  if (qr) {
    return new NextResponse(new Uint8Array(qr.png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'X-Store-Apply-Qr': 'scene' },
    });
  }
  const fallback = await png(STATIC_FALLBACK_URL);
  return new NextResponse(new Uint8Array(fallback), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Store-Apply-Qr': 'fallback' },
  });
}

// 已关注服务号的会员在微信内点按钮：服务号直接发门店申请问题模板（客服消息，需 48 小时内互动过；失败则页面改显示二维码）
export async function POST(request: NextRequest) {
  if (!inWechat(request)) return NextResponse.json({ sent: false, reason: 'not_wechat' }, { status: 400 });
  const member = memberOf(request);
  const openid = member?.wechatOfficialOpenId || '';
  if (!member || !openid) return NextResponse.json({ sent: false, reason: 'not_linked' }, { status: 403 });
  if ((await followerStatus(request)) !== true) return NextResponse.json({ sent: false, reason: 'not_follower' });
  const recent = getKefuConversation(openid)?.storeApply;
  if (recent?.status === 'collecting' && recent.via === 'web_button' && Date.now() - Date.parse(recent.startedAt) < 60_000) {
    return NextResponse.json({ sent: true, reused: true });
  }
  await startStoreApply(openid, `${STORE_APPLY_SCENE}:m${member.id}`, 'web_button', Date.now() + 6000);
  const last = [...(getKefuConversation(openid)?.messages || [])].reverse().find((m) => m.tag === 'store_apply_template');
  const sent = last?.delivery === 'custom' || last?.delivery === 'simulated';
  return NextResponse.json({ sent, reason: sent ? undefined : 'custom_failed' });
}
