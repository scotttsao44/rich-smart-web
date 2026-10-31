import path from 'path';
import { db } from './db';
import { objectStorageObjects } from './schema';
import { createLocalBrandAssetStore } from './local-brand-asset-store';
import { prepareBrandAssetUpload, persistPreparedBrandAsset, type BrandAssetUploadInput } from './brand-asset-upload-core';
export type { StoredBrandAsset } from './local-brand-asset-store';

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function mediaRoot() {
  return process.env.CN_PILOT_MEDIA_DIR || path.join(dataDir(), 'object-storage');
}

function requireProductionObjectStorage() {
  const hasAliyunOss = Boolean(process.env.ALIYUN_OSS_BUCKET && process.env.ALIYUN_OSS_REGION && process.env.ALIYUN_OSS_ACCESS_KEY_ID && process.env.ALIYUN_OSS_ACCESS_KEY_SECRET);
  const pilotVolume = process.env.CN_PILOT_MEDIA_STORAGE === 'ecs_volume' && Boolean(process.env.CN_PILOT_MEDIA_DIR);
  if (process.env.NODE_ENV === 'production' && !hasAliyunOss && !pilotVolume && process.env.CN_ALLOW_LOCAL_OBJECT_STORAGE !== 'true') {
    throw new Error('正式环境尚未配置 OSS 或 ECS 持久媒体卷，已拒绝保存图片，避免落入容器临时文件');
  }
}

export function objectStorageReadiness() {
  const hasAliyunOss = Boolean(process.env.ALIYUN_OSS_BUCKET && process.env.ALIYUN_OSS_REGION && process.env.ALIYUN_OSS_ACCESS_KEY_ID && process.env.ALIYUN_OSS_ACCESS_KEY_SECRET);
  const pilotVolume = process.env.CN_PILOT_MEDIA_STORAGE === 'ecs_volume' && Boolean(process.env.CN_PILOT_MEDIA_DIR);
  return {
    productionReady: hasAliyunOss || pilotVolume,
    provider: hasAliyunOss ? 'aliyun-oss' : pilotVolume ? 'ecs-volume-pilot' : 'local-persistent-substitute',
    blocker: hasAliyunOss || pilotVolume ? '' : '缺少 ALIYUN_OSS_* 或 CN_PILOT_MEDIA_STORAGE=ecs_volume/CN_PILOT_MEDIA_DIR；正式 production 不会使用本机替身',
    singleEcsRisk: pilotVolume,
  };
}

export function getLocalBrandAssetMetadata(objectKey: string) {
  return createLocalBrandAssetStore(path.resolve(mediaRoot())).getMetadata(objectKey);
}

export async function persistBrandAssetBuffer(input: BrandAssetUploadInput) {
  requireProductionObjectStorage();
  const prepared = prepareBrandAssetUpload(input, objectStorageReadiness);
  const { ready, contentType, hash, objectKey } = prepared;
  if (ready.provider === 'aliyun-oss') {
    throw new Error('Aliyun OSS adapter interface is ready, but the SDK/upload implementation is not bundled in this build; configure and implement signed PUT before production exposure');
  }

  const store = createLocalBrandAssetStore(path.resolve(mediaRoot()));
  return persistPreparedBrandAsset(prepared, {
    store,
    writeMetadata: async (asset) => {
      const { publicUrl } = asset;
      if (process.env.DATABASE_URL) {
        await db.insert(objectStorageObjects).values({
          provider: ready.provider,
          bucket: 'local-cn-data',
          objectKey,
          publicUrl,
          contentType,
          byteSize: input.bytes.length,
          sha256: hash,
          virusScanStatus: 'not_configured',
          ownerMemberId: input.ownerMemberId,
          brandId: input.brandId,
          createdAt: new Date(),
        }).onConflictDoNothing();
      } else {
        store.writeMetadata(asset);
      }
    },
  });
}
