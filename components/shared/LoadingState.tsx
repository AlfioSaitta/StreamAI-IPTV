import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message: string;
  variant?: 'movie' | 'series';
}

const LoadingState: React.FC<LoadingStateProps> = ({ message, variant = 'movie' }) => {
  const isMovie = variant === 'movie';
  
  return (
    <div className={`fixed inset-0 ${isMovie ? 'bg-black/80 backdrop-blur-md z-[90]' : 'bg-[#141414] z-50'} flex flex-col items-center justify-center text-white`}>
      <Loader2 className={`${isMovie ? 'w-14 h-14 text-red-500' : 'w-16 h-16 text-red-600'} animate-spin mb-${isMovie ? '4' : '6'}`} />
      <p className={`${isMovie ? 'text-lg text-gray-300' : 'text-2xl text-gray-400'}`}>{message}</p>
    </div>
  );
};

export default LoadingState;
