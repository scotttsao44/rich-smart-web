#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(join(process.cwd(), 'lib/pdf-safety.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, module: { exports: {} }, require, RegExp };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox, { filename: 'lib/pdf-safety.ts' });

const { findActivePdfMarker } = sandbox.module.exports;
const markers = ['/JavaScript', '/JS', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA'];

assert.equal(findActivePdfMarker('/FontName /AAAAAA+ArialUnicodeMS', markers), null);
assert.equal(findActivePdfMarker('/BaseFont /JSong-Light', markers), null);
assert.equal(findActivePdfMarker('<< /AA << /O 2 0 R >> >>', markers), '/AA');
assert.equal(findActivePdfMarker('<< /OpenAction 7 0 R >>', markers), '/OpenAction');
assert.equal(findActivePdfMarker('<< /S /JavaScript /JS (alert) >>', markers), '/JavaScript');
assert.equal(findActivePdfMarker('/LaunchSomething', markers), null);

console.log('PDF active-content marker boundary checks passed.');
