import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

// ==========================================
// 1. DATABASE & CLOUD STORAGE INITIALIZATION
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize PostgreSQL Database Schema
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'alert'
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      description TEXT NOT NULL,
      severity INTEGER NOT NULL DEFAULT 3 CHECK(severity >= 1 AND severity <= 5),
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      image_url TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      incident_id INTEGER NOT NULL REFERENCES incidents(id),
      body TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      incident_id INTEGER NOT NULL REFERENCES incidents(id),
      score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, incident_id)
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

const SEED_VERSION = 'global-seed-v5';

async function seedDatabase() {
  await initDatabase();

  const metaRes = await pool.query('SELECT value FROM meta WHERE key = $1', ['seed_version']);
  const current = metaRes.rows[0];
  if (current?.value === SEED_VERSION) {
    console.log('Database schema and seeds are up to date.');
    return;
  }

  console.log('Database not seeded or seed version outdated. Seeding now...');

  // Clear existing tables in correct dependency order
  await pool.query('TRUNCATE ratings, comments, incidents, categories, users, meta CASCADE');

  // Insert mock users
  const hash = bcrypt.hashSync('demo1234', 10);
  const userResult = await pool.query(
    'INSERT INTO users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id',
    ['demo@pointnoir.app', hash, 'demo']
  );
  const userId = userResult.rows[0].id;

  // Insert categories
  const categories = [
    { name: 'Pothole', icon: 'construction' },
    { name: 'Broken Streetlight', icon: 'lightbulb' },
    { name: 'Flooding', icon: 'droplets' },
    { name: 'Vandalism', icon: 'shield' },
    { name: 'Sidewalk Damage', icon: 'footprints' },
  ];

  const catMap = {};
  for (const c of categories) {
    const res = await pool.query('INSERT INTO categories (name, icon) VALUES ($1, $2) RETURNING id', [c.name, c.icon]);
    catMap[c.name] = res.rows[0].id;
  }

  // Insert incidents in demo zone (Ifrane coordinates)
  const incidents = [
    {
      catName: 'Pothole',
      desc: 'Large pothole on the main road — buses and cars swerve to avoid it.',
      sev: 4,
      lat: 33.5348,
      lng: -5.1105,
    },
    {
      catName: 'Broken Streetlight',
      desc: 'Walkway streetlight broken. Very dark and unsafe after sunset.',
      sev: 3,
      lat: 33.5352,
      lng: -5.1098,
    },
    {
      catName: 'Flooding',
      desc: 'Standing water pooling near the park entrance after rain — slippery and blocks the path.',
      sev: 5,
      lat: 33.5368,
      lng: -5.1072,
    },
    {
      catName: 'Sidewalk Damage',
      desc: 'Cracked sidewalk tiles along the main commercial pathway — tripping hazard.',
      sev: 4,
      lat: 33.5336,
      lng: -5.1085,
    },
    {
      catName: 'Vandalism',
      desc: 'Graffiti on the bus stop shelter along the main avenue.',
      sev: 2,
      lat: 33.5318,
      lng: -5.1128,
    },
    {
      catName: 'Pothole',
      desc: 'Growing pothole near the main entrance — worsening each week.',
      sev: 3,
      lat: 33.5325,
      lng: -5.1118,
    },
    {
      catName: 'Broken Streetlight',
      desc: 'Multiple lights out in the public parking lot. Hard to find your car at night.',
      sev: 3,
      lat: 33.5340,
      lng: -5.1125,
    },
  ];

  const incResultMap = {};
  for (let idx = 0; idx < incidents.length; idx++) {
    const i = incidents[idx];
    const catId = catMap[i.catName];
    const res = await pool.query(
      'INSERT INTO incidents (user_id, category_id, description, severity, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [userId, catId, i.desc, i.sev, i.lat, i.lng]
    );
    incResultMap[idx + 1] = res.rows[0].id;
  }

  // Insert mock comments and ratings
  await pool.query('INSERT INTO comments (user_id, incident_id, body) VALUES ($1, $2, $3)', [
    userId,
    incResultMap[1],
    'Almost tripped here yesterday. Be careful!',
  ]);
  await pool.query('INSERT INTO comments (user_id, incident_id, body) VALUES ($1, $2, $3)', [
    userId,
    incResultMap[3],
    'Still flooded three days after the rain — needs drainage work.',
  ]);

  await pool.query('INSERT INTO ratings (user_id, incident_id, score) VALUES ($1, $2, $3)', [userId, incResultMap[1], 4]);
  await pool.query('INSERT INTO ratings (user_id, incident_id, score) VALUES ($1, $2, $3)', [userId, incResultMap[3], 5]);
  await pool.query('INSERT INTO ratings (user_id, incident_id, score) VALUES ($1, $2, $3)', [userId, incResultMap[4], 4]);

  await pool.query('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [
    'seed_version',
    SEED_VERSION,
  ]);
  console.log('Database seeding successfully finished.');
}

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET || 'pointnoir_local_secret_key_12345';

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

