const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('dashboard separates confirmed health from failed checks and only toasts confirmed transitions', () => {
  const elements = new Map();
  const handlers = new Map();
  const notifications = [];
  function element() {
    return { innerHTML: '', textContent: '', style: {}, classList: { remove() {} }, addEventListener() {} };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement() {
      return { textContent: '', get innerHTML() {
        return String(this.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      } };
    },
    addEventListener() {}
  };
  function Notification(...args) { notifications.push(args); }
  Notification.permission = 'granted';
  const context = vm.createContext({
    document, window: { addEventListener() {}, Notification }, Notification,
    io: () => ({ on: (event, handler) => handlers.set(event, handler) }),
    fetch: async () => ({ json: async () => ({ success: true, data: [] }) }),
    setTimeout() {}, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
  handlers.get('initial-status')([{ id: 'site', name: 'Example', url: 'https://example.invalid', confirmed_status: 'online' }]);
  const update = handlers.get('status-update');
  const latest = { id: 'site', name: 'Example', status: 'unknown', confirmed_status: 'online',
    status_code: null, checked_at: new Date().toISOString(), transition: null,
    error_message: 'Request timeout <unsafe>' };
  update(latest);
  assert.match(elements.get('websites-grid').innerHTML, /website-card online/);
  assert.match(elements.get('websites-grid').innerHTML, /ตรวจไม่สำเร็จ/);
  assert.match(elements.get('websites-grid').innerHTML, /&lt;unsafe&gt;/);
  assert.equal(elements.get('online-count').textContent, 1);
  assert.equal(elements.get('offline-count').textContent, 0);
  assert.equal(notifications.length, 0);
  assert.equal(elements.has('toast'), false);

  update({ ...latest, status: 'offline', status_code: 503, error_message: 'Unexpected status' });
  assert.equal(notifications.length, 0);
  assert.equal(elements.has('toast'), false);
  update({ ...latest, status: 'offline', status_code: 503, confirmed_status: 'offline', transition: 'down' });
  assert.equal(notifications.length, 1);
  assert.equal(elements.get('offline-count').textContent, 1);
  assert.match(elements.get('toast').textContent, /OFFLINE/);

  update({ ...latest, status: 'online', status_code: 200, confirmed_status: 'offline' });
  assert.equal(elements.get('offline-count').textContent, 1);
  assert.match(elements.get('toast').textContent, /OFFLINE/);
  update({ ...latest, status: 'online', status_code: 200, confirmed_status: 'online', transition: 'up' });
  assert.equal(elements.get('online-count').textContent, 1);
  assert.match(elements.get('toast').textContent, /back ONLINE/);
});
