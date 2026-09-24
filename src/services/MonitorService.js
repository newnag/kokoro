const axios = require('axios');
const Website = require('../models/Website');
const CheckHistory = require('../models/CheckHistory');
const Incident = require('../models/Incident');
const NotificationService = require('./NotificationService');
const { forceSave } = require('../config/database');
const hasHttpStatus = require('../utils/httpStatus');
const runtime = require('../config/runtime');

class MonitorService {
  constructor(io) {
    this.io = io;
    this.intervals = new Map();
    this.websiteStatus = new Map();
    this.streaks = new Map();
    this.inFlight = new Map();
  }

  getConfirmedStatus(website) {
    if (!this.websiteStatus.has(website.id)) {
      const stored = Website.findById(website.id);
      const status = Incident.findActiveByWebsiteId(website.id)
        ? 'offline' : stored?.confirmed_status || 'unknown';
      this.websiteStatus.set(website.id, status);
      if (stored && stored.confirmed_status !== status) Website.setConfirmedStatus(website.id, status);
    }
    return this.websiteStatus.get(website.id);
  }

  checkWebsite(website) {
    // Scheduled checks, API calls and Check Now share the same request.
    const existing = this.inFlight.get(website.id);
    if (existing) return existing.promise;
    const job = { controller: new AbortController(), cancelled: false };
    job.promise = Promise.resolve().then(() => this.performCheck(website, job))
      .finally(() => this.inFlight.delete(website.id));
    this.inFlight.set(website.id, job);
    return job.promise;
  }

  async performCheck(website, job) {
    if (job.cancelled) return null;
    const startTime = Date.now();
    const result = {
      website_id: website.id, status: 'unknown', status_code: null,
      response_time: null, error_message: null
    };
    try {
      const response = await axios.get(website.url, {
        timeout: website.timeout || 10000,
        signal: job.controller.signal,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Website-Uptime-Monitor/1.0' }
      });
      result.status_code = response.status;
      if (hasHttpStatus(result)) {
        result.status = response.status === website.expected_status ? 'online' : 'offline';
        if (result.status === 'offline') {
          result.error_message = `Unexpected status code: ${response.status} (expected: ${website.expected_status})`;
        }
      } else {
        result.status_code = null;
        result.error_message = 'No valid HTTP status received';
      }
    } catch (error) {
      const reasons = {
        ECONNABORTED: 'Request timeout', ETIMEDOUT: 'Request timeout',
        ENOTFOUND: 'DNS lookup failed', ECONNREFUSED: 'Connection refused',
        ECONNRESET: 'Connection reset'
      };
      result.error_message = reasons[error.code] || error.message || 'Connection failed';
    }
    // A stopped/deleted/edited monitor must not apply a stale response.
    if (job.cancelled) return null;
    result.response_time = Date.now() - startTime;
    CheckHistory.create(result);
    const transition = await this.handleStatusChange(website, result);
    if (!job.cancelled) this.emitUpdate(website, result, transition);
    return result;
  }

  static hasHttpStatus(result) { return hasHttpStatus(result); }

