import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import path from 'path';

const LOCAL_METADATA_FILE = '.brand-asset-metadata.json';

export type StoredBrandAsset = {
  provider: string;
  objectKey: string;
  publicUrl: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  ownerMemberId: number;
  brandId: number;
  purpose: 'brand-page' | 'product' | 'ai-generated';
  width: number;
  height: number;
  createdAt: string;
};

export function createLocalBrandAssetStore(root: string) {
  if (typeof root !== 'string' || !root || !path.isAbsolute(root) || /[\u0000-\u001f\u007f\\]/.test(root) || root.split(path.sep).includes('..')) {
    throw new Error('本机媒体根目录必须是明确的绝对路径');
  }
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot === path.parse(resolvedRoot).root) throw new Error('不可使用文件系统根目录储存媒体');
  function checkRootAncestors() {
    let ancestor = path.parse(resolvedRoot).root;
    for (const part of path.relative(ancestor, resolvedRoot).split(path.sep)) {
      ancestor = path.join(ancestor, part);
      try {
        const stat = lstatSync(ancestor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('本机媒体根目录必须是非符号链接目录');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
  }
  checkRootAncestors();
  const base = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;

  function targetFor(key: string, internalMetadata = false) {
    checkRootAncestors();
    if (typeof key !== 'string' || !key || path.isAbsolute(key) || /[\u0000-\u001f\u007f\\]/.test(key) || /^[a-z]:/i.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('非法储存路径');
    }
    const target = path.resolve(base, key);
    if (!target.startsWith(`${base}${path.sep}`)) throw new Error('非法储存路径');
    if (!internalMetadata && path.relative(base, target).toLowerCase() === LOCAL_METADATA_FILE) {
      throw new Error('不可使用内部媒体索引作为资源路径');
    }
    // Reject symlink traversal at the root and every existing descendant.
    let cursor = base;
    for (const part of ['', ...path.relative(base, target).split(path.sep)]) {
      if (part) cursor = path.join(cursor, part);
      try {
        if (lstatSync(cursor).isSymbolicLink()) throw new Error('非法储存路径：符号链接');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }

  function readMetadata(): StoredBrandAsset[] {
    const file = targetFor(LOCAL_METADATA_FILE, true);
    if (!existsSync(file)) return [];
    try {
      const rows = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(rows) ? rows.filter((row) => row && typeof row.objectKey === 'string') : [];
    } catch {
      return [];
    }
  }

  return {
    writeBytes(key: string, bytes: Buffer) {
      const target = targetFor(key);
      if (!existsSync(path.dirname(target))) mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(targetFor(key), bytes, { mode: 0o600 });
    },
    readBytes(key: string) {
      return readFileSync(targetFor(key));
    },
    writeMetadata(asset: StoredBrandAsset) {
      targetFor(asset.objectKey);
      const rows = readMetadata().filter((row) => row.objectKey !== asset.objectKey);
      rows.push(asset);
      if (!existsSync(base)) mkdirSync(base, { recursive: true });
      writeFileSync(targetFor(LOCAL_METADATA_FILE, true), JSON.stringify(rows.slice(-2000), null, 2), { mode: 0o600 });
    },
    getMetadata(key: string) {
      targetFor(key);
      return readMetadata().find((row) => row.objectKey === key) || null;
    },
  };
}
