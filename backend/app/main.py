from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
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
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    session_columns = {column["name"] for column in inspector.get_columns("practice_sessions")}

    with engine.begin() as conn:
        if "full_name" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR(160) NOT NULL DEFAULT ''"))
        if "role" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user'"))
        if "email" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL"))
        if "password_salt" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_salt VARCHAR(64) NULL"))
        if "password_hash" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(128) NULL"))
        if "auth_token" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN auth_token VARCHAR(128) NULL"))
        if "client_ip" not in session_columns:
            conn.execute(text("ALTER TABLE practice_sessions ADD COLUMN client_ip VARCHAR(64) NOT NULL DEFAULT ''"))


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = authorization.split(" ", 1)[1].strip()
    user = services.get_user_by_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    return user


def get_path_user(
    client_id: str,
    current_user=Depends(get_current_user),
):
    if current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="User/client mismatch")
    return current_user


@app.post("/api/auth/signup", response_model=schemas.AuthResponse)
def signup(payload: schemas.SignUpRequest, db: Session = Depends(get_db)):
    try:
        user = services.create_user_account(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return services.auth_response(db, user)


@app.post("/api/auth/signin", response_model=schemas.AuthResponse)
def signin(payload: schemas.SignInRequest, db: Session = Depends(get_db)):
    try:
        user = services.sign_in_user(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return services.auth_response(db, user)


@app.get("/api/auth/me", response_model=schemas.MeResponse)
def me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return services.me_response(db, current_user)


@app.get("/api/users/{client_id}/bootstrap", response_model=schemas.BootstrapResponse)
def get_bootstrap(client_id: str, current_user=Depends(get_path_user)):
    return services.build_bootstrap_response(current_user)


@app.put("/api/users/{client_id}/profile", response_model=schemas.BootstrapResponse)
def update_profile(
    client_id: str, payload: schemas.ProfileUpdate, db: Session = Depends(get_db), current_user=Depends(get_path_user)
):
    services.update_profile(current_user, payload)
    db.commit()
    db.refresh(current_user)
    return services.build_bootstrap_response(current_user)


@app.post("/api/users/{client_id}/sections", response_model=schemas.SectionRead)
def create_section(
    client_id: str, payload: schemas.SectionCreate, db: Session = Depends(get_db), current_user=Depends(get_path_user)
):
    try:
        section = services.add_section(db, current_user, payload)
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
    client_id: str, payload: schemas.InteractionCreate, db: Session = Depends(get_db), current_user=Depends(get_path_user)
):
    services.log_interaction(db, current_user, payload)
    return {"status": "logged"}


@app.post(
    "/api/users/{client_id}/sessions/complete",
    response_model=schemas.SessionSummaryResponse,
)
def complete_session(
    client_id: str,
    payload: schemas.SessionComplete,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_path_user),
):
    try:
        services.assert_daily_practice_limit(db, current_user, request.client.host if request.client else "")
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    response = services.queue_session_completion(
        db,
        current_user,
        payload,
        request.client.host if request.client else "",
    )
    background_tasks.add_task(
        services.process_session_assessment,
        response.sessionId,
        current_user.level,
        payload.transcriptText or payload.transcriptExcerpt,
    )
    return response


@app.get(
    "/api/users/{client_id}/sessions/{session_id}",
    response_model=schemas.SessionStatusResponse,
)
def get_session_status(client_id: str, session_id: str, db: Session = Depends(get_db), current_user=Depends(get_path_user)):
    session = services.get_session_status(db, current_user, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get(
    "/api/users/{client_id}/sessions",
    response_model=schemas.SessionTrendsResponse,
)
def get_sessions(client_id: str, db: Session = Depends(get_db), current_user=Depends(get_path_user)):
    return services.get_session_trends(db, current_user)
