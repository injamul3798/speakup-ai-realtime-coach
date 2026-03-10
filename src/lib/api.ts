import type {
  AuthResponse,
  BootstrapResponse,
  GeminiResponsePayload,
  MeResponse,
  PracticeSection,
  SessionTrendsResponse,
  SessionStatusResponse,
  SessionSummaryResponse,
} from '../types';
import { getAuthToken } from './client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function signUp(payload: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}) {
  return request<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function signIn(payload: { email: string; password: string }) {
  return request<AuthResponse>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchMe() {
  return request<MeResponse>('/api/auth/me');
}

export function fetchBootstrap(clientId: string) {
  return request<BootstrapResponse>(`/api/users/${clientId}/bootstrap`);
}

export function updateProfile(clientId: string, payload: { level: string }) {
  return request<BootstrapResponse>(`/api/users/${clientId}/profile`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function createSection(clientId: string, payload: PracticeSection) {
  return request<PracticeSection>(`/api/users/${clientId}/sections`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function logInteraction(
  clientId: string,
  sectionName: string,
  response: GeminiResponsePayload,
) {
  return request<{ status: string }>(`/api/users/${clientId}/interactions`, {
    method: 'POST',
    body: JSON.stringify({
      sectionName,
      heard: response.heard || '',
      reply: response.reply || '',
      corrections: response.corrections || [],
      suggestions: response.suggestions || [],
      scores: response.scores || {},
      smartTip: response.smart_tip || '',
      followUp: response.follow_up || '',
    }),
  });
}

export function completeSession(
  clientId: string,
  payload: {
    sectionName: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    targetDurationMinutes: number;
    score: number;
    xpAwarded: number;
    transcriptExcerpt: string;
    transcriptText: string;
    stats: Record<string, unknown>;
    strengths: string[];
    improvements: string[];
    reportQuote: string;
  },
) {
  return request<SessionSummaryResponse>(`/api/users/${clientId}/sessions/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchSessionStatus(clientId: string, sessionId: string) {
  return request<SessionStatusResponse>(`/api/users/${clientId}/sessions/${sessionId}`);
}

export function fetchSessionTrends(clientId: string) {
  return request<SessionTrendsResponse>(`/api/users/${clientId}/sessions`);
}
