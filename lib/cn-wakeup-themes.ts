// 一键唤醒 / 分层唤醒素材库：按日期轮换主题，避免连续两次同一模板。
// 唤醒 = 给对方「愿意回 / 愿意转」的东西，而不是催回会员中心。
// 主题：转发拉人（专属关注码）、预约到店体验、体验点导航、门店合作、当日新鲜内容。
import { FOLLOW_QR_PAGE_URL } from './local-cn-follow-qr';

export type WakeupThemeKey = 'forward' | 'appointment' | 'map' | 'partner' | 'fresh';
export type WakeupSegment = 'owner' | 'sleeping' | 'default';

export type WakeupFreshAssets = { coverUrl: string; coverMediaId: string; articleId: string; linkUrl: string; linkTitle: string; updatedAt?: string };

export type WakeupTheme = {
  key: WakeupThemeKey;
  label: string;
  title: string; // 服务号消息标题「xx 通过富智慧给你发来{title}」
  linkTitle: string;
  linkUrl: string;
  coverUrl: string;
  coverMediaId: string; // 只有已上传服务号素材库的封面才有
  articleId: string;
  withRef: boolean; // 个人发出的站内链接带发送人推荐码；会员自己的关注码页不带
  hint: boolean; // 是否附「先生成专属二维码」提示
};

const SITE = 'https://rich-smart.com.cn';

// 各身份的轮换顺序；按天取索引，相邻两天必不同；若与上次发给此人的主题相同再顺延一格
export const WAKEUP_ROTATION: Record<WakeupSegment, WakeupThemeKey[]> = {
  default: ['forward', 'appointment', 'map', 'fresh', 'partner'],
  sleeping: ['appointment', 'forward', 'map', 'fresh'],
  owner: ['partner', 'forward', 'fresh', 'map'],
};

export function shanghaiDayIndex(at: Date = new Date()) {
  return Math.floor((at.getTime() + 8 * 3600000) / 86400000);
}

