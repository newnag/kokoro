const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Database file path
const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'monitor.sqlite');

let db = null;
let saveTimeout = null;

// Debounced save to prevent too frequent writes
function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveToFile();
  }, 1000); // Save at most once per second
}

// Save database to file
function saveToFile() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Initialize database
async function initializeDatabase() {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize SQL.js
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('✅ Loaded existing SQLite database');
    } else {
      db = new SQL.Database();
      console.log('✅ Created new SQLite database');
    }

    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS websites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        check_interval INTEGER DEFAULT 30000,
        timeout INTEGER DEFAULT 10000,
        expected_status INTEGER DEFAULT 200,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS check_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        website_id TEXT NOT NULL,
        status TEXT NOT NULL,
        status_code INTEGER,
        response_time INTEGER,
        error_message TEXT,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_check_history_website 
      ON check_history(website_id, checked_at DESC)
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        website_id TEXT NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        duration_seconds INTEGER,
        error_message TEXT,
        FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS alert_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        website_id TEXT,
        alert_type TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        name TEXT,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Save initial schema
    saveToFile();
    
    console.log('✅ Database schema initialized successfully');
    return db;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Get database instance
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

// Execute query and save
function run(sql, params = []) {
  const result = db.run(sql, params);
  debouncedSave();
  return result;
}

// Get single row
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Get all rows
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Get last insert ID
function lastInsertRowId() {
  const result = db.exec("SELECT last_insert_rowid() as id");
  return result[0]?.values[0]?.[0] || 0;
}

// Graceful shutdown
function closeDatabase() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveToFile();
  if (db) {
    db.close();
    db = null;
  }
  console.log('✅ Database closed');
}

// Force save (for critical operations)
function forceSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveToFile();
}

module.exports = {
  initializeDatabase,
  getDb,
  run,
  get,
  all,
  lastInsertRowId,
  closeDatabase,
  forceSave,
  debouncedSave
};
