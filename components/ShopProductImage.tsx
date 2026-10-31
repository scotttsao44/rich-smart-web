'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Package } from 'lucide-react';

export default function ShopProductImage({ src, alt, className = 'object-cover', sizes }: {
  src: string | null;
  alt: string;
  className?: string;
  sizes?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && src !== failedSrc) {
    return <Image src={src} alt={alt} fill sizes={sizes} className={className} onError={() => setFailedSrc(src)} />;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-stone-100 text-stone-500">
      <Package className="h-8 w-8" aria-hidden="true" />
      <span className="text-xs font-semibold">品牌商品</span>
    </div>
  );
}
