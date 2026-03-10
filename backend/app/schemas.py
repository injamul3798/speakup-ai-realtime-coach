from datetime import date, datetime

from pydantic import BaseModel, Field


class StreakPayload(BaseModel):
    count: int = 0
    lastDate: str = ""


class SectionBase(BaseModel):
    name: str
    emoji: str
    description: str
    systemPrompt: str


class SectionCreate(SectionBase):
    id: str


class SectionRead(SectionBase):
    id: str
    isBuiltIn: bool = False


class ProfileUpdate(BaseModel):
    level: str | None = None


class SignUpRequest(BaseModel):
    fullName: str
    email: str
    password: str
    confirmPassword: str


class SignInRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    clientId: str
    email: str
    fullName: str
    role: str
    practiceCount: int
    practiceLimit: int | None
    canPractice: bool


class MeResponse(BaseModel):
    clientId: str
    email: str
    fullName: str
    role: str
    level: str
    xp: int
    practiceCount: int
    practiceLimit: int | None
    canPractice: bool


class InteractionCreate(BaseModel):
    sectionName: str
    heard: str = ""
    reply: str = ""
    corrections: list[dict] = Field(default_factory=list)
    suggestions: list[dict] = Field(default_factory=list)
    scores: dict = Field(default_factory=dict)
    smartTip: str = ""
    followUp: str = ""


class SessionComplete(BaseModel):
    sectionName: str
    startedAt: datetime
    endedAt: datetime
    durationSeconds: int = 0
    targetDurationMinutes: int = 10
    score: int = 0
    xpAwarded: int = 0
    transcriptExcerpt: str = ""
    transcriptText: str = ""
    stats: dict = Field(default_factory=dict)
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    reportQuote: str = ""


class BootstrapResponse(BaseModel):
    role: str = "user"
    fullName: str = ""
    level: str
    xp: int
    streak: StreakPayload
    practiceCount: int = 0
    practiceLimit: int | None = 2
    canPractice: bool = True
    customSections: list[SectionRead]


class SessionSummaryResponse(BaseModel):
    sessionId: str = ""
    status: str = "processing"
    xp: int
    streak: StreakPayload
    assessmentSummary: str = ""
    assessment: dict = Field(default_factory=dict)


class SessionStatusResponse(SessionSummaryResponse):
    transcriptFilePath: str = ""


class SessionHistoryItem(BaseModel):
    sessionId: str
    sectionName: str
    completedAt: datetime
    score: int
    status: str
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    scores: dict = Field(default_factory=dict)
    transcriptFilePath: str = ""


class SessionTrendsResponse(BaseModel):
    sessionsCompleted: int = 0
    averageScore: int = 0
    latestScoreDelta: int = 0
    strongestArea: str = ""
    focusArea: str = ""
    recentSessions: list[SessionHistoryItem] = Field(default_factory=list)
