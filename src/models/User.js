const { run, get, all, lastInsertRowId } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async create(data) {
    const hashedPassword = await bcrypt.hash(data.password, 12);
    
    run(`
      INSERT INTO users (username, password, role)
      VALUES (?, ?, ?)
    `, [data.username, hashedPassword, data.role || 'user']);
    
    const id = lastInsertRowId();
    return this.findById(id);
  }

  static findById(id) {
    return get('SELECT id, username, role, created_at FROM users WHERE id = ?', [id]);
  }

  static findByUsername(username) {
    return get('SELECT * FROM users WHERE username = ?', [username]);
  }

  static findAll() {
    return all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
  }

  static async validatePassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  static async updatePassword(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, id]);
    return this.findById(id);
  }

  static delete(id) {
    run('DELETE FROM users WHERE id = ?', [id]);
    return { changes: 1 };
  }

  static count() {
    const result = get('SELECT COUNT(*) as count FROM users');
    return result?.count || 0;
  }
}

module.exports = User;
