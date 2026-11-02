import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// 公众号「服务器配置」消息加解密（兼容明文 / 兼容 / 安全模式）。
// 算法见微信官方文档：AES-256-CBC，key = Base64(EncodingAESKey + '=')，IV = key 前 16 字节，PKCS#7 补位到 32 字节。

export function mpServerConfigured() {
  return Boolean(process.env.WECHAT_MP_MSG_TOKEN && process.env.WECHAT_MP_ENCODING_AES_KEY && process.env.WECHAT_OFFICIAL_APP_ID);
}

function sha1(parts: string[]) {
  return createHash('sha1').update([...parts].sort().join('')).digest('hex');
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyUrlSignature(signature: string, timestamp: string, nonce: string) {
  const token = process.env.WECHAT_MP_MSG_TOKEN || '';
  if (!token || !timestamp || !nonce) return false;
  return safeEqual(sha1([token, timestamp, nonce]), String(signature || '').toLowerCase());
}

export function verifyMsgSignature(msgSignature: string, timestamp: string, nonce: string, encrypt: string) {
  const token = process.env.WECHAT_MP_MSG_TOKEN || '';
  if (!token || !timestamp || !nonce || !encrypt) return false;
  return safeEqual(sha1([token, timestamp, nonce, encrypt]), String(msgSignature || '').toLowerCase());
}

function aesKey() {
  const key = Buffer.from(`${process.env.WECHAT_MP_ENCODING_AES_KEY || ''}=`, 'base64');
  if (key.length !== 32) throw new Error('bad_aes_key');
  return key;
}

export function decryptMpMessage(encrypt: string) {
  const key = aesKey();
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  let buf = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error('bad_padding');
  buf = buf.subarray(0, buf.length - pad);
  const msgLen = buf.readUInt32BE(16);
  const xml = buf.subarray(20, 20 + msgLen).toString('utf8');
  const appId = buf.subarray(20 + msgLen).toString('utf8');
  if (appId !== (process.env.WECHAT_OFFICIAL_APP_ID || '')) throw new Error('appid_mismatch');
  return xml;
}

export function encryptMpMessage(xml: string) {
  const key = aesKey();
  const msg = Buffer.from(xml, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(msg.length, 0);
  const raw = Buffer.concat([randomBytes(16), len, msg, Buffer.from(process.env.WECHAT_OFFICIAL_APP_ID || '', 'utf8')]);
  const padLen = 32 - (raw.length % 32);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function cdata(value: string) {
  return `<![CDATA[${String(value).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function wrapEncryptedReply(xml: string, nonce: string) {
  const token = process.env.WECHAT_MP_MSG_TOKEN || '';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const encrypt = encryptMpMessage(xml);
  const signature = sha1([token, timestamp, nonce, encrypt]);
  return `<xml><Encrypt>${cdata(encrypt)}</Encrypt><MsgSignature>${cdata(signature)}</MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce>${cdata(nonce)}</Nonce></xml>`;
}

export function buildTextReplyXml(toUser: string, fromUser: string, content: string) {
  return `<xml><ToUserName>${cdata(toUser)}</ToUserName><FromUserName>${cdata(fromUser)}</FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType>${cdata('text')}</MsgType><Content>${cdata(content)}</Content></xml>`;
}

// 微信推送的 XML 只有一层，按标签取值即可
export function parseMpXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = String(xml || '').replace(/^[\s\S]*?<xml>/, '').replace(/<\/xml>[\s\S]*$/, '');
  const re = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out[m[1]] = m[2] !== undefined ? m[2] : (m[3] || '').trim();
  }
  return out;
}
