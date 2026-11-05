// 一键唤醒素材轮换回归：相邻两天主题不同；同一人上次主题相同时顺延；文案不再是固定「回来看看会员中心」
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import assert from 'assert';
import ts from 'typescript';

const src = readFileSync(new URL('../lib/cn-wakeup-themes.ts', import.meta.url), 'utf8')
  .replace(/import \{ FOLLOW_QR_PAGE_URL \} from '[^']+';/, "const FOLLOW_QR_PAGE_URL = 'https://rich-smart.com.cn/cn/member/follow-qr';");
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const file = path.join(mkdtempSync(path.join(tmpdir(), 'wakeup-')), 'themes.mjs');
writeFileSync(file, out);
const t = await import(file);

const assets = { coverUrl: '/images/mp/wakeup-device-office-cover.jpg', coverMediaId: 'MEDIA', articleId: '', linkUrl: 'https://rich-smart.com.cn/cn/afu', linkTitle: '阿富同学 · 门店合作', updatedAt: '2026-11-03T19:40:00+08:00' };
const day = (s) => new Date(`${s}T09:00:00+08:00`);
const days = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
for (const seg of ['default', 'sleeping', 'owner']) {
  const seq = days.map((d) => t.pickWakeupTheme(seg, assets, day(d)));
  console.log(seg.padEnd(8), seq.map((th, i) => `${days[i].slice(5)}:${th.label}`).join('  '));
  for (let i = 1; i < seq.length; i += 1) {
    assert.notStrictEqual(seq[i].key, seq[i - 1].key, `${seg} ${days[i]} 与前一天同主题`);
    assert.notStrictEqual(seq[i].coverUrl, seq[i - 1].coverUrl, `${seg} ${days[i]} 与前一天同封面`);
  }
  // 同一人上次已收到今天的主题 → 顺延
  const today = t.pickWakeupThemeKey(seg, day('2026-11-05'));
  assert.notStrictEqual(t.pickWakeupThemeKey(seg, day('2026-11-05'), today), today);
}
// default 5 天覆盖全部 5 类
assert.strictEqual(new Set(days.slice(0, 5).map((d) => t.pickWakeupThemeKey('default', day(d)))).size, 5);
// 文案：不再出现「会员中心」固定句；转发主题带专属二维码提示；收益只用于本人，不出现 %
for (const key of ['forward', 'appointment', 'map', 'partner', 'fresh']) {
  const msg = t.wakeupMessage(t.wakeupTheme(key, assets, day('2026-11-05')), '王建民', key === 'forward' ? 12.5 : 0);
  assert(!/会员中心/.test(msg), msg);
  assert(!/%|％/.test(msg), msg);
  console.log(key.padEnd(12), msg);
}
assert(/专属二维码/.test(t.wakeupMessage(t.wakeupTheme('forward', assets), 'A')));
assert.strictEqual(t.wakeupTheme('forward', assets).withRef, false);
// 当日文章：只在 updatedAt 为当天时才当「今日新内容」，否则用商城健康好物（不假造图文 URL）
assert.strictEqual(t.wakeupTheme('fresh', assets, day('2026-11-05')).linkUrl, 'https://rich-smart.com.cn/cn/shop');
const fresh = t.wakeupTheme('fresh', { ...assets, articleId: 'ART', linkUrl: 'https://mp.weixin.qq.com/s/x', linkTitle: '秋冬养生', updatedAt: '2026-11-05T07:00:00+08:00' }, day('2026-11-05'));
assert.strictEqual(fresh.articleId, 'ART');
console.log('OK cn-wakeup rotation');
