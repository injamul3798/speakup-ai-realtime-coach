import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Edit2 } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:p-4 lg:items-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative my-4 w-full max-w-3xl rounded-[28px] border border-accent/20 bg-card shadow-2xl max-h-[calc(100vh-2rem)] overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 sm:px-6">
              <h2 className="text-lg font-bold font-display sm:text-2xl">{title}</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 max-h-[calc(100vh-7rem)]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