async function getIncidentSummary(row) {
  const avgRes = await pool.query(
    'SELECT AVG(score) as avg, COUNT(*)::integer as count FROM ratings WHERE incident_id = $1',
    [row.id]
  );
  const avg = avgRes.rows[0];

  const commentCountRes = await pool.query(
    'SELECT COUNT(*)::integer as c FROM comments WHERE incident_id = $1',
    [row.id]
  );
  const commentCount = commentCountRes.rows[0].c;

  return {
    id: row.id,
    description: row.description,
    severity: row.severity,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    imageUrl: row.image_url,
    createdAt: row.created_at,
    category: { id: row.category_id, name: row.category_name, icon: row.category_icon },
    reporter: { id: row.user_id, username: row.username },
    averageRating: avg.avg ? Math.round(parseFloat(avg.avg) * 10) / 10 : null,
    ratingCount: avg.count,
    commentCount,
  };
}

// ==========================================
// 3. AUTHENTICATION MIDDLEWARE
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

// URL rewriting middleware to support both local prefix and Vercel prefix stripping
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api') && req.url !== '/favicon.ico') {
    req.url = '/api' + req.url;
  }
  next();
});

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'point-noir-api' });
});

// ==========================================
// 5. REST API ROUTES
// ==========================================

// --- Authentication ---
app.post('/api/auth/register', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Email, password, and username are required' });
  }

  try {
    const password_hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id',
      [email.trim().toLowerCase(), password_hash, username.trim()]
    );
    const newUserId = result.rows[0].id;

    const token = jwt.sign({ id: newUserId, username: username.trim() }, JWT_SECRET, {
      expiresIn: '7d',
    });
    res.status(201).json({ token, user: { id: newUserId, email, username } });
  } catch (err) {
    if (err.message?.includes('unique constraint') || err.message?.includes('duplicate key')) {
      return res.status(400).json({ error: 'Email is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = userRes.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, email, username FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get user session' });
  }
});

// --- Categories ---
app.get('/api/categories', async (_req, res) => {
  try {
    const list = await pool.query('SELECT * FROM categories');
    res.json(list.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// --- Incidents ---
app.get('/api/incidents/nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = parseFloat(req.query.radius) || 5;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query parameters are required' });
  }

  try {
    const rowsRes = await pool.query(`
      SELECT i.*, c.name as category_name, c.icon as category_icon, u.username
      FROM incidents i
      JOIN categories c ON c.id = i.category_id
      JOIN users u ON u.id = i.user_id
    `);

    const nearby = [];
    for (const row of rowsRes.rows) {
      const summary = await getIncidentSummary(row);
      const distance = haversineKm(lat, lng, row.latitude, row.longitude);
      if (distance <= radius) {
        nearby.push({
          ...summary,
          distanceKm: distance,
        });
      }
    }

    nearby.sort((a, b) => a.distanceKm - b.distanceKm);
    res.json(nearby);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch nearby incidents' });
  }
});

