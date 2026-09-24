const { run, get, all, lastInsertRowId } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Website {
  static create(data) {
    const id = uuidv4();
    
    run(`
      INSERT INTO websites (id, name, url, check_interval, timeout, expected_status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      data.name,
      data.url,
      data.check_interval || 30000,
      data.timeout || 10000,
      data.expected_status || 200,
      data.enabled !== false ? 1 : 0
    ]);
    
    return this.findById(id);
  }

  static findById(id) {
    return get('SELECT * FROM websites WHERE id = ?', [id]);
  }

  static findByUrl(url) {
    return get('SELECT * FROM websites WHERE url = ?', [url]);
  }

  static findAll() {
    return all('SELECT * FROM websites ORDER BY created_at DESC');
  }

  static findEnabled() {
    return all('SELECT * FROM websites WHERE enabled = 1');
  }

  static setConfirmedStatus(id, status) {
    run('UPDATE websites SET confirmed_status = ? WHERE id = ?', [status, id]);
  }

  static update(id, data) {
    const fields = [];
    const values = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.url !== undefined) {
      fields.push('url = ?');
      values.push(data.url);
    }
    if (data.check_interval !== undefined) {
      fields.push('check_interval = ?');
      values.push(data.check_interval);
    }
    if (data.timeout !== undefined) {
      fields.push('timeout = ?');
      values.push(data.timeout);
    }
    if (data.expected_status !== undefined) {
      fields.push('expected_status = ?');
      values.push(data.expected_status);
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(data.enabled ? 1 : 0);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    run(`UPDATE websites SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  static delete(id) {
    // Delete related data first (cascade doesn't work with sql.js)
    run('DELETE FROM check_history WHERE website_id = ?', [id]);
    run('DELETE FROM incidents WHERE website_id = ?', [id]);
    run('DELETE FROM alert_settings WHERE website_id = ?', [id]);
    run('DELETE FROM websites WHERE id = ?', [id]);
    return { changes: 1 };
  }

  static getWithLatestStatus() {
    return all(`
      SELECT 
        w.*,
        h.status as latest_status,
        h.status_code as latest_status_code,
        h.response_time as latest_response_time,
        h.checked_at as last_checked_at,
        h.error_message as latest_error
      FROM websites w
      LEFT JOIN check_history h ON h.id = (
        SELECT id FROM check_history WHERE website_id = w.id
        ORDER BY checked_at DESC, id DESC LIMIT 1
      )
      ORDER BY w.created_at DESC
    `);
  }
}

module.exports = Website;
