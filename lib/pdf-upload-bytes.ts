export class UploadValidationError extends Error {}

export function copyPdfParserBytes(bytes: Uint8Array) {
  // PDF.js can transfer its input buffer; never lend it the upload's buffer.
  return new Uint8Array(bytes);
}

export function assertUploadBytesIntact(bytes: Uint8Array, expectedSize: number) {
  if (!expectedSize || bytes.byteLength !== expectedSize) {
    throw new Error('Upload byte ownership or length check failed');
  }
}

export function publicUploadError(error: unknown, fallback: string) {
  if (error instanceof UploadValidationError) return error.message;
  if (error instanceof Error && error.name === 'PasswordException') return 'PDF 已加密，请上传未加密的原始文件';
  if (error instanceof Error && ['InvalidPDFException', 'FormatError'].includes(error.name)) return 'PDF 无法解码，请上传可正常开启的完整静态文件';
  return fallback;
}
