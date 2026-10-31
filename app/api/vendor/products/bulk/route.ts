import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { products } from '@/lib/schema';
import { getFreshSessionUser } from '@/lib/auth';
import { buildSupplierInfo, getVendorProductEditUrl } from '@/lib/vendor-product-review';
import { createBrandProduct } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

class CsvInputError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, CsvInputError.prototype);
    this.name = 'CsvInputError';
  }
}

function toSlug(name: string, index: number) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || `product-${Date.now()}-${index}`;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] || '');
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function mapRow(row: Record<string, string>) {
  return {
    supplierName: row['厂商名称'],
    supplierContact: row['联系人'],
    supplierPhone: row['联系电话'],
    supplierServiceId: row['客服账号'] || row['LINE ID'],
    supplierWechat: row['微信 ID'],
    supplierEmail: row['Email'],
    name: row['商品名称'],
    priceTwd: row['售价CNY'] || row['售价TWD'],
    stockQuantity: row['库存数量'],
    commissionRate: row['推荐人利润%'],
    imageUrl: row['商品图片URL'],
    description: row['产品详细页内容'],
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getFreshSessionUser(request);
    if (!user) {
      return NextResponse.json({ message: '批量提交审核请先登录厂商中心，避免补件通知找不到人。' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ message: '请求内容必须是包含 CSV 的 JSON 对象' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: '请求内容不是有效的 JSON，请重新上传 CSV' }, { status: 400 });
    }
    const rows = parseCsv(String(body.csv || '')).map(mapRow);
    if (rows.length === 0) {
      return NextResponse.json({ message: 'CSV 没有商品资料' }, { status: 400 });
    }

    const now = new Date();
    const values = rows.map((row, index) => {
      const required = ['supplierName', 'supplierContact', 'name', 'priceTwd', 'stockQuantity', 'commissionRate', 'description'] as const;
      const missing = required.filter((key) => !String(row[key] || '').trim());
      const { contacts, supplierName } = buildSupplierInfo(row);
      if (missing.length > 0 || contacts.length === 0) {
        throw new CsvInputError(`第 ${index + 2} 行资料不完整，请确认必填栏位与至少一種联系方式。`);
      }
      return {
        name: String(row.name).trim(),
        slug: toSlug(String(row.name), index),
        description: String(row.description).trim(),
        images: row.imageUrl ? [String(row.imageUrl).trim()] : [],
        priceTwd: String(row.priceTwd),
        stockQuantity: Number(row.stockQuantity || 0),
        supplierId: user.id,
        supplierName,
        commissionRate: String(row.commissionRate),
        reviewStatus: 'pending',
        reviewNote: '厂商批量提交，等待平台审核',
        submittedAt: now,
        isActive: false,
        isFeatured: false,
        createdAt: now,
        updatedAt: now,
      };
    });

    if (!process.env.DATABASE_URL) {
      const created = values.map((product) => createBrandProduct(user, {
        name: product.name,
        category: '品牌商品',
        description: product.description,
        fulfillmentInfo: '品牌确认库存后安排发货，具体时效以商品说明为准。',
        imageUrl: product.images[0] || '',
        imageIsTest: false,
        priceCny: product.priceTwd,
        stockQuantity: product.stockQuantity,
        commissionRate: product.commissionRate,
      }));
      return NextResponse.json({
        count: created.length,
        products: created.map((product) => ({
          id: product.id,
          name: product.name,
          reviewStatus: product.reviewStatus,
          editUrl: `/vendor/products/${product.id}/edit`,
        })),
      });
    }

    const inserted = await db.insert(products).values(values).returning();
    return NextResponse.json({
      count: inserted.length,
      products: inserted.map((product) => ({
        id: product.id,
        name: product.name,
        reviewStatus: product.reviewStatus,
        editUrl: getVendorProductEditUrl(product.id),
      })),
    });
  } catch (error: any) {
    const msg = String(error?.message || '批量提交审核失败');
    if (error instanceof CsvInputError || error?.name === 'CsvInputError' || /第\s*\d+\s*行|资料不完整|必填|请填写|需大于|格式|售价|结算价|库存|不能/.test(msg)) {
      return NextResponse.json({ error: msg, message: msg }, { status: 422 });
    }
    console.error('Bulk vendor product submission failed:', error);
    return NextResponse.json({ error: msg, message: msg }, { status: 422 });
  }
}
