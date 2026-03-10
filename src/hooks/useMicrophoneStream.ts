import { useRef, useCallback, useState } from 'react';

export function useMicrophoneStream() {
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const startRecording = useCallback(async (onAudioChunk: (base64: string) => void) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // ScriptProcessor is deprecated but easiest for raw PCM access in this context
      // AudioWorklet would be better for production but requires separate file
      // 512 samples at 16kHz ~= 32ms chunks for lower turn latency.
      const processor = ctx.createScriptProcessor(512, 1, 1);
      processorRef.current = processor;

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Convert to Base64
        const buffer = pcm16.buffer;
        const binary = String.fromCharCode(...new Uint8Array(buffer));
        const base64 = btoa(binary);
        onAudioChunk(base64);
      };

      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsRecording(false);
  }, []);

  return { isRecording, startRecording, stopRecording, analyserRef };
}
