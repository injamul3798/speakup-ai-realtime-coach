import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';

interface WaveformVisualizerProps {
  isRecording: boolean;
  isAISpeaking: boolean;
  isThinking: boolean;
  analyserRef: React.RefObject<AnalyserNode | null>;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  isRecording,
  isAISpeaking,
  isThinking,
  analyserRef
}) => {
  const barsRef = useRef<HTMLDivElement[]>([]);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!isRecording || !analyserRef.current) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const update = () => {
      analyser.getByteFrequencyData(dataArray);
      
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const index = Math.floor((i / 12) * bufferLength);
        const value = dataArray[index];
        const height = Math.max(4, (value / 255) * 60);
        bar.style.height = `${height}px`;
      });

      animationRef.current = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(animationRef.current);
  }, [isRecording, analyserRef]);

  return (
    <div className="flex items-center justify-center gap-1.5 h-20">
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          ref={(el) => (barsRef.current[i] = el!)}
          className="w-1.5 bg-accent rounded-full"
          initial={{ height: 4 }}
          animate={
            isThinking 
              ? { height: [4, 20, 4], transition: { repeat: Infinity, duration: 1, delay: i * 0.1 } }
              : isAISpeaking
              ? { height: [4, 30, 4], transition: { repeat: Infinity, duration: 0.8, delay: i * 0.05 } }
              : !isRecording ? { height: 4 } : undefined
          }
        />
      ))}
    </div>
  );
};
