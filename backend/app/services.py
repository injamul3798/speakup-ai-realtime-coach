from datetime import date
import logging
from threading import Lock

from sqlalchemy.orm import Session

from . import models, schemas
from .assessment import assess_transcript, generate_session_id, save_transcript_file
from .database import SessionLocal

logger = logging.getLogger(__name__)
_interaction_cache: dict[str, list[dict]] = {}
_interaction_cache_lock = Lock()


def _sanitize_transcript_line(text: str) -> str:
    cleaned = (text or "").replace("**", "").strip()
    if not cleaned:
        return ""

    lower = cleaned.lower()
    blocked_phrases = [
        "acknowledge and engage",
        "acknowledge and inquire",
        "initiating communication now",
        "i've registered",
        "my current focus is",
        "my approach now is",
        "i decided to ask",
        "i want to build rapport",
        "i noted that",
        "i will pose",
        "internal",
        "thinking:",
    ]
    if any(phrase in lower for phrase in blocked_phrases):
        return ""
    return cleaned


def _interaction_cache_key(user: models.User, section_name: str) -> str:
    return f"{user.client_id}:{section_name.lower()}"


def _build_transcript_from_interactions(user: models.User, payload: schemas.SessionComplete) -> str:
    cache_key = _interaction_cache_key(user, payload.sectionName)
    with _interaction_cache_lock:
        rows = list(_interaction_cache.get(cache_key, []))

    lines: list[str] = []
    for row in rows:
        heard = _sanitize_transcript_line(row.get("heard", ""))
        reply = _sanitize_transcript_line(row.get("reply", ""))
        if heard:
            lines.append(f"User: {heard}")
        if reply:
            lines.append(f"Coach: {reply}")

    return "\n\n".join(lines).strip()


def _resolve_transcript_text(user: models.User, payload: schemas.SessionComplete) -> str:
    direct_text = (payload.transcriptText or "").strip()
    direct_excerpt = (payload.transcriptExcerpt or "").strip()
    if len(direct_text) >= 80:
        return direct_text

    interaction_text = _build_transcript_from_interactions(user, payload)
    if interaction_text:
        logger.info(
            "Using in-memory interaction transcript fallback for user=%s section=%s (%s chars)",
            user.client_id,
            payload.sectionName,
            len(interaction_text),
        )
        return interaction_text

    return direct_text or direct_excerpt


