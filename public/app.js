// API wrapper
async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers
  });

  return response.json();
}

// Initialize Socket.io
const socket = io();

// State
let websites = [];

// DOM Elements
const websitesGrid = document.getElementById('websites-grid');
const emptyState = document.getElementById('empty-state');
const onlineCount = document.getElementById('online-count');
const offlineCount = document.getElementById('offline-count');
const incidentsList = document.getElementById('incidents-list');
const addWebsiteForm = document.getElementById('add-website-form');
const modal = document.getElementById('website-modal');
const alertModal = document.getElementById('alert-modal');

// Update UI with user info
function updateUserUI() {
  // Auth disabled – user-info section is hidden
  const userInfo = document.getElementById('user-info');
  if (userInfo) userInfo.innerHTML = '';
}

// Socket Events
socket.on('connect', () => {
  console.log('Connected to server');
  showToast('Connected to monitor server', 'success');
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  showToast('Disconnected from server', 'error');
});

socket.on('initial-status', (data) => {
  websites = data;
  renderWebsites();
  updateStats();
  loadIncidents();
});

socket.on('status-update', (update) => {
  // Update local state
  const index = websites.findIndex(w => w.id === update.id);
  if (index !== -1) {
    websites[index] = {
      ...websites[index],
      latest_status: update.status,
      confirmed_status: update.confirmed_status,
      latest_status_code: update.status_code,
      latest_response_time: update.response_time,
      last_checked_at: update.checked_at,
      latest_error: update.error_message
    };
    renderWebsites();
    updateStats();
    
    // Only confirmed server transitions generate browser notifications.
    if (update.transition) {
      if (update.transition === 'down') {
        showToast(`🔴 ${update.name} is OFFLINE!`, 'error');
        // Request browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Website Down!', {
            body: `${update.name} is offline`,
            icon: '/favicon.ico'
          });
        }
      } else if (update.transition === 'up') {
        showToast(`🟢 ${update.name} is back ONLINE!`, 'success');
      }
    }
  }
  
  // Reload incidents
  loadIncidents();
});

// Form submission
addWebsiteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = document.getElementById('website-name').value.trim();
  const url = document.getElementById('website-url').value.trim();
  const interval = parseInt(document.getElementById('check-interval').value) * 1000;
  
  try {
    const result = await api('/websites', {
      method: 'POST',
      body: JSON.stringify({
        name,
        url,
        check_interval: interval
      })
    });
    
    if (result && result.success) {
      websites.push(result.data);
      renderWebsites();
      updateStats();
      addWebsiteForm.reset();
      document.getElementById('check-interval').value = '30';
      showToast('Website added successfully!', 'success');
    } else if (result) {
      showToast(result.error || 'Failed to add website', 'error');
    }
  } catch (error) {
    showToast('Failed to add website', 'error');
  }
});

