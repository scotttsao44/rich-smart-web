import { createHash, randomBytes } from 'crypto';
import type { createLocalBrandAssetStore, StoredBrandAsset } from './local-brand-asset-store';

const MAX_IMAGE_BYTES = 3_000_000;
const MAX_IMAGE_DIMENSION = 8000;
const MAX_IMAGE_PIXELS = 32_000_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type BrandAssetUploadInput = {
  bytes: Buffer;
  declaredType?: string;
  ownerMemberId: number;
  brandId: number;
  purpose: 'brand-page' | 'product' | 'ai-generated';
};

export type BrandAssetReadiness = { provider: string; productionReady: boolean };

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function extension(contentType: string) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

function detectImageType(bytes: Buffer, declaredType = '') {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return declaredType && ALLOWED_IMAGE_TYPES.has(declaredType) ? declaredType : '';
}

function readUInt24(bytes: Buffer, offset: number) {
  return (bytes[offset] << 16) + (bytes[offset + 1] << 8) + bytes[offset + 2];
}

function detectImageDimensions(bytes: Buffer, contentType: string) {
  if (contentType === 'image/png' && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  if (contentType === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { width: readUInt24(bytes, 24) + 1, height: readUInt24(bytes, 27) + 1 };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
  }

  if (contentType === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }

  throw new Error('图片尺寸读取失败，请重新导出 JPG、PNG 或 WebP');
}

function assertImageDimensions(bytes: Buffer, contentType: string) {
  const dimensions = detectImageDimensions(bytes, contentType);
  if (!dimensions.width || !dimensions.height) throw new Error('图片尺寸不正确');
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new Error('图片尺寸过大，请压缩到 8000px 以内');
  }
  return dimensions;
}

function scanForActiveContent(bytes: Buffer) {
  const head = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('utf8').toLowerCase();
  if (head.includes('<script') || head.includes('<svg') || head.includes('<html') || head.includes('<?xml')) {
    throw new Error('图片含有可执行或向量内容，请改上传 JPG、PNG 或 WebP 点阵图片');
  }
}

// Keep readiness and key generation after image validation and before provider dispatch.
export function prepareBrandAssetUpload(input: BrandAssetUploadInput, getReadiness: () => BrandAssetReadiness) {
  if (!input.bytes.length) throw new Error('上传文件为空');
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new Error('图片请压缩到 3MB 以内');
  scanForActiveContent(input.bytes);
  const contentType = detectImageType(input.bytes, input.declaredType || '');
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error('仅支持 JPG、PNG、WebP 图片');
  const dimensions = assertImageDimensions(input.bytes, contentType);
  const hash = sha256(input.bytes);

  const ready = getReadiness();
  const ext = extension(contentType);
  const objectKey = `brand-assets/${input.brandId}/${input.purpose}/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 16)}-${randomBytes(4).toString('hex')}.${ext}`;

  return { input, ready, contentType, dimensions, hash, objectKey };
}

export async function persistPreparedBrandAsset(
  prepared: ReturnType<typeof prepareBrandAssetUpload>,
  dependencies: {
    store: Pick<ReturnType<typeof createLocalBrandAssetStore>, 'writeBytes'>;
    writeMetadata: (asset: StoredBrandAsset) => void | Promise<void>;
  },
) {
  const { input, ready, contentType, dimensions, hash, objectKey } = prepared;
  const { store } = dependencies;
  store.writeBytes(objectKey, input.bytes);
  const publicUrl = `/api/cn/brand-assets?key=${encodeURIComponent(objectKey)}`;
  const asset: StoredBrandAsset = {
    provider: ready.provider,
    objectKey,
    publicUrl,
    contentType,
    byteSize: input.bytes.length,
    sha256: hash,
    ownerMemberId: input.ownerMemberId,
    brandId: input.brandId,
    purpose: input.purpose,
    width: dimensions.width,
    height: dimensions.height,
    createdAt: new Date().toISOString(),
  };

  await dependencies.writeMetadata(asset);

  return {
    provider: ready.provider,
    objectKey,
    publicUrl,
    contentType,
    byteSize: input.bytes.length,
    sha256: hash,
    width: dimensions.width,
    height: dimensions.height,
    productionReady: ready.productionReady,
  };
}

export function serializeBrandAssetUploadResponse(saved: Awaited<ReturnType<typeof persistPreparedBrandAsset>>) {
  return {
    url: saved.publicUrl,
    objectKey: saved.objectKey,
    contentType: saved.contentType,
    byteSize: saved.byteSize,
    sha256: saved.sha256,
    width: saved.width,
    height: saved.height,
    productionReady: saved.productionReady,
  };
}
