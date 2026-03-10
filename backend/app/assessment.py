import json
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from .config import settings

logger = logging.getLogger(__name__)


def save_transcript_file(session_id: str, client_id: str, section_name: str, started_at: str, transcript: str) -> str:
    transcript_dir = Path(settings.transcript_dir)
    transcript_dir.mkdir(parents=True, exist_ok=True)
    safe_section = "".join(ch.lower() if ch.isalnum() else "-" for ch in section_name).strip("-")
    safe_client = "".join(ch.lower() if ch.isalnum() else "-" for ch in client_id).strip("-")
    safe_started = started_at.replace(":", "-")
    file_path = transcript_dir / f"{session_id}_{safe_client}_{safe_section}_{safe_started}.txt"
    file_path.write_text(transcript, encoding="utf-8")
    logger.info("Transcript saved for session %s at %s (%s chars)", session_id, file_path, len(transcript))
    return str(file_path)


def generate_session_id() -> str:
    return uuid4().hex


def assess_transcript(transcript: str, level: str, section_name: str) -> dict[str, Any]:
    logger.info(
        "Starting transcript assessment with model=%s, section=%s, chars=%s",
        settings.gemini_assessment_model,
        section_name,
        len(transcript),
    )
    if not settings.gemini_api_key:
        return {
            "summary": "Assessment skipped because backend Gemini API key is not configured.",
            "strengths": [],
            "improvements": [],
            "coach_notes": [],
            "scores": {},
            "better_response": "",
            "mistake_patterns": [],
            "next_session_plan": [],
        }

    prompt = f"""
You are a strict but helpful English speaking evaluator for a production coaching app.
User level: {level}
Practice section: {section_name}

Return JSON only with this exact shape:
{{
  "summary": "short professional coaching summary",
  "strengths": ["..."],
  "improvements": ["..."],
  "coach_notes": ["..."],
  "better_response": "rewrite one representative user answer into a stronger version",
  "mistake_patterns": [
    {{
      "pattern": "name of recurring issue",
      "impact": "why it matters",
      "fix": "how to improve it"
    }}
  ],
  "next_session_plan": ["..."],
  "scores": {{
    "grammar": 0,
    "fluency": 0,
    "pronunciation": 0,
    "vocabulary": 0
  }}
}}

Transcript:
{transcript}
""".strip()

    response = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_assessment_model}:generateContent",
        params={"key": settings.gemini_api_key},
        headers={"Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=30.0,
    )
    response.raise_for_status()
    payload = response.json()
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    logger.info("Transcript assessment completed for section=%s", section_name)
    return parsed
