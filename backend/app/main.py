from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db
from . import schemas, services

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.get("/api/users/{client_id}/bootstrap", response_model=schemas.BootstrapResponse)
def get_bootstrap(client_id: str, db: Session = Depends(get_db)):
    user = services.get_or_create_user(db, client_id)
    return services.build_bootstrap_response(user)


@app.put("/api/users/{client_id}/profile", response_model=schemas.BootstrapResponse)
def update_profile(
    client_id: str, payload: schemas.ProfileUpdate, db: Session = Depends(get_db)
):
    user = services.get_or_create_user(db, client_id)
    services.update_profile(user, payload)
    db.commit()
    db.refresh(user)
    return services.build_bootstrap_response(user)


@app.post("/api/users/{client_id}/sections", response_model=schemas.SectionRead)
def create_section(
    client_id: str, payload: schemas.SectionCreate, db: Session = Depends(get_db)
):
    user = services.get_or_create_user(db, client_id)
    try:
        section = services.add_section(db, user, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Section name already exists") from exc

    return schemas.SectionRead(
        id=section.external_id,
        name=section.name,
        emoji=section.emoji,
        description=section.description,
        systemPrompt=section.system_prompt,
        isBuiltIn=False,
    )


@app.post("/api/users/{client_id}/interactions")
def create_interaction(
    client_id: str, payload: schemas.InteractionCreate, db: Session = Depends(get_db)
):
    user = services.get_or_create_user(db, client_id)
    services.log_interaction(db, user, payload)
    return {"status": "logged"}


@app.post(
    "/api/users/{client_id}/sessions/complete",
    response_model=schemas.SessionSummaryResponse,
)
def complete_session(
    client_id: str,
    payload: schemas.SessionComplete,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    user = services.get_or_create_user(db, client_id)
    response = services.queue_session_completion(db, user, payload)
    background_tasks.add_task(
        services.process_session_assessment,
        response.sessionId,
        user.level,
        payload.transcriptText or payload.transcriptExcerpt,
    )
    return response


@app.get(
    "/api/users/{client_id}/sessions/{session_id}",
    response_model=schemas.SessionStatusResponse,
)
def get_session_status(client_id: str, session_id: str, db: Session = Depends(get_db)):
    user = services.get_or_create_user(db, client_id)
    session = services.get_session_status(db, user, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get(
    "/api/users/{client_id}/sessions",
    response_model=schemas.SessionTrendsResponse,
)
def get_sessions(client_id: str, db: Session = Depends(get_db)):
    user = services.get_or_create_user(db, client_id)
    return services.get_session_trends(db, user)
