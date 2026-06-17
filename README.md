# Point Noir · Civic Infrastructure Reporting App

Welcome to **Point Noir**! This is a simple, beautiful, and fully functional civic crowdsourcing web application. It allows citizens to report local infrastructure problems (like potholes, broken streetlights, flooding, or sidewalk damage) on an interactive live map, review existing reports, rate their severity, and post comments.

The project is structured to be as clean, tidy, and minimal as possible. Instead of having dozens of scattered folders and configuration files, the entire application is written using standard **JavaScript** and consolidated into just **4 primary code files**!

---

## 📁 Project Directory Structure

Here is the exact folder structure:

```
📁 Black point v2/
├── 📄 package.json              # Runs both backend and frontend servers together
├── 📄 .gitignore                # Excludes node_modules, database files, and uploaded photos
├── 📄 README.md                 # This human-friendly walkthrough guide
│
├── 📁 backend/
│   ├── 📄 package.json          # Backend configuration and scripts
│   └── 📁 src/
│       └── 📄 server.js         # The ONLY backend file (database, seed data, routes, and uploads)
│
└── 📁 frontend/
    ├── 📄 package.json          # Frontend packages and scripts
    ├── 📄 vite.config.js        # Standard Vite server proxy settings
    ├── 📄 index.html            # Main HTML wrapper (loads Google Fonts)
    └── 📁 src/
        ├── 📄 main.jsx          # Starts the React application
        ├── 📄 App.jsx           # The ONLY React file (holds pages, components, and global states)
        └── 📄 index.css         # The ONLY styling stylesheet (contains the glassmorphic system)
```

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
Open your terminal at the root directory (`/Users/ryan/Projects/Black point v2`) and run:
```bash
npm run install:all
```
This will automatically download and install all backend and frontend libraries.

### 2. Start the Application
To launch the backend API and the frontend server together, run:
```bash
npm run dev
```
You should see:
*   The API running on: **`http://localhost:3001`**
*   The Web App running on: **`http://localhost:3000`**

### 3. Open in Your Browser
Go to **`http://localhost:3000`** and log in with the demo account:
*   **Email:** `demo@pointnoir.app`
*   **Password:** `demo1234`

*Note: The map will request your browser GPS location. The pre-loaded demo incidents are seeded around the Ifrane area so you see live markers immediately.*

---

## 🔗 How to Share Your App with Others

Since this is running locally on your Mac, others cannot open it unless you share access:

1.  **Quick Sharing (Temporary Link using ngrok):**
    If you want to send a link to someone to test on their phone or computer right now, you can use a free tool called **ngrok**. 
    *   Install it via Homebrew: `brew install ngrok`
    *   Start a tunnel pointing to the React port: `ngrok http 3000`
    *   ngrok will give you a temporary link (like `https://xyz.ngrok-free.app`). Send this link to anyone, and they can open the app as long as your Mac is running!
2.  **Permanent Sharing (Deployment):**
    To make the site permanently accessible 24/7, you can deploy it to a free host like **Render** or **Railway**. Once deployed, you will get a permanent web address (like `https://point-noir.onrender.com`).

---

## 📖 Code Walkthrough: How Everything Works

Here is a human-friendly explanation of how all the code works:

### 1. Backend API (`backend/src/server.js`)
This is the only backend file. It performs four key jobs:
*   **Database Setup (`SQLite`):** It initiates a local database file (`pointnoir.db`) using Node's built-in `node:sqlite` package. If the file doesn't exist, it creates five SQL tables: `users`, `categories`, `incidents`, `comments`, `ratings`, and `meta`.
*   **Mock Seeding:** It automatically seeds the database with a default demo user and seven real incidents around Ifrane.
*   **Authentication Middleware:** It parses incoming request headers for a JSON Web Token (JWT). If the token is valid, it attaches the user profile to the request so the app knows who is making reports or comments.
*   **API Endpoints:**
    *   `POST /api/auth/register` & `POST /api/auth/login`: Hashes passwords with `bcryptjs` and signs session tokens.
    *   `GET /api/categories`: Returns the incident categories (Pothole, Broken Light, etc.).
    *   `GET /api/incidents/nearby`: Accepts the user's latitude and longitude and returns all reported incidents within a given radius, sorted by distance using the mathematical **Haversine formula**.
    *   `POST /api/incidents`: Saves a new incident report including categories, descriptions, coordinates, and photo links.
    *   `POST /api/incidents/:id/ratings` & `POST /api/incidents/:id/comments`: Submits 1-5 star feedback and text discussions.
    *   `POST /api/media/upload`: Uses `multer` to securely save uploaded photos to a local `/uploads` directory.

### 2. Frontend React Shell (`frontend/src/main.jsx`)
This simple file imports React, the style system, and the consolidated React application `App.jsx`, mounting it directly onto the browser window.

### 3. Frontend React App (`frontend/src/App.jsx`)
This is the heart of the frontend, consolidating all views and modules into one clear, top-down structure:
*   **Axios HTTP Client:** Sets up a central connection instance to communicate with the Express API. It contains a request interceptor that automatically reads the user token (`pn_token`) from browser local storage and attaches it to every API request header.
*   **Global Contexts (`Theme` & `Auth`):**
    *   `ThemeContext` handles dark mode (violet/black) and light mode (sky blue/white) switching. It updates the class attribute on the HTML element so the CSS knows which color palette to render.
    *   `AuthContext` handles user sign-in, account creation, and logout. It stores the logged-in user's profile and JWT token, automatically restoring the session from local storage on refresh.
*   **Routing & Guards (`App` & `ProtectedRoute`):** Uses React Router. If a user is not authenticated, the app automatically blocks access and redirects them to the `/login` screen.
*   **Views & Pages:**
    *   `LoginPage`: Renders the sleek glassmorphic center card seen in the login screenshots, letting users register or sign in.
    *   `MapPage`: The main application view. It keeps track of user coordinates, fetches nearby reports from the API, and controls whether the report details panel or report creation form is currently open.
*   **Components:**
    *   `Header`: The transparent top navigation bar. It displays the statistics pill, active username, theme toggler, and the "+ Report" button.
    *   `MapView`: Renders the Leaflet map container. It draws OpenStreetMap map tiles, places a pulsating blue circle on your GPS coordinates, and plots purple markers representing reported incidents. Marker colors indicate incident severity (higher severity = darker outline).
    *   `DetailPanel`: Renders the slide-up modal showing incident details. It shows reports, user ratings, a custom interactive star-rating selector, and lists user comments with a form to submit new ones.
    *   `ReportPanel`: Renders the slide-up report form. It captures the user's GPS coordinates, shows category chips, provides a severity slider, a description textarea, and allows attaching an optional photo.

### 4. Styles System (`frontend/src/index.css`)
This stylesheet contains all CSS rules for the entire app. It implements:
*   **Design Tokens:** Defines CSS variables for fonts, borders, shadows, and color schemes.
    *   *Dark Mode:* Deep purple/black palette (`#09090f`, `#1a1033`).
    *   *Light Mode:* Sky-blue/white palette (`#f0f9ff`, `#0ea5e9`).
*   **Glassmorphism styling:** Standardizes glossy cards and modal panels using translucent borders (`rgba(...)`) and backdrop filters (`blur(16px)`).
*   **Leaflet Map overrides:** Tweaks default Leaflet maps to look modern, styling markers, the user locator dot, and map attribution controls.
*   **Smooth Animations:** Implements custom CSS animations like `fadeUp` (fade and slide upwards) and `slideUp` (pop panels from the bottom of the screen) to make page elements feel responsive and alive.
