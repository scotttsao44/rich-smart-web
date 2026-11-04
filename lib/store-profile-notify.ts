import type { StoreProfile } from './local-cn-experience-points';
import { sendMpCustomText, sendMpTemplate } from './wechat-mp-api';

// 网页自填资料提交后通知 KEFU_NOTIFY_OPENIDS（曹总）；服务号里提交的走 wechat-kefu-bot notifyAdmins。只发摘要，不含凭证。
export async function notifyStoreProfileSubmitted(p: StoreProfile) {
  const openids = String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{10,64}$/.test(s));
  const link = `${String(process.env.NEXT_PUBLIC_APP_URL || 'https://rich-smart.com.cn').replace(/\/$/, '')}/cn/ops/experience-points`;
  const owner = p.kind === 'owner';
  const summary = owner
    ? `${p.storeName || '门店'}（${p.city || '城市未填'}）${p.address ? `；地址：${p.address}` : ''}${p.businessModel ? `；${p.businessModel}` : ''}${p.hours ? `；${p.hours}` : ''}；照片 ${p.photos.filter((x) => x.status === 'ok').length} 张`
    : `${p.company || '代理'}（${p.city || '城市未填'}）${p.coverage ? `；覆盖：${p.coverage}` : ''}`;
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const body = `【糙米量子】${owner ? '店主' : '代理'}在网页提交了门店资料（自报，待后台确认）\n${summary}${p.flags.length ? `\n需核对：${p.flags.join('／')}` : ''}\n时间：${time}\n审核：${link}`;
  const templateId = process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_ID || '';
  const keys = String(process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_KEYS || 'thing1,thing2,time3').split(',').map((s) => s.trim());
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  for (const openid of openids) {
    try {
      const r = await sendMpCustomText(openid, body);
      if (!r.ok && templateId) {
        await sendMpTemplate(openid, templateId, link, { [keys[0] || 'thing1']: cut(`${owner ? '店主' : '代理'}资料待审核`, 18), [keys[1] || 'thing2']: cut(summary, 18), [keys[2] || 'time3']: time });
      }
    } catch {
      console.warn('[store-profile] notify failed');
    }
  }
}
