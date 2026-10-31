import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { emptySharedOtpState, validateSharedOtpState } from './shared-store';
import type { AtomicOtpStore, SharedOtpState } from './shared-store';

const PREFIX = '/private/tmp/richsmart-sms-fixture-';

// Local fixture adapter only: shared across processes on one filesystem. Never
// wired to HTTP, .data, environment configuration, or a production store.
export class FixtureFileOtpStore implements AtomicOtpStore {
  private constructor(public readonly directory: string) {}

  static async create() {
    const directory = await mkdtemp(PREFIX);
    const file = await open(path.join(directory, 'state.json'), 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(emptySharedOtpState())); await file.sync(); } finally { await file.close(); }
    await FixtureFileOtpStore.syncDirectory(directory);
    return new FixtureFileOtpStore(directory);
  }

  static async connect(directory: string) {
    if (!directory.startsWith(PREFIX) || !/^[-A-Za-z0-9]+$/.test(directory.slice(PREFIX.length))
      || await realpath(directory) !== directory) throw new Error('isolated fixture directory required');
    const info = await lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error('private fixture directory required');
    await FixtureFileOtpStore.readState(directory);
    return new FixtureFileOtpStore(directory);
  }

  private static async syncDirectory(directory: string) {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private static async readState(directory: string) {
    const filename = path.join(directory, 'state.json');
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 4000000) throw new Error('invalid fixture file');
    const state: unknown = JSON.parse(await readFile(filename, 'utf8'));
    validateSharedOtpState(state);
    return state;
  }

  async transaction<T>(update: (state: SharedOtpState) => T): Promise<T> {
    const lock = path.join(this.directory, 'transaction.lock');
    const deadline = Date.now() + 2000;
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw new Error('fixture store unavailable');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    let temporary: string | undefined;
    try {
      const state = await FixtureFileOtpStore.readState(this.directory);
      const result = update(state);
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('async transaction callback forbidden');
      validateSharedOtpState(state);
      temporary = path.join(this.directory, `state-${randomBytes(16).toString('hex')}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path.join(this.directory, 'state.json'));
      temporary = undefined;
      await FixtureFileOtpStore.syncDirectory(this.directory);
      return result;
    } finally {
      try { if (temporary) await unlink(temporary); } finally { await rmdir(lock); }
    }
  }
}
