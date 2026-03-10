import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / ".env.local", override=False)


class Settings:
    app_name = os.getenv("APP_NAME", "SpeakUp AI Tracking API")
    database_url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@127.0.0.1:3306/speakup_ai",
    )
    gemini_api_key = os.getenv("GEMINI_API_KEY", "")
    gemini_assessment_model = os.getenv("GEMINI_ASSESSMENT_MODEL", "gemini-3.1-pro-preview")
    user_lifetime_session_limit = int(os.getenv("USER_LIFETIME_SESSION_LIMIT", "2"))
    transcript_dir = os.getenv(
        "TRANSCRIPT_DIR",
        str(Path(__file__).resolve().parents[1] / "transcript"),
    )
    cors_origins = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]


settings = Settings()
