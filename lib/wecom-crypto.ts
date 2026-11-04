import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// 企业微信回调加解密（WXBizMsgCrypt）：
// msg_signature = SHA1(sort(Token, timestamp, nonce, encrypt))
// AES-256-CBC，key = Base64(EncodingAESKey + '=')，IV = key 前 16 字节，PKCS#7 补位到 32 字节
// 明文 = random(16) + msg_len(4, 网络字节序) + msg + receiveid（自建应用为 CorpID）

export function wecomCallbackConfigured() {
  return Boolean(process.env.WECOM_CALLBACK_TOKEN && process.env.WECOM_CALLBACK_AES_KEY && process.env.WECOM_CORP_ID);
}

export function wecomSignature(token: string, timestamp: string, nonce: string, encrypt: string) {
  return createHash('sha1').update([token, timestamp, nonce, encrypt].sort().join('')).digest('hex');
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyWecomSignature(msgSignature: string, timestamp: string, nonce: string, encrypt: string) {
  const token = process.env.WECOM_CALLBACK_TOKEN || '';
  if (!token || !timestamp || !nonce || !encrypt) return false;
  return safeEqual(wecomSignature(token, timestamp, nonce, encrypt), String(msgSignature || '').toLowerCase());
}

function aesKey(encodingAesKey = process.env.WECOM_CALLBACK_AES_KEY || '') {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (encodingAesKey.length !== 43 || key.length !== 32) throw new Error('bad_aes_key');
  return key;
}

export function decryptWecom(encrypt: string, opts: { aesKey?: string; receiveId?: string } = {}) {
  const key = aesKey(opts.aesKey);
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  let buf = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error('bad_padding');
  buf = buf.subarray(0, buf.length - pad);
  const msgLen = buf.readUInt32BE(16);
  const msg = buf.subarray(20, 20 + msgLen).toString('utf8');
  const receiveId = buf.subarray(20 + msgLen).toString('utf8');
  const expected = opts.receiveId ?? (process.env.WECOM_CORP_ID || '');
  if (receiveId !== expected) throw new Error('receiveid_mismatch');
  return msg;
}

export function encryptWecom(msg: string, opts: { aesKey?: string; receiveId?: string } = {}) {
  const key = aesKey(opts.aesKey);
  const body = Buffer.from(msg, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const raw = Buffer.concat([randomBytes(16), len, body, Buffer.from(opts.receiveId ?? (process.env.WECOM_CORP_ID || ''), 'utf8')]);
  const padLen = 32 - (raw.length % 32);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}