def get_or_create_user(db: Session, client_id: str) -> models.User:
    user = db.query(models.User).filter(models.User.client_id == client_id).first()
    if user:
        return user

    user = models.User(client_id=client_id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def build_bootstrap_response(user: models.User) -> schemas.BootstrapResponse:
    return schemas.BootstrapResponse(
        level=user.level,
        xp=user.xp,
        streak=schemas.StreakPayload(
            count=user.streak_count,
            lastDate=user.streak_last_date.isoformat() if user.streak_last_date else "",
        ),
        customSections=[
            schemas.SectionRead(
                id=section.external_id,
                name=section.name,
                emoji=section.emoji,
                description=section.description,
                systemPrompt=section.system_prompt,
                isBuiltIn=False,
            )
            for section in user.sections
        ],
    )


def update_profile(user: models.User, payload: schemas.ProfileUpdate) -> None:
    if payload.level is not None:
        user.level = payload.level


def add_section(db: Session, user: models.User, payload: schemas.SectionCreate) -> models.Section:
    section = models.Section(
        user_id=user.id,
        external_id=payload.id,
        name=payload.name,
        emoji=payload.emoji,
        description=payload.description,
        system_prompt=payload.systemPrompt,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def log_interaction(db: Session, user: models.User, payload: schemas.InteractionCreate) -> None:
    cache_key = _interaction_cache_key(user, payload.sectionName)
    turn = {
        "heard": payload.heard,
        "reply": payload.reply,
        "corrections": payload.corrections,
        "suggestions": payload.suggestions,
        "scores": payload.scores,
        "smart_tip": payload.smartTip,
        "follow_up": payload.followUp,
    }
    with _interaction_cache_lock:
        _interaction_cache.setdefault(cache_key, []).append(turn)


def queue_session_completion(
    db: Session, user: models.User, payload: schemas.SessionComplete
) -> schemas.SessionSummaryResponse:
    session_id = generate_session_id()
    resolved_transcript = _resolve_transcript_text(user, payload)
    cache_key = _interaction_cache_key(user, payload.sectionName)
    with _interaction_cache_lock:
        turns = list(_interaction_cache.pop(cache_key, []))
    transcript_file_path = save_transcript_file(
        session_id=session_id,
        client_id=user.client_id,
        section_name=payload.sectionName,
        started_at=payload.startedAt.isoformat(),
        transcript=resolved_transcript,
    )

    session = models.PracticeSession(
        session_uuid=session_id,
        user_id=user.id,
        section_name=payload.sectionName,
        started_at=payload.startedAt,
        ended_at=payload.endedAt,
        duration_seconds=payload.durationSeconds,
        target_duration_minutes=payload.targetDurationMinutes,
        score=payload.score,
        xp_awarded=payload.xpAwarded,
        transcript_excerpt=resolved_transcript[:1000],
        transcript_file_path=transcript_file_path,
        stats={
            **payload.stats,
            "conversation_turns": turns,
        },
        strengths=payload.strengths,
        improvements=payload.improvements,
        report_quote=payload.reportQuote,
        assessment_summary="Evaluation in progress.",
        assessment_payload={},
        status="processing",
    )
    db.add(session)

    user.xp += payload.xpAwarded
    session_day = payload.endedAt.date()
    if user.streak_last_date != session_day:
        if user.streak_last_date == date.fromordinal(session_day.toordinal() - 1):
            user.streak_count += 1
        else:
            user.streak_count = 1
        user.streak_last_date = session_day

    db.commit()
    db.refresh(user)
    return schemas.SessionSummaryResponse(
        sessionId=session.session_uuid,
        status=session.status,
        xp=user.xp,
        streak=schemas.StreakPayload(
            count=user.streak_count,
            lastDate=user.streak_last_date.isoformat() if user.streak_last_date else "",
        ),
        assessmentSummary=session.assessment_summary,
        assessment={},
    )


def process_session_assessment(session_id: str, level: str, transcript: str) -> None:
    db = SessionLocal()
    try:
        session = db.query(models.PracticeSession).filter(models.PracticeSession.session_uuid == session_id).first()
        if not session:
            return

        logger.info("Background assessment started for session=%s", session_id)

        assessment = assess_transcript(
            transcript=transcript or session.transcript_excerpt or "",
            level=level,
            section_name=session.section_name,
        )
        assessment_scores = assessment.get("scores", {})
        session.stats = {
            **(session.stats or {}),
            "assessment_scores": assessment_scores,
        }
        session.strengths = assessment.get("strengths") or session.strengths
        session.improvements = assessment.get("improvements") or session.improvements
        session.report_quote = assessment.get("summary") or session.report_quote
        session.assessment_summary = assessment.get("summary", "")
        session.assessment_payload = assessment
        session.score = session.score or _average_score(assessment_scores)
        session.status = "completed"
        db.commit()
        logger.info("Background assessment completed for session=%s", session_id)
    except Exception as exc:
        if 'session' in locals() and session:
            session.status = "failed"
            session.assessment_summary = f"Evaluation failed: {exc}"
            session.assessment_payload = {}
            db.commit()
        logger.exception("Background assessment failed for session=%s", session_id)
    finally:
        db.close()


def get_session_status(db: Session, user: models.User, session_id: str) -> schemas.SessionStatusResponse | None:
    session = (
        db.query(models.PracticeSession)
        .filter(models.PracticeSession.user_id == user.id, models.PracticeSession.session_uuid == session_id)
        .first()
    )
    if not session:
        return None

    return schemas.SessionStatusResponse(
        sessionId=session.session_uuid,
        status=session.status,
        xp=user.xp,
        streak=schemas.StreakPayload(
            count=user.streak_count,
            lastDate=user.streak_last_date.isoformat() if user.streak_last_date else "",
        ),
        assessmentSummary=session.assessment_summary or "",
        assessment=session.assessment_payload or {},
        transcriptFilePath=session.transcript_file_path or "",
    )


def get_session_trends(db: Session, user: models.User) -> schemas.SessionTrendsResponse:
    sessions = (
        db.query(models.PracticeSession)
        .filter(models.PracticeSession.user_id == user.id)
        .order_by(models.PracticeSession.ended_at.desc())
        .limit(12)
        .all()
    )

    if not sessions:
        return schemas.SessionTrendsResponse()

    completed_sessions = [session for session in sessions if session.status == "completed"]
    average_score = round(
        sum(session.score for session in completed_sessions) / len(completed_sessions)
    ) if completed_sessions else 0

    latest_score_delta = 0
    if len(completed_sessions) >= 2:
        latest_score_delta = completed_sessions[0].score - completed_sessions[1].score

    aggregated_scores = {"grammar": 0, "fluency": 0, "pronunciation": 0, "vocabulary": 0}
    score_samples = 0
    for session in completed_sessions:
      scores = (session.assessment_payload or {}).get("scores") or (session.stats or {}).get("assessment_scores") or {}
      if scores:
        score_samples += 1
        for key in aggregated_scores:
          aggregated_scores[key] += int(scores.get(key, 0))

    averaged_dimensions = {
        key: round(value / score_samples) if score_samples else 0 for key, value in aggregated_scores.items()
    }
    strongest_area = max(averaged_dimensions, key=averaged_dimensions.get) if score_samples else ""
    focus_area = min(averaged_dimensions, key=averaged_dimensions.get) if score_samples else ""

    return schemas.SessionTrendsResponse(
        sessionsCompleted=len(completed_sessions),
        averageScore=average_score,
        latestScoreDelta=latest_score_delta,
        strongestArea=strongest_area,
        focusArea=focus_area,
        recentSessions=[
            schemas.SessionHistoryItem(
                sessionId=session.session_uuid,
                sectionName=session.section_name,
                completedAt=session.ended_at,
                score=session.score,
                status=session.status,
                summary=session.assessment_summary or session.report_quote or "",
                strengths=session.strengths or [],
                improvements=session.improvements or [],
                scores=(session.assessment_payload or {}).get("scores")
                or (session.stats or {}).get("assessment_scores")
                or {},
                transcriptFilePath=session.transcript_file_path or "",
            )
            for session in sessions
        ],
    )


def _average_score(scores: dict) -> int:
    values = [int(value) for value in scores.values() if isinstance(value, (int, float))]
    if not values:
        return 0
    return round(sum(values) / len(values))
