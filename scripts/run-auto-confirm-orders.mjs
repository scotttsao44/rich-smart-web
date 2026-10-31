const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.AUTO_CONFIRM_JOB_SECRET;

if (!baseUrl || !secret) {
  console.error('缺少 APP_BASE_URL 或 AUTO_CONFIRM_JOB_SECRET');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/jobs/auto-confirm-orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
  body: JSON.stringify({ idempotencyKey: `cron:auto-confirm:${date}` }),
});
const data = await response.json();
if (!response.ok) {
  console.error(data);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));

