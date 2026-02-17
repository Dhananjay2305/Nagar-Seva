const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public')); // Serve frontend files

// In-memory storage for MVP
const issues = [];
const users = {};
let issueCounter = 1;

const ISSUE_STATUSES = ['new', 'in_progress', 'resolved', 'rejected'];

// Utility: basic user handling (no auth, just name+phone)
function getOrCreateUser({ name, phone }) {
  const key = phone || name.toLowerCase();
  if (!users[key]) {
    users[key] = {
      id: key,
      name,
      phone,
      points: 0,
      totalRewards: 0,
    };
  }
  return users[key];
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'NagarSeva backend running' });
});

// Create new issue
app.post('/api/issues', (req, res) => {
  const {
    title,
    description,
    category,
    latitude,
    longitude,
    address,
    city,
    imageData,
    reporterName,
    reporterPhone,
  } = req.body || {};

  if (!category || !description || !imageData) {
    return res.status(400).json({
      error: 'category, description and imageData are required',
    });
  }

  const reporter = getOrCreateUser({
    name: reporterName || 'Anonymous Citizen',
    phone: reporterPhone || '',
  });

  const now = new Date();
  const year = now.getFullYear();
  const sequence = String(issueCounter).padStart(4, '0');
  const complaintId = `FIX-${year}-${sequence}`;
  issueCounter += 1;

  const issue = {
    id: nanoid(),
    complaintId,
    title: title || `${category} issue`,
    description,
    category,
    location: {
      latitude: latitude || null,
      longitude: longitude || null,
      address: address || '',
      city: city || '',
    },
    imageData, // base64 string for MVP
    status: 'new',
    department: inferDepartment(category),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    upvotes: 0,
    reporterId: reporter.id,
    reward: {
      amount: 0,
      currency: 'INR',
      awarded: false,
    },
    timeline: [
      {
        at: new Date().toISOString(),
        status: 'new',
        note: 'Issue created by citizen',
      },
    ],
  };

  issues.push(issue);

  res.status(201).json({ issue });
});

// List all issues (simple filters)
app.get('/api/issues', (req, res) => {
  const { status, category, city } = req.query;

  let result = issues;
  if (status) {
    result = result.filter((i) => i.status === status);
  }
  if (category) {
    result = result.filter((i) => i.category === category);
  }
  if (city) {
    const cityLower = city.toLowerCase();
    result = result.filter(
      (i) => i.location && i.location.city && i.location.city.toLowerCase() === cityLower
    );
  }

  res.json({ issues: result });
});

// Get single issue
app.get('/api/issues/:id', (req, res) => {
  const issue = issues.find((i) => i.id === req.params.id);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }
  res.json({ issue });
});

// Find issue by complaintId (for tracking)
app.get('/api/issues/by-complaint/:complaintId', (req, res) => {
  const complaintId = req.params.complaintId;
  const issue = issues.find((i) => i.complaintId === complaintId);
  if (!issue) {
    return res.status(404).json({ error: 'Complaint ID not found' });
  }
  res.json({ issue });
});

// Upvote an issue (public engagement)
app.post('/api/issues/:id/upvote', (req, res) => {
  const issue = issues.find((i) => i.id === req.params.id);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }
  issue.upvotes = (issue.upvotes || 0) + 1;
  res.json({ issue });
});

// Update status (simulating government/department portal)
app.patch('/api/issues/:id/status', (req, res) => {
  const { status, note } = req.body || {};
  const issue = issues.find((i) => i.id === req.params.id);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  if (!ISSUE_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  issue.status = status;
  issue.updatedAt = new Date().toISOString();
  issue.timeline.push({
    at: new Date().toISOString(),
    status,
    note: note || '',
  });

  res.json({ issue });
});

// Award reward when resolved
app.post('/api/issues/:id/reward', (req, res) => {
  const { amount } = req.body || {};
  const issue = issues.find((i) => i.id === req.params.id);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }
  if (issue.status !== 'resolved') {
    return res
      .status(400)
      .json({ error: 'Issue must be resolved before rewarding' });
  }
  if (issue.reward.awarded) {
    return res.status(400).json({ error: 'Reward already awarded' });
  }

  const rewardAmount = typeof amount === 'number' ? amount : estimateReward(issue);
  issue.reward.amount = rewardAmount;
  issue.reward.awarded = true;

  const reporter = users[issue.reporterId];
  if (reporter) {
    reporter.points += rewardAmount;
    reporter.totalRewards += rewardAmount;
  }

  issue.timeline.push({
    at: new Date().toISOString(),
    status: 'rewarded',
    note: `Reward of ₹${rewardAmount} approved`,
  });

  res.json({ issue, reporter });
});

// Leaderboard
app.get('/api/leaderboard', (_req, res) => {
  const list = Object.values(users)
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);
  res.json({ leaderboard: list });
});

// Simple user summary for rewards page
app.get('/api/user-summary', (req, res) => {
  const { phone, name } = req.query;
  if (!phone && !name) {
    return res.status(400).json({ error: 'phone or name is required' });
  }

  const key = phone || String(name).toLowerCase();
  const user = users[key];
  if (!user) {
    return res.status(404).json({ error: 'Citizen not found yet' });
  }

  const reportedIssues = issues.filter((i) => i.reporterId === user.id);
  const rewardsHistory = reportedIssues
    .filter((i) => i.reward && i.reward.awarded)
    .map((i) => ({
      complaintId: i.complaintId,
      category: i.category,
      amount: i.reward.amount,
      createdAt: i.createdAt,
      status: i.status,
    }));

  res.json({
    user,
    totals: {
      totalRewards: user.totalRewards,
      points: user.points,
      issuesReported: reportedIssues.length,
      rewardsCount: rewardsHistory.length,
    },
    rewardsHistory,
  });
});

// Simple department inference from category
function inferDepartment(category) {
  const map = {
    roads: 'Public Works Department (PWD)',
    road: 'Public Works Department (PWD)',
    pothole: 'Public Works Department (PWD)',
    water: 'Water Supply & Sewerage Board',
    sanitation: 'Municipal Sanitation Department',
    garbage: 'Municipal Sanitation Department',
    electricity: 'Electricity Board',
    streetlight: 'Electricity Board',
    safety: 'Traffic Police / Municipal Engineering',
  };
  const key = String(category || '').toLowerCase();
  return map[key] || 'Municipal Corporation';
}

// Simple reward estimation logic for MVP
function estimateReward(issue) {
  const base = 20;
  const impactBoost =
    issue.category === 'safety' || issue.category === 'water' ? 40 : 0;
  const engagementBoost = Math.min(issue.upvotes || 0, 20);
  return Math.min(base + impactBoost + engagementBoost, 200);
}

app.listen(PORT, () => {
  console.log(`NagarSeva backend listening on http://localhost:${PORT}`);
});