app.get('/api/incidents/:id', async (req, res) => {
  try {
    const rowRes = await pool.query(`
      SELECT i.*, c.name as category_name, c.icon as category_icon, u.username
      FROM incidents i
      JOIN categories c ON c.id = i.category_id
      JOIN users u ON u.id = i.user_id
      WHERE i.id = $1
    `, [req.params.id]);
    const row = rowRes.rows[0];

    if (!row) return res.status(404).json({ error: 'Incident not found' });

    const commentsRes = await pool.query(`
      SELECT cm.id, cm.body, cm.created_at, u.username, u.id as user_id
      FROM comments cm JOIN users u ON u.id = cm.user_id
      WHERE cm.incident_id = $1 ORDER BY cm.created_at DESC
    `, [req.params.id]);

    const summary = await getIncidentSummary(row);
    res.json({ ...summary, comments: commentsRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch incident details' });
  }
});

app.post('/api/incidents', requireAuth, async (req, res) => {
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

  try {
    const catRes = await pool.query('SELECT id FROM categories WHERE id = $1', [categoryId]);
    if (catRes.rows.length === 0) return res.status(400).json({ error: 'Invalid category' });

    const result = await pool.query(`
      INSERT INTO incidents (user_id, category_id, description, severity, latitude, longitude, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [req.user.id, categoryId, description, sev, latitude, longitude, imageUrl ?? null]);
    const newIncidentId = result.rows[0].id;

    const createdRes = await pool.query(`
      SELECT i.*, c.name as category_name, c.icon as category_icon, u.username
      FROM incidents i
      JOIN categories c ON c.id = i.category_id
      JOIN users u ON u.id = i.user_id
      WHERE i.id = $1
    `, [newIncidentId]);
    const created = createdRes.rows[0];

    res.status(201).json(await getIncidentSummary(created));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to report incident' });
  }
});

// --- Incident Feedback ---
app.post('/api/incidents/:id/ratings', requireAuth, async (req, res) => {
  const score = parseInt(req.body.score, 10);
  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ error: 'score must be between 1 and 5' });
  }

  try {
    const incidentRes = await pool.query('SELECT id FROM incidents WHERE id = $1', [req.params.id]);
    if (incidentRes.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

    try {
      await pool.query(
        'INSERT INTO ratings (user_id, incident_id, score) VALUES ($1, $2, $3)',
        [req.user.id, req.params.id, score]
      );
    } catch (err) {
      return res.status(409).json({ error: 'You have already rated this incident' });
    }

    const avgRes = await pool.query(
      'SELECT AVG(score) as avg, COUNT(*)::integer as count FROM ratings WHERE incident_id = $1',
      [req.params.id]
    );
    const avg = avgRes.rows[0];

    res.status(201).json({
      averageRating: avg.avg ? Math.round(parseFloat(avg.avg) * 10) / 10 : null,
      ratingCount: avg.count,
      yourRating: score,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to rate incident' });
  }
});

app.post('/api/incidents/:id/comments', requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Comment body is required' });

  try {
    const incidentRes = await pool.query('SELECT id FROM incidents WHERE id = $1', [req.params.id]);
    if (incidentRes.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

    const result = await pool.query(
      'INSERT INTO comments (user_id, incident_id, body) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, req.params.id, body.trim()]
    );
    const commentId = result.rows[0].id;

    res.status(201).json({
      id: commentId,
      body: body.trim(),
      username: req.user.username,
      userId: req.user.id,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// --- Media Upload (Supabase Storage integration) ---
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post('/api/media/upload', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

  try {
    const fileExt = path.extname(req.file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;

    // Upload directly to Supabase storage bucket
    const { data, error } = await supabase.storage
      .from('incident-images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(error.message);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('incident-images')
      .getPublicUrl(fileName);

    res.json({ url: publicUrl });
  } catch (err) {
    console.error('Supabase upload error:', err);
    res.status(500).json({ error: `Image upload failed: ${err.message}` });
  }
});

// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start and Seed Database
seedDatabase()
  .then(() => {
    if (process.env.NODE_ENV !== 'production') {
      app.listen(PORT, () => {
        console.log(`Point Noir API running on http://localhost:${PORT}`);
      });
    } else {
      console.log('Production database connected & schema checked.');
    }
  })
  .catch((err) => {
    console.error('Failed to initialize database on startup:', err);
  });

export default app;