  async handleStatusChange(website, result) {
    const previousStatus = this.getConfirmedStatus(website);
    if (!hasHttpStatus(result)) {
      this.streaks.delete(website.id);
      return null;
    }
    if (result.status === previousStatus) {
      this.streaks.delete(website.id);
      return null;
    }
    const previous = this.streaks.get(website.id);
    const streak = {
      status: result.status,
      count: previous?.status === result.status ? previous.count + 1 : 1
    };
    this.streaks.set(website.id, streak);
    // Confirm failures over three checks; recovery/initial health over two.
    if (streak.count < (result.status === 'offline' ? 3 : 2)) return null;

    const activeIncident = Incident.findActiveByWebsiteId(website.id);
    let incidentId;
    let type;
    let duration = null;
    if (result.status === 'offline') {
      if (!activeIncident) {
        incidentId = Incident.create(website.id, result.error_message);
        type = 'down';
      }
    } else if (activeIncident) {
      incidentId = activeIncident.id;
      // SQLite CURRENT_TIMESTAMP is UTC but has no timezone suffix.
      const startedAt = /(?:Z|[+-]\d\d:\d\d)$/.test(activeIncident.started_at)
        ? activeIncident.started_at : activeIncident.started_at.replace(' ', 'T') + 'Z';
      duration = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      Incident.resolveActiveByWebsiteId(website.id);
      type = 'up';
    }

    Website.setConfirmedStatus(website.id, result.status);
    if (type) Incident.recordNotification(incidentId, type, { status: 'sending' });
    // Persist before sending. A crash during delivery leaves 'sending' recorded;
    // no automatic resend on restart, since delivery may already have succeeded.
    forceSave();
    this.websiteStatus.set(website.id, result.status);
    this.streaks.delete(website.id);
    if (!type) return null;

    console.log(JSON.stringify({ event: 'monitor.transition', ...runtime,
      website_id: website.id, incident_id: incidentId, type, http_status: result.status_code }));
    try {
      const deliveries = type === 'down'
        ? await NotificationService.sendDownAlert(website, result)
        : await NotificationService.sendUpAlert(website, result, duration);
      Incident.recordNotification(incidentId, type, { status: 'completed', deliveries });
    } catch (error) {
      Incident.recordNotification(incidentId, type, { status: 'failed' });
      console.error(JSON.stringify({ event: 'monitor.notification_failed', ...runtime,
        website_id: website.id, incident_id: incidentId, type }));
    }
    forceSave();
    return type;
  }

  emitUpdate(website, result, transition = null) {
    this.io.emit('status-update', {
      id: website.id, name: website.name, url: website.url,
      status: result.status, confirmed_status: this.getConfirmedStatus(website),
      transition, status_code: result.status_code, response_time: result.response_time,
      error_message: result.error_message, checked_at: new Date().toISOString()
    });
  }

  startMonitoring(website) {
    this.stopMonitoring(website.id);
    this.getConfirmedStatus(website);
    const run = async () => {
      try {
        const existing = this.inFlight.get(website.id);
        if (existing?.cancelled) await existing.promise.catch(() => {});
        if (!this.intervals.has(website.id)) return;
        const current = Website.findById(website.id);
        if (current?.enabled) await this.checkWebsite(current);
      } catch (error) {
        console.error(`Monitor check failed for ${website.id}:`, error.message);
      }
    };
    const interval = setInterval(run, website.check_interval || 30000);
    this.intervals.set(website.id, interval);
    void run();
    console.log(`Started monitoring ${website.name} (every ${(website.check_interval || 30000) / 1000}s)`);
  }

  stopMonitoring(websiteId) {
    clearInterval(this.intervals.get(websiteId));
    this.intervals.delete(websiteId);
    this.streaks.delete(websiteId);
    this.websiteStatus.delete(websiteId);
    const job = this.inFlight.get(websiteId);
    if (job) {
      job.cancelled = true;
      job.controller.abort();
    }
  }

  startAll() {
    const websites = Website.findEnabled();
    console.log(JSON.stringify({ event: 'monitor.started', ...runtime,
      websites: websites.length, failure_threshold: 3, recovery_threshold: 2 }));
    websites.forEach(website => this.startMonitoring(website));
  }

  async stopAll() {
    for (const id of new Set([...this.intervals.keys(), ...this.inFlight.keys()])) {
      this.stopMonitoring(id);
    }
    await Promise.allSettled([...this.inFlight.values()].map(job => job.promise));
    this.websiteStatus.clear();
    this.streaks.clear();
  }

  restartMonitoring(websiteId) {
    const website = Website.findById(websiteId);
    if (website?.enabled) this.startMonitoring(website);
    else this.stopMonitoring(websiteId);
  }

  getStatus() { return Object.fromEntries(this.websiteStatus); }
}

module.exports = MonitorService;
