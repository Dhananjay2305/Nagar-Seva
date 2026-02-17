const API_BASE = "http://localhost:4000/api";

// State
let state = {
  allIssues: [],
  userLocation: null,
  currentUser: null
};

let maps = {
  report: null,
  feed: null,
  marker: null,
  layerGroup: null
};

// DOM Elements
const views = {
  report: document.getElementById('view-report'),
  feed: document.getElementById('view-feed'),
  map: document.getElementById('view-map'),
  rewards: document.getElementById('view-rewards'),
  admin: document.getElementById('view-admin')
};

const toastContainer = document.getElementById('toast-container');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initReportForm();
  initFeedFilters();
  initRewards();
  initAdmin();
  
  // Load initial data
  loadAllIssues();
});

// --- Navigation ---
function initNavigation() {
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = btn.dataset.target;
      
      // Update buttons
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      const activeBtns = document.querySelectorAll(`[data-target="${target}"]`);
      activeBtns.forEach(b => b.classList.add('active'));
      
      // Update views
      document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${target}`).classList.add('active');
      
      // Map resize check
      if (target === 'map' || target === 'report') {
        setTimeout(() => {
          if (maps.report) maps.report.invalidateSize();
          if (maps.feed) maps.feed.invalidateSize();
        }, 200);
      }
      
      // View specific data loads
      if (target === 'feed') renderFeed();
      if (target === 'map') renderMapMarkers();
      if (target === 'admin') renderAdminTable();
    });
  });
}

// --- Toast System ---
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '⚠️'}</span>
    <span>${message}</span>
  `;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Data Fetching ---
async function loadAllIssues() {
  try {
    const res = await fetch(`${API_BASE}/issues`);
    const data = await res.json();
    state.allIssues = data.issues || [];
    renderFeed();
    renderMapMarkers();
    renderAdminTable();
  } catch (err) {
    console.error('Failed to load issues:', err);
    showToast('Failed to connect to server', 'error');
  }
}

// --- Report Form ---
function initReportForm() {
  const form = document.getElementById('issueForm');
  const photoInput = document.getElementById('photoInput');
  const preview = document.getElementById('photoPreview');
  const uploadArea = document.getElementById('uploadArea');
  const gpsBtn = document.getElementById('gpsBtn');
  
  // File Preview
  uploadArea.addEventListener('click', () => photoInput.click());
  
  photoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        preview.src = base64;
        preview.classList.remove('hidden');
        document.querySelector('.upload-icon').classList.add('hidden');
      } catch (err) {
        showToast('Error reading file', 'error');
      }
    }
  });
  
  // GPS
  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }
    
    gpsBtn.textContent = 'Locating...';
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        document.getElementById('lat').value = latitude.toFixed(6);
        document.getElementById('lng').value = longitude.toFixed(6);
        
        updateReportMap(latitude, longitude);
        gpsBtn.textContent = '📍 GPS Updated';
        setTimeout(() => gpsBtn.textContent = '📍 Use GPS', 2000);
      },
      (err) => {
        showToast('Unable to retrieve location', 'error');
        gpsBtn.textContent = '📍 Use GPS';
      }
    );
  });
  
  // Map Init
  if (!maps.report) {
    maps.report = L.map('report-map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19
    }).addTo(maps.report);
  }
  
  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const category = document.getElementById('category').value;
    const description = document.getElementById('description').value;
    
    if (!photoInput.files[0]) {
      showToast('Please upload a photo', 'error');
      return;
    }
    
    try {
      const imageData = await fileToBase64(photoInput.files[0]);
      
      const payload = {
        category,
        description,
        imageData,
        address: document.getElementById('address').value,
        city: document.getElementById('city').value,
        latitude: document.getElementById('lat').value,
        longitude: document.getElementById('lng').value,
        reporterName: document.getElementById('reporterName').value,
        reporterPhone: document.getElementById('reporterPhone').value
      };
      
      const res = await fetch(`${API_BASE}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) throw new Error('Submission failed');
      
      const data = await res.json();
      showToast(`Issue Reported! ID: ${data.issue.complaintId}`);
      
      // Reset form
      form.reset();
      preview.classList.add('hidden');
      document.querySelector('.upload-icon').classList.remove('hidden');
      
      // Auto switch to feed
      loadAllIssues();
      document.querySelector('[data-target="feed"]').click();
      
    } catch (err) {
      showToast(err.message || 'Error submitting issue', 'error');
    }
  });
}

function updateReportMap(lat, lng) {
  if (!maps.report) return;
  if (maps.marker) maps.marker.remove();
  
  maps.marker = L.marker([lat, lng]).addTo(maps.report);
  maps.report.setView([lat, lng], 15);
}

// --- Feed & Filters ---
function initFeedFilters() {
  ['filterCategory', 'filterStatus', 'filterCity'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderFeed);
    if(id === 'filterCity') {
      document.getElementById(id).addEventListener('input', renderFeed);
    }
  });
}

function renderFeed() {
  const container = document.getElementById('feedList');
  const cat = document.getElementById('filterCategory').value;
  const status = document.getElementById('filterStatus').value;
  const city = document.getElementById('filterCity').value.toLowerCase();
  
  let filtered = state.allIssues.filter(i => {
    if (cat && i.category !== cat) return false;
    if (status && i.status !== status) return false;
    if (city && i.location.city && !i.location.city.toLowerCase().includes(city)) return false;
    return true;
  });
  
  // Sort by latest
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center text-muted" style="padding: 40px;">No issues found matching filters.</div>`;
    return;
  }
  
  container.innerHTML = filtered.map(issue => `
    <div class="issue-card">
      <div class="issue-img-box">
        <img src="${issue.imageData}" loading="lazy" alt="${issue.category}">
      </div>
      <div class="issue-body">
        <div class="issue-meta">
          <span class="status-badge status-${issue.status}">${issue.status.replace('_', ' ')}</span>
          <small class="text-muted">${new Date(issue.createdAt).toLocaleDateString()}</small>
        </div>
        <div class="issue-title text-capitalize">${issue.category} Issue</div>
        <div class="issue-loc">📍 ${issue.location.city || 'Unknown Location'}</div>
        <div class="issue-desc">${issue.description}</div>
        <div class="issue-footer">
          <span>ID: ${issue.complaintId}</span>
          <button class="vote-btn" onclick="upvoteIssue('${issue.id}')">
            ▲ ${issue.upvotes || 0}
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

window.upvoteIssue = async (id) => {
  try {
    await fetch(`${API_BASE}/issues/${id}/upvote`, { method: 'POST' });
    loadAllIssues(); // Refresh to show new count
  } catch (err) {
    console.error(err);
  }
};

// --- Map View ---
function renderMapMarkers() {
  if (!maps.feed) {
    maps.feed = L.map('issues-map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19
    }).addTo(maps.feed);
    maps.layerGroup = L.layerGroup().addTo(maps.feed);
  }
  
  maps.layerGroup.clearLayers();
  
  state.allIssues.forEach(issue => {
    if (issue.location.latitude && issue.location.longitude) {
      const color = issue.status === 'resolved' ? '#10b981' : (issue.status === 'new' ? '#3b82f6' : '#f59e0b');
      
      const circle = L.circleMarker([issue.location.latitude, issue.location.longitude], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      }).bindPopup(`
        <b>${issue.category}</b><br>
        ${issue.description.substring(0,50)}...
      `);
      
      maps.layerGroup.addLayer(circle);
    }
  });
}

// --- Rewards ---
function initRewards() {
  document.getElementById('checkRewardsBtn').addEventListener('click', async () => {
    const phone = document.getElementById('rewardPhone').value;
    if (!phone) return showToast('Enter phone number', 'error');
    
    try {
      const res = await fetch(`${API_BASE}/user-summary?phone=${phone}`);
      if (!res.ok) throw new Error('User not found');
      
      const data = await res.json();
      document.getElementById('wallet-balance').textContent = `₹${data.totals.totalRewards || 0}`;
      
      const historyEl = document.getElementById('rewardHistory');
      historyEl.innerHTML = data.rewardsHistory.length 
        ? data.rewardsHistory.map(r => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
              <span>${r.complaintId} (${r.category})</span>
              <span class="text-success">+₹${r.amount}</span>
            </div>
          `).join('')
        : '<div class="text-muted text-center">No rewards yet.</div>';
        
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// --- Admin ---
function initAdmin() {
  // Simple tab switch via dataset in HTML if needed, but for now just load data
}

function renderAdminTable() {
  const tbody = document.getElementById('adminTableBody');
  tbody.innerHTML = state.allIssues.map(issue => `
    <tr>
      <td>${issue.complaintId}</td>
      <td>${issue.category}</td>
      <td>${issue.location.city || '-'}</td>
      <td>
        <select onchange="updateStatus('${issue.id}', this.value)" class="form-control" style="padding:4px; font-size:0.8rem; width:auto;">
          <option value="new" ${issue.status === 'new' ? 'selected' : ''}>New</option>
          <option value="in_progress" ${issue.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="resolved" ${issue.status === 'resolved' ? 'selected' : ''}>Resolved</option>
          <option value="rejected" ${issue.status === 'rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </td>
      <td>
        ${issue.reward.awarded 
          ? `<span class="text-success">₹${issue.reward.amount}</span>`
          : (issue.status === 'resolved' 
             ? `<button class="btn btn-primary" style="padding:2px 8px;font-size:0.7rem" onclick="rewardIssue('${issue.id}')">Approve</button>`
             : '-')
        }
      </td>
    </tr>
  `).join('');
}

window.updateStatus = async (id, status) => {
  try {
    await fetch(`${API_BASE}/issues/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    showToast('Status updated');
    loadAllIssues();
  } catch (err) {
    showToast('Failed to update status', 'error');
  }
};

window.rewardIssue = async (id) => {
  try {
    const amount = prompt("Enter reward amount (INR):", "50");
    if (!amount) return;
    
    await fetch(`${API_BASE}/issues/${id}/reward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount) })
    });
    showToast('Reward awarded!');
    loadAllIssues();
  } catch (err) {
    showToast('Failed to award reward', 'error');
  }
};

// Utilities
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
