const { createHash, randomUUID } = require('crypto');
const { readFileSync } = require('fs');
const { hostname } = require('os');
const path = require('path');

const hash = createHash('sha256');
for (const file of ['../services/MonitorService.js', '../services/NotificationService.js', '../utils/httpStatus.js']) {
  hash.update(readFileSync(path.join(__dirname, file)));
}

module.exports = {
  version: require('../../package.json').version,
  revision: process.env.APP_REVISION || 'unspecified',
  monitor_build: hash.digest('hex').slice(0, 12),
  instance: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
};
