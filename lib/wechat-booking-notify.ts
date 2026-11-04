import { sendMpTemplate } from '@/lib/wechat-mp-api';
import { findLocalCnUser, findLocalCnUserById } from '@/lib/local-cn-users';
import { listStoreApplications } from '@/lib/local-cn-store-applications';
import type { SessionUser } from '@/lib/auth';

// 服务号模板消息「预约成功通知」（WECHAT_TPL_BOOKING_SUCCESS）
// 字段：thing2 预约门店 / thing15 预约项目 / time16 预约时间 / thing20 门店地址 / phone_number24 联系电话
// 联系电话只用门店公开电话（publicPhone），否则用客服电话；绝不使用任何人的个人手机号（含 contactPhone）。
export const BOOKING_SERVICE_PHONE = '15862501498';

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://rich-smart.com.cn').replace(/\/$/, '');
}

function thing(text: string, max = 20) {
  const t = String(text || '').replace(/\s+/g, ' ').trim() || '-';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function bookingNowText(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

export type BookingTemplateInput = { store: string; item: string; time: string; address: string; phone?: string; url?: string };

export async function sendBookingSuccessTemplate(openid: string, input: BookingTemplateInput, tag = 'booking') {
  const templateId = process.env.WECHAT_TPL_BOOKING_SUCCESS || '';
  if (!templateId || !openid) {
    console.info(`[wechat-booking] ${tag} skip reason=${templateId ? 'no_openid' : 'no_template_id'}`);
    return { ok: false, errcode: templateId ? 'no_openid' : 'no_template_id' } as const;
  }
  try {
    const r = await sendMpTemplate(openid, templateId, input.url || `${appUrl()}/cn/member`, {
      thing2: thing(input.store),
      thing15: thing(input.item),
      time16: String(input.time || '').trim() || '-',
      thing20: thing(input.address),
      phone_number24: String(input.phone || '').trim() || BOOKING_SERVICE_PHONE,
    });
    const msgid = r.ok && r.data ? String((r.data as Record<string, unknown>).msgid ?? '') : '';
    console.info(`[wechat-booking] ${tag} to=…${openid.slice(-4)} ${r.ok ? `sent msgid=${msgid}` : `failed errcode=${r.errcode}`}`);
    return { ...r, msgid };
  } catch {
    console.warn(`[wechat-booking] ${tag} error`);
    return { ok: false, errcode: 'exception' } as const;
  }
}

function bookingTime(row: Record<string, unknown>) {
  const date = String(row.date || '').trim();
  const time = String(row.time || '').trim();
  return [date, time].filter(Boolean).join(' ');
}

// 门店工作台建立／确认预约后通知客人（找得到服务号 openid 才发）。不抛错，不影响预约本身。
export async function notifyCustomerBookingSuccess(user: SessionUser, row: Record<string, unknown>) {
  try {
    if (String(row.status || '已预约') !== '已预约') return;
    const memberId = Number(row.memberId || row.userId || 0);
    const customer = (memberId && findLocalCnUserById(memberId)) || (row.phone ? findLocalCnUser(String(row.phone)) : null);
    const openid = String(customer?.wechatOfficialOpenId || '');
    if (!openid) {
      console.info(`[wechat-booking] customer skip reason=no_openid appt=${String(row.id || '')}`);
      return;
    }
    const stores = listStoreApplications(user).filter((s) => s.status === 'active');
    const store = stores.find((s) => s.id === row.storeId) || (stores.length === 1 ? stores[0] : null);
    const publicPhone = String((store as unknown as { publicPhone?: string } | null)?.publicPhone || '').trim();
    await sendBookingSuccessTemplate(openid, {
      store: store?.name || String(row.store || '糙米量子合作门店'),
      item: String(row.service || '阿富同学体验'),
      time: bookingTime(row),
      address: store?.address || '详见预约页面',
      phone: publicPhone || BOOKING_SERVICE_PHONE,
      url: `${appUrl()}/cn/member`,
    }, `customer appt=${String(row.id || '')}`);
  } catch {
    console.warn('[wechat-booking] customer notify error');
  }
}
