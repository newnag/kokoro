const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const NotificationService = require('../src/services/NotificationService');
const AlertSetting = require('../src/models/AlertSetting');

test.beforeEach(t => {
  for (const key of ['Lark_URL_API', 'LARK_URL_API', 'LARK_WEBHOOK_URL']) {
    const value = process.env[key];
    delete process.env[key];
    t.after(() => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
});

const website = { id: 1, name: 'เว็บทดสอบ', url: 'https://example.com' };
const downResult = {
  status: 'offline',
  status_code: 503,
  response_time: 1200,
  error_message: 'เซิร์ฟเวอร์ไม่พร้อมใช้งาน'
};
const upResult = {
  status: 'online',
  status_code: 200,
  response_time: 180
};
const timeoutResult = {
  status: 'offline',
  status_code: null,
  response_time: 10000,
  error_message: 'Request timeout'
};

test('sends a Lark down payload through the configured webhook', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalPost = axios.post;
  let request;
  process.env.Lark_URL_API = 'https://lark.example/webhook';
  axios.post = async (...args) => {
    request = args;
    return { data: { code: 0 } };
  };

  try {
    assert.equal(await NotificationService.sendLarkAlert(website, downResult, 'down'), true);
    assert.equal(request[0], process.env.Lark_URL_API);
    assert.equal(request[1].msg_type, 'text');
    assert.match(request[1].content.text, /เว็บทดสอบ/);
    assert.match(request[1].content.text, /HTTP Status: 503/);
    assert.match(request[1].content.text, /เซิร์ฟเวอร์ไม่พร้อมใช้งาน/);
    assert.equal(request[2].timeout, 10000);
  } finally {
    axios.post = originalPost;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
  }
});

test('sends down and recovery alerts when an HTTP status is available', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalPost = axios.post;
  const originalFind = AlertSetting.findByWebsiteId;
  const payloads = [];
  process.env.Lark_URL_API = 'https://lark.example/webhook';
  AlertSetting.findByWebsiteId = () => [];
  axios.post = async (url, payload) => {
    payloads.push(payload);
    return { data: { code: 0 } };
  };

  try {
    await NotificationService.sendDownAlert(website, downResult);
    await NotificationService.sendUpAlert(website, upResult, 10);
    assert.equal(payloads.length, 2);
    assert.match(payloads[0].content.text, /HTTP Status: 503/);
    assert.match(payloads[1].content.text, /HTTP Status: 200/);
  } finally {
    axios.post = originalPost;
    AlertSetting.findByWebsiteId = originalFind;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
  }
});

test('sends recovery details and skips the webhook when it is not configured', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalPost = axios.post;
  let calls = 0;
  process.env.Lark_URL_API = 'https://lark.example/webhook';
  axios.post = async (...args) => {
    calls += 1;
    assert.match(args[1].content.text, /กลับมาใช้งานได้/);
    assert.match(args[1].content.text, /ระยะเวลาที่ขัดข้อง: 2 minutes 5 seconds/);
    return { data: { code: 0 } };
  };

  try {
    assert.equal(await NotificationService.sendLarkAlert(website, upResult, 'up', 125), true);
    delete process.env.Lark_URL_API;
    assert.equal(await NotificationService.sendLarkAlert(website, upResult, 'up', 125), false);
    assert.equal(calls, 1);
  } finally {
    axios.post = originalPost;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
  }
});

test('accepts the uppercase Dokploy environment variable alias', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalUppercaseUrl = process.env.LARK_URL_API;
  const originalPost = axios.post;
  let called = false;
  delete process.env.Lark_URL_API;
  process.env.LARK_URL_API = 'https://lark.example/webhook';
  axios.post = async () => {
    called = true;
    return { data: { code: 0 } };
  };

  try {
    assert.equal(await NotificationService.sendLarkAlert(website, downResult, 'down'), true);
    assert.equal(called, true);
  } finally {
    axios.post = originalPost;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
    if (originalUppercaseUrl === undefined) delete process.env.LARK_URL_API;
    else process.env.LARK_URL_API = originalUppercaseUrl;
  }
});

test('handles Lark API errors and timeouts without throwing', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalPost = axios.post;
  process.env.Lark_URL_API = 'https://lark.example/webhook';

  try {
    axios.post = async () => ({ data: { code: 123 } });
    assert.equal(await NotificationService.sendLarkAlert(website, downResult, 'down'), false);

    axios.post = async () => {
      const error = new Error('timeout');
      error.code = 'ECONNABORTED';
      throw error;
    };
    assert.equal(await NotificationService.sendLarkAlert(website, downResult, 'down'), false);
  } finally {
    axios.post = originalPost;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
  }
});

