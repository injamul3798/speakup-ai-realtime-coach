import { useState, useEffect, useRef, useCallback } from 'react';
import { EndSensitivity, GoogleGenAI, Modality, StartSensitivity } from "@google/genai";
import { getSystemPrompt } from '../constants';

function extractJsonBlock(raw: string) {
  const tagMatch = raw.match(/<JSON>([\s\S]*?)<\/JSON>/i);
  if (tagMatch) {
    return tagMatch[1].trim();
  }

  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return '';
}

function stripStructuredBlock(raw: string) {
  return raw
    .replace(/<JSON>[\s\S]*?<\/JSON>/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();
}

export function useGeminiLive(apiKey: string, level: string, sectionPrompt: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [inputTranscript, setInputTranscript] = useState('');
  const [outputTranscript, setOutputTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState<any>(null);
  
  const sessionRef = useRef<any>(null);
  const textAccumulatorRef = useRef('');
  const inputTranscriptRef = useRef('');
  const outputTranscriptRef = useRef('');
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);

  const connect = useCallback(async () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (sessionRef.current) await sessionRef.current.close();

    // Prioritize process.env.API_KEY (user-selected) over the default apiKey prop
    const activeKey = process.env.API_KEY || apiKey;
    const ai = new GoogleGenAI({ apiKey: activeKey });
    
    try {
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 20,
              silenceDurationMs: 150,
            },
          },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: getSystemPrompt(level, sectionPrompt),
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
          },
          onmessage: async (message: any) => {
            if (message.serverContent) {
              const { modelTurn, turnComplete, inputTranscription, outputTranscription, interrupted } = message.serverContent;

              if (interrupted) {
                window.dispatchEvent(new CustomEvent('gemini-interrupted'));
              }

              if (inputTranscription?.text) {
                inputTranscriptRef.current = inputTranscription.text.trim();
                setInputTranscript(inputTranscriptRef.current);
              }

              if (outputTranscription?.text) {
                outputTranscriptRef.current = outputTranscription.text.trim();
                setOutputTranscript(outputTranscriptRef.current);
              }

              if (modelTurn) {
                modelTurn.parts?.forEach((part: any) => {
                  if (part.inlineData) {
                    window.dispatchEvent(new CustomEvent('gemini-audio-chunk', { detail: part.inlineData.data }));
                  }
                  if (part.text) {
                    textAccumulatorRef.current += part.text;
                  }
                });
              }

              if (turnComplete) {
                setIsThinking(false);
                const fullText = textAccumulatorRef.current;
                const jsonBlock = extractJsonBlock(fullText);
                const spokenText = stripStructuredBlock(fullText);
                const heardText = inputTranscriptRef.current || inputTranscript;
                const replyText = outputTranscriptRef.current || outputTranscript || spokenText;

                if (jsonBlock) {
                  try {
                    const parsed = JSON.parse(jsonBlock);
                    const normalized = {
                      ...parsed,
                      heard: parsed.heard || heardText,
                      reply: parsed.reply || replyText,
                    };
                    if (normalized.heard) {
                      setInputTranscript(normalized.heard);
                    }
                    if (normalized.reply) {
                      setOutputTranscript(normalized.reply);
                    }
                    setLastResponse(normalized);
                    window.dispatchEvent(new CustomEvent('gemini-response-complete', { detail: normalized }));
                  } catch (e) {
                    console.error('Failed to parse JSON response', e);
                  }
                } else if (heardText || replyText) {
                  const fallback = {
                    heard: heardText,
                    reply: replyText,
                    corrections: [],
                    suggestions: [],
                    scores: {},
                    smart_tip: '',
                    follow_up: '',
                  };
                  setLastResponse(fallback);
                  window.dispatchEvent(new CustomEvent('gemini-response-complete', { detail: fallback }));
                }
                textAccumulatorRef.current = '';
                inputTranscriptRef.current = '';
                outputTranscriptRef.current = '';
              }
            }
          },
          onerror: (err: any) => {
            console.error('Gemini Live error:', err);
            setIsConnected(false);
            if (!shouldReconnectRef.current) {
              return;
            }
            reconnectTimerRef.current = window.setTimeout(() => {
              void connect();
            }, 1200);
          },
          onclose: () => {
            setIsConnected(false);
            if (!shouldReconnectRef.current) {
              return;
            }
            reconnectTimerRef.current = window.setTimeout(() => {
              void connect();
            }, 1200);
          }
        }
      });
      sessionRef.current = session;
    } catch (err) {
      console.error('Failed to connect to Gemini Live:', err);
    }
  }, [apiKey, level, sectionPrompt]);

  const sendAudioChunk = useCallback((base64: string) => {
    if (sessionRef.current) {
      sessionRef.current.sendRealtimeInput({
        media: { data: base64, mimeType: 'audio/pcm;rate=16000' }
      });
    }
  }, []);

  const endTurn = useCallback(() => {
    if (sessionRef.current) {
      // Explicitly end the current audio stream so the model can respond immediately.
      sessionRef.current.sendRealtimeInput({
        audioStreamEnd: true,
      });
      setIsThinking(true);
    }
  }, []);

  const sendText = useCallback((text: string) => {
    if (sessionRef.current) {
      sessionRef.current.sendRealtimeInput({
        text
      });
      setIsThinking(true);
    }
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (sessionRef.current) sessionRef.current.close();
    };
  }, [connect]);

  return {
    isConnected,
    isThinking,
    inputTranscript,
    outputTranscript,
    lastResponse,
    sendAudioChunk,
    endTurn,
    sendText,
    setInputTranscript
  };
}
