import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message: string;
  variant?: 'movie' | 'series';
}

const LoadingState: React.FC<LoadingStateProps> = ({ message, variant = 'movie' }) => {
  const isMovie = variant === 'movie';
  
  const containerClasses = isMovie 
    ? 'fixed inset-0 bg-black/80 backdrop-blur-md z-[90] flex flex-col items-center justify-center text-white safe-area-screen'
    : 'fixed inset-0 bg-[var(--bg-primary)] z-50 flex flex-col items-center justify-center text-white safe-area-screen';

  const spinnerClasses = isMovie
    ? 'w-14 h-14 text-red-500 mb-4 animate-spin'
    : 'w-16 h-16 text-red-600 mb-6 animate-spin';
  
  const messageClasses = isMovie
    ? 'text-lg text-gray-300'
    : 'text-2xl text-gray-400';
  
  return (
    <div className={containerClasses}>
      <Loader2 className={spinnerClasses} />
      <p className={messageClasses}>{message}</p>
    </div>
  );
};

export default LoadingState;
