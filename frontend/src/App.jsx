import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { X, Calendar, MessageSquare, Plus, Star, Moon, Sun, LogOut } from 'lucide-react';

// ==========================================
// 1. CONSTANTS & API CLIENT
// ==========================================
const DEFAULT_CENTER = { lat: 33.5348, lng: -5.1105 }; // Seeding coords centered in Ifrane demo zone

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pn_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ==========================================
// 2. CONTEXTS (AUTH & THEME)
// ==========================================
const AuthContext = createContext(null);
const ThemeContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    localStorage.removeItem('pn_token');
    setUser(null);
  };

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('pn_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async (email, password, username) => {
    const { data } = await api.post('/auth/register', { email, password, username });
    localStorage.setItem('pn_token', data.token);
    setUser(data.user);
    return data.user;
  };

  useEffect(() => {
    const token = localStorage.getItem('pn_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('pn_theme') || 'dark');

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pn_theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useTheme() {
  return useContext(ThemeContext);
}

// ==========================================
// 3. ROUTING & GUARDS
// ==========================================
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading application…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// ==========================================
// 4. MAP LEAFLET HELPERS
// ==========================================
function RecenterMap({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

function createMarkerIcon(severity) {
  return L.divIcon({
    className: '',
    html: `<div class="incident-marker sev-${severity}"><div class="incident-marker-inner"></div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
  });
}

const userIcon = L.divIcon({
  className: '',
  html: '<div class="user-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// ==========================================
// 5. SMALL REUSABLE COMPONENTS
// ==========================================
function SeverityBadge({ severity }) {
  const labels = {
    1: 'Minor',
    2: 'Low',
    3: 'Moderate',
    4: 'High',
    5: 'Critical',
  };
  return (
    <span className={`severity-badge sev-${severity}`}>
      {labels[severity] || 'Unknown'} - {severity}/5
    </span>
  );
}

function StarRating({ value, onChange, readonly }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`star-btn ${star <= value ? 'active' : ''}`}
          disabled={readonly}
          onClick={() => onChange && onChange(star)}
          aria-label={`Rate ${star} star`}
        >
          <Star size={18} fill={star <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

// ==========================================
// 6. POPUP MODAL PANELS
// ==========================================

// --- Incident Detail Slide Panel ---
function DetailPanel({ incident, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');
  const [myRating, setMyRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/incidents/${incident.id}`)
      .then(({ data }) => setDetail(data))
      .catch(() => setError('Failed to load incident details'))
      .finally(() => setLoading(false));
  }, [incident.id]);

  const submitRating = async (score) => {
    setMyRating(score);
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/incidents/${incident.id}/ratings`, { score });
      const { data } = await api.get(`/incidents/${incident.id}`);
      setDetail(data);
      onUpdated();
    } catch (e) {
      const msg = e.response?.data?.error;
      setError(msg || 'Could not submit rating');
      setMyRating(0);
    } finally {
      setSubmitting(false);
    }
  };

  const submitComment = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/incidents/${incident.id}/comments`, { body: comment });
      setComment('');
      const { data } = await api.get(`/incidents/${incident.id}`);
      setDetail(data);
      onUpdated();
    } catch {
      setError('Could not post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const d = detail || incident;
  const dateStr = new Date(d.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel detail-panel animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div>
            <span className="panel-category">{d.category?.name}</span>
            <h2>Incident Report</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {loading && <p className="panel-muted">Loading incident details…</p>}

        {!loading && (
          <div className="panel-scroll panel-body">
            {d.imageUrl && (
              <img src={d.imageUrl} alt="Reported problem" className="detail-image" />
            )}

            <div className="detail-meta-row">
              <SeverityBadge severity={d.severity} />
              <span className="detail-reporter">by {d.reporter?.username}</span>
            </div>

            <p className="detail-description">{d.description}</p>

            <div className="detail-info-grid">
              <div className="info-chip">
                <Calendar size={14} />
                {dateStr}
              </div>
              <div className="info-chip">
                <MessageSquare size={14} />
                {d.commentCount} comments
              </div>
            </div>

            <div className="rating-section">
              <h3>Community feedback</h3>
              <div className="rating-row">
                <StarRating
                  value={myRating || Math.round(d.averageRating || 0)}
                  onChange={submitRating}
                  readonly={submitting}
                />
                <span className="rating-text">
                  {d.averageRating
                    ? `${d.averageRating} / 5 (${d.ratingCount} reviews)`
                    : 'No ratings yet'}
                </span>
              </div>
            </div>

            <div className="comments-section">
              <h3>Discussion</h3>
              {detail?.comments?.length ? (
                <ul className="comment-list">
                  {detail.comments.map((c) => (
                    <li key={c.id} className="comment-item">
                      <strong>{c.username}</strong>
                      <p>{c.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel-muted">No comments yet. Start the conversation.</p>
              )}

              <div className="comment-form">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment…"
                  rows={2}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={submitting || !comment.trim()}
                  onClick={submitComment}
                >
                  Post
                </button>
              </div>
            </div>

            {error && <p className="form-error">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Incident Report Slide Panel ---
function ReportPanel({ lat, lng, onClose, onSubmitted }) {
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState(null);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState(3);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/categories').then(({ data }) => {
      setCategories(data);
      if (data.length) {
        setCategoryId(data[0].id);
      }
    });
  }, []);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const submitReport = async () => {
    if (!categoryId || !description.trim()) {
      setError('Please select a category and add a description.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let imageUrl = null;
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        const { data } = await api.post('/media/upload', formData);
        imageUrl = data.url;
      }

      await api.post('/incidents', {
        categoryId,
        description: description.trim(),
        severity,
        latitude: lat,
        longitude: lng,
        imageUrl,
      });

      onSubmitted();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.error;
      setError(msg || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel report-panel animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div>
            <span className="panel-category">New report</span>
            <h2>Report a problem</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="panel-scroll panel-body">
          <p className="location-hint">
            Pin placed at your current location ({lat.toFixed(4)}, {lng.toFixed(4)})
          </p>

          <label className="field-label">Category</label>
          <div className="category-chips">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${categoryId === c.id ? 'active' : ''}`}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="severity">
            Severity Level: {severity}/5
          </label>
          <input
            id="severity"
            type="range"
            min={1}
            max={5}
            value={severity}
            onChange={(e) => setSeverity(Number(e.target.value))}
            className="severity-slider"
          />

          <label className="field-label" htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the infrastructure problem in detail…"
            rows={4}
          />

          <label className="field-label">Attach Photo (optional)</label>
          <div className="image-upload">
            {imagePreview ? (
              <div className="image-preview-wrap">
                <img src={imagePreview} alt="Preview" />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setImagePreview(null);
                    setImageFile(null);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="upload-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Add photo
              </button>
            )}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              hidden
              onChange={handleImageChange}
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button
            type="button"
            className="btn-primary btn-full"
            disabled={loading}
            onClick={submitReport}
          >
            {loading ? 'Submitting report…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 7. PRIMARY DASHBOARD VIEWS & SCREENS
// ==========================================

// --- Transparent Header ---
function Header({ incidentCount, onReport }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">PN</div>
        <h1 className="header-title">Point Noir</h1>
      </div>

      <div className="header-stats">
        <span>{incidentCount} nearby</span>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle dark/light theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <span className="header-user">{user?.username}</span>

        <button
          type="button"
          className="icon-btn"
          onClick={logout}
          aria-label="Logout"
        >
          <LogOut size={18} />
        </button>

        <button
          type="button"
          className="report-fab-header"
          onClick={onReport}
        >
          <Plus size={16} />
          Report
        </button>
      </div>
    </header>
  );
}

// --- Leaflet Map Engine ---
function MapView({ incidents, userLat, userLng, onSelect }) {
  return (
    <MapContainer
      center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
      zoom={16}
      className="map-container"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="map-tiles"
      />
      <RecenterMap lat={userLat} lng={userLng} />
      <Marker position={[userLat, userLng]} icon={userIcon} />
      {incidents.map((inc) => (
        <Marker
          key={inc.id}
          position={[inc.latitude, inc.longitude]}
          icon={createMarkerIcon(inc.severity)}
          eventHandlers={{ click: () => onSelect(inc) }}
        />
      ))}
    </MapContainer>
  );
}

// --- Main Map Page Wrapper ---
function MapPage() {
  const [incidents, setIncidents] = useState([]);
  const [userLat, setUserLat] = useState(DEFAULT_CENTER.lat);
  const [userLng, setUserLng] = useState(DEFAULT_CENTER.lng);
  const [selected, setSelected] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchIncidents = useCallback(async (lat, lng) => {
    try {
      const { data } = await api.get('/incidents/nearby', {
        params: { lat, lng, radius: 5 },
      });
      setIncidents(data);
    } catch {
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setUserLat(lat);
          setUserLng(lng);
          fetchIncidents(lat, lng);
        },
        () => {
          fetchIncidents(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      fetchIncidents(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
    }
  }, [fetchIncidents]);

  const refresh = () => fetchIncidents(userLat, userLng);

  return (
    <div className="map-page">
      <Header incidentCount={incidents.length} onReport={() => setShowReport(true)} />

      <div className="map-wrapper">
        {loading && <div className="map-loading">Locating on map…</div>}
        <MapView
          incidents={incidents}
          userLat={userLat}
          userLng={userLng}
          onSelect={setSelected}
        />
      </div>

      <button
        type="button"
        className="report-fab-mobile"
        onClick={() => setShowReport(true)}
        aria-label="Report incident"
      >
        <Plus size={24} />
      </button>

      {selected && (
        <DetailPanel
          incident={selected}
          onClose={() => setSelected(null)}
          onUpdated={refresh}
        />
      )}

      {showReport && (
        <ReportPanel
          lat={userLat}
          lng={userLng}
          onClose={() => setShowReport(false)}
          onSubmitted={refresh}
        />
      )}
    </div>
  );
}

// --- Glassmorphic Login/Register Panel ---
function LoginPage() {
  const { login, register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || (!isLogin && !username)) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, username);
      }
      navigate('/');
    } catch (err) {
      const msg = err.response?.data?.error;
      setError(msg || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <button
        type="button"
        className="theme-toggle auth-theme"
        onClick={toggleTheme}
        aria-label="Toggle dark/light theme"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="auth-card animate-fade-up">
        <div className="auth-logo">PN</div>
        <h2 className="auth-title">Point Noir</h2>

        <div className="auth-tabs">
          <button
            type="button"
            className={isLogin ? 'active' : ''}
            onClick={() => {
              setIsLogin(true);
              setError('');
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={!isLogin ? 'active' : ''}
            onClick={() => {
              setIsLogin(false);
              setError('');
            }}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="field">
              <label htmlFor="username">Full Name / Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. John Doe"
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. user@email.com"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button
            type="submit"
            className="btn-primary btn-full"
            disabled={loading}
          >
            {loading ? 'Authenticating…' : isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {isLogin && (
          <p className="auth-hint">
            Demo: <code>demo@pointnoir.app</code> / <code>demo1234</code>
          </p>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 8. CENTRAL APP NAVIGATION SHELL
// ==========================================
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MapPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
