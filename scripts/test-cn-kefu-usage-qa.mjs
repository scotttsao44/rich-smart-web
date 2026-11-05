// 服务号客服：用法／穴位问题不得被产品介绍吞掉；菜单数字仍可用
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(import.meta.dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kefu-usage-'));
const oldResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(name, parent, ...rest) {
  return oldResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
require.extensions['.ts'] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

process.env.LOCAL_CN_DATA_DIR = directory;
process.env.DATABASE_URL = '';
process.env.DASHSCOPE_API_KEY = ''; // force rule path; no live LLM
process.env.KEFU_AI_DISABLED = '1';

const { kefuNormalize, kefuIsProductIntroAsk, kefuUsageBodyReply, KEFU_PRODUCT_INTRO } = require('../lib/wechat-kefu-knowledge.ts');
const { handleKefuInbound } = require('../lib/wechat-kefu-bot.ts');

const HEEL_TW = '照機器的時候，後腳跟脹痛是什麼穴位？';
const HEEL_CN = '脚底照机器时，后脚跟涨痛是什么穴位';
const NECK = '照肩颈要多久';
const MENU1 = '1';
const INTRO = '你们机器是什么？';

const heelSimple = kefuNormalize(HEEL_TW);
assert.equal(heelSimple.includes('机器'), true);
assert.equal(heelSimple.includes('是什么'), true);
assert.equal(kefuIsProductIntroAsk(heelSimple), false, 'heel Q must not be product-intro');
assert.equal(kefuIsProductIntroAsk(kefuNormalize(INTRO)), true, 'true intro ask still matches');
const heelCanned = kefuUsageBodyReply(heelSimple);
assert.ok(heelCanned && /太溪|昆仑|照海/.test(heelCanned), heelCanned);
assert.ok(/20–50 cm|15 分钟/.test(heelCanned));
assert.ok(/不是医疗设备/.test(heelCanned));
assert.ok(!/分润|提成|%|％/.test(heelCanned));
assert.ok(!heelCanned.includes(KEFU_PRODUCT_INTRO.split('\n')[0]));

async function sim(text, openid) {
  const deadline = Date.now() + 8000;
  const reply = await handleKefuInbound({
    MsgType: 'text',
    FromUserName: openid,
    ToUserName: 'gh_test',
    Content: text,
    MsgId: `sim-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    CreateTime: String(Math.floor(Date.now() / 1000)),
  }, deadline);
  return reply;
}

// 新会话首条非数字消息会回身份菜单；先暖机一条，再测真实问题
async function warm(openid) {
  await sim('你好呀测试暖机', openid);
}

const oidHeel = 'SIMULATED_kefu_heel_qa';
const oidNeck = 'SIMULATED_kefu_neck_qa';
const oidMenu = 'SIMULATED_kefu_menu_qa';
const oidIntro = 'SIMULATED_kefu_intro_qa';

await warm(oidHeel);
await warm('SIMULATED_kefu_heel_qa2');
await warm(oidNeck);
await warm(oidIntro);

const r1 = await sim(HEEL_TW, oidHeel);
console.log('--- heel TW ---\n' + r1 + '\n');
assert.ok(r1 && /太溪|昆仑|照海/.test(r1), 'heel should mention acupoints');
assert.ok(!/想体验的话，麻烦留言您的城市和手机号（例如：苏州/.test(r1), 'must not be full canned intro lead');
assert.ok(!r1.startsWith('阿富同学（频率密码健康仪'), 'must not start with product intro');

const r1b = await sim(HEEL_CN, 'SIMULATED_kefu_heel_qa2');
console.log('--- heel CN ---\n' + r1b + '\n');
assert.ok(r1b && /太溪|昆仑|照海/.test(r1b));

const r2 = await sim(NECK, oidNeck);
console.log('--- neck duration ---\n' + r2 + '\n');
assert.ok(r2 && /^默认单次 15 分钟。$/.test(r2.trim()), 'neck duration should be short 15-min reply, got: ' + r2);

const r3 = await sim(MENU1, oidMenu);
console.log('--- menu 1 ---\n' + String(r3).slice(0, 200) + '\n');
assert.ok(r3 && /(预约|体验|访客|1|菜单|到店)/.test(r3), 'menu 1 should still work: ' + r3);

const r4 = await sim(INTRO, oidIntro);
console.log('--- true intro ---\n' + String(r4).slice(0, 180) + '\n');
assert.ok(r4 && r4.includes('远红外'), 'true product intro still returns intro');

console.log('OK kefu usage QA regression passed');
process.exit(0);
