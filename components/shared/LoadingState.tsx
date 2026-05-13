import React from 'react';
import Spinner from './Spinner';

interface LoadingStateProps {
  message: string;
  variant?: 'movie' | 'series';
}

const LoadingState: React.FC<LoadingStateProps> = ({ message, variant = 'movie' }) => {
  const isMovie = variant === 'movie';

  const containerClasses = isMovie
    ? 'fixed inset-0 bg-surface-overlay-hard backdrop-blur-md z-[90] flex flex-col items-center justify-center text-content-primary safe-area-screen'
    : 'fixed inset-0 bg-surface-0 z-50 flex flex-col items-center justify-center text-content-primary safe-area-screen';

  const messageClasses = isMovie
    ? 'mt-4 text-lg text-content-secondary'
    : 'mt-6 text-2xl text-content-muted';

  return (
    <div className={containerClasses} role="status" aria-live="polite">
      <Spinner size={isMovie ? 'lg' : 'xl'} tone="brand" />
      <p className={messageClasses}>{message}</p>
    </div>
  );
};

export default LoadingState;
