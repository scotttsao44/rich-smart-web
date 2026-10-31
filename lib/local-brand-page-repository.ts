import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

export type BrandMarketplaceAudit = {
  id: string;
  action: string;
  actorId: number;
  actorName: string;
  entityType: 'brand' | 'product';
  entityId: number;
  detail: string;
  createdAt: string;
};

export type BrandPageActor = { id: number; name: string };

export type BrandMarketplaceState<B, P> = {
  schemaVersion: 1;
  revision: number;
  brands: B[];
  products: P[];
  audits: BrandMarketplaceAudit[];
};

export function appendBrandMarketplaceAudit(state: { audits: BrandMarketplaceAudit[] }, user: BrandPageActor, entityType: 'brand' | 'product', entityId: number, action: string, detail: string) {
  state.audits.unshift({ id: `BA${Date.now()}${Math.random().toString(36).slice(2, 7)}`, action, actorId: user.id, actorName: user.name, entityType, entityId, detail, createdAt: new Date().toISOString() });
  state.audits = state.audits.slice(0, 500);
}

export function createLocalBrandMarketplaceRepository<B, P>(root: string) {
  if (typeof root !== 'string' || !root || !path.isAbsolute(root) || /[\u0000-\u001f\u007f\\]/.test(root) || root.split(path.sep).includes('..') || path.resolve(root) === path.parse(root).root) {
    throw new Error('品牌页面储存根目录必须是明确的非根绝对路径');
  }
  const resolvedRoot = path.resolve(root);
  function checkLocation(file = resolvedRoot) {
    let cursor = path.parse(resolvedRoot).root;
    for (const part of path.relative(cursor, file).split(path.sep)) {
      cursor = path.join(cursor, part);
      try {
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || (cursor !== file && !stat.isDirectory()) || (cursor === resolvedRoot && !stat.isDirectory())) {
          throw new Error('品牌页面储存路径不可经过符号链接或非目录祖先');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
  }
  checkLocation();
  type MarketplaceState = BrandMarketplaceState<B, P>;
  function dataDir() { return resolvedRoot; }
  function dataFile() {
    return path.join(dataDir(), 'cn-brand-marketplace.json');
  }

  function lockFile() {
    return `${dataFile()}.lock`;
  }

  function emptyState(): MarketplaceState {
    return { schemaVersion: 1, revision: 1, brands: [], products: [], audits: [] };
  }

  function normalizeState(value: unknown): MarketplaceState {
    const parsed = value && typeof value === 'object' ? value as Partial<MarketplaceState> : {};
    return {
      schemaVersion: 1,
      revision: Number(parsed.revision || 1),
      brands: Array.isArray(parsed.brands) ? parsed.brands : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      audits: Array.isArray(parsed.audits) ? parsed.audits : [],
    };
  }

  function readState(): MarketplaceState {
    checkLocation(dataFile());
    if (!existsSync(dataFile())) return emptyState();
    try {
      return normalizeState(JSON.parse(readFileSync(dataFile(), 'utf8')));
    } catch {
      return emptyState();
    }
  }

  function writeState(state: MarketplaceState) {
    checkLocation(dataFile());
    mkdirSync(dataDir(), { recursive: true });
    const temporary = `${dataFile()}.${process.pid}.${Date.now()}.tmp`;
    checkLocation(temporary);
    writeFileSync(temporary, JSON.stringify({ ...state, revision: state.revision + 1 }, null, 2));
    renameSync(temporary, dataFile());
  }

  function withWrite<T>(operation: (state: MarketplaceState) => T): T {
    checkLocation(lockFile());
    mkdirSync(dataDir(), { recursive: true });
    let descriptor: number | null = null;
    const deadline = Date.now() + 3000;
    while (descriptor === null) {
      try {
        descriptor = openSync(lockFile(), 'wx');
      } catch (error: any) {
        if (error?.code !== 'EEXIST' || Date.now() > deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try {
      const state = readState();
      const result = operation(state);
      writeState(state);
      return result;
    } finally {
      closeSync(descriptor);
      checkLocation(lockFile());
      rmSync(lockFile(), { force: true });
    }
  }
  return { readState, withWrite };
}
