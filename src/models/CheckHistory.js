const { run, get, all, lastInsertRowId } = require('../config/database');

class CheckHistory {
  static create(data) {
    run(`
      INSERT INTO check_history (website_id, status, status_code, response_time, error_message)
      VALUES (?, ?, ?, ?, ?)
    `, [
      data.website_id,
      data.status,
      data.status_code || null,
      data.response_time || null,
      data.error_message || null
    ]);
    
    return lastInsertRowId();
  }

  static findByWebsiteId(websiteId, limit = 100) {
    return all(`
      SELECT * FROM check_history 
      WHERE website_id = ? 
      ORDER BY checked_at DESC 
      LIMIT ?
    `, [websiteId, limit]);
  }

  static getRecentByWebsiteId(websiteId, hours = 24) {
    return all(`
      SELECT * FROM check_history 
      WHERE website_id = ? 
        AND checked_at >= datetime('now', '-' || ? || ' hours')
      ORDER BY checked_at DESC
    `, [websiteId, hours]);
  }

  static getUptimeStats(websiteId, days = 30) {
    const stats = get(`
      SELECT 
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_checks,
        AVG(CASE WHEN status = 'online' THEN response_time ELSE NULL END) as avg_response_time,
        MIN(CASE WHEN status = 'online' THEN response_time ELSE NULL END) as min_response_time,
        MAX(CASE WHEN status = 'online' THEN response_time ELSE NULL END) as max_response_time
      FROM check_history 
      WHERE website_id = ? 
        AND checked_at >= datetime('now', '-' || ? || ' days')
    `, [websiteId, days]);
    
    return {
      ...stats,
      uptime_percentage: stats.total_checks > 0 
        ? ((stats.online_checks / stats.total_checks) * 100).toFixed(2)
        : 0
    };
  }

  static getHourlyStats(websiteId, hours = 24) {
    return all(`
      SELECT 
        strftime('%Y-%m-%d %H:00', checked_at) as hour,
        COUNT(*) as checks,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
        AVG(response_time) as avg_response_time
      FROM check_history 
      WHERE website_id = ? 
        AND checked_at >= datetime('now', '-' || ? || ' hours')
      GROUP BY strftime('%Y-%m-%d %H:00', checked_at)
      ORDER BY hour DESC
    `, [websiteId, hours]);
  }

  static cleanup(daysToKeep = 30) {
    run(`
      DELETE FROM check_history 
      WHERE checked_at < datetime('now', '-' || ? || ' days')
    `, [daysToKeep]);
    return { changes: 1 };
  }

  static getLatestStatus(websiteId) {
    return get(`
      SELECT * FROM check_history 
      WHERE website_id = ? 
      ORDER BY checked_at DESC 
      LIMIT 1
    `, [websiteId]);
  }
}

module.exports = CheckHistory;
