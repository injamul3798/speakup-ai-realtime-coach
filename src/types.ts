export interface PracticeSection {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

export interface Streak {
  count: number;
  lastDate: string;
}

export interface Scores {
  grammar: number;
  fluency: number;
  pronunciation: number;
  vocabulary: number;
}

export interface Correction {
  wrong: string;
  right: string;
  explanation: string;
}

export interface Suggestion {
  phrase: string;
  example: string;
}

export interface GeminiResponsePayload {
  heard?: string;
  reply?: string;
  corrections?: Correction[];
  suggestions?: Suggestion[];
  scores?: Partial<Scores>;
  smart_tip?: string;
  follow_up?: string;
}

export interface SessionAssessment {
  summary: string;
  strengths: string[];
  improvements: string[];
  coach_notes: string[];
  scores: Partial<Scores>;
  better_response?: string;
  mistake_patterns?: Array<{
    pattern: string;
    impact: string;
    fix: string;
  }>;
  next_session_plan?: string[];
}

export interface BootstrapResponse {
  level: string;
  xp: number;
  streak: Streak;
  customSections: PracticeSection[];
}

export interface SessionSummaryResponse {
  sessionId: string;
  status: string;
  xp: number;
  streak: Streak;
  assessmentSummary: string;
  assessment: SessionAssessment;
}

export interface SessionStatusResponse extends SessionSummaryResponse {
  transcriptFilePath: string;
}

export interface SessionHistoryItem {
  sessionId: string;
  sectionName: string;
  completedAt: string;
  score: number;
  status: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  scores: Partial<Scores>;
  transcriptFilePath: string;
}

export interface SessionTrendsResponse {
  sessionsCompleted: number;
  averageScore: number;
  latestScoreDelta: number;
  strongestArea: string;
  focusArea: string;
  recentSessions: SessionHistoryItem[];
}

export interface SessionHistoryItem {
  sessionId: string;
  sectionName: string;
  completedAt: string;
  score: number;
  status: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  scores: Partial<Scores>;
  transcriptFilePath: string;
}

export interface SessionTrendsResponse {
  sessionsCompleted: number;
  averageScore: number;
  latestScoreDelta: number;
  strongestArea: string;
  focusArea: string;
  recentSessions: SessionHistoryItem[];
}
