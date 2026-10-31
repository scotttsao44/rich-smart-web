import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = [
    '厂商名称',
    '联系人',
    '联系电话',
    '客服账号',
    '微信 ID',
    'Email',
    '商品名称',
    '售价CNY',
    '库存数量',
    '推荐人利润%',
    '商品图片URL',
    '产品详细页内容',
  ];
  const csv = `\uFEFF${headers.join(',')}\n`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="vendor-products-template.csv"',
    },
  });
}
