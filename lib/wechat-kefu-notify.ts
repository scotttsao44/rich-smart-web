import nodemailer from 'nodemailer';
import { findLocalCnUserById } from '@/lib/local-cn-users';
import { recordKefuNotification, type KefuConversation } from '@/lib/local-cn-wechat-kefu';
import { sendMpCustomText, sendMpTemplate } from '@/lib/wechat-mp-api';

// 转人工通知：发给 KEFU_NOTIFY_OPENIDS（逗号分隔的服务号 openid，只走微信，不发 Email）
// 以及 KEFU_NOTIFY_MEMBER_IDS（逗号分隔的会员 ID，微信 + Email）。
// 渠道：1) 服务号模板消息（配置 WECHAT_KEFU_NOTIFY_TEMPLATE_ID 后启用）；
//       2) 否则服务号客服消息（对方 48 小时内与服务号有过互动才会成功）；
//       3) Email（SMTP 已配置且会员有真实邮箱时）。
// SIMULATED_ 开头的测试 openid 只记录、不真正发送。

const THROTTLE_MS = 10 * 60 * 1000;

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://rich-smart.com.cn').replace(/\/$/, '');
}

function smtpReady() {
  return Boolean(process.env.EMAIL_SMTP_HOST && process.env.EMAIL_SMTP_PORT && process.env.EMAIL_SMTP_USER && process.env.EMAIL_SMTP_PASSWORD && process.env.EMAIL_FROM);
}

function realEmail(email?: string | null) {
  const e = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return '';
  if (/(@local|@example|@wechat|@placeholder|brand-demo-|@caomi\.local)/i.test(e)) return '';
  return e;
}

function shortText(text: string, max: number) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function isSimulatedOpenid(openid: string) {
  return openid.startsWith('SIMULATED_');
}

export async function notifyKefuHandoff(conv: KefuConversation, reason: string, lastText: string, opts: { force?: boolean; detail?: string } = {}) {
  if (!opts.force && conv.lastNotifiedAt && Date.now() - Date.parse(conv.lastNotifiedAt) < THROTTLE_MS) return null;
  const ids = String(process.env.KEFU_NOTIFY_MEMBER_IDS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const simulated = isSimulatedOpenid(conv.openid);
  const link = `${appUrl()}/admin/wechat-inbox?openid=${encodeURIComponent(conv.openid)}`;
  const who = conv.memberName || `访客 ${conv.openid.slice(-6)}`;
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const summary = shortText(opts.detail || lastText || '(非文字消息)', 18);
  const body = `【糙米量子客服】有客人需要人工处理\n客人：${who}\n原因：${reason}\n${opts.detail ? `线索：${opts.detail}\n` : ''}内容：${shortText(lastText || '(非文字消息)', 80)}\n时间：${time}\n处理：${link}`;
  const templateId = process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_ID || '';
  const templateKeys = String(process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_KEYS || 'thing1,thing2,time3').split(',').map((s) => s.trim());

  const results: Array<{ memberId: number; channel: string; status: string; errcode?: string }> = [];
  const directOpenids = String(process.env.KEFU_NOTIFY_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{10,64}$/.test(s));
  for (const openid of directOpenids) {
    if (simulated) {
      results.push({ memberId: 0, channel: templateId ? 'template' : 'custom', status: 'simulated' });
    } else if (templateId) {
      const r = await sendMpTemplate(openid, templateId, link, {
        [templateKeys[0] || 'thing1']: shortText(who, 18),
        [templateKeys[1] || 'thing2']: summary,
        [templateKeys[2] || 'time3']: time,
      });
      results.push({ memberId: 0, channel: 'template', status: r.ok ? 'sent' : 'failed', errcode: r.ok ? undefined : String(r.errcode) });
    } else {
      const r = await sendMpCustomText(openid, body);
      results.push({ memberId: 0, channel: 'custom', status: r.ok ? 'sent' : 'failed', errcode: r.ok ? undefined : String(r.errcode) });
    }
  }
  for (const memberId of ids) {
    const user = findLocalCnUserById(memberId);
    if (!user) {
      results.push({ memberId, channel: 'lookup', status: 'member_not_found' });
      continue;
    }
    const openid = user.wechatOfficialOpenId || '';
    if (openid) {
      if (simulated) {
        results.push({ memberId, channel: templateId ? 'template' : 'custom', status: 'simulated' });
      } else if (templateId) {
        const r = await sendMpTemplate(openid, templateId, link, {
          [templateKeys[0] || 'thing1']: shortText(who, 18),
          [templateKeys[1] || 'thing2']: summary,
          [templateKeys[2] || 'time3']: time,
        });
        results.push({ memberId, channel: 'template', status: r.ok ? 'sent' : 'failed', errcode: r.ok ? undefined : String(r.errcode) });
      } else {
        const r = await sendMpCustomText(openid, body);
        results.push({ memberId, channel: 'custom', status: r.ok ? 'sent' : 'failed', errcode: r.ok ? undefined : String(r.errcode) });
      }
    } else {
      results.push({ memberId, channel: 'wechat', status: 'no_openid' });
    }
    const email = realEmail(user.email);
    if (email && smtpReady()) {
      if (simulated) {
        results.push({ memberId, channel: 'email', status: 'simulated' });
      } else {
        try {
          const port = Number(process.env.EMAIL_SMTP_PORT || 587);
          await nodemailer
            .createTransport({
              host: process.env.EMAIL_SMTP_HOST,
              port,
              secure: process.env.EMAIL_SMTP_SECURE === 'true' || port === 465,
              auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASSWORD },
            })
            .sendMail({ from: process.env.EMAIL_FROM, to: email, subject: `【糙米量子客服】${who} 需要人工处理`, text: body });
          results.push({ memberId, channel: 'email', status: 'sent' });
        } catch {
          results.push({ memberId, channel: 'email', status: 'failed' });
        }
      }
    }
  }
  if (!ids.length && !directOpenids.length) results.push({ memberId: 0, channel: 'config', status: 'no_recipients' });
  return recordKefuNotification({ openid: conv.openid, reason, results });
}
