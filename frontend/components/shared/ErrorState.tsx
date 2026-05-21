import React from 'react';
import Button from './Button';

interface ErrorStateProps {
  message: string;
  buttonText: string;
  onButtonClick: () => void;
  variant?: 'movie' | 'series';
}

const ErrorState: React.FC<ErrorStateProps> = ({ message, buttonText, onButtonClick, variant = 'movie' }) => {
  const isMovie = variant === 'movie';

  const containerClasses = isMovie
    ? 'fixed inset-0 bg-surface-overlay-hard backdrop-blur-md z-[90] flex flex-col items-center justify-center text-content-primary px-8 text-center safe-area-screen'
    : 'fixed inset-0 bg-surface-0 z-50 flex flex-col items-center justify-center text-content-primary safe-area-screen';

  const messageClasses = isMovie
    ? 'text-2xl text-state-error mb-6'
    : 'text-3xl text-state-error mb-8';

  return (
    <div className={containerClasses} role="alert">
      <p className={messageClasses}>{message}</p>
      <Button
        onClick={onButtonClick}
        variant={isMovie ? 'secondary' : 'primary'}
        size="lg"
        autoFocus
        data-initial-focus="true"
      >
        {buttonText}
      </Button>
    </div>
  );
};

export default ErrorState;