// Render websites
function renderWebsites() {
  if (websites.length === 0) {
    websitesGrid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  websitesGrid.innerHTML = websites.map(website => {
    const status = website.confirmed_status || 'unknown';
    const statusClass = status;
    const statusIcon = status === 'online' ? 'fa-check-circle' :
                       status === 'offline' ? 'fa-times-circle' : 'fa-question-circle';

    return `
      <div class="website-card ${statusClass}" data-action="show-details" data-id="${website.id}">
        <div class="card-header">
          <div>
            <div class="card-title">${escapeHtml(website.name)}</div>
            <div class="card-url">${escapeHtml(website.url)}</div>
          </div>
          <span class="status-badge ${statusClass}">
            <i class="fas ${statusIcon}"></i>
            ${status.toUpperCase()}
          </span>
        </div>
        <div class="check-summary">
          <div>สถานะยืนยัน: ${status === 'unknown' ? 'รอยืนยัน' : status.toUpperCase()}</div>
          <div>ผลตรวจล่าสุด: ${!website.last_checked_at ? 'ยังไม่ได้ตรวจ'
            : !Number.isInteger(website.latest_status_code) ? 'ตรวจไม่สำเร็จ'
            : `${website.latest_status === 'online' ? 'ตอบกลับตามที่คาดไว้' : 'HTTP ไม่ตรงค่าที่ตั้งไว้'} (${website.latest_status_code})`}</div>
          ${website.latest_error ? `<div>${escapeHtml(website.latest_error)}</div>` : ''}
        </div>
        <div class="card-stats">
          <div class="card-stat">
            <span class="card-stat-label">Response Time</span>
            <span class="card-stat-value">${website.latest_response_time ? website.latest_response_time + 'ms' : '-'}</span>
          </div>
          <div class="card-stat">
            <span class="card-stat-label">Status Code</span>
            <span class="card-stat-value">${website.latest_status_code || '-'}</span>
          </div>
          <div class="card-stat">
            <span class="card-stat-label">Last Check</span>
            <span class="card-stat-value">${website.last_checked_at ? formatTime(website.last_checked_at) : '-'}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-primary" data-action="check-now" data-id="${website.id}">
            <i class="fas fa-sync-alt"></i> Check Now
          </button>
          <button class="btn btn-sm btn-danger" data-action="delete-website" data-id="${website.id}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Update stats
function updateStats() {
  const online = websites.filter(w => w.confirmed_status === 'online').length;
  const offline = websites.filter(w => w.confirmed_status === 'offline').length;
  
  onlineCount.textContent = online;
  offlineCount.textContent = offline;
}

// Load incidents
async function loadIncidents() {
  try {
    const result = await api('/incidents?limit=10');
    
    if (result && result.success && result.data.length > 0) {
      incidentsList.innerHTML = result.data.map(incident => {
        const isResolved = !!incident.resolved_at;
        const iconClass = isResolved ? 'up' : 'down';
        const icon = isResolved ? 'fa-arrow-up' : 'fa-arrow-down';
        
        return `
          <div class="incident-item">
            <div class="incident-icon ${iconClass}">
              <i class="fas ${icon}"></i>
            </div>
            <div class="incident-content">
              <div class="incident-title">${escapeHtml(incident.website_name || 'Unknown')}</div>
              <div class="incident-details">
                ${isResolved 
                  ? `Resolved after ${formatDuration(incident.duration_seconds)}` 
                  : `Down: ${incident.error_message || 'Unknown error'}`}
              </div>
            </div>
            <div class="incident-time">
              ${formatTime(incident.started_at)}
            </div>
          </div>
        `;
      }).join('');
    } else {
      incidentsList.innerHTML = `
        <div class="no-incidents">
          <i class="fas fa-check-circle"></i>
          <p>No recent incidents. All systems operational!</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Failed to load incidents:', error);
  }
}

// Show website details modal
async function showWebsiteDetails(id) {
  const website = websites.find(w => w.id === id);
  if (!website) return;
  
  document.getElementById('modal-title').textContent = website.name;
  
  try {
    const [stats, history] = await Promise.all([
      api(`/websites/${id}/stats`),
      api(`/websites/${id}/history?limit=50`)
    ]);
    
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats?.data?.overview?.uptime_percentage || 0}%</div>
          <div class="stat-label">ผลตรวจสำเร็จ (30 วัน รวม timeout ในยอดตรวจ)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Math.round(stats?.data?.overview?.avg_response_time) || 0}ms</div>
          <div class="stat-label">Avg Response</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats?.data?.overview?.total_checks || 0}</div>
          <div class="stat-label">Total Checks</div>
        </div>
      </div>
      
      <h3 style="margin-top: 20px; margin-bottom: 15px;">
        <i class="fas fa-history"></i> Recent Check History
      </h3>
      <div style="max-height: 300px; overflow-y: auto;">
        ${history?.data?.map(h => `
          <div class="incident-item">
            <div class="incident-icon ${!Number.isInteger(h.status_code) ? 'unknown' : h.status === 'online' ? 'up' : 'down'}">
              <i class="fas ${!Number.isInteger(h.status_code) ? 'fa-question' : h.status === 'online' ? 'fa-check' : 'fa-times'}"></i>
            </div>
            <div class="incident-content">
              <div class="incident-title">${Number.isInteger(h.status_code) ? h.status.toUpperCase() : 'ตรวจไม่สำเร็จ'}</div>
              <div class="incident-details">
                ${h.status === 'online' 
                  ? `${h.response_time}ms - Status ${h.status_code}` 
                  : escapeHtml(h.error_message || '')}
              </div>
            </div>
            <div class="incident-time">${formatTime(h.checked_at)}</div>
          </div>
        `).join('') || '<p>No history available</p>'}
      </div>
      
      <div style="margin-top: 20px; display: flex; gap: 10px;">
        <button class="btn btn-primary" data-action="open-alerts" data-id="${id}">
          <i class="fas fa-bell"></i> Alert Settings
        </button>
        <button class="btn btn-danger" data-action="delete-and-close" data-id="${id}">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    `;
    
    modal.classList.add('active');
  } catch (error) {
    console.error('Failed to load website details:', error);
    showToast('Failed to load details', 'error');
  }
}

function closeModal() {
  modal.classList.remove('active');
}

// Check website now
async function checkNow(id) {
  try {
    showToast('Checking website...', 'success');
    socket.emit('check-website', id);
  } catch (error) {
    showToast('Failed to check website', 'error');
  }
}

// Delete website
async function deleteWebsite(id) {
  if (!confirm('Are you sure you want to delete this website?')) return;
  
  try {
    const result = await api(`/websites/${id}`, {
      method: 'DELETE'
    });
    
    if (result && result.success) {
      websites = websites.filter(w => w.id !== id);
      renderWebsites();
      updateStats();
      showToast('Website deleted', 'success');
    } else if (result) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to delete website', 'error');
  }
}

// Alert settings
function openAlertSettings(websiteId) {
  closeModal();
  loadAlerts();
  alertModal.classList.add('active');
  alertModal.dataset.websiteId = websiteId || '';
}

function closeAlertModal() {
  alertModal.classList.remove('active');
}

// Alert type change
document.getElementById('alert-type').addEventListener('change', (e) => {
  const emailConfig = document.getElementById('email-config');
  const webhookConfig = document.getElementById('webhook-config');
  
  if (e.target.value === 'email') {
    emailConfig.style.display = 'block';
    webhookConfig.style.display = 'none';
  } else {
    emailConfig.style.display = 'none';
    webhookConfig.style.display = 'block';
  }
});

// Alert form submission
document.getElementById('alert-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const alertType = document.getElementById('alert-type').value;
  let config = {};
  
  if (alertType === 'email') {
    const recipients = document.getElementById('email-recipients').value
      .split(',')
      .map(e => e.trim())
      .filter(e => e);
    config = { recipients };
  } else {
    config = { webhook_url: document.getElementById('webhook-url').value };
  }
  
  try {
    const result = await api('/alerts', {
      method: 'POST',
      body: JSON.stringify({
        website_id: alertModal.dataset.websiteId || null,
        alert_type: alertType,
        config
      })
    });
    
    if (result && result.success) {
      showToast('Alert created successfully!', 'success');
      loadAlerts();
      e.target.reset();
    } else if (result) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to create alert', 'error');
  }
});

async function loadAlerts() {
  try {
    const result = await api('/alerts');
    
    const alertsList = document.getElementById('alerts-list');
    
    if (result && result.success && result.data.length > 0) {
      alertsList.innerHTML = result.data.map(alert => `
        <div class="alert-item">
          <div>
            <strong>${alert.alert_type.toUpperCase()}</strong>
            <br>
            <small>${JSON.stringify(alert.config)}</small>
          </div>
          <button class="btn btn-sm btn-danger" data-action="delete-alert" data-id="${alert.id}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `).join('');
    } else {
      alertsList.innerHTML = '<p>No alerts configured</p>';
    }
  } catch (error) {
    console.error('Failed to load alerts:', error);
  }
}

async function deleteAlert(id) {
  try {
    await api(`/alerts/${id}`, { method: 'DELETE' });
    loadAlerts();
    showToast('Alert deleted', 'success');
  } catch (error) {
    showToast('Failed to delete alert', 'error');
  }
}

// Utility functions
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

// Close modals on outside click
window.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
  if (e.target === alertModal) closeAlertModal();
});

// Event delegation – websites grid (card click, check now, delete)
websitesGrid.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'show-details') {
    showWebsiteDetails(id);
  } else if (action === 'check-now') {
    e.stopPropagation();
    checkNow(id);
  } else if (action === 'delete-website') {
    e.stopPropagation();
    deleteWebsite(id);
  }
});

// Event delegation – website detail modal body (alert settings, delete)
document.getElementById('modal-body').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'open-alerts') openAlertSettings(id);
  else if (action === 'delete-and-close') { deleteWebsite(id); closeModal(); }
});

// Event delegation – alerts list (delete alert)
document.getElementById('alerts-list').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'delete-alert') deleteAlert(el.dataset.id);
});

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  updateUserUI();
  loadIncidents();
  // Bind static close buttons (avoids inline onclick CSP violation)
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('alert-modal-close-btn').addEventListener('click', closeAlertModal);
});
