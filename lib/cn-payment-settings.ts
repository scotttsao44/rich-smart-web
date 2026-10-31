import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

export type CnPaymentSettings = {
  platformFeeRate: number;
  paymentChannelFeeRate: number;
  riskReserveRate: number;
  updatedAt: string | null;
  updatedBy: number | null;
};

const defaults: CnPaymentSettings = {
  platformFeeRate: 0.6,
  paymentChannelFeeRate: 0,
  riskReserveRate: 0,
  updatedAt: null,
  updatedBy: null,
};

function settingsPath() {
  const directory = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(directory, 'cn-payment-settings.json');
}

function rate(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error(`${label}必须介于 0% 到 100%`);
  return Math.round(parsed * 10000) / 10000;
}

export function getCnPaymentSettings(): CnPaymentSettings {
  try {
    if (!existsSync(settingsPath())) return { ...defaults };
    const saved = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    return {
      platformFeeRate: rate(saved.platformFeeRate ?? defaults.platformFeeRate, '平台服务费率'),
      paymentChannelFeeRate: rate(saved.paymentChannelFeeRate ?? 0, '支付通道费率'),
      riskReserveRate: rate(saved.riskReserveRate ?? 0, '风险准备金率'),
      updatedAt: saved.updatedAt ? String(saved.updatedAt) : null,
      updatedBy: saved.updatedBy == null ? null : Number(saved.updatedBy),
    };
  } catch {
    return { ...defaults };
  }
}

export function updateCnPaymentSettings(input: { platformFeeRate?: unknown; paymentChannelFeeRate: unknown; riskReserveRate: unknown; updatedBy: number }) {
  const current = getCnPaymentSettings();
  const settings: CnPaymentSettings = {
    platformFeeRate: rate(input.platformFeeRate ?? current.platformFeeRate, '平台服务费率'),
    paymentChannelFeeRate: rate(input.paymentChannelFeeRate, '支付通道费率'),
    riskReserveRate: rate(input.riskReserveRate, '风险准备金率'),
    updatedAt: new Date().toISOString(),
    updatedBy: Number(input.updatedBy),
  };
  const target = settingsPath();
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  return settings;
}
