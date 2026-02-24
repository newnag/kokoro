const express = require('express');
const router = express.Router();
const Website = require('../models/Website');
const CheckHistory = require('../models/CheckHistory');
const Incident = require('../models/Incident');
const AlertSetting = require('../models/AlertSetting');
const { validate } = require('../middleware/validate');

module.exports = (monitorService) => {
  // ============ WEBSITES ============

  // Get all websites with latest status
  router.get('/websites', (req, res) => {
    try {
      const websites = Website.getWithLatestStatus();
      res.json({ success: true, data: websites });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get single website
  router.get('/websites/:id', (req, res) => {
    try {
      const website = Website.findById(req.params.id);
      if (!website) {
        return res.status(404).json({ success: false, error: 'Website not found' });
      }
      res.json({ success: true, data: website });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create website
  router.post('/websites', validate('createWebsite'), (req, res) => {
    try {
      const { name, url, check_interval, timeout, expected_status } = req.body;

      // Check if URL already exists
      const existing = Website.findByUrl(url);
      if (existing) {
        return res.status(400).json({ success: false, error: 'URL already exists' });
      }

      const website = Website.create({
        name,
        url,
        check_interval,
        timeout,
        expected_status
      });

      // Start monitoring
      monitorService.startMonitoring(website);

      res.status(201).json({ success: true, data: website });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update website
  router.put('/websites/:id', validate('updateWebsite'), (req, res) => {
    try {
      const website = Website.findById(req.params.id);
      if (!website) {
        return res.status(404).json({ success: false, error: 'Website not found' });
      }

      const updated = Website.update(req.params.id, req.body);
      
      // Restart monitoring with new settings
      monitorService.restartMonitoring(req.params.id);

      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete website
  router.delete('/websites/:id', (req, res) => {
    try {
      const website = Website.findById(req.params.id);
      if (!website) {
        return res.status(404).json({ success: false, error: 'Website not found' });
      }

      // Stop monitoring
      monitorService.stopMonitoring(req.params.id);

      Website.delete(req.params.id);
      res.json({ success: true, message: 'Website deleted' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Manual check
  router.post('/websites/:id/check', async (req, res) => {
    try {
      const website = Website.findById(req.params.id);
      if (!website) {
        return res.status(404).json({ success: false, error: 'Website not found' });
      }

      const result = await monitorService.checkWebsite(website);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ HISTORY ============

  // Get check history for website
  router.get('/websites/:id/history', (req, res) => {
    try {
      const { limit = 100, hours } = req.query;
      
      let history;
      if (hours) {
        history = CheckHistory.getRecentByWebsiteId(req.params.id, parseInt(hours));
      } else {
        history = CheckHistory.findByWebsiteId(req.params.id, parseInt(limit));
      }
      
      res.json({ success: true, data: history });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get uptime stats for website
  router.get('/websites/:id/stats', (req, res) => {
    try {
      const { days = 30 } = req.query;
      const stats = CheckHistory.getUptimeStats(req.params.id, parseInt(days));
      const hourlyStats = CheckHistory.getHourlyStats(req.params.id, 24);
      
      res.json({ 
        success: true, 
        data: { 
          overview: stats,
          hourly: hourlyStats
        } 
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ INCIDENTS ============

  // Get all incidents
  router.get('/incidents', (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const incidents = Incident.findAll(parseInt(limit));
      res.json({ success: true, data: incidents });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get incidents for website
  router.get('/websites/:id/incidents', (req, res) => {
    try {
      const { limit = 50 } = req.query;
      const incidents = Incident.findByWebsiteId(req.params.id, parseInt(limit));
      const stats = Incident.getStats(req.params.id, 30);
      res.json({ success: true, data: { incidents, stats } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ ALERTS ============

  // Get all alert settings
  router.get('/alerts', (req, res) => {
    try {
      const alerts = AlertSetting.findAll();
      res.json({ success: true, data: alerts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create alert setting
  router.post('/alerts', validate('createAlert'), (req, res) => {
    try {
      const { website_id, alert_type, config } = req.body;

      const alert = AlertSetting.create({
        website_id: website_id || null,
        alert_type,
        config
      });

      res.status(201).json({ success: true, data: alert });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update alert setting
  router.put('/alerts/:id', validate('updateAlert'), (req, res) => {
    try {
      const alert = AlertSetting.findById(parseInt(req.params.id));
      if (!alert) {
        return res.status(404).json({ success: false, error: 'Alert setting not found' });
      }

      const updated = AlertSetting.update(parseInt(req.params.id), req.body);
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete alert setting
  router.delete('/alerts/:id', (req, res) => {
    try {
      AlertSetting.delete(parseInt(req.params.id));
      res.json({ success: true, message: 'Alert setting deleted' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ SYSTEM ============

  // Get overall dashboard stats
  router.get('/dashboard', (req, res) => {
    try {
      const websites = Website.getWithLatestStatus();
      const recentIncidents = Incident.findAll(10);
      
      const stats = {
        total_websites: websites.length,
        online: websites.filter(w => w.latest_status === 'online').length,
        offline: websites.filter(w => w.latest_status === 'offline').length,
        unknown: websites.filter(w => !w.latest_status).length,
        recent_incidents: recentIncidents
      };

      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Cleanup old history
  router.post('/maintenance/cleanup', (req, res) => {
    try {
      const { days = 30 } = req.body;
      const result = CheckHistory.cleanup(parseInt(days));
      res.json({ 
        success: true, 
        message: `Cleanup completed` 
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Health check (public)
  router.get('/health', (req, res) => {
    res.json({ 
      success: true, 
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  return router;
};
