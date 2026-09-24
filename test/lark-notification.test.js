const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const NotificationService = require('../src/services/NotificationService');
const AlertSetting = require('../src/models/AlertSetting');
const Incident = require('../src/models/Incident');
const CheckHistory = require('../src/models/CheckHistory');
const MonitorService = require('../src/services/MonitorService');

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
    return { data: {} };
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

test('does not duplicate alerts while a website remains offline', async () => {
  const monitor = new MonitorService({ emit() {} });
  const originalDown = NotificationService.sendDownAlert;
  const originalUp = NotificationService.sendUpAlert;
  const originalCreate = Incident.create;
  const originalFindActive = Incident.findActiveByWebsiteId;
  const originalResolve = Incident.resolve;
  const calls = { down: 0, up: 0 };
  NotificationService.sendDownAlert = async () => { calls.down += 1; };
  NotificationService.sendUpAlert = async () => { calls.up += 1; };
  Incident.create = () => 1;
  Incident.findActiveByWebsiteId = () => ({ id: 1, started_at: new Date().toISOString() });
  Incident.resolve = () => {};

  try {
    await monitor.handleStatusChange(website, downResult);
    await monitor.handleStatusChange(website, downResult);
    assert.deepEqual(calls, { down: 1, up: 0 });
    await monitor.handleStatusChange(website, upResult);
    assert.deepEqual(calls, { down: 1, up: 1 });
  } finally {
    NotificationService.sendDownAlert = originalDown;
    NotificationService.sendUpAlert = originalUp;
    Incident.create = originalCreate;
    Incident.findActiveByWebsiteId = originalFindActive;
    Incident.resolve = originalResolve;
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

test('does not transition monitor state or create an incident for a timeout', async () => {
  const monitor = new MonitorService({ emit() {} });
  const originalGet = axios.get;
  const originalHistoryCreate = CheckHistory.create;
  const originalCreate = Incident.create;
  let incidentCalls = 0;
  axios.get = async () => {
    const error = new Error('timeout');
    error.code = 'ECONNABORTED';
    throw error;
  };
  CheckHistory.create = () => {};
  Incident.create = () => { incidentCalls += 1; };

  try {
    monitor.websiteStatus.set(website.id, 'online');
    const result = await monitor.checkWebsite({ ...website, expected_status: 200, timeout: 10000 });
    assert.equal(result.status, 'offline');
    assert.equal(result.status_code, null);
    assert.equal(monitor.websiteStatus.get(website.id), 'online');
    assert.equal(incidentCalls, 0);
  } finally {
    axios.get = originalGet;
    CheckHistory.create = originalHistoryCreate;
    Incident.create = originalCreate;
  }
});

test('does not resolve or create incidents when an existing incident sees a timeout', async () => {
  const monitor = new MonitorService({ emit() {} });
  const originalGet = axios.get;
  const originalHistoryCreate = CheckHistory.create;
  const originalCreate = Incident.create;
  const originalFindActive = Incident.findActiveByWebsiteId;
  const originalResolve = Incident.resolve;
  let createCalls = 0;
  let findActiveCalls = 0;
  let resolveCalls = 0;
  axios.get = async () => {
    const error = new Error('timeout');
    error.code = 'ECONNABORTED';
    throw error;
  };
  CheckHistory.create = () => {};
  Incident.create = () => { createCalls += 1; };
  Incident.findActiveByWebsiteId = () => { findActiveCalls += 1; return { id: 1 }; };
  Incident.resolve = () => { resolveCalls += 1; };

  try {
    monitor.websiteStatus.set(website.id, 'offline');
    await monitor.checkWebsite({ ...website, expected_status: 200, timeout: 10000 });
    assert.equal(monitor.websiteStatus.get(website.id), 'offline');
    assert.equal(createCalls, 0);
    assert.equal(findActiveCalls, 0);
    assert.equal(resolveCalls, 0);
  } finally {
    axios.get = originalGet;
    CheckHistory.create = originalHistoryCreate;
    Incident.create = originalCreate;
    Incident.findActiveByWebsiteId = originalFindActive;
    Incident.resolve = originalResolve;
  }
});
