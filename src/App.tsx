import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flame,
  HelpCircle,
  Languages,
  Lightbulb,
  Menu,
  Mic,
  MoreVertical,
  Plus,
  RotateCcw,
  Settings,
  Speaker,
  Sparkles,
  Square,
  Target,
  Trophy,
  WandSparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { BUILT_IN_SECTIONS, DEFAULT_REPORT_QUOTE, LEVELS, SESSION_XP_REWARD } from './constants';
import { Modal } from './components/Modal';
import { ScoreRing } from './components/ScoreRing';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { useAudioOutput } from './hooks/useAudioOutput';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useMicrophoneStream } from './hooks/useMicrophoneStream';
import {
  completeSession,
  createSection,
  fetchBootstrap,
  fetchMe,
  fetchSessionStatus,
  fetchSessionTrends,
  logInteraction,
  signIn,
  signUp,
  updateProfile,
} from './lib/api';
import { clearAuth, getAuthToken, setAuthToken, setClientId } from './lib/client';
import { cn } from './lib/utils';
import type {
  GeminiResponsePayload,
  PracticeSection,
  Scores,
  SessionHistoryItem,
  SessionAssessment,
  SessionTrendsResponse,
  Streak,
} from './types';

const EMPTY_STREAK: Streak = { count: 0, lastDate: '' };
const SESSION_OPTIONS = [10, 20];
const EMPTY_ASSESSMENT: SessionAssessment = {
  summary: DEFAULT_REPORT_QUOTE,
  strengths: [],
  improvements: [],
  coach_notes: [],
  scores: {},
};

function normalizeAssessment(assessment?: Partial<SessionAssessment> | null): SessionAssessment {
  return {
    summary: assessment?.summary || DEFAULT_REPORT_QUOTE,
    strengths: assessment?.strengths || [],
    improvements: assessment?.improvements || [],
    coach_notes: assessment?.coach_notes || [],
    scores: assessment?.scores || {},
    better_response: assessment?.better_response || '',
    mistake_patterns: assessment?.mistake_patterns || [],
    next_session_plan: assessment?.next_session_plan || [],
  };
}

function sanitizeTranscriptText(text?: string) {
  if (!text) {
    return '';
  }

  const cleaned = text.replace(/\*\*/g, '').trim();
  const lower = cleaned.toLowerCase();
  const blockedPhrases = [
    'my approach now is',
    'i will pose',
    'it is about building rapport',
    'i have registered',
    'acknowledge and inquire',
    'thinking:',
    'internal',
  ];

  if (blockedPhrases.some((phrase) => lower.includes(phrase))) {
    return '';
  }

  return cleaned;
}

const EMPTY_TRENDS: SessionTrendsResponse = {
  sessionsCompleted: 0,
  averageScore: 0,
  latestScoreDelta: 0,
  strongestArea: '',
  focusArea: '',
  recentSessions: [],
};

