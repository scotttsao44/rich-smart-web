const UNAVAILABLE = '短信服务尚未配置，当前不能发送真实短信或使用电话登录。';

export function smsUnavailableResponse() {
  return Response.json({ error: UNAVAILABLE, code: 'SMS_NOT_CONFIGURED' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}

export function smsConfigurationResponse() {
  return Response.json({ configured: false, loginEnabled: false, message: UNAVAILABLE }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
