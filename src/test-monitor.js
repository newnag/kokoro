/**
 * Test script to add sample websites and test the monitoring system
 */

const { initializeDatabase, getDb, save } = require('./config/database');
const Website = require('./models/Website');
const AlertSetting = require('./models/AlertSetting');

// Initialize database
initializeDatabase();

console.log('\n🧪 Setting up test data...\n');

// Sample websites to monitor
const sampleWebsites = [
  {
    name: 'Google',
    url: 'https://www.google.com',
    check_interval: 30000
  },
  {
    name: 'GitHub',
    url: 'https://github.com',
    check_interval: 60000
  },
  {
    name: 'Stack Overflow',
    url: 'https://stackoverflow.com',
    check_interval: 60000
  },
  {
    name: 'Example (Always Works)',
    url: 'https://example.com',
    check_interval: 30000
  },
  {
    name: 'Invalid Site (Test Offline)',
    url: 'https://this-site-does-not-exist-12345.com',
    check_interval: 30000
  }
];

// Clear existing data
console.log('Clearing existing test data...');
const db = getDb();
db.websites = [];
db.check_history = [];
db.incidents = [];
db.alert_settings = [];
save();

// Add sample websites
console.log('\nAdding sample websites:\n');
sampleWebsites.forEach(site => {
  try {
    const website = Website.create(site);
    console.log(`  ✅ Added: ${website.name} (${website.url})`);
  } catch (error) {
    console.log(`  ❌ Failed: ${site.name} - ${error.message}`);
  }
});

// Add sample alert (email)
console.log('\nAdding sample email alert...');
try {
  AlertSetting.create({
    website_id: null, // Global alert for all websites
    alert_type: 'email',
    config: {
      recipients: ['admin@example.com']
    }
  });
  console.log('  ✅ Email alert added (admin@example.com)');
} catch (error) {
  console.log(`  ❌ Failed to add email alert: ${error.message}`);
}

// Add sample webhook alert
console.log('\nAdding sample webhook alert...');
try {
  AlertSetting.create({
    website_id: null,
    alert_type: 'webhook',
    config: {
      webhook_url: 'https://example.com/webhook'
    }
  });
  console.log('  ✅ Webhook alert added');
} catch (error) {
  console.log(`  ❌ Failed to add webhook alert: ${error.message}`);
}

console.log('\n✅ Test data setup complete!\n');
console.log('Run `npm start` to start the monitoring server.\n');
console.log('Then open http://localhost:3000 in your browser.\n');
