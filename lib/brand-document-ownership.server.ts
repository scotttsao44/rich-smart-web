import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { brandDocumentTokenOwner, enforceBrandApplicationDocumentOwnership } from './brand-application-documents';

export function brandDocumentDirectory() {
  return path.join(process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'), 'brand-documents');
}

export function readBrandDocumentOwnership(token: string): { source: 'metadata' | 'legacy' | 'invalid'; ownerId: number | null } {
  if (token !== token.trim() || !/^[a-z0-9_-]{1,200}\.(?:pdf|jpg|png|webp)$/i.test(token)) return { source: 'invalid', ownerId: null };
  try {
    const metadata = JSON.parse(readFileSync(path.join(brandDocumentDirectory(), '.metadata', `${token}.json`), 'utf8'));
    if (metadata?.token !== token || !Number.isSafeInteger(metadata.userId) || metadata.userId <= 0) {
      return { source: 'invalid', ownerId: null };
    }
    return { source: 'metadata', ownerId: metadata.userId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      const tokenOwner = brandDocumentTokenOwner(token);
      return { source: tokenOwner ? 'legacy' : 'invalid', ownerId: tokenOwner };
    }
    console.error('Brand document metadata read failed:', error);
    return { source: 'invalid', ownerId: null };
  }
}

export function enforceStoredBrandApplicationDocumentOwnership(value: unknown, memberId: number) {
  return enforceBrandApplicationDocumentOwnership(value, memberId, (token) => {
    const ownership = readBrandDocumentOwnership(token);
    return ownership.ownerId && existsSync(path.join(brandDocumentDirectory(), token)) ? ownership.ownerId : null;
  });
}
