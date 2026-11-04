import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import QRCode from 'qrcode';
import { ensureMemberFollowQr, followQrEligibility } from '@/lib/local-cn-follow-qr';
import { ensureReferrerContactWay, fetchQrImage } from '@/lib/local-cn-wecom';

// 推广长图：一张竖版 PNG，三个二维码都带会员推荐信息
//   ① 企业微信「联系我」码（state=推荐码）② 服务号专属关注码（ref_推荐码）③ 商城链接 /cn/shop?ref=推荐码
// 文字块可勾选：a 加企业微信说明 / b 7 项回复菜单 / c 店主・代理确认身份提示 / d 生成专属码提示
// 不写价格、分成比例或个人姓名。服务端渲染（@napi-rs/canvas + Noto Sans CJK SC 子集字体），按会员＋勾选缓存。
// 字体子集：public/fonts/poster（改了文案需重跑 scripts/subset-poster-font.sh）

export const POSTER_BLOCKS = ['a', 'b', 'c', 'd'] as const;
export type PosterBlock = (typeof POSTER_BLOCKS)[number];
const LAYOUT_VERSION = 'v1';
const SHOP_URL = 'https://rich-smart.com.cn/cn/shop';

export const POSTER_TEXT = {
  title: '加入「糙米量子」',
  subtitle: '扫码即识别专属推荐',
  s1: '① 扫码加企业微信',
  a: '添加企业微信，门店体验预约、新品和活动消息会第一时间发给你，有问题也可以随时咨询。',
  s1Cap: '长按识别 / 扫码添加企业微信',
  s2: '② 关注「糙米量子」服务号',
  s2Menu: '② 关注「糙米量子」服务号，回复数字办理：',
  s2Cap: '长按识别 / 扫码关注服务号',
  menu: ['预约到店体验', '我是店主（已有机器）', '申请品牌前页（主页）', '申请商品入驻', '申请门店合作', '了解门店／体验点', '我是代理／渠道'],
  c: '已有机器的店主请回复「2」，代理请回复「7」确认身份。我们每天生成推广和预约文章，帮门店带客流，欢迎多帮忙转发。',
  s3: '③ 前往「糙米量子」商城',
  s3Cap: '长按识别 / 扫码进入商城',
  dTitle: '转发前请先生成您的专属二维码',
  d: '关注服务号后进入「会员中心 → 生成我的专属关注码」，朋友扫您的码关注就记在您名下。',
  footer: 'rich-smart.com.cn · 客服 15862501498',
};

export function parsePosterBlocks(raw?: string | null): PosterBlock[] {
  if (raw == null) return [...POSTER_BLOCKS];
  const set = new Set(String(raw).toLowerCase().split('').filter((ch): ch is PosterBlock => (POSTER_BLOCKS as readonly string[]).includes(ch)));
  return POSTER_BLOCKS.filter((b) => set.has(b));
}

const W = 1080;
const PAD = 56;
const GREEN = '#1f7a4c';
const FONT = 'PosterSC';
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), 'public', 'fonts', 'poster');
  GlobalFonts.registerFromPath(path.join(dir, 'NotoSansSC-Poster-Regular.otf'), FONT);
  GlobalFonts.registerFromPath(path.join(dir, 'NotoSansSC-Poster-Bold.otf'), FONT);
  fontsReady = true;
}

const NO_LINE_START = '，。、；：！？）」』》〉】,.;:!?)';
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    if (line && ctx.measureText(line + ch).width > maxWidth && !NO_LINE_START.includes(ch)) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

type Inputs = { wecomImage: Buffer; followUrl: string; shopUrl: string };

