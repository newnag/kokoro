const { run, get, all, lastInsertRowId } = require('../config/database');

class Incident {
  static create(websiteId, errorMessage = null) {
    run(`
      INSERT INTO incidents (website_id, error_message)
      VALUES (?, ?)
    `, [websiteId, errorMessage]);
    
    return lastInsertRowId();
  }

  static resolve(incidentId) {
    run(`
      UPDATE incidents 
      SET 
        resolved_at = CURRENT_TIMESTAMP,
        duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
      WHERE id = ?
    `, [incidentId]);
    return { changes: 1 };
  }

  static recordNotification(incidentId, type, result) {
    const column = type === 'down' ? 'down_notification' : 'up_notification';
    run(`UPDATE incidents SET ${column} = ? WHERE id = ?`, [JSON.stringify({
      ...result, attempted_at: new Date().toISOString()
    }), incidentId]);
  }

  static resolveActiveByWebsiteId(websiteId) {
    // Old releases could leave multiple active rows after restarts.
    run(`UPDATE incidents SET resolved_at = CURRENT_TIMESTAMP,
      duration_seconds = MAX(0, CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER))
      WHERE website_id = ? AND resolved_at IS NULL`, [websiteId]);
  }

  static findActiveByWebsiteId(websiteId) {
    return get(`
      SELECT * FROM incidents 
      WHERE website_id = ? AND resolved_at IS NULL
      ORDER BY started_at ASC, id ASC
      LIMIT 1
    `, [websiteId]);
  }

  static findByWebsiteId(websiteId, limit = 50) {
    return all(`
      SELECT * FROM incidents 
      WHERE website_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `, [websiteId, limit]);
  }

  static findAll(limit = 100) {
    return all(`
      SELECT i.*, w.name as website_name, w.url as website_url
      FROM incidents i
      LEFT JOIN websites w ON i.website_id = w.id
      ORDER BY i.started_at DESC
      LIMIT ?
    `, [limit]);
  }

  static getStats(websiteId, days = 30) {
    return get(`
      SELECT 
        COUNT(*) as total_incidents,
        COALESCE(SUM(duration_seconds), 0) as total_downtime_seconds,
        AVG(duration_seconds) as avg_incident_duration,
        MAX(duration_seconds) as longest_incident
      FROM incidents 
      WHERE website_id = ? 
        AND started_at >= datetime('now', '-' || ? || ' days')
        AND resolved_at IS NOT NULL
    `, [websiteId, days]);
  }
}

module.exports = Incident;
