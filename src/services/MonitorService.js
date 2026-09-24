const axios = require('axios');
const Website = require('../models/Website');
const CheckHistory = require('../models/CheckHistory');
const Incident = require('../models/Incident');
const NotificationService = require('./NotificationService');

class MonitorService {
  constructor(io) {
    this.io = io;
    this.intervals = new Map();
    this.websiteStatus = new Map();
  }

  async checkWebsite(website) {
    const startTime = Date.now();
    let result = {
      website_id: website.id,
      status: 'online',
      status_code: null,
      response_time: null,
      error_message: null
    };

    try {
      const response = await axios.get(website.url, {
        timeout: website.timeout || 10000,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Website-Uptime-Monitor/1.0'
        }
      });

      result.response_time = Date.now() - startTime;
      result.status_code = response.status;

      // Check if status code matches expected
      if (response.status !== website.expected_status) {
        result.status = 'offline';
        result.error_message = `Unexpected status code: ${response.status} (expected: ${website.expected_status})`;
      }
    } catch (error) {
      result.response_time = Date.now() - startTime;
      result.status = 'offline';
      
      if (error.code === 'ECONNABORTED') {
        result.error_message = 'Request timeout';
      } else if (error.code === 'ENOTFOUND') {
        result.error_message = 'DNS lookup failed';
      } else if (error.code === 'ECONNREFUSED') {
        result.error_message = 'Connection refused';
      } else if (error.code === 'ECONNRESET') {
        result.error_message = 'Connection reset';
      } else {
        result.error_message = error.message;
      }
    }

    // Save to database
    CheckHistory.create(result);

    // A transport failure has no HTTP response. Keep the previous monitor state
    // so transient timeouts do not create false incidents or notifications.
    if (!MonitorService.hasHttpStatus(result)) {
      this.emitUpdate(website, result);
      return result;
    }

    // Handle status change
    await this.handleStatusChange(website, result);

    // Emit real-time update
    this.emitUpdate(website, result);

    return result;
  }

  static hasHttpStatus(result) {
    const statusCode = Number(result?.status_code);
    return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599;
  }

  async handleStatusChange(website, result) {
    if (!MonitorService.hasHttpStatus(result)) return;

    const previousStatus = this.websiteStatus.get(website.id);
    this.websiteStatus.set(website.id, result.status);

    // Status changed from online to offline
    if (previousStatus === 'online' && result.status === 'offline') {
      console.log(`🔴 ${website.name} went OFFLINE: ${result.error_message}`);
      
      // Create incident
      Incident.create(website.id, result.error_message);
      
      // Send notifications
      await NotificationService.sendDownAlert(website, result);
    }
    
    // Status changed from offline to online
    else if (previousStatus === 'offline' && result.status === 'online') {
      console.log(`🟢 ${website.name} is back ONLINE`);
      
      // Resolve incident
      const activeIncident = Incident.findActiveByWebsiteId(website.id);
      if (activeIncident) {
        Incident.resolve(activeIncident.id);
        
        // Calculate downtime duration
        const duration = Math.floor(
          (Date.now() - new Date(activeIncident.started_at).getTime()) / 1000
        );
        
        // Send recovery notification
        await NotificationService.sendUpAlert(website, result, duration);
      }
    }
    
    // First check
    else if (previousStatus === undefined) {
      console.log(`📊 ${website.name} initial status: ${result.status.toUpperCase()}`);
      
      if (result.status === 'offline') {
        Incident.create(website.id, result.error_message);
        await NotificationService.sendDownAlert(website, result);
      }
    }
  }

  emitUpdate(website, result) {
    const updateData = {
      id: website.id,
      name: website.name,
      url: website.url,
      status: result.status,
      status_code: result.status_code,
      response_time: result.response_time,
      error_message: result.error_message,
      checked_at: new Date().toISOString()
    };

    this.io.emit('status-update', updateData);
  }

  startMonitoring(website) {
    if (this.intervals.has(website.id)) {
      this.stopMonitoring(website.id);
    }

    // Initial check
    this.checkWebsite(website);

    // Set up interval
    const interval = setInterval(() => {
      this.checkWebsite(website);
    }, website.check_interval || 30000);

    this.intervals.set(website.id, interval);
    console.log(`⏱️  Started monitoring ${website.name} (every ${(website.check_interval || 30000) / 1000}s)`);
  }

  stopMonitoring(websiteId) {
    const interval = this.intervals.get(websiteId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(websiteId);
      this.websiteStatus.delete(websiteId);
      console.log(`⏹️  Stopped monitoring website ID: ${websiteId}`);
    }
  }

  startAll() {
    const websites = Website.findEnabled();
    console.log(`\n🚀 Starting monitor for ${websites.length} website(s)...\n`);
    
    websites.forEach(website => {
      this.startMonitoring(website);
    });
  }

  stopAll() {
    console.log('\n🛑 Stopping all monitors...\n');
    this.intervals.forEach((interval, websiteId) => {
      clearInterval(interval);
    });
    this.intervals.clear();
    this.websiteStatus.clear();
  }

  restartMonitoring(websiteId) {
    const website = Website.findById(websiteId);
    if (website && website.enabled) {
      this.startMonitoring(website);
    } else {
      this.stopMonitoring(websiteId);
    }
  }

  getStatus() {
    const status = {};
    this.websiteStatus.forEach((value, key) => {
      status[key] = value;
    });
    return status;
  }
}

module.exports = MonitorService;
