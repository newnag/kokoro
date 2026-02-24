const { run, get, all, lastInsertRowId } = require('../config/database');

class AlertSetting {
  static create(data) {
    run(`
      INSERT INTO alert_settings (website_id, alert_type, config, enabled)
      VALUES (?, ?, ?, ?)
    `, [
      data.website_id || null,
      data.alert_type,
      JSON.stringify(data.config),
      data.enabled !== false ? 1 : 0
    ]);
    
    return this.findById(lastInsertRowId());
  }

  static findById(id) {
    const row = get('SELECT * FROM alert_settings WHERE id = ?', [id]);
    if (row) {
      row.config = JSON.parse(row.config);
    }
    return row;
  }

  static findAll() {
    return all('SELECT * FROM alert_settings ORDER BY created_at DESC').map(row => ({
      ...row,
      config: JSON.parse(row.config)
    }));
  }

  static findByType(alertType) {
    return all('SELECT * FROM alert_settings WHERE alert_type = ? AND enabled = 1', [alertType])
      .map(row => ({
        ...row,
        config: JSON.parse(row.config)
      }));
  }

  static findByWebsiteId(websiteId) {
    return all(`
      SELECT * FROM alert_settings 
      WHERE (website_id = ? OR website_id IS NULL) AND enabled = 1
    `, [websiteId]).map(row => ({
      ...row,
      config: JSON.parse(row.config)
    }));
  }

  static findEnabled() {
    return all('SELECT * FROM alert_settings WHERE enabled = 1').map(row => ({
      ...row,
      config: JSON.parse(row.config)
    }));
  }

  static update(id, data) {
    const fields = [];
    const values = [];

    if (data.website_id !== undefined) {
      fields.push('website_id = ?');
      values.push(data.website_id);
    }
    if (data.alert_type !== undefined) {
      fields.push('alert_type = ?');
      values.push(data.alert_type);
    }
    if (data.config !== undefined) {
      fields.push('config = ?');
      values.push(JSON.stringify(data.config));
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(data.enabled ? 1 : 0);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    run(`UPDATE alert_settings SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.findById(id);
  }

  static delete(id) {
    run('DELETE FROM alert_settings WHERE id = ?', [id]);
    return { changes: 1 };
  }
}

module.exports = AlertSetting;
