const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
if (!fs.realpathSync(process.env.LOCAL_CN_DATA_DIR || '').includes('/richsmart-email-test-')) throw new Error('isolated test directory required');
const original = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  return original.call(this, name.startsWith('@/') ? path.join(process.cwd(), name.slice(2)) : name, parent, ...rest);
};
require.extensions['.ts'] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText, filename);
};
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const { id, code, browser, now } = JSON.parse(input);
  Date.now = () => now;
  try {
    const user = require('../lib/email-auth/service.ts').verifyEmailRegistration(id, code, browser);
    console.log(JSON.stringify({ ok: true, memberId: user.id }));
  } catch (error) { console.log(JSON.stringify({ ok: false, code: error.code || 'STORE_BUSY' })); }
});
