import React from 'react';

interface ErrorStateProps {
  message: string;
  buttonText: string;
  onButtonClick: () => void;
  variant?: 'movie' | 'series';
}

const ErrorState: React.FC<ErrorStateProps> = ({ message, buttonText, onButtonClick, variant = 'movie' }) => {
  const isMovie = variant === 'movie';
  
  const containerClasses = isMovie
    ? 'fixed inset-0 bg-black/80 backdrop-blur-md z-[90] flex flex-col items-center justify-center text-white px-8 text-center'
    : 'fixed inset-0 bg-[#141414] z-50 flex flex-col items-center justify-center text-white';
  
  const messageClasses = isMovie
    ? 'text-2xl text-red-400 mb-6'
    : 'text-3xl text-red-400 mb-8';
  
  const buttonClasses = isMovie
    ? 'tv-focus px-6 py-3 bg-white/10 rounded-lg hover:bg-white/20 border border-white/10'
    : 'tv-focus text-xl bg-gray-800 px-8 py-4 rounded-lg';
  
  return (
    <div className={containerClasses}>
      <p className={messageClasses}>{message}</p>
      <button onClick={onButtonClick} className={buttonClasses}>
        {buttonText}
      </button>
    </div>
  );
};

export default ErrorState;
