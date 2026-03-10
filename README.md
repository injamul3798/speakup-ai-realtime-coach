<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# SpeakUp AI

Real-time English speaking practice app with a React frontend, Gemini Live voice coaching, and a FastAPI + MySQL backend for persistent tracking.

## Architecture

- Frontend: Vite, React 19, TypeScript, Tailwind CSS
- Realtime AI: Gemini Live in the browser for voice-to-voice interaction
- Backend: FastAPI
- Database: MySQL

The realtime conversation flow stays in the frontend. The backend is responsible for:

- user bootstrap and profile persistence
- custom practice section storage
- interaction tracking
- session summaries, XP, and streak updates
- transcript export to text files at session end
- backend Gemini assessment of completed session transcripts

## Frontend setup

1. Install frontend dependencies:
   `npm install`
2. Create `.env.local` from `.env.example`
3. Set:
   `GEMINI_API_KEY=your_key`
4. Optionally set:
   `VITE_API_BASE_URL=http://localhost:8000`
5. Run the frontend:
   `npm run dev`

## Backend setup

1. Create a Python virtual environment inside `backend`
2. Install dependencies:
   `pip install -r backend/requirements.txt`
3. Set environment variables:
   `DATABASE_URL=mysql+pymysql://user:password@localhost:3306/speakup_ai`
   `CORS_ORIGINS=http://localhost:3000`
   `GEMINI_API_KEY=your_gemini_api_key`
   `GEMINI_ASSESSMENT_MODEL=gemini-2.0-flash`
   `TRANSCRIPT_DIR=backend/transcript`
4. Start the API:
   `uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000`

## Database tables

The backend auto-creates these tables on startup:

- `users`
- `sections`
- `interaction_logs`
- `practice_sessions`

## Notes

- The frontend still uses Gemini directly for low-latency realtime audio.
- Browser `client_id` is stored locally and used as the stable identity for tracking.
- API keys should be proxied or managed server-side for a production deployment.
