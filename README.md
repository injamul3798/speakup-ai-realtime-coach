# SpeakUp AI

SpeakUp AI is a real-time English speaking coach that lets learners practice live conversations with Gemini, saves each session, evaluates progress, and surfaces actionable feedback over time.

## Tagline

Real-time interview practice with live coaching and trackable speaking progress.

## What It Does

- Runs live English speaking practice with Gemini native audio.
- Stores authenticated user sessions in MySQL.
- Saves transcript files for each completed session.
- Evaluates completed sessions with a second Gemini model.
- Shows coaching metrics such as grammar, fluency, pronunciation, vocabulary, strengths, and improvement priorities.
- Supports normal users with a lifetime practice cap and admin users with unlimited access.

## Architecture Diagram

```text
                        +----------------------------------+
                        |          User Browser            |
                        |   React + Vite + Tailwind UI     |
                        +----------------+-----------------+
                                         |
                                         | HTTPS / HTTP
                                         v
                        +----------------------------------+
                        |   Frontend App / Nginx Static    |
                        |   Served on Google Compute VM    |
                        +----------------+-----------------+
                                         |
                                         | /api
                                         v
                        +----------------------------------+
                        |        FastAPI Backend           |
                        |  Auth, session tracking, APIs    |
                        +--------+---------------+---------+
                                 |               |
                                 |               |
                                 v               v
                 +--------------------------+   +---------------------------+
                 |        MySQL DB          |   | Transcript File Storage   |
                 | users, sessions, trends  |   | backend/transcript/*.txt  |
                 +--------------------------+   +---------------------------+
                                 |
                                 |
                    +------------+-------------+
                    |                          |
                    v                          v
     +--------------------------------+   +----------------------------------+
     | Gemini Live API                |   | Gemini Assessment Model          |
     | gemini-2.5-flash-native-       |   | gemini-3.1-pro-preview           |
     | audio-preview-12-2025          |   | post-session scoring + feedback  |
     +--------------------------------+   +----------------------------------+
```

## Technical Details

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Lucide React
- Motion

### Backend

- FastAPI
- Python
- SQLAlchemy
- PyMySQL

### Database

- MySQL
- Local MySQL instance running on the same Google Compute Engine VM

### AI Models

- Live conversation model:
  - `gemini-2.5-flash-native-audio-preview-12-2025`
- Post-session evaluation model:
  - `gemini-3.1-pro-preview`

### Infrastructure

- Google Cloud Platform
- Google Compute Engine
- Nginx for static frontend hosting and API reverse proxy
- systemd for running the backend as a persistent service

## Session Lifecycle

1. User signs in and starts a live speaking session.
2. Frontend streams speech and receives live coaching responses from Gemini Live.
3. Frontend sends tracked interaction data to FastAPI.
4. When the session is completed, the backend:
   - stores the session in MySQL
   - writes the transcript to a text file
   - starts background evaluation
5. The evaluation model analyzes the transcript and updates the database with:
   - summary
   - dimension scores
   - strengths
   - improvements
   - next-session recommendations
6. The dashboard reads the saved session history and progress metrics from MySQL.

## Authentication and Access Control

- Users must sign up or sign in before using the app.
- Signup creates normal users only.
- Admin accounts are created by a script, not through public signup.
- Normal users have a lifetime practice limit.
- Admin users have unlimited access.

## Data Stored

- User account data
- Practice sections
- Completed session records
- Session transcript file path
- Evaluation payload and scores
- Progress metrics used by the dashboard

## Deployment

Production deployment is designed for a single Google Compute Engine VM:

- frontend built with Vite and served by Nginx
- backend served by FastAPI/Uvicorn behind Nginx
- MySQL hosted locally on the same VM
- backend managed by systemd so the app continues running after terminal or SSH is closed

## Environment Variables

### Backend

- `DATABASE_URL`
- `CORS_ORIGINS`
- `APP_NAME`
- `GEMINI_API_KEY`
- `GEMINI_ASSESSMENT_MODEL`
- `TRANSCRIPT_DIR`
- `USER_LIFETIME_SESSION_LIMIT`

### Frontend

- `VITE_API_BASE_URL`
- `GEMINI_API_KEY`

## Why This Matters

Many people practice English with AI tools, but they still cannot clearly measure whether they are improving. SpeakUp AI closes that gap by combining live practice, persistent session tracking, transcript storage, and structured evaluation in one system.
