import { sql } from 'drizzle-orm';
import { db } from './db';
import type { BrandAiImageUsage, BrandAiPriceSnapshot, BrandAiProviderUsage, BrandAiServiceCode } from './local-cn-brand-ai-credits';

export type DbReserveBrandAiUsageInput = {
  usageId: string;
  brandId: number;
  userId: number;
  serviceCode: BrandAiServiceCode;
  model: string;
  idempotencyKey: string;
  estimatedDebitMicrosCny: number;
  priceSnapshot: BrandAiPriceSnapshot;
  exchangeRateSnapshot: Record<string, unknown>;
};

export type DbCompleteBrandAiUsageInput = {
  usageId: string;
  brandId: number;
  providerUsage?: BrandAiProviderUsage;
  imageUsage?: BrandAiImageUsage;
  actualDebitMicrosCny: number;
};

export type DbTimeoutBrandAiUsageInput = {
  usageId: string;
  brandId: number;
  reason: string;
};

export async function reserveBrandAiUsageDb(input: DbReserveBrandAiUsageInput) {
  return (db as any).transaction(async (tx: any) => {
    const existing = await tx.execute(sql`
      SELECT *
      FROM brand_ai_usages
      WHERE brand_id = ${input.brandId} AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `);
    if (existing.rows?.[0]) return existing.rows[0];

    const account = await tx.execute(sql`
      SELECT *
      FROM brand_ai_accounts
      WHERE brand_id = ${input.brandId}
      FOR UPDATE
    `);
    if (!account.rows?.[0]) throw new Error('AI balance account does not exist');
    if (Number(account.rows[0].balance_micros_cny) - Number(account.rows[0].reserved_micros_cny) < input.estimatedDebitMicrosCny) throw new Error('AI balance is insufficient');

    await tx.execute(sql`
      UPDATE brand_ai_accounts
      SET reserved_micros_cny = reserved_micros_cny + ${input.estimatedDebitMicrosCny}, updated_at = now()
      WHERE brand_id = ${input.brandId}
    `);

    const inserted = await tx.execute(sql`
      INSERT INTO brand_ai_usages (
        id, brand_id, user_id, service_code, model, idempotency_key, status,
        estimated_debit_micros_cny, platform_service_fee_micros_cny,
        price_snapshot, exchange_rate_snapshot, provider_usage, requested_at
      )
      VALUES (
        ${input.usageId}, ${input.brandId}, ${input.userId}, ${input.serviceCode}, ${input.model}, ${input.idempotencyKey}, 'reserved',
        ${input.estimatedDebitMicrosCny}, 0,
        ${JSON.stringify(input.priceSnapshot)}::jsonb, ${JSON.stringify(input.exchangeRateSnapshot)}::jsonb, '{}'::jsonb, now()
      )
      RETURNING *
    `);
    return inserted.rows[0];
  });
}

export async function completeBrandAiUsageDb(input: DbCompleteBrandAiUsageInput) {
  return (db as any).transaction(async (tx: any) => {
    const usageResult = await tx.execute(sql`
      SELECT *
      FROM brand_ai_usages
      WHERE id = ${input.usageId} AND brand_id = ${input.brandId}
      FOR UPDATE
    `);
    const usage = usageResult.rows?.[0];
    if (!usage) throw new Error('AI usage does not exist');
    if (usage.status !== 'reserved') return usage;

    await tx.execute(sql`
      SELECT *
      FROM brand_ai_accounts
      WHERE brand_id = ${input.brandId}
      FOR UPDATE
    `);

    const estimated = Number(usage.estimated_debit_micros_cny);
    const actual = Math.max(0, Math.min(input.actualDebitMicrosCny, estimated));
    const refund = Math.max(0, estimated - actual);
    const providerUsage = input.providerUsage || {};
    const imageUsage = input.imageUsage || {};

    await tx.execute(sql`
      UPDATE brand_ai_accounts
      SET
        reserved_micros_cny = GREATEST(0, reserved_micros_cny - ${estimated}),
        balance_micros_cny = GREATEST(0, balance_micros_cny - ${actual}),
        updated_at = now()
      WHERE brand_id = ${input.brandId}
    `);

    const completed = await tx.execute(sql`
      UPDATE brand_ai_usages
      SET
        status = 'succeeded',
        actual_debit_micros_cny = ${actual},
        reserved_refund_micros_cny = ${refund},
        provider_request_id = ${input.providerUsage?.providerRequestId || input.imageUsage?.providerRequestId || ''},
        prompt_tokens = ${input.providerUsage?.promptTokens || 0},
        completion_tokens = ${input.providerUsage?.completionTokens || 0},
        total_tokens = ${input.providerUsage?.totalTokens || 0},
        image_success_count = ${input.imageUsage?.successCount || 0},
        image_failed_count = ${input.imageUsage?.failedCount || 0},
        provider_usage = ${JSON.stringify({ providerUsage, imageUsage })}::jsonb,
        completed_at = now()
      WHERE id = ${input.usageId} AND brand_id = ${input.brandId}
      RETURNING *
    `);
    return completed.rows[0];
  });
}

export async function timeoutBrandAiUsageDb(input: DbTimeoutBrandAiUsageInput) {
  return (db as any).transaction(async (tx: any) => {
    const usageResult = await tx.execute(sql`
      SELECT *
      FROM brand_ai_usages
      WHERE id = ${input.usageId} AND brand_id = ${input.brandId}
      FOR UPDATE
    `);
    const usage = usageResult.rows?.[0];
    if (!usage) throw new Error('AI usage does not exist');
    if (usage.status !== 'reserved') return usage;

    const estimated = Number(usage.estimated_debit_micros_cny);
    await tx.execute(sql`
      UPDATE brand_ai_accounts
      SET reserved_micros_cny = GREATEST(0, reserved_micros_cny - ${estimated}), updated_at = now()
      WHERE brand_id = ${input.brandId}
    `);
    const timedOut = await tx.execute(sql`
      UPDATE brand_ai_usages
      SET status = 'refunded', reserved_refund_micros_cny = ${estimated}, provider_usage = ${JSON.stringify({ timeoutReason: input.reason })}::jsonb, completed_at = now()
      WHERE id = ${input.usageId} AND brand_id = ${input.brandId}
      RETURNING *
    `);
    return timedOut.rows[0];
  });
}
