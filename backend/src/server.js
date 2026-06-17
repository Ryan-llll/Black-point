import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==========================================
// 1. DATABASE CONFIGURATION & SEEDING
// ==========================================
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'pointnoir.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'alert'
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    severity INTEGER NOT NULL DEFAULT 3 CHECK(severity >= 1 AND severity <= 5),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    image_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    incident_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (incident_id) REFERENCES incidents(id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    incident_id INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, incident_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (incident_id) REFERENCES incidents(id)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const SEED_VERSION = 'global-seed-v3';

function seedDatabase() {
  const current = db.prepare('SELECT value FROM meta WHERE key = ?').get('seed_version');
  if (current?.value === SEED_VERSION) return;

  // Clear existing data
  db.exec('DELETE FROM ratings');
  db.exec('DELETE FROM comments');
  db.exec('DELETE FROM incidents');
  db.exec('DELETE FROM categories');
  db.exec('DELETE FROM users');
  try {
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users', 'categories', 'incidents', 'comments', 'ratings')");
  } catch (e) {
    // Ignore if sqlite_sequence doesn't exist yet
  }

  // Create demo user
  const hash = bcrypt.hashSync('demo1234', 10);
  const userResult = db.prepare(
    'INSERT INTO users (email, password_hash, username) VALUES (?, ?, ?)'
  ).run('demo@pointnoir.app', hash, 'demo');
  const userId = userResult.lastInsertRowid;

  // Insert categories
  const categories = [
    { name: 'Pothole', icon: 'construction' },
    { name: 'Broken Streetlight', icon: 'lightbulb' },
    { name: 'Flooding', icon: 'droplets' },
    { name: 'Vandalism', icon: 'shield' },
    { name: 'Sidewalk Damage', icon: 'footprints' },
  ];

  const insertCat = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)');
  for (const c of categories) {
    insertCat.run(c.name, c.icon);
  }

  // Insert mock incidents in the demo zone (Ifrane coordinates)
  const incidents = [
    {
      cat: 1,
      desc: 'Large pothole on the main road — buses and cars swerve to avoid it.',
      sev: 4,
      lat: 33.5348,
      lng: -5.1105,
    },
    {
      cat: 2,
      desc: 'Walkway streetlight broken. Very dark and unsafe after sunset.',
      sev: 3,
      lat: 33.5352,
      lng: -5.1098,
    },
    {
      cat: 3,
      desc: 'Standing water pooling near the park entrance after rain — slippery and blocks the path.',
      sev: 5,
      lat: 33.5368,
      lng: -5.1072,
    },
    {
      cat: 5,
      desc: 'Cracked sidewalk tiles along the main commercial pathway — tripping hazard.',
      sev: 4,
      lat: 33.5336,
      lng: -5.1085,
    },
    {
      cat: 4,
      desc: 'Graffiti on the bus stop shelter along the main avenue.',
      sev: 2,
      lat: 33.5318,
      lng: -5.1128,
    },
    {
      cat: 1,
      desc: 'Growing pothole near the main entrance — worsening each week.',
      sev: 3,
      lat: 33.5325,
      lng: -5.1118,
    },
    {
      cat: 2,
      desc: 'Multiple lights out in the public parking lot. Hard to find your car at night.',
      sev: 3,
      lat: 33.5340,
      lng: -5.1125,
    },
  ];

  const insertInc = db.prepare(
    'INSERT INTO incidents (user_id, category_id, description, severity, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const i of incidents) {
    insertInc.run(userId, i.cat, i.desc, i.sev, i.lat, i.lng);
  }

  // Insert comments and ratings using the dynamically loaded userId
  db.prepare('INSERT INTO comments (user_id, incident_id, body) VALUES (?, 1, ?)').run(
    userId,
    'Almost tripped here yesterday. Be careful!'
  );
  db.prepare('INSERT INTO comments (user_id, incident_id, body) VALUES (?, 3, ?)').run(
    userId,
    'Still flooded three days after the rain — needs drainage work.'
  );
  db.prepare('INSERT INTO ratings (user_id, incident_id, score) VALUES (?, 1, 4)').run(userId);
  db.prepare('INSERT INTO ratings (user_id, incident_id, score) VALUES (?, 3, 5)').run(userId);
  db.prepare('INSERT INTO ratings (user_id, incident_id, score) VALUES (?, 4, 4)').run(userId);

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('seed_version', SEED_VERSION);
}

seedDatabase();

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
const JWT_SECRET = 'pointnoir_local_secret_key_12345';

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getIncidentSummary(row) {
  const avg = db.prepare(
    'SELECT AVG(score) as avg, COUNT(*) as count FROM ratings WHERE incident_id = ?'
  ).get(row.id);
  const commentCount = db.prepare(
    'SELECT COUNT(*) as c FROM comments WHERE incident_id = ?'
  ).get(row.id).c;

  return {
    id: row.id,
    description: row.description,
    severity: row.severity,
    latitude: row.latitude,
    longitude: row.longitude,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    category: { id: row.category_id, name: row.category_name, icon: row.category_icon },
    reporter: { id: row.user_id, username: row.username },
    averageRating: avg.avg ? Math.round(avg.avg * 10) / 10 : null,
    ratingCount: avg.count,
    commentCount,
  };
}

