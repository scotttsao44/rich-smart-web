import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';
import { getPublicProductById, parsePublicProductId } from '@/lib/public-products';

export const dynamic = 'force-dynamic';

export default async function ChinaProductDetailPage({ params }: { params: { id: string } }) {
  const id = parsePublicProductId(params.id);
  if (!id) notFound();

  const product = await getPublicProductById(id);
  if (!product) notFound();

  return <ProductDetailClient product={product} />;
}
