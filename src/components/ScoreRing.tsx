import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface ScoreRingProps {
  label: string;
  score: number;
  size?: number;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({ label, score, size = 80 }) => {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return 'stroke-success';
    if (s >= 50) return 'stroke-yellow-400';
    return 'stroke-error';
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="stroke-white/5 fill-none"
            strokeWidth="6"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className={cn("fill-none transition-colors duration-500", getColor(score))}
            strokeWidth="6"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold">{score}</span>
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium">{label}</span>
    </div>
  );
};