function shanghaiDate(at: Date) {
  return new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

// 每日文章例行任务更新 mp-wakeup-assets.json；只在当天（上海时间）更新过且确有文章/新链接时，才当作「当日服务号内容」
function freshFromAssets(assets: WakeupFreshAssets, at: Date) {
  const updated = assets.updatedAt ? new Date(assets.updatedAt) : null;
  if (!updated || !Number.isFinite(updated.getTime()) || shanghaiDate(updated) !== shanghaiDate(at)) return null;
  if (!assets.articleId && /\/cn\/afu\/?$/.test(assets.linkUrl)) return null;
  return assets;
}

export function wakeupTheme(key: WakeupThemeKey, assets: WakeupFreshAssets, at: Date = new Date()): WakeupTheme {
  switch (key) {
    case 'forward':
      return { key, label: '转发拉人', title: '一份可以转发的邀请', linkTitle: '生成我的专属二维码', linkUrl: FOLLOW_QR_PAGE_URL, coverUrl: '/images/mp/wakeup-forward-cover.jpg', coverMediaId: '', articleId: '', withRef: false, hint: false };
    case 'appointment':
      return { key, label: '预约体验', title: '到店体验邀请', linkTitle: '预约到店体验', linkUrl: `${SITE}/cn/experience`, coverUrl: '/images/mp/wakeup-appointment-cover.jpg', coverMediaId: '', articleId: '', withRef: true, hint: true };
    case 'map':
      return { key, label: '体验点导航', title: '附近体验点', linkTitle: '体验点地址与导航', linkUrl: `${SITE}/cn/experience-points`, coverUrl: '/images/mp/wakeup-map-cover.jpg', coverMediaId: '', articleId: '', withRef: true, hint: true };
    case 'partner':
      return {
        key, label: '门店合作', title: '门店合作介绍', linkTitle: '阿富同学 · 门店合作', linkUrl: `${SITE}/cn/afu`,
        coverUrl: '/images/mp/wakeup-device-office-cover.jpg',
        // 门店合作封面已在服务号素材库（沿用 mp-wakeup-assets.json 的默认图片素材）
        coverMediaId: /\/cn\/afu\/?$/.test(assets.linkUrl) ? assets.coverMediaId : '',
        articleId: '', withRef: true, hint: true,
      };
    case 'fresh':
    default: {
      const fresh = freshFromAssets(assets, at);
      if (fresh) return { key: 'fresh', label: '今日新内容', title: '今日新内容', linkTitle: fresh.linkTitle, linkUrl: fresh.linkUrl, coverUrl: fresh.coverUrl, coverMediaId: fresh.coverMediaId, articleId: fresh.articleId, withRef: true, hint: true };
      return { key: 'fresh', label: '健康好物', title: '健康好物推荐', linkTitle: '商城健康好物', linkUrl: `${SITE}/cn/shop`, coverUrl: '/images/mp/wakeup-fresh-cover.jpg', coverMediaId: '', articleId: '', withRef: true, hint: true };
    }
  }
}

export function pickWakeupThemeKey(segment: WakeupSegment, at: Date = new Date(), lastKey?: string | null): WakeupThemeKey {
  const list = WAKEUP_ROTATION[segment] || WAKEUP_ROTATION.default;
  const index = ((shanghaiDayIndex(at) % list.length) + list.length) % list.length;
  let key = list[index];
  if (lastKey && key === lastKey) key = list[(index + 1) % list.length];
  return key;
}

export function pickWakeupTheme(segment: WakeupSegment, assets: WakeupFreshAssets, at: Date = new Date(), lastKey?: string | null) {
  return wakeupTheme(pickWakeupThemeKey(segment, at, lastKey), assets, at);
}

function clean(value: string, fallback: string) {
  return String(value || fallback).replace(/[<>]/g, '').slice(0, 40);
}

// 一键唤醒文案（简体对客）：短、有一句行动（转发 / 预约 / 导航 / 回复）。
// ownIncome 仅为收件人本人的近 30 天已确认收益，只发给本人；不写分润比例。
export function wakeupMessage(theme: WakeupTheme, recipientName: string, ownIncome = 0, fmtMoney: (n: number) => string = (n) => `¥${n.toFixed(2)}`) {
  const n = clean(recipientName, '朋友');
  const income = ownIncome > 0 ? `你近 30 天已确认收益 ${fmtMoney(ownIncome)}。` : '';
  switch (theme.key) {
    case 'forward':
      return `Hi ${n}，身边有想了解健康体验的朋友吗？${income}转发给朋友前，先生成你的专属二维码，朋友扫码关注就记在你名下。生成后长按保存，发到群里或朋友圈。`;
    case 'appointment':
      return `Hi ${n}，这周约个时间到店体验一次吧，现场有人讲解，可以亲自上手试。点链接选时间预约，也可以带家人朋友一起来。`;
    case 'map':
      return `Hi ${n}，离你最近的体验点在哪？点链接一键导航，到店前先打个电话更方便。回复你所在的城市，我帮你查附近的体验点。`;
    case 'partner':
      return `Hi ${n}，身边有开店或有门面的朋友吗？阿富同学门店合作正在招合作店，点链接看介绍、在线申请；合适的话直接转给他。`;
    case 'fresh':
    default:
      return theme.label === '今日新内容'
        ? `Hi ${n}，今天服务号新内容：${theme.linkTitle}。看完觉得有用，转给家人朋友看看。`
        : `Hi ${n}，商城里有几款日常健康好物，看看家里有没有用得上的；觉得不错，顺手转给家人。`;
  }
}

// 分层排程用（服务号文字，带「你好」称呼由调用方给）
export function wakeupScheduleLine(theme: WakeupTheme) {
  switch (theme.key) {
    case 'forward': return '转发给朋友前，先生成你的专属二维码，朋友扫码关注就记在你名下：';
    case 'appointment': return '这周约个时间到店体验一次，可以带家人朋友一起来，点链接预约：';
    case 'map': return '附近体验点一键导航，到店前先打个电话更方便：';
    case 'partner': return '身边有开店的朋友吗？阿富同学门店合作在招合作店，合适就转给他：';
    default: return theme.label === '今日新内容' ? `今天服务号新内容：${theme.linkTitle}，觉得有用转给家人朋友：` : '商城日常健康好物，看看家里用得上的，顺手转给家人：';
  }
}
