import React from 'react';

interface ErrorStateProps {
  message: string;
  buttonText: string;
  onButtonClick: () => void;
  variant?: 'movie' | 'series';
}

const ErrorState: React.FC<ErrorStateProps> = ({ message, buttonText, onButtonClick, variant = 'movie' }) => {
  const isMovie = variant === 'movie';
  
  return (
    <div className={`fixed inset-0 ${isMovie ? 'bg-black/80 backdrop-blur-md z-[90]' : 'bg-[#141414] z-50'} flex flex-col items-center justify-center text-white ${isMovie ? 'px-8 text-center' : ''}`}>
      <p className={`${isMovie ? 'text-2xl' : 'text-3xl'} text-red-400 mb-${isMovie ? '6' : '8'}`}>{message}</p>
      <button 
        onClick={onButtonClick} 
        className={`tv-focus ${isMovie ? 'px-6 py-3 bg-white/10 rounded-lg hover:bg-white/20 border border-white/10' : 'text-xl bg-gray-800 px-8 py-4 rounded-lg'}`}
      >
        {buttonText}
      </button>
    </div>
  );
};

export default ErrorState;