function averageScore(scores?: Partial<Scores>) {
  const values = [
    scores?.grammar ?? 0,
    scores?.fluency ?? 0,
    scores?.pronunciation ?? 0,
    scores?.vocabulary ?? 0,
  ];
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function buildCoachingPriorities(scores?: Partial<Scores>) {
  return [
    {
      key: 'grammar',
      label: 'Grammar control',
      score: scores?.grammar ?? 0,
      note: 'Tighten sentence structure and article usage.',
    },
    {
      key: 'fluency',
      label: 'Fluency flow',
      score: scores?.fluency ?? 0,
      note: 'Connect ideas without pausing mid-thought.',
    },
    {
      key: 'pronunciation',
      label: 'Pronunciation clarity',
      score: scores?.pronunciation ?? 0,
      note: 'Land stressed syllables and word endings cleanly.',
    },
    {
      key: 'vocabulary',
      label: 'Vocabulary range',
      score: scores?.vocabulary ?? 0,
      note: 'Replace repeated words with stronger phrases.',
    },
  ].sort((a, b) => a.score - b.score);
}

function getCompletedSessions(sessions: SessionHistoryItem[]) {
  return sessions.filter((session) => session.status === 'completed');
}

function getDashboardScores(
  liveScores?: Partial<Scores>,
  assessmentScores?: Partial<Scores>,
  recentSessions: SessionHistoryItem[] = [],
) {
  const completed = getCompletedSessions(recentSessions);
  const latestCompletedScores = completed[0]?.scores || {};

  return {
    grammar: liveScores?.grammar ?? assessmentScores?.grammar ?? latestCompletedScores.grammar ?? 0,
    fluency: liveScores?.fluency ?? assessmentScores?.fluency ?? latestCompletedScores.fluency ?? 0,
    pronunciation:
      liveScores?.pronunciation ?? assessmentScores?.pronunciation ?? latestCompletedScores.pronunciation ?? 0,
    vocabulary: liveScores?.vocabulary ?? assessmentScores?.vocabulary ?? latestCompletedScores.vocabulary ?? 0,
  };
}

function buildScoreHistory(recentSessions: SessionHistoryItem[]) {
  return getCompletedSessions(recentSessions)
    .slice(0, 6)
    .reverse()
    .map((session) => ({
      sessionId: session.sessionId,
      label: new Date(session.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      score: session.score,
    }));
}

function formatAreaLabel(value: string) {
  if (!value) {
    return 'N/A';
  }
  return value.replace(/([A-Z])/g, ' $1').replace(/^\w/, (match) => match.toUpperCase());
}

export default function App() {
  const clientIdRef = useRef('');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authForm, setAuthForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [authUser, setAuthUser] = useState({
    fullName: '',
    email: '',
    role: 'user' as 'user' | 'admin',
  });
  const [practiceCount, setPracticeCount] = useState(0);
  const [practiceLimit, setPracticeLimit] = useState<number | null>(2);
  const [canPractice, setCanPractice] = useState(true);

  const [level, setLevel] = useState('B1');
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState<Streak>(EMPTY_STREAK);
  const [customSections, setCustomSections] = useState<PracticeSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState('free-talk');
  const [sessionMinutes, setSessionMinutes] = useState(10);
  const [secondsRemaining, setSecondsRemaining] = useState(10 * 60);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [apiError, setApiError] = useState('');
  const [sessionHint, setSessionHint] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [newSection, setNewSection] = useState({ name: '', emoji: '💬', description: '' });
  const [wordBank, setWordBank] = useState<Set<string>>(new Set());
  const [mistakeLog, setMistakeLog] = useState<Array<{ wrong: string; right: string }>>([]);
  const [isMistakeLogOpen, setIsMistakeLogOpen] = useState(false);
  const [assessment, setAssessment] = useState<SessionAssessment>(EMPTY_ASSESSMENT);
  const [sessionTrends, setSessionTrends] = useState<SessionTrendsResponse>(EMPTY_TRENDS);
  const [selectedHistory, setSelectedHistory] = useState<SessionHistoryItem | null>(null);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [isEvaluatingSession, setIsEvaluatingSession] = useState(false);
  const [transcriptFilePath, setTranscriptFilePath] = useState('');
  const [sessionReport, setSessionReport] = useState({
    score: 0,
    strengths: [] as string[],
    improvements: [] as string[],
    reportQuote: DEFAULT_REPORT_QUOTE,
  });

  const transcriptTurnsRef = useRef<Array<{ user: string; coach: string }>>([]);
  const sessionStartedAtRef = useRef<Date | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const pollingRef = useRef<number | null>(null);
  const aiSpeakingTimeoutRef = useRef<number | null>(null);

  const sections = [...BUILT_IN_SECTIONS, ...customSections];
  const activeSection = sections.find((section) => section.id === activeSectionId) || BUILT_IN_SECTIONS[0];

  const { playChunk, stopAll } = useAudioOutput();
  const { isRecording, startRecording, stopRecording, analyserRef } = useMicrophoneStream();
  const {
    isConnected,
    isThinking,
    inputTranscript,
    outputTranscript,
    lastResponse,
    sendAudioChunk,
    endTurn,
    setInputTranscript,
  } = useGeminiLive(process.env.GEMINI_API_KEY || '', level, activeSection.systemPrompt);

  useEffect(() => {
    let cancelled = false;

    async function loadAuth() {
      const token = getAuthToken();
      if (!token) {
        if (!cancelled) {
          setIsAuthReady(false);
          setIsBootstrapLoading(false);
        }
        return;
      }

      try {
        const me = await fetchMe();
        if (cancelled) {
          return;
        }
        clientIdRef.current = me.clientId;
        setClientId(me.clientId);
        setAuthUser({ fullName: me.fullName, email: me.email, role: me.role });
        setPracticeCount(me.practiceCount);
        setPracticeLimit(me.practiceLimit);
        setCanPractice(me.canPractice);
        setIsAuthReady(true);
      } catch {
        clearAuth();
        if (!cancelled) {
          setIsAuthReady(false);
        }
      }
    }

    void loadAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthReady || !clientIdRef.current) {
      return;
    }

    let cancelled = false;
    setIsBootstrapLoading(true);

    async function loadBootstrap() {
      try {
        const bootstrap = await fetchBootstrap(clientIdRef.current);
        if (cancelled) {
          return;
        }
        setLevel(bootstrap.level);
        setXp(bootstrap.xp);
        setStreak(bootstrap.streak);
        setCustomSections(bootstrap.customSections);
        setPracticeCount(bootstrap.practiceCount);
        setPracticeLimit(bootstrap.practiceLimit);
        setCanPractice(bootstrap.canPractice);
        const trends = await fetchSessionTrends(clientIdRef.current);
        if (!cancelled) {
          setSessionTrends(trends);
        }
      } catch (error) {
        if (!cancelled) {
          setApiError(error instanceof Error ? error.message : 'Failed to load tracking data.');
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapLoading(false);
        }
      }
    }

    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, [isAuthReady]);

  useEffect(() => {
    if (!sessionStartedAtRef.current) {
      setSecondsRemaining(sessionMinutes * 60);
    }
  }, [sessionMinutes]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
      }
      if (aiSpeakingTimeoutRef.current !== null) {
        window.clearTimeout(aiSpeakingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isAddModalOpen && !isReportModalOpen) {
        event.preventDefault();
        toggleRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen, isReportModalOpen, isRecording, isConnected]);

  useEffect(() => {
    const handleAudioChunk = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setIsAISpeaking(true);
      if (aiSpeakingTimeoutRef.current !== null) {
        window.clearTimeout(aiSpeakingTimeoutRef.current);
      }
      playChunk(customEvent.detail)
        .catch(() => undefined)
        .finally(() => {
          aiSpeakingTimeoutRef.current = window.setTimeout(() => {
            setIsAISpeaking(false);
          }, 200);
        });
    };

    const handleInterrupted = () => {
      stopAll();
      setIsAISpeaking(false);
    };

    const handleResponseComplete = (event: Event) => {
      const customEvent = event as CustomEvent<GeminiResponsePayload>;
      const response = customEvent.detail;

      if (response.corrections?.length) {
        setMistakeLog((prev) => [
          ...prev,
          ...response.corrections!.map((item) => ({ wrong: item.wrong, right: item.right })),
        ]);
      }

      const words = response.heard?.toLowerCase().match(/\b\w+\b/g) || [];
      setWordBank((prev) => {
        const next = new Set(prev);
        words.forEach((word) => {
          if (word.length > 4) {
            next.add(word);
          }
        });
        return next;
      });

      const userText = sanitizeTranscriptText(response.heard || inputTranscript);
      const coachText = sanitizeTranscriptText(response.reply || outputTranscript);
      if (userText || coachText) {
        transcriptTurnsRef.current = [...transcriptTurnsRef.current, { user: userText, coach: coachText }];
      }

      void logInteraction(clientIdRef.current, activeSection.name, response).catch((error) => {
        setApiError(error instanceof Error ? error.message : 'Failed to track interaction.');
      });
    };

    window.addEventListener('gemini-audio-chunk', handleAudioChunk);
    window.addEventListener('gemini-response-complete', handleResponseComplete);
    window.addEventListener('gemini-interrupted', handleInterrupted);
    return () => {
      window.removeEventListener('gemini-audio-chunk', handleAudioChunk);
      window.removeEventListener('gemini-response-complete', handleResponseComplete);
      window.removeEventListener('gemini-interrupted', handleInterrupted);
    };
  }, [activeSection.name, inputTranscript, outputTranscript, playChunk, stopAll]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [inputTranscript, outputTranscript]);

  const startSession = () => {
    if (sessionStartedAtRef.current) {
      return;
    }

    sessionStartedAtRef.current = new Date();
    transcriptTurnsRef.current = [];
    setAssessment(EMPTY_ASSESSMENT);
    setSecondsRemaining(sessionMinutes * 60);

    timerRef.current = window.setInterval(() => {
      setSecondsRemaining((current) => {
        if (current <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          void handleEndSession();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const stopSessionClock = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const persistLevel = async (nextLevel: string) => {
    setLevel(nextLevel);
    setIsSavingProfile(true);
    setApiError('');
    try {
      const bootstrap = await updateProfile(clientIdRef.current, { level: nextLevel });
      setLevel(bootstrap.level);
      setXp(bootstrap.xp);
      setStreak(bootstrap.streak);
      setCustomSections(bootstrap.customSections);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAuthSubmit = async () => {
    setApiError('');
    setIsAuthLoading(true);
    try {
      const payload =
        authMode === 'signup'
          ? await signUp({
              fullName: authForm.fullName,
              email: authForm.email,
              password: authForm.password,
              confirmPassword: authForm.confirmPassword,
            })
          : await signIn({
              email: authForm.email,
              password: authForm.password,
            });

      setAuthToken(payload.token);
      setClientId(payload.clientId);
      clientIdRef.current = payload.clientId;
      setAuthUser({ fullName: payload.fullName, email: payload.email, role: payload.role });
      setPracticeCount(payload.practiceCount);
      setPracticeLimit(payload.practiceLimit);
      setCanPractice(payload.canPractice);
      setIsAuthReady(true);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    clientIdRef.current = '';
    setIsAuthReady(false);
    setAuthUser({ fullName: '', email: '', role: 'user' });
    setPracticeCount(0);
    setPracticeLimit(2);
    setCanPractice(true);
    setCustomSections([]);
    setSessionTrends(EMPTY_TRENDS);
    setAssessment(EMPTY_ASSESSMENT);
  };

  const toggleRecording = () => {
    if (!canPractice) {
      setApiError('Practice limit reached. Upgrade to admin to continue unlimited sessions.');
      return;
    }
    if (isRecording) {
      stopRecording();
      endTurn();
      setSessionHint('Turn ended. Click "Finish & Save Session" to store this interview in the database.');
      return;
    }

    setInputTranscript('');
    setSessionHint('');
    startSession();
    startRecording(sendAudioChunk);
  };

  const handleAddSection = async () => {
    if (!newSection.name || !newSection.description) {
      return;
    }

    setApiError('');
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Convert this English practice section description into a concise system prompt for an AI coach: "${newSection.description}". Return ONLY the prompt text.`,
                  },
                ],
              },
            ],
          }),
        },
      );
      const data = await response.json();
      const generatedPrompt =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        `You are a coach for ${newSection.name}. ${newSection.description}`;

      const customSection: PracticeSection = {
        id: Date.now().toString(),
        name: newSection.name,
        emoji: newSection.emoji,
        description: newSection.description,
        systemPrompt: generatedPrompt,
        isBuiltIn: false,
      };

      const savedSection = await createSection(clientIdRef.current, customSection);
      setCustomSections((prev) => [...prev, savedSection]);
      setIsAddModalOpen(false);
      setNewSection({ name: '', emoji: '💬', description: '' });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to generate and save section.');
    }
  };

  const handleEndSession = async () => {
    const endedAt = new Date();
    const startedAt = sessionStartedAtRef.current || endedAt;
    const liveUser = sanitizeTranscriptText(lastResponse?.heard || inputTranscript);
    const liveCoach = sanitizeTranscriptText(lastResponse?.reply || outputTranscript);
    const transcriptParts = [...transcriptTurnsRef.current];
    if (liveUser || liveCoach) {
      const previous = transcriptParts[transcriptParts.length - 1];
      const isDuplicate =
        previous && previous.user === liveUser && previous.coach === liveCoach;
      if (!isDuplicate) {
        transcriptParts.push({ user: liveUser, coach: liveCoach });
      }
    }
    const transcriptText = transcriptParts
      .flatMap((turn) => [turn.user ? `User: ${turn.user}` : '', turn.coach ? `Coach: ${turn.coach}` : ''])
      .filter(Boolean)
      .join('\n\n')
      .trim();
    const fallbackScore = averageScore(lastResponse?.scores);

    stopSessionClock();
    if (isRecording) {
      stopRecording();
      endTurn();
    }

    try {
      const result = await completeSession(clientIdRef.current, {
        sectionName: activeSection.name,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
        targetDurationMinutes: sessionMinutes,
        score: fallbackScore,
        xpAwarded: SESSION_XP_REWARD,
        transcriptExcerpt: transcriptText.slice(0, 1000),
        transcriptText,
        stats: {
          realtime_scores: lastResponse?.scores || {},
          correctionsCount: lastResponse?.corrections?.length || 0,
          suggestionsCount: lastResponse?.suggestions?.length || 0,
          wordBankSize: wordBank.size,
        },
        strengths: [],
        improvements: [],
        reportQuote: lastResponse?.smart_tip || DEFAULT_REPORT_QUOTE,
      });

      setXp(result.xp);
      setStreak(result.streak);
      setActiveSessionId(result.sessionId);
      setAssessment(normalizeAssessment(result.assessment));
      setTranscriptFilePath('');
      setIsEvaluatingSession(result.status !== 'completed');
      setSessionReport({
        score: averageScore(result.assessment?.scores) || fallbackScore,
        strengths: result.assessment?.strengths || [],
        improvements: result.assessment?.improvements || [],
        reportQuote: result.assessmentSummary || DEFAULT_REPORT_QUOTE,
      });
      setIsReportModalOpen(true);
      const trends = await fetchSessionTrends(clientIdRef.current);
      setSessionTrends(trends);
      const bootstrap = await fetchBootstrap(clientIdRef.current);
      setPracticeCount(bootstrap.practiceCount);
      setPracticeLimit(bootstrap.practiceLimit);
      setCanPractice(bootstrap.canPractice);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6c63ff', '#ff6584', '#43e97b'],
      });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to save session summary.');
    } finally {
      sessionStartedAtRef.current = null;
      setSessionHint('');
      setSecondsRemaining(sessionMinutes * 60);
    }
  };

  useEffect(() => {
    if (!isEvaluatingSession || !activeSessionId) {
      return;
    }

    pollingRef.current = window.setInterval(() => {
      void fetchSessionStatus(clientIdRef.current, activeSessionId)
        .then((result) => {
          setXp(result.xp);
          setStreak(result.streak);
          setTranscriptFilePath(result.transcriptFilePath);
          if (result.status === 'completed' || result.status === 'failed') {
            setAssessment(normalizeAssessment(result.assessment as SessionAssessment));
            setSessionReport({
              score: averageScore((result.assessment as SessionAssessment | undefined)?.scores),
              strengths: ((result.assessment as SessionAssessment | undefined)?.strengths || []),
              improvements: ((result.assessment as SessionAssessment | undefined)?.improvements || []),
              reportQuote: result.assessmentSummary || DEFAULT_REPORT_QUOTE,
            });
            setIsEvaluatingSession(false);
            void fetchSessionTrends(clientIdRef.current).then(setSessionTrends).catch(() => undefined);
            if (pollingRef.current !== null) {
              window.clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        })
        .catch((error) => {
          setApiError(error instanceof Error ? error.message : 'Failed to fetch session status.');
          setIsEvaluatingSession(false);
          if (pollingRef.current !== null) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        });
    }, 2500);

    return () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeSessionId, isEvaluatingSession]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-card/70 p-6 sm:p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="text-2xl font-bold font-display">SpeakUp AI</div>
            <div className="mt-2 text-sm text-white/50">
              Sign in to access live practice and dashboard analytics.
            </div>
          </div>
          {apiError && (
            <div className="mb-4 rounded-2xl border border-error/20 bg-error/10 p-3 text-sm text-error">{apiError}</div>
          )}
          {authMode === 'signup' && (
            <input
              type="text"
              placeholder="Full name"
              value={authForm.fullName}
              onChange={(event) => setAuthForm({ ...authForm, fullName: event.target.value })}
              className="mb-3 w-full rounded-2xl border border-white/10 bg-white/5 p-3 focus:border-accent focus:outline-none"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={authForm.email}
            onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
            className="mb-3 w-full rounded-2xl border border-white/10 bg-white/5 p-3 focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={authForm.password}
            onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
            className="mb-3 w-full rounded-2xl border border-white/10 bg-white/5 p-3 focus:border-accent focus:outline-none"
          />
          {authMode === 'signup' && (
            <>
              <input
                type="password"
                placeholder="Confirm password"
                value={authForm.confirmPassword}
                onChange={(event) => setAuthForm({ ...authForm, confirmPassword: event.target.value })}
                className="mb-3 w-full rounded-2xl border border-white/10 bg-white/5 p-3 focus:border-accent focus:outline-none"
              />
            </>
          )}
          <button
            onClick={() => void handleAuthSubmit()}
            disabled={isAuthLoading}
            className="w-full rounded-2xl bg-accent py-3 font-semibold transition hover:bg-accent/80 disabled:opacity-50"
          >
            {isAuthLoading ? 'Please wait...' : authMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          <button
            onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}
            className="mt-3 w-full text-sm text-white/60 transition hover:text-white"
          >
            {authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create account'}
          </button>
        </div>
      </div>
    );
  }

  const sessionProgress = 100 - Math.round((secondsRemaining / (sessionMinutes * 60)) * 100);
  const dashboardScores = getDashboardScores(lastResponse?.scores, assessment.scores, sessionTrends.recentSessions);
  const coachingPriorities = buildCoachingPriorities(dashboardScores);
  const scoreHistory = buildScoreHistory(sessionTrends.recentSessions);
  const latestCompletedSession = getCompletedSessions(sessionTrends.recentSessions)[0] || null;
  const dashboardSummary = assessment.summary || latestCompletedSession?.summary || DEFAULT_REPORT_QUOTE;
  const dashboardStrengths = assessment.strengths.length
    ? assessment.strengths
    : latestCompletedSession?.strengths || [];
  const dashboardImprovements = assessment.improvements.length
    ? assessment.improvements
    : latestCompletedSession?.improvements || [];
  const scoreDeltaLabel =
    sessionTrends.latestScoreDelta > 0
      ? `+${sessionTrends.latestScoreDelta}`
      : `${sessionTrends.latestScoreDelta}`;

  return (
    <div className="min-h-screen w-full xl:grid xl:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)_minmax(20rem,24rem)]">
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm xl:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(86vw,22rem)] flex-col overflow-y-auto border-r border-white/5 bg-card/95 p-4 shadow-2xl transition-transform duration-300 sm:p-6 xl:static xl:z-auto xl:w-auto xl:translate-x-0 xl:border-b-0 xl:bg-card/50 xl:shadow-none',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex items-center gap-3 sm:mb-8 xl:mb-10">
          <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center shadow-lg shadow-accent/20">
            <Speaker className="text-white" size={24} />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold font-display tracking-tight">SpeakUp AI</h1>
            <div className="text-xs text-white/50">{authUser.fullName} · {authUser.role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Logout
          </button>
        </div>

        <div className="flex-1 space-y-5 xl:space-y-6 xl:overflow-y-auto xl:pr-2">
          {apiError && (
            <div className="bg-error/10 text-error border border-error/20 rounded-2xl p-3 text-xs">
              {apiError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-orange-400 mb-1">
                <Flame size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Streak</span>
              </div>
              <div className="text-2xl font-bold font-display">{streak.count}d</div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-accent mb-1">
                <Trophy size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">XP</span>
              </div>
              <div className="text-2xl font-bold font-display">{xp}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-white/70 mb-3">
              <Clock3 size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Session Length</span>
            </div>
            <div className="flex gap-2">
              {SESSION_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  onClick={() => setSessionMinutes(minutes)}
                  disabled={Boolean(sessionStartedAtRef.current)}
                  className={cn(
                    'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-all',
                    sessionMinutes === minutes
                      ? 'bg-accent text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10',
                    sessionStartedAtRef.current && 'opacity-60 cursor-not-allowed',
                  )}
                >
                  {minutes} min
                </button>
              ))}
            </div>
          </div>

          <div className="relative group">
            <button className="w-full bg-accent/10 hover:bg-accent/20 border border-accent/20 rounded-2xl p-4 flex items-center justify-between transition-all">
              <div className="flex flex-col items-start">
                <span className="text-[10px] uppercase tracking-widest text-accent font-bold">
                  Current Level
                </span>
                <span className="text-lg font-bold font-display">
                  {LEVELS.find((item) => item.id === level)?.name}
                </span>
              </div>
              <Settings size={18} className="text-accent/60" />
            </button>
            <div className="absolute top-full left-0 w-full mt-2 bg-card border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 overflow-hidden">
              {LEVELS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void persistLevel(item.id)}
                  disabled={isSavingProfile}
                  className={cn(
                    'w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition-colors',
                    level === item.id && 'text-accent bg-accent/5',
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                Practice Sections
              </span>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="p-1 hover:bg-white/5 rounded-md text-accent transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => {
                  setActiveSectionId(section.id);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group relative',
                  activeSectionId === section.id
                    ? 'bg-accent text-white shadow-lg shadow-accent/20'
                    : 'hover:bg-white/5 text-white/60',
                )}
              >
                <span className="text-xl">{section.emoji}</span>
                <span className="font-medium text-sm flex-1 text-left">{section.name}</span>
                {!section.isBuiltIn && (
                  <span className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/20 rounded transition-all">
                    <MoreVertical size={14} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <button
            onClick={() => void handleEndSession()}
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 font-bold transition-all hover:bg-white/10"
          >
            End Session
          </button>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-col">
        <header className="p-4 sm:p-6 lg:p-8">
          <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-white/8 via-white/4 to-transparent p-4 shadow-[0_24px_80px_rgba(8,8,25,0.45)] sm:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-3 sm:gap-4">
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/75 transition-colors hover:bg-white/10 xl:hidden"
                >
                  <Menu size={20} />
                </button>
                <span className="mt-1 text-4xl">{activeSection.emoji}</span>
                <div>
                  <h2 className="text-2xl font-bold font-display tracking-tight sm:text-3xl">{activeSection.name}</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-white/45 sm:text-base">
                    {activeSection.description}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                      Level {level}
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
                      {practiceCount} used
                      {practiceLimit === null ? ' · Unlimited' : ` / ${practiceLimit} total`}
                    </div>
                    <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent">
                      Avg score {sessionTrends.averageScore}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] xl:min-w-[26rem]">
                <div className="w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-4 sm:px-5">
                  <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-widest text-white/40">
                    <span>Session Clock</span>
                    <span>{formatDuration(secondsRemaining)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-accent via-success to-yellow-400 transition-all duration-700"
                      style={{ width: `${Math.max(4, sessionProgress)}%` }}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <span className="text-white/40">Target {sessionMinutes} min conversation</span>
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-widest',
                        isConnected
                          ? 'border-success/20 bg-success/10 text-success'
                          : 'border-error/20 bg-error/10 text-error',
                      )}
                    >
                      <div className={cn('h-2 w-2 rounded-full', isConnected ? 'bg-success animate-pulse' : 'bg-error')} />
                      {isConnected ? 'Live' : 'Offline'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
                  <button
                    onClick={toggleRecording}
                    disabled={!isConnected || isBootstrapLoading || !canPractice}
                    className={cn(
                      'flex min-h-16 items-center justify-center rounded-3xl border px-5 py-4 text-sm font-bold transition-all',
                      isRecording
                        ? 'border-error/30 bg-error text-white shadow-lg shadow-error/20'
                        : 'border-accent/20 bg-accent text-white shadow-lg shadow-accent/20',
                      (!isConnected || isBootstrapLoading || !canPractice) && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isRecording ? <Square size={20} /> : <Mic size={20} />}
                      <span>
                        {isRecording
                          ? 'End Turn'
                          : canPractice
                            ? 'Start Speaking'
                            : 'Practice Limit Reached'}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => void handleEndSession()}
                    className="flex min-h-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-bold transition-all hover:bg-white/10"
                  >
                    Finish & Save Session
                  </button>
                </div>
                {!canPractice && authUser.role !== 'admin' && (
                  <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-xs text-error">
                    Lifetime practice cap reached ({practiceCount}/{practiceLimit}). This account cannot start more live sessions.
                  </div>
                )}
                {sessionStartedAtRef.current && (
                  <div className="rounded-2xl border border-yellow-400/25 bg-yellow-400/10 px-4 py-3 text-xs text-yellow-200">
                    Session is active. Your interview is saved to DB only after you click <strong>Finish &amp; Save Session</strong>.
                  </div>
                )}
                {sessionHint && (
                  <div className="rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-xs text-accent">
                    {sessionHint}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-screen-lg flex-1 flex-col gap-5 p-4 sm:gap-6 sm:p-6 lg:gap-8 lg:p-8">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <section className="rounded-[28px] border border-white/10 bg-card/35 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Live Conversation</div>
                  <div className="mt-1 text-sm text-white/50">Keep the latest user and coach exchange in view while speaking.</div>
                </div>
                <div
                  className={cn(
                    'rounded-full border px-3 py-1 text-[11px] font-bold',
                    isAISpeaking
                      ? 'border-accent/20 bg-accent/10 text-accent'
                      : isRecording
                        ? 'border-error/20 bg-error/10 text-error'
                        : 'border-white/10 bg-white/5 text-white/45',
                  )}
                >
                  {isAISpeaking ? 'Coach speaking' : isRecording ? 'Listening' : 'Idle'}
                </div>
              </div>

              <div className="mb-4 rounded-3xl border border-white/6 bg-black/10 px-3 py-4 sm:px-4">
                <WaveformVisualizer
                  isRecording={isRecording}
                  isAISpeaking={isAISpeaking}
                  isThinking={isThinking}
                  analyserRef={analyserRef}
                />
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">You said</div>
                  <AnimatePresence mode="wait">
                    {inputTranscript ? (
                      <motion.p
                        key={inputTranscript}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-sm leading-7 text-white/75"
                      >
                        {inputTranscript}
                      </motion.p>
                    ) : (
                      <p className="text-sm text-white/30">
                        {isConnected ? 'Your spoken transcript will appear here.' : 'Waiting for live connection.'}
                      </p>
                    )}
                  </AnimatePresence>
                </div>

                <div className="rounded-2xl border border-accent/15 bg-accent/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-accent/90">Coach reply</div>
                    <div className="relative">
                      {isRecording && <div className="absolute inset-0 -m-2 rounded-full bg-error/20 animate-pulse-ring" />}
                      <div
                        className={cn(
                          'relative z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-all',
                          isRecording ? 'bg-error text-white' : isAISpeaking ? 'bg-accent text-white' : 'bg-white/10 text-white/75',
                        )}
                      >
                        {isRecording ? <Square size={18} /> : isAISpeaking ? <Speaker size={18} /> : <Mic size={18} />}
                      </div>
                    </div>
                  </div>
                  <AnimatePresence mode="wait">
                    {outputTranscript ? (
                      <motion.p
                        key={outputTranscript}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-sm font-medium leading-7 text-white"
                      >
                        {outputTranscript}
                      </motion.p>
                    ) : (
                      <p className="text-sm text-white/35">
                        {isBootstrapLoading
                          ? 'Loading your tracked progress...'
                          : isConnected
                            ? 'Coach response will appear here during the session.'
                            : 'Connecting to Gemini Live...'}
                      </p>
                    )}
                  </AnimatePresence>
                </div>

                <div ref={transcriptEndRef} />
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-card/35 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Live Feedback</div>
                  <div className="mt-1 text-sm text-white/50">Corrections and suggestions stay visible without scrolling down the page.</div>
                </div>
                <Target size={16} className="text-accent" />
              </div>

              <div className="space-y-3">
                {lastResponse?.corrections?.length ? (
                  lastResponse.corrections.map((correction, index) => (
                    <div
                      key={`${correction.wrong}-${index}`}
                      className="flex gap-4 rounded-2xl border border-error/15 bg-error/5 p-4"
                    >
                      <AlertCircle className="shrink-0 text-error" size={18} />
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm text-error line-through">{correction.wrong}</span>
                          <ChevronRight size={14} className="text-white/20" />
                          <span className="text-sm font-bold text-success">{correction.right}</span>
                        </div>
                        <p className="text-xs leading-6 text-white/60">{correction.explanation}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4 text-sm text-white/35">
                    Corrections will appear here when the coach detects grammar or phrasing issues.
                  </div>
                )}

                {lastResponse?.suggestions?.length ? (
                  lastResponse.suggestions.map((suggestion, index) => (
                    <div
                      key={`${suggestion.phrase}-${index}`}
                      className="flex gap-4 rounded-2xl border border-accent/15 bg-accent/5 p-4"
                    >
                      <Sparkles className="shrink-0 text-accent" size={18} />
                      <div>
                        <p className="mb-1 text-sm font-bold text-accent">{suggestion.phrase}</p>
                        <p className="text-xs italic leading-6 text-white/60">"{suggestion.example}"</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4 text-sm text-white/35">
                    Phrase upgrades and better alternatives will appear here during the session.
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-medium transition-all hover:bg-white/10">
                  <RotateCcw size={14} /> Say Again
                </button>
                <button className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-medium transition-all hover:bg-white/10">
                  <HelpCircle size={14} /> I don&apos;t understand
                </button>
                <button className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-medium transition-all hover:bg-white/10">
                  <Lightbulb size={14} /> Give me a topic
                </button>
                <button className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-medium transition-all hover:bg-white/10">
                  <Languages size={14} /> Translate
                </button>
              </div>
            </section>
          </div>

          {lastResponse?.smart_tip && (
            <div className="rounded-2xl border border-accent/20 bg-accent/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-accent">
                <WandSparkles size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Human-style Tip</span>
              </div>
              <p className="text-sm leading-relaxed text-white/80">{lastResponse.smart_tip}</p>
            </div>
          )}
        </div>
      </main>

      <aside className="border-t border-white/5 bg-card/50 p-4 sm:p-6 lg:p-8 xl:sticky xl:top-0 xl:h-screen xl:border-l xl:border-t-0 xl:overflow-y-auto">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Coaching Console</h3>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/45">
            {latestCompletedSession ? 'Live + history' : 'History pending'}
          </div>
        </div>

        <div className="mb-6 rounded-[28px] border border-white/10 bg-gradient-to-br from-white/8 to-white/3 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">Performance Snapshot</div>
              <div className="mt-1 text-sm text-white/55">
                {latestCompletedSession ? 'Latest completed session insights' : 'Complete one session to unlock tracked insights'}
              </div>
            </div>
            <div className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-bold text-accent">
              Avg {sessionTrends.averageScore}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <ScoreRing label="Grammar" score={dashboardScores.grammar} />
            <ScoreRing label="Fluency" score={dashboardScores.fluency} />
            <ScoreRing label="Pronun." score={dashboardScores.pronunciation} />
            <ScoreRing label="Vocab" score={dashboardScores.vocabulary} />
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-8">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Progress Overview</span>
            <span className="text-xs text-white/40">{sessionTrends.sessionsCompleted} sessions</span>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/8 bg-black/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-white/35 mb-1">Average</div>
              <div className="text-xl font-bold">{sessionTrends.averageScore}</div>
            </div>
            <div className="rounded-xl border border-white/8 bg-black/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-white/35 mb-1">Last Delta</div>
              <div className={cn('text-xl font-bold', sessionTrends.latestScoreDelta >= 0 ? 'text-success' : 'text-error')}>
                {scoreDeltaLabel}
              </div>
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-white/45">Strongest area</span>
              <span className="text-white/85">{formatAreaLabel(sessionTrends.strongestArea)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/45">Focus area</span>
              <span className="text-white/85">{formatAreaLabel(sessionTrends.focusArea)}</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-white/35">
              <span>Recent Score Trend</span>
              <span>{scoreHistory.length ? 'Last 6 sessions' : 'Waiting for data'}</span>
            </div>
            <div className="flex items-end gap-2 rounded-2xl border border-white/6 bg-black/10 p-3 h-28">
              {scoreHistory.length ? (
                scoreHistory.map((point) => (
                  <div key={point.sessionId} className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="text-[10px] text-white/35">{point.score}</div>
                    <div
                      className={cn(
                        'w-full rounded-t-full bg-gradient-to-t',
                        point.score >= 75
                          ? 'from-success/70 to-success'
                          : point.score >= 55
                            ? 'from-yellow-500/70 to-yellow-400'
                            : 'from-error/70 to-error',
                      )}
                      style={{ height: `${Math.max(14, point.score)}%` }}
                    />
                    <div className="text-[10px] text-white/30">{point.label}</div>
                  </div>
                ))
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-white/30">
                  Finish sessions to see score movement over time.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-8">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
              Improvement Priorities
            </span>
            <Target size={14} className="text-accent" />
          </div>
          <div className="space-y-4">
            {coachingPriorities.map((item) => (
              <div key={item.key}>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-white/80">{item.label}</span>
                  <span className="text-white/40">{item.score}</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      item.score >= 80 ? 'bg-success' : item.score >= 60 ? 'bg-yellow-400' : 'bg-error',
                    )}
                    style={{ width: `${Math.max(6, item.score)}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/40">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Coach Summary</span>
            <Sparkles size={14} className="text-accent" />
          </div>
          <p className="text-sm leading-relaxed text-white/78">{dashboardSummary}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-success/15 bg-success/5 p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-success">What Is Working</div>
              <div className="space-y-2">
                {dashboardStrengths.length ? (
                  dashboardStrengths.slice(0, 3).map((item) => (
                    <div key={item} className="text-xs text-white/75">
                      {item}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/35">Strengths will appear after the first completed assessment.</div>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-error/15 bg-error/5 p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-error">Improve Next</div>
              <div className="space-y-2">
                {dashboardImprovements.length ? (
                  dashboardImprovements.slice(0, 3).map((item) => (
                    <div key={item} className="text-xs text-white/75">
                      {item}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/35">Improvement targets will appear after the first completed assessment.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-success/5 border border-success/10 rounded-2xl p-4 mb-8">
          <div className="flex items-center gap-2 text-success mb-3">
            <CheckCircle2 size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Assessment Notes</span>
          </div>
          <div className="space-y-3">
            {assessment.coach_notes.length ? (
              assessment.coach_notes.map((note) => (
                <div key={note} className="text-sm text-white/75 border-l-2 border-success pl-3">
                  {note}
                </div>
              ))
            ) : (
              <div className="text-xs text-white/30">Finish a session to generate post-session analysis.</div>
            )}
          </div>
        </div>

        <div className="mb-8">
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-4">Word Bank</span>
          <div className="flex flex-wrap gap-2">
            {Array.from(wordBank).map((word) => (
              <span
                key={word}
                className="px-3 py-1 bg-success/10 text-success border border-success/20 rounded-full text-xs font-medium"
              >
                {word}
              </span>
            ))}
            {wordBank.size === 0 && (
              <span className="text-white/20 text-xs italic">Start speaking to collect words...</span>
            )}
          </div>
        </div>

        <div>
          <button
            onClick={() => setIsMistakeLogOpen(!isMistakeLogOpen)}
            className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4"
          >
            Mistake Log ({mistakeLog.length})
            <ChevronRight size={14} className={cn('transition-transform', isMistakeLogOpen && 'rotate-90')} />
          </button>
          <AnimatePresence>
            {isMistakeLogOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {mistakeLog.map((mistake, index) => (
                  <div key={`${mistake.wrong}-${index}`} className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="text-error line-through text-[10px] mb-1">{mistake.wrong}</div>
                    <div className="text-success font-bold text-xs">{mistake.right}</div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-8">
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4">Recent Reviews</div>
          <div className="space-y-3">
            {sessionTrends.recentSessions.slice(0, 4).map((session) => (
              <button
                key={session.sessionId}
                onClick={() => setSelectedHistory(session)}
                className="w-full text-left rounded-2xl border border-white/8 bg-white/5 p-4 hover:bg-white/8 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{session.sectionName}</span>
                  <span className="text-sm text-accent font-bold">{session.score}</span>
                </div>
                <div className="text-[11px] text-white/45 mb-2">{new Date(session.completedAt).toLocaleString()}</div>
                <div className="text-xs text-white/65 line-clamp-2">{session.summary || 'Assessment in progress.'}</div>
              </button>
            ))}
            {sessionTrends.recentSessions.length === 0 && (
              <div className="text-xs text-white/30">Complete sessions to build a progress history.</div>
            )}
          </div>
        </div>
      </aside>

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add Custom Section">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider block mb-2">Section Name</label>
            <input
              type="text"
              value={newSection.name}
              onChange={(event) => setNewSection({ ...newSection, name: event.target.value })}
              placeholder="e.g. Travel Planning"
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider block mb-2">Emoji</label>
            <input
              type="text"
              value={newSection.emoji}
              onChange={(event) => setNewSection({ ...newSection, emoji: event.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider block mb-2">Description</label>
            <textarea
              value={newSection.description}
              onChange={(event) => setNewSection({ ...newSection, description: event.target.value })}
              placeholder="Describe what you want to practice..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-accent transition-colors h-32 resize-none"
            />
          </div>
          <button
            onClick={() => void handleAddSection()}
            className="w-full py-4 bg-accent hover:bg-accent/80 rounded-2xl font-bold transition-all mt-4"
          >
            Create Section
          </button>
        </div>
      </Modal>

      <Modal isOpen={isReportModalOpen} onClose={() => setIsReportModalOpen(false)} title="Session Summary">
        <div className="space-y-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-32 h-32 rounded-full border-4 border-accent flex items-center justify-center mb-4">
              <span className="text-4xl font-bold font-display">{sessionReport.score}</span>
            </div>
            <h3 className="text-xl font-bold font-display mb-2">
              {isEvaluatingSession ? 'Evaluation Running' : 'Assessment Complete'}
            </h3>
            <p className="text-white/60 text-sm italic serif">"{sessionReport.reportQuote}"</p>
          </div>

          {isEvaluatingSession && (
            <div className="bg-accent/10 border border-accent/20 rounded-2xl p-4 text-sm text-white/80">
              The conversation has stopped. Transcript saving and evaluation are running in the background.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="bg-success/10 border border-success/20 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-success mb-2">
                <CheckCircle2 size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Strengths</span>
              </div>
              <ul className="text-xs space-y-2 text-white/80">
                {sessionReport.strengths.length ? (
                  sessionReport.strengths.map((item) => <li key={item}>- {item}</li>)
                ) : (
                  <li>- Consistent speaking effort across the session</li>
                )}
              </ul>
            </div>
            <div className="bg-error/10 border border-error/20 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-error mb-2">
                <AlertCircle size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Improvements</span>
              </div>
              <ul className="text-xs space-y-2 text-white/80">
                {sessionReport.improvements.length ? (
                  sessionReport.improvements.map((item) => <li key={item}>- {item}</li>)
                ) : (
                  <li>- Keep extending answers with more detail</li>
                )}
              </ul>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3">Coach Notes</div>
            <div className="space-y-2">
              {isEvaluatingSession ? (
                <div className="text-sm text-white/40">Waiting for Gemini assessment to finish...</div>
              ) : assessment.coach_notes.length ? (
                assessment.coach_notes.map((note) => (
                  <div key={note} className="text-sm text-white/75">
                    {note}
                  </div>
                ))
              ) : (
                <div className="text-sm text-white/40">No additional notes were generated.</div>
              )}
            </div>
          </div>

          {!isEvaluatingSession && assessment.better_response && (
            <div className="bg-accent/10 border border-accent/20 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-accent font-bold mb-3">Better Version</div>
              <div className="text-sm text-white/85 leading-relaxed">{assessment.better_response}</div>
            </div>
          )}

          {!isEvaluatingSession && Boolean(assessment.mistake_patterns?.length) && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3">
                Recurring Patterns
              </div>
              <div className="space-y-3">
                {assessment.mistake_patterns?.map((item, index) => (
                  <div key={`${item.pattern}-${index}`} className="rounded-xl border border-white/8 bg-black/10 p-3">
                    <div className="text-sm font-semibold text-white mb-1">{item.pattern}</div>
                    <div className="text-xs text-white/55 mb-1">{item.impact}</div>
                    <div className="text-xs text-success">{item.fix}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isEvaluatingSession && Boolean(assessment.next_session_plan?.length) && (
            <div className="bg-success/5 border border-success/15 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-success font-bold mb-3">Next Session Plan</div>
              <div className="space-y-2">
                {assessment.next_session_plan?.map((item, index) => (
                  <div key={`${item}-${index}`} className="text-sm text-white/80">
                    {index + 1}. {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {transcriptFilePath && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3">Transcript File</div>
              <div className="text-sm text-white/75 break-all">{transcriptFilePath}</div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(selectedHistory)}
        onClose={() => setSelectedHistory(null)}
        title={selectedHistory ? `${selectedHistory.sectionName} Review` : 'Session Review'}
      >
        {selectedHistory && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Score</div>
                <div className="text-2xl font-bold">{selectedHistory.score}</div>
              </div>
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Completed</div>
                <div className="text-sm text-white/75">{new Date(selectedHistory.completedAt).toLocaleString()}</div>
              </div>
            </div>

            <div className="rounded-2xl bg-accent/10 border border-accent/20 p-4">
              <div className="text-[10px] uppercase tracking-widest text-accent mb-2">Evaluator Summary</div>
              <div className="text-sm text-white/85 leading-relaxed">{selectedHistory.summary}</div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-success/10 border border-success/20 p-4">
                <div className="text-[10px] uppercase tracking-widest text-success mb-2">Strengths</div>
                <div className="space-y-2">
                  {selectedHistory.strengths.map((item, index) => (
                    <div key={`${item}-${index}`} className="text-sm text-white/80">{item}</div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-error/10 border border-error/20 p-4">
                <div className="text-[10px] uppercase tracking-widest text-error mb-2">Improve Next</div>
                <div className="space-y-2">
                  {selectedHistory.improvements.map((item, index) => (
                    <div key={`${item}-${index}`} className="text-sm text-white/80">{item}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-3">Dimension Scores</div>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="flex items-center justify-between"><span>Grammar</span><span>{selectedHistory.scores.grammar ?? 0}</span></div>
                <div className="flex items-center justify-between"><span>Fluency</span><span>{selectedHistory.scores.fluency ?? 0}</span></div>
                <div className="flex items-center justify-between"><span>Pronunciation</span><span>{selectedHistory.scores.pronunciation ?? 0}</span></div>
                <div className="flex items-center justify-between"><span>Vocabulary</span><span>{selectedHistory.scores.vocabulary ?? 0}</span></div>
              </div>
            </div>

            {selectedHistory.transcriptFilePath && (
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Transcript File</div>
                <div className="text-sm text-white/70 break-all">{selectedHistory.transcriptFilePath}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
