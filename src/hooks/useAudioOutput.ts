import { useRef, useCallback } from 'react';

export function useAudioOutput() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      nextStartTimeRef.current = audioContextRef.current.currentTime;
    }
  }, []);

  const playChunk = useCallback(async (base64Data: string) => {
    initAudio();
    const ctx = audioContextRef.current!;
    
    // Decode base64 to ArrayBuffer
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert PCM16 to Float32
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    return new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
  }, [initAudio]);

  const stopAll = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
      nextStartTimeRef.current = 0;
    }
  }, []);

  return { playChunk, stopAll };
}
