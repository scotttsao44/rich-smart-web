import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { addProfilePhoto, profilePhotoDir, setProfilePhotoStatus } from './local-cn-experience-points';
import { getMpStableToken } from './wechat-mp-api';

export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

export function sniffImage(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export function savePhotoBuffer(profileId: string, photoId: string, buf: Buffer) {
  const ext = sniffImage(buf);
  if (!ext) throw new Error('只支持 JPG／PNG／WEBP 图片');
  if (buf.length > PHOTO_MAX_BYTES) throw new Error('图片太大（上限 6MB）');
  const dir = profilePhotoDir(profileId);
  mkdirSync(dir, { recursive: true });
  const file = `${photoId}.${ext}`;
  writeFileSync(path.join(dir, file), buf);
  return file;
}

// 网页上传
export function saveUploadedPhoto(profileId: string, buf: Buffer) {
  if (!sniffImage(buf)) throw new Error('只支持 JPG／PNG／WEBP 图片');
  if (buf.length > PHOTO_MAX_BYTES) throw new Error('图片太大（上限 6MB）');
  const { photo } = addProfilePhoto(profileId, { file: '', status: 'downloading', source: 'upload' });
  const file = savePhotoBuffer(profileId, photo.id, buf);
  setProfilePhotoStatus(profileId, photo.id, 'ok', file);
  return { ...photo, file, status: 'ok' as const };
}

// 服务号图片消息：先登记 MediaId，再后台用 media/get 下载（临时素材 3 天内有效）
export function registerWechatPhoto(profileId: string, mediaId: string) {
  const { profile, photo } = addProfilePhoto(profileId, { file: '', status: 'downloading', source: 'wechat', mediaId });
  void downloadWechatMedia(profileId, photo.id, mediaId);
  return { profile, photo };
}

async function downloadWechatMedia(profileId: string, photoId: string, mediaId: string) {
  try {
    const token = await getMpStableToken();
    if (!token) throw new Error('no token');
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!sniffImage(buf)) {
      let errcode = '';
      try { errcode = String(JSON.parse(buf.toString('utf8')).errcode ?? ''); } catch { /* not json */ }
      throw new Error(`media/get not image errcode=${errcode}`);
    }
    const file = savePhotoBuffer(profileId, photoId, buf);
    setProfilePhotoStatus(profileId, photoId, 'ok', file);
  } catch (e) {
    console.warn('[store-profile] media download failed', e instanceof Error ? e.message : 'error');
    setProfilePhotoStatus(profileId, photoId, 'failed');
  }
}
