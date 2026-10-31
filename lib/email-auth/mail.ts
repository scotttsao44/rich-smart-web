import nodemailer from 'nodemailer';

export function smtpConfigured() {
  return Boolean(
    process.env.EMAIL_SMTP_HOST
      && process.env.EMAIL_SMTP_PORT
      && process.env.EMAIL_SMTP_USER
      && process.env.EMAIL_SMTP_PASSWORD
      && process.env.EMAIL_FROM,
  );
}

export function emailDeliveryConfigured() {
  if (smtpConfigured()) return true;
  if (process.env.EMAIL_AUTH_ENABLED === 'true' && process.env.CN_TRANSITIONAL_TEST_MODE !== 'false') {
    return true;
  }
  return process.env.NODE_ENV !== 'production' && Boolean(process.env.EMAIL_DEV_CAPTURE_FILE);
}

function transport() {
  const port = Number(process.env.EMAIL_SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port,
    secure: process.env.EMAIL_SMTP_SECURE === 'true' || port === 465,
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASSWORD,
    },
  });
}

export async function sendRegistrationEmail(email: string, code: string) {
  const subject = '富智慧商城 Email 验证码';
  const text = [
    '您好：',
    '',
    `您的富智慧商城 6 位数字验证码为：${code}`,
    '此验证码有效期为 10 分钟。若非本人操作，请忽略此邮件。',
  ].join('\n');

  if (process.env.NODE_ENV !== 'production' && process.env.EMAIL_DEV_CAPTURE_FILE) {
    const fs = await import('fs');
    const path = await import('path');
    const target = path.resolve(process.env.EMAIL_DEV_CAPTURE_FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let rows: unknown[] = [];
    try {
      if (fs.existsSync(target)) rows = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      rows = [];
    }
    rows.unshift({ to: email, code, subject, createdAt: new Date().toISOString() });
    fs.writeFileSync(target, JSON.stringify(rows.slice(0, 50), null, 2), { encoding: 'utf8', mode: 0o600 });
    return;
  }

  if (smtpConfigured()) {
    try {
      await transport().sendMail({
        from: process.env.EMAIL_FROM,
        to: email,
        subject,
        text,
      });
      return;
    } catch (err) {
      if (process.env.CN_TRANSITIONAL_TEST_MODE !== 'false') {
        console.warn('SMTP send failed, using transitional inline code mode');
        return;
      }
      throw err;
    }
  }

  if (process.env.CN_TRANSITIONAL_TEST_MODE !== 'false') {
    return;
  }
  throw new Error('SMTP not configured');
}
