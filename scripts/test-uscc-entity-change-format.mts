import assert from 'node:assert/strict';
import {
  canonicalUscc,
  isUnifiedSocialCreditCode,
  normalizeUsccCandidate,
  parseBusinessLicenseText,
  submittedUnifiedSocialCreditCode,
} from '../lib/cn-business-license-ocr.ts';

// 家蜜可主体变更：2015-12-01 深圳市坪山新区上丰润商行营业执照上的 18 位代码。
// GB 32100 校验位为 W，只在第 9 位保留字母 L 时成立。
const licenseCode = '92440300L91111330W';
const rewrittenAsOne = '92440300191111330W';
const currentBrandCode = '91320507MAK1X15M90';

assert.equal(canonicalUscc(`  ${licenseCode.toLowerCase()}  `), licenseCode);
assert.equal(submittedUnifiedSocialCreditCode(licenseCode.toLowerCase()), licenseCode);
assert.equal(isUnifiedSocialCreditCode(licenseCode), true);
assert.equal(normalizeUsccCandidate(licenseCode), licenseCode, 'OCR 不得把合法的 L 改成 1');

assert.equal(isUnifiedSocialCreditCode(rewrittenAsOne), false, '把 L 改成 1 后校验位不再是 W');
assert.equal(submittedUnifiedSocialCreditCode(rewrittenAsOne), null);
assert.equal(normalizeUsccCandidate(rewrittenAsOne), rewrittenAsOne, '不得把失败的数字码猜回另一个码');

assert.equal(isUnifiedSocialCreditCode(currentBrandCode), true, '现登记主体 91320507MAK1X15M90 仍须通过');
assert.equal(normalizeUsccCandidate(currentBrandCode), currentBrandCode);

const misreadL = '91320507MAKLX15M90';
assert.equal(isUnifiedSocialCreditCode(misreadL), false);
assert.equal(normalizeUsccCandidate(misreadL), misreadL, 'L 即使导致校验失败，也不改写成 1');
assert.equal(submittedUnifiedSocialCreditCode(misreadL), null);

const digitReadAsI = '9I320507MAK1X15M90';
assert.equal(isUnifiedSocialCreditCode(digitReadAsI), false, '用户提交含非法字符 I 时格式检核不通过');
assert.equal(submittedUnifiedSocialCreditCode(digitReadAsI), null);
assert.equal(normalizeUsccCandidate(digitReadAsI), currentBrandCode, 'OCR 仅在非法字符替换后能通过校验位时才采用');

const brokenLookalike = '9132O507MAK1X15M91';
assert.equal(normalizeUsccCandidate(brokenLookalike), brokenLookalike, '替换后仍失败时保留原字符串，不编造代码');
assert.equal(isUnifiedSocialCreditCode(brokenLookalike), false);
assert.equal(isUnifiedSocialCreditCode('91320507MAK1X15M91'), false);

for (const rejected of ['', '92440300L91111330', '92440300L91111330WW', 'AAAAAAAAAA', '92440300V91111330W']) {
  assert.equal(submittedUnifiedSocialCreditCode(rejected), null, rejected || '(empty)');
  assert.equal(isUnifiedSocialCreditCode(rejected), false, rejected || '(empty)');
}

const parsed = parseBusinessLicenseText([
  '营业执照',
  `统一社会信用代码：${licenseCode}`,
  '名称：深圳市坪山新区上丰润商行',
  '主体类型：个体工商户（台湾）',
  '经营者：何景沧',
  '成立日期：2015年12月01日',
].join('\n'), 'pdf-text');
assert.equal(parsed.draft.registrationNo, licenseCode);
assert.equal(parsed.validRegistrationNo, true);

console.log('uscc format checks passed');
console.log(`license ${licenseCode} kept; ${rewrittenAsOne} rejected`);