// ==========================================
// 3. MIDDLEWARE
// ==========================================
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authorization token' });
  }
}

// ==========================================
// 4. EXPRESS SERVER SETUP
// ==========================================
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Ensure uploads folder exists and serve uploads statically
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'point-noir-api' });
});

// ==========================================
// 5. REST API ROUTES
// ==========================================

// --- Authentication ---
app.post('/api/auth/register', (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Email, password, and username are required' });
  }

  try {
    const password_hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (email, password_hash, username) VALUES (?, ?, ?)'
    ).run(email.trim().toLowerCase(), password_hash, username.trim());

    const token = jwt.sign({ id: result.lastInsertRowid, username: username.trim() }, JWT_SECRET, {
      expiresIn: '7d',
    });
    res.status(201).json({ token, user: { id: result.lastInsertRowid, email, username } });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Email is already registered' });
    }
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// --- Categories ---
app.get('/api/categories', (_req, res) => {
  const list = db.prepare('SELECT * FROM categories').all();
  res.json(list);
});

// --- Incidents ---
app.get('/api/incidents/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = parseFloat(req.query.radius) || 5;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query parameters are required' });
  }

  const rows = db.prepare(`
    SELECT i.*, c.name as category_name, c.icon as category_icon, u.username
    FROM incidents i
    JOIN categories c ON c.id = i.category_id
    JOIN users u ON u.id = i.user_id
  `).all();

  const nearby = rows
    .map((row) => ({
      ...getIncidentSummary(row),
      distanceKm: haversineKm(lat, lng, row.latitude, row.longitude),
    }))
    .filter((inc) => inc.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  res.json(nearby);
});

app.get('/api/incidents/:id', (req, res) => {
  const row = db.prepare(`
    SELECT i.*, c.name as category_name, c.icon as category_icon, u.username
    FROM incidents i
    JOIN categories c ON c.id = i.category_id
    JOIN users u ON u.id = i.user_id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Incident not found' });

  const comments = db.prepare(`
    SELECT cm.id, cm.body, cm.created_at, u.username, u.id as user_id
    FROM comments cm JOIN users u ON u.id = cm.user_id
    WHERE cm.incident_id = ? ORDER BY cm.created_at DESC
  `).all(req.params.id);

  res.json({ ...getIncidentSummary(row), comments });
});

app.post('/api/incidents', requireAuth, (req, res) => {
  const { categoryId, description, severity, latitude, longitude, imageUrl } = req.body;

  if (!categoryId || !description || !latitude || !longitude) {
    return res.status(400).json({
      error: 'categoryId, description, latitude, and longitude are required',
    });
  }

  const sev = severity ?? 3;
  if (sev < 1 || sev > 5) {
    return res.status(400).json({ error: 'severity must be between 1 and 5' });
  }

  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!cat) return res.status(400).json({ error: 'Invalid category' });

  const result = db.prepare(`
    INSERT INTO incidents (user_id, category_id, description, severity, latitude, longitude, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, categoryId, description, sev, latitude, longitude, imageUrl ?? null);

  const created = db.prepare(`
    SELECT i.*, c.name as category_name, c.icon as category_icon, u.username
    FROM incidents i
    JOIN categories c ON c.id = i.category_id
    JOIN users u ON u.id = i.user_id
    WHERE i.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(getIncidentSummary(created));
});

// --- Incident Feedback (Ratings & Comments) ---
app.post('/api/incidents/:id/ratings', requireAuth, (req, res) => {
  const score = parseInt(req.body.score, 10);
  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ error: 'score must be between 1 and 5' });
  }

  const incident = db.prepare('SELECT id FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  try {
    db.prepare(
      'INSERT INTO ratings (user_id, incident_id, score) VALUES (?, ?, ?)'
    ).run(req.user.id, req.params.id, score);
  } catch {
    return res.status(409).json({ error: 'You have already rated this incident' });
  }

  const avg = db.prepare(
    'SELECT AVG(score) as avg, COUNT(*) as count FROM ratings WHERE incident_id = ?'
  ).get(req.params.id);

  res.status(201).json({
    averageRating: Math.round(avg.avg * 10) / 10,
    ratingCount: avg.count,
    yourRating: score,
  });
});

app.post('/api/incidents/:id/comments', requireAuth, (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Comment body is required' });

  const incident = db.prepare('SELECT id FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const result = db.prepare(
    'INSERT INTO comments (user_id, incident_id, body) VALUES (?, ?, ?)'
  ).run(req.user.id, req.params.id, body.trim());

  res.status(201).json({
    id: result.lastInsertRowid,
    body: body.trim(),
    username: req.user.username,
    userId: req.user.id,
    createdAt: new Date().toISOString(),
  });
});

// --- Media Upload ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

app.post('/api/media/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Point Noir API running on http://localhost:${PORT}`);
});