async function qrPng(text: string, size: number) {
  return loadImage(await QRCode.toBuffer(text, { type: 'png', width: size, margin: 1, errorCorrectionLevel: 'M' }));
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function renderReferralPoster(blocks: PosterBlock[], input: Inputs) {
  ensureFonts();
  const has = (b: PosterBlock) => blocks.includes(b);
  const [wecomImg, followImg, shopImg] = await Promise.all([loadImage(input.wecomImage), qrPng(input.followUrl, 400), qrPng(input.shopUrl, 360)]);
  const font = (size: number, bold = false) => `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  const inner = W - PAD * 2;

  // 两遍：先量高度，再绘制
  const run = (ctx: SKRSContext2D, draw: boolean) => {
    let y = 0;
    const text = (t: string, x: number, yy: number, f: string, color: string, align: CanvasTextAlign = 'left') => {
      if (!draw) return;
      ctx.font = f;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(t, x, yy);
    };
    const para = (t: string, f: string, size: number, lh: number, color: string, x = PAD, width = inner) => {
      ctx.font = f;
      for (const l of wrap(ctx, t, width)) {
        text(l, x, y + size, f, color);
        y += lh;
      }
    };
    const image = (img: Awaited<ReturnType<typeof loadImage>>, size: number) => {
      if (draw) ctx.drawImage(img, (W - size) / 2, y, size, size);
      y += size;
    };
    // 头部
    if (draw) { ctx.fillStyle = GREEN; ctx.fillRect(0, 0, W, 230); }
    text(POSTER_TEXT.title, W / 2, 112, font(64, true), '#ffffff', 'center');
    text(POSTER_TEXT.subtitle, W / 2, 182, font(40), '#dcefe3', 'center');
    y = 290;
    // ① 企业微信
    para(POSTER_TEXT.s1, font(46, true), 46, 64, GREEN);
    if (has('a')) { y += 4; para(POSTER_TEXT.a, font(36), 36, 54, '#333333'); }
    y += 24;
    image(wecomImg, 440);
    y += 16;
    text(POSTER_TEXT.s1Cap, W / 2, y + 32, font(32), '#777777', 'center');
    y += 70;
    if (draw) { ctx.fillStyle = '#e5e5e5'; ctx.fillRect(PAD, y, inner, 3); }
    y += 50;
    // ② 服务号
    para(has('b') ? POSTER_TEXT.s2Menu : POSTER_TEXT.s2, font(46, true), 46, 64, GREEN);
    y += 24;
    image(followImg, 400);
    y += 16;
    text(POSTER_TEXT.s2Cap, W / 2, y + 32, font(32), '#777777', 'center');
    y += 66;
    if (has('b')) {
      POSTER_TEXT.menu.forEach((label, i) => {
        if (draw) {
          ctx.fillStyle = '#f2f7f4';
          roundRect(ctx, PAD, y, inner, 72, 16);
          ctx.fill();
          ctx.fillStyle = GREEN;
          ctx.beginPath();
          ctx.arc(PAD + 42, y + 36, 25, 0, Math.PI * 2);
          ctx.fill();
        }
        text(String(i + 1), PAD + 42, y + 48, font(32, true), '#ffffff', 'center');
        text(label, PAD + 90, y + 50, font(36), '#222222');
        y += 84;
      });
      y += 16;
    }
    if (has('c')) {
      ctx.font = font(38, true);
      const lines = wrap(ctx, POSTER_TEXT.c, inner - 60);
      const h = lines.length * 56 + 52;
      if (draw) {
        ctx.fillStyle = '#fff3d6';
        roundRect(ctx, PAD, y, inner, h, 22);
        ctx.fill();
        ctx.strokeStyle = '#e3a32b';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      lines.forEach((l, i) => text(l, PAD + 30, y + 26 + 40 + i * 56, font(38, true), '#8a4b00'));
      y += h + 40;
    } else y += 20;
    if (draw) { ctx.fillStyle = '#e5e5e5'; ctx.fillRect(PAD, y, inner, 3); }
    y += 50;
    // ③ 商城
    para(POSTER_TEXT.s3, font(46, true), 46, 64, GREEN);
    y += 24;
    image(shopImg, 360);
    y += 16;
    text(POSTER_TEXT.s3Cap, W / 2, y + 32, font(32), '#777777', 'center');
    y += 70;
    if (has('d')) {
      ctx.font = font(34);
      const lines = wrap(ctx, POSTER_TEXT.d, inner - 60);
      const h = 40 + 56 + lines.length * 50 + 24;
      if (draw) {
        ctx.fillStyle = '#f2f7f4';
        roundRect(ctx, PAD, y, inner, h, 22);
        ctx.fill();
      }
      text(POSTER_TEXT.dTitle, PAD + 30, y + 40 + 40, font(40, true), GREEN);
      lines.forEach((l, i) => text(l, PAD + 30, y + 40 + 56 + 36 + i * 50, font(34), '#333333'));
      y += h + 40;
    }
    y += 10;
    // 页脚
    if (draw) { ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, y, W, 110); }
    text(POSTER_TEXT.footer, W / 2, y + 68, font(34), '#666666', 'center');
    y += 110;
    return y;
  };

  const height = Math.ceil(run(createCanvas(W, 10).getContext('2d'), false));
  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, height);
  run(ctx, true);
  return canvas.encode('png');
}

// ── 会员缓存（LOCAL_CN_DATA_DIR/referral-posters） ──
function posterDir() {
  return path.join(process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'), 'referral-posters');
}
function writeAtomic(file: string, data: Buffer) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
}

async function wecomImageFor(memberId: number, qrCodeUrl: string) {
  const key = createHash('sha1').update(qrCodeUrl).digest('hex').slice(0, 12);
  const file = path.join(posterDir(), `wecom-${memberId}-${key}.img`);
  if (existsSync(file)) return readFileSync(file);
  const buf = await fetchQrImage(qrCodeUrl);
  writeAtomic(file, buf);
  return buf;
}

const inflight = new Map<string, Promise<PosterResult>>();
type PosterResult = { ok: true; png: Buffer; file: string } | { ok: false; error: string; status: number };

// 生成（或读取缓存）会员推广长图；资格同专属关注码
export function ensureReferralPoster(memberId: number, blocks: PosterBlock[]): Promise<PosterResult> {
  const sel = blocks.join('') || 'none';
  const flightKey = `${memberId}:${sel}`;
  const running = inflight.get(flightKey);
  if (running) return running;
  const task = (async (): Promise<PosterResult> => {
    const check = followQrEligibility(memberId);
    if (!check.eligible) return { ok: false, error: '暂未取得推荐资格', status: 403 };
    const code = String(check.user.referralCode || '').toUpperCase();
    const follow = await ensureMemberFollowQr(memberId);
    if (!follow.ok || !follow.qr) return { ok: false, error: '专属关注码生成失败，请稍后再试', status: 502 };
    let way;
    try {
      way = await ensureReferrerContactWay(memberId, code);
    } catch (error) {
      console.warn('[referral-poster] contact way failed', error instanceof Error ? error.message : '');
      return { ok: false, error: '企业微信二维码生成失败，请稍后再试', status: 502 };
    }
    const shopUrl = `${SHOP_URL}?ref=${encodeURIComponent(code)}`;
    const hash = createHash('sha1').update([LAYOUT_VERSION, code, follow.qr.url, way.qrCode, shopUrl].join('|')).digest('hex').slice(0, 12);
    const file = path.join(posterDir(), `poster-${memberId}-${sel}-${hash}.png`);
    if (existsSync(file)) return { ok: true, png: readFileSync(file), file };
    let wecomImage: Buffer;
    try {
      wecomImage = await wecomImageFor(memberId, way.qrCode);
    } catch {
      return { ok: false, error: '企业微信二维码读取失败，请稍后再试', status: 502 };
    }
    const png = await renderReferralPoster(blocks, { wecomImage, followUrl: follow.qr.url, shopUrl });
    writeAtomic(file, png);
    return { ok: true, png, file };
  })().finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, task);
  return task;
}
