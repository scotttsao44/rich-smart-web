'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function ReferralQrCode({ value }: { value: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!value) return;
    let active = true;
    QRCode.toDataURL(value, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f1f16', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setSrc(dataUrl);
    });
    return () => { active = false; };
  }, [value]);

  return (
    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white p-3">
      {src ? (
        <Image unoptimized src={src} width={360} height={360} alt="专属邀请链接 QR Code" className="h-full w-full object-contain" />
      ) : (
        <div className="text-sm font-bold text-stone-500">生成中</div>
      )}
    </div>
  );
}
