const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

// Real SQLite, isolated from the user's database and all external services.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kokoro-monitor-test-'));
process.env.MONITOR_DB_PATH = path.join(directory, 'monitor.sqlite');
const database = require('../src/config/database');
const Website = require('../src/models/Website');
const Incident = require('../src/models/Incident');
const CheckHistory = require('../src/models/CheckHistory');
const Notification = require('../src/services/NotificationService');
const Monitor = require('../src/services/MonitorService');
let sequence = 0;

test.before(async () => {
  // Reproduce an old schema and verify the additive upgrade is repeatable.
  const SQL = await require('sql.js')();
  const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE websites (
    id TEXT PRIMARY KEY, name TEXT, url TEXT, check_interval INTEGER DEFAULT 30000,
    timeout INTEGER DEFAULT 10000, expected_status INTEGER DEFAULT 200, enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, website_id TEXT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, duration_seconds INTEGER, error_message TEXT);
    INSERT INTO websites (id, name, url) VALUES ('legacy', 'Existing website', 'https://example.invalid/legacy');
    INSERT INTO incidents (website_id, error_message) VALUES ('legacy', 'Original incident');`);
  fs.writeFileSync(process.env.MONITOR_DB_PATH, Buffer.from(legacy.export()));
  legacy.close();
  await database.initializeDatabase();
});

test.after(() => {
  database.closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

function setup(t) {
  const site = Website.create({ name: 'test', url: `https://example.invalid/${++sequence}` });
  const events = [];
  const deliveries = [];
  const durations = [];
  const monitor = new Monitor({ emit: (_event, data) => events.push(data) });
  t.mock.method(Notification, 'sendDownAlert', async () => {
    deliveries.push('down'); return [{ channel: 'lark', status: 'sent' }];
  });
  t.mock.method(Notification, 'sendUpAlert', async (_site, _result, duration) => {
    deliveries.push('up'); durations.push(duration);
    return [{ channel: 'lark', status: 'sent' }];
  });
  let reply = 200;
  const get = t.mock.method(axios, 'get', async () => {
    if (typeof reply === 'string') throw Object.assign(new Error(reply), { code: reply });
    return { status: reply };
  });
  const check = async (...responses) => {
    for (const response of responses) { reply = response; await monitor.checkWebsite(site); }
  };
  t.after(async () => {
    await monitor.stopAll();
    for (const duration of durations) assert(duration >= 0 && duration < 10);
  });
  return { site, events, deliveries, monitor, check, get };
}

test('upgrades the legacy schema without erasing data and can reopen it', async () => {
  assert.equal(Website.findById('legacy').name, 'Existing website');
  assert.equal(Website.findById('legacy').confirmed_status, 'unknown');
  assert.equal(Incident.findActiveByWebsiteId('legacy').error_message, 'Original incident');
  assert.equal(Incident.findActiveByWebsiteId('legacy').down_notification, null);
  database.closeDatabase();
  await database.initializeDatabase();
  assert.equal(Website.findById('legacy').confirmed_status, 'unknown');
  assert.equal(Incident.findByWebsiteId('legacy').length, 1);
});

test('isolated HTTP errors and transport failures do not trigger an incident', async t => {
  const { site, events, deliveries, monitor, check } = setup(t);
  await check(200, 200, 503, 200, 503, 200, 'ECONNABORTED', 'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 200);
  assert.deepEqual(deliveries, []);
  assert.equal(Incident.findByWebsiteId(site.id).length, 0);
  assert.equal(Website.findById(site.id).confirmed_status, 'online');
  assert.equal(monitor.getStatus()[site.id], 'online');
  assert.equal(CheckHistory.findByWebsiteId(site.id).length, 11);
  assert.equal(events.length, 11);
  assert.equal(events[6].status, 'unknown');
  assert.equal(events[6].confirmed_status, 'online');
  assert.equal(events[6].transition, null);
});

test('N/A breaks consecutive failures and recovery; three down checks and two up checks notify once', async t => {
  const { site, events, deliveries, check } = setup(t);
  await check(503, 503, 'ECONNABORTED', 503, 503);
  assert.deepEqual(deliveries, []);
  assert.equal(Website.findById(site.id).confirmed_status, 'unknown');
  await check(503, 503, 'ENOTFOUND');
  assert.deepEqual(deliveries, ['down']);
  assert.equal(Incident.findByWebsiteId(site.id).length, 1);
  assert.equal(Website.findById(site.id).confirmed_status, 'offline');
  await check(200, 'ECONNRESET', 200);
  assert.deepEqual(deliveries, ['down']);
  await check(200, 200);
  assert.deepEqual(deliveries, ['down', 'up']);
  assert.equal(Incident.findActiveByWebsiteId(site.id), null);
  assert.equal(Website.findById(site.id).confirmed_status, 'online');
  assert.deepEqual(events.filter(e => e.transition).map(e => e.transition), ['down', 'up']);
  const incident = Incident.findByWebsiteId(site.id)[0];
  assert.equal(JSON.parse(incident.down_notification).deliveries[0].status, 'sent');
  assert.equal(JSON.parse(incident.up_notification).deliveries[0].status, 'sent');
});

test('confirmed incident and delivery state survive database reopen without duplicate alerts', async t => {
  const { site, deliveries, check } = setup(t);
  await check(503, 503, 503);
  database.closeDatabase();
  await database.initializeDatabase();
  const restarted = new Monitor({ emit() {} });
  t.after(() => restarted.stopAll());
  await restarted.checkWebsite(site); // mock still returns 503
  assert.deepEqual(deliveries, ['down']);
  assert.equal(Incident.findByWebsiteId(site.id).length, 1);
  assert.equal(restarted.getStatus()[site.id], 'offline');
  t.mock.method(axios, 'get', async () => ({ status: 200 }));
  await restarted.checkWebsite(site);
  assert.deepEqual(deliveries, ['down']);
  await restarted.checkWebsite(site);
  assert.deepEqual(deliveries, ['down', 'up']);
  assert.equal(Incident.findActiveByWebsiteId(site.id), null);
  const third = new Monitor({ emit() {} });
  assert.equal(third.getConfirmedStatus(site), 'online');
});

test('legacy active duplicates are closed once after confirmed recovery, not on initial 200', async t => {
  const { site, deliveries, check } = setup(t);
  Incident.create(site.id, 'Old timeout');
  Incident.create(site.id, 'Old duplicate');
  await check(200);
  assert.equal(Website.findById(site.id).confirmed_status, 'offline');
  assert.deepEqual(deliveries, []);
  await check(200, 200);
  assert.deepEqual(deliveries, ['up']);
  assert(Incident.findByWebsiteId(site.id).every(incident => incident.resolved_at));
});

test('concurrent requests share one network call and one failure vote', async t => {
  const { site, monitor, events, deliveries } = setup(t);
  let release;
  const get = t.mock.method(axios, 'get', () => new Promise(resolve => { release = resolve; }));
  const first = monitor.checkWebsite(site);
  const second = monitor.checkWebsite(site);
  const third = monitor.checkWebsite(site);
  assert.equal(first, second);
  assert.equal(second, third);
  await Promise.resolve();
  assert.equal(get.mock.callCount(), 1);
  release({ status: 503 });
  await Promise.all([first, second, third]);
  assert.equal(CheckHistory.findByWebsiteId(site.id).length, 1);
  assert.equal(events.length, 1);
  assert.equal(monitor.streaks.get(site.id).count, 1);
  assert.deepEqual(deliveries, []);
});

test('stopping a check cancels it and discards late results for deleted websites', async t => {
  const { site, monitor, events, deliveries } = setup(t);
  let release;
  let signal;
  t.mock.method(axios, 'get', (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { release = resolve; });
  });
  const pending = monitor.checkWebsite(site);
  await Promise.resolve();
  monitor.stopMonitoring(site.id);
  Website.delete(site.id);
  release({ status: 503 });
  assert.equal(await pending, null);
  assert.equal(signal.aborted, true);
  assert.equal(CheckHistory.findByWebsiteId(site.id).length, 0);
  assert.equal(events.length, 0);
  assert.deepEqual(deliveries, []);
});

test('transport rejection releases the per-website lock for subsequent checks', async t => {
  const { site, monitor, check } = setup(t);
  await check('ECONNABORTED');
  assert.equal(monitor.inFlight.size, 0);
  await check(200, 200);
  assert.equal(Website.findById(site.id).confirmed_status, 'online');
});

test('failed notification is recorded separately and does not reopen/resend an incident', async t => {
  const { site, check, monitor, events } = setup(t);
  const sender = t.mock.method(Notification, 'sendDownAlert', async () => [{ channel: 'lark', status: 'failed' }]);
  await check(503, 503, 503, 503);
  assert.equal(sender.mock.callCount(), 1);
  assert.equal(Website.findById(site.id).confirmed_status, 'offline');
  assert.equal(JSON.parse(Incident.findActiveByWebsiteId(site.id).down_notification).deliveries[0].status, 'failed');
  assert.equal(events.filter(e => e.transition === 'down').length, 1);
  assert.equal(monitor.inFlight.size, 0);
});

test('incident is durable before delivery and unexpected delivery errors still emit confirmed status', async t => {
  const { site, check, events } = setup(t);
  const SQL = await require('sql.js')();
  let persistedState;
  const sender = t.mock.method(Notification, 'sendDownAlert', async () => {
    const snapshot = new SQL.Database(fs.readFileSync(process.env.MONITOR_DB_PATH));
    try {
      persistedState = snapshot.exec(`SELECT w.confirmed_status, i.down_notification FROM websites w
        JOIN incidents i ON w.id = i.website_id WHERE w.id = '${site.id}'`)[0].values;
    } finally { snapshot.close(); }
    throw new Error('Simulated delivery failure');
  });
  await check(503, 503, 503, 503);
  assert.equal(persistedState[0][0], 'offline');
  assert.equal(JSON.parse(persistedState[0][1]).status, 'sending');
  assert.equal(sender.mock.callCount(), 1);
  assert.equal(JSON.parse(Incident.findActiveByWebsiteId(site.id).down_notification).status, 'failed');
  assert.equal(events.filter(e => e.transition === 'down').length, 1);
  assert.equal(events.at(-1).confirmed_status, 'offline');
});

test('same-second history yields only one website row and the most recent check', async t => {
  const { site, check } = setup(t);
  await check(200, 200, 'ECONNRESET');
  const rows = Website.getWithLatestStatus().filter(row => row.id === site.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].confirmed_status, 'online');
  assert.equal(rows[0].latest_status, 'unknown');
  assert.equal(rows[0].latest_status_code, null);
});