test('continues existing alerts when the Lark request fails', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalPost = axios.post;
  const originalFind = AlertSetting.findByWebsiteId;
  const originalWebhook = NotificationService.sendWebhook;
  let existingAlertSent = false;
  process.env.Lark_URL_API = 'https://lark.example/webhook';
  axios.post = async () => { throw new Error('network failure'); };
  AlertSetting.findByWebsiteId = () => [{ alert_type: 'webhook', config: { webhook_url: 'https://example.com' } }];
  NotificationService.sendWebhook = async () => { existingAlertSent = true; };

  try {
    await assert.doesNotReject(() => NotificationService.sendDownAlert(website, downResult));
    assert.equal(existingAlertSent, true);
  } finally {
    axios.post = originalPost;
    AlertSetting.findByWebsiteId = originalFind;
    NotificationService.sendWebhook = originalWebhook;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
  }
});

test('skips every notification channel when there is no HTTP status', async () => {
  const originalUrl = process.env.Lark_URL_API;
  const originalPost = axios.post;
  const originalFind = AlertSetting.findByWebsiteId;
  let larkCalls = 0;
  process.env.Lark_URL_API = 'https://lark.example/webhook';
  axios.post = async () => { larkCalls += 1; return { data: { code: 0 } }; };
  AlertSetting.findByWebsiteId = () => [
    { alert_type: 'email', config: { recipients: ['test@example.com'] } },
    { alert_type: 'discord', config: {} },
    { alert_type: 'slack', config: {} },
    { alert_type: 'webhook', config: { webhook_url: 'https://example.com' } }
  ];

  try {
    assert.equal(await NotificationService.sendDownAlert(website, timeoutResult), false);
    assert.equal(await NotificationService.sendUpAlert(website, timeoutResult, 10), false);
    assert.equal(larkCalls, 0);
  } finally {
    axios.post = originalPost;
    AlertSetting.findByWebsiteId = originalFind;
    if (originalUrl === undefined) delete process.env.Lark_URL_API;
    else process.env.Lark_URL_API = originalUrl;
  }
});

test('all direct senders reject absent, coerced and invalid HTTP status values before I/O', async t => {
  let calls = 0;
  t.mock.method(axios, 'post', async () => { calls++; return { data: { code: 0 } }; });
  t.mock.method(require('nodemailer'), 'createTransport', () => { calls++; throw new Error('Unexpected SMTP'); });
  t.mock.method(AlertSetting, 'findByWebsiteId', () => { calls++; return []; });
  process.env.Lark_URL_API = 'https://example.invalid/mock';
  const senders = ['sendLarkAlert', 'sendEmail', 'sendDiscord', 'sendSlack', 'sendWebhook'];
  for (const status_code of [null, undefined, 'N/A', '', '503', [503], {}, true, 0, 99, 600, 200.5, NaN, Infinity]) {
    const result = { ...downResult, status_code };
    assert.equal(await NotificationService.sendDownAlert(website, result), false);
    assert.equal(await NotificationService.sendUpAlert(website, result, 10), false);
    for (const sender of senders) {
      assert.equal(await NotificationService[sender](website, result, 'down', {}), false, sender);
    }
  }
  assert.equal(calls, 0);
  for (const status_code of [100, 200, 403, 500, 503, 599]) {
    assert.equal(NotificationService.hasHttpStatus({ status_code }), true);
  }
});

test('does not claim Lark success for an invalid response body', async t => {
  process.env.Lark_URL_API = 'https://example.invalid/mock';
  t.mock.method(axios, 'post', async () => ({ data: '<html>gateway</html>' }));
  assert.equal(await NotificationService.sendLarkAlert(website, downResult, 'down'), false);
});

test('HTTP errors produce safe diagnostic fields without exposing webhook secrets', async t => {
  const secret = 'https://example.invalid/private-webhook-token';
  process.env.Lark_URL_API = secret;
  const logs = [];
  t.mock.method(console, 'error', message => logs.push(message));
  t.mock.method(axios, 'post', async () => {
    throw Object.assign(new Error(`Failed POST ${secret}`), {
      response: { status: 429 }, config: { url: secret }
    });
  });
  assert.equal(await NotificationService.sendLarkAlert(website, downResult, 'down'), false);
  assert.equal(JSON.parse(logs[0]).http_status, 429);
  assert.equal(logs.join('').includes(secret), false);
});

test('recognizes the legacy Lark success code and reports per-channel delivery results', async t => {
  process.env.Lark_URL_API = 'https://example.invalid/mock';
  t.mock.method(axios, 'post', async () => ({ data: { StatusCode: 0 } }));
  t.mock.method(AlertSetting, 'findByWebsiteId', () => [
    { id: 1, alert_type: 'email', config: {} },
    { id: 2, alert_type: 'webhook', config: {} }
  ]);
  t.mock.method(NotificationService, 'sendEmail', async () => { throw new Error('SMTP failed'); });
  t.mock.method(NotificationService, 'sendWebhook', async () => {});
  assert.deepEqual(await NotificationService.sendDownAlert(website, downResult), [
    { channel: 'lark', status: 'sent' },
    { channel: 'email', alert_id: 1, status: 'failed' },
    { channel: 'webhook', alert_id: 2, status: 'sent' }
  ]);
});
