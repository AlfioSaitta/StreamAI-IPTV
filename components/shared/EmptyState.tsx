import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: EmptyStateAction[];
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, actions = [], className = '' }) => {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 py-20 text-gray-300 ${className}`}>
      <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
        <Icon className="w-12 h-12 text-gray-500" />
      </div>
      <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">{title}</h2>
      <p className="text-base md:text-lg text-gray-400 max-w-2xl leading-relaxed mb-8">{description}</p>

      {actions.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {actions.map((action, index) => (
            <button
              key={action.label}
              onClick={action.onClick}
              autoFocus={index === 0}
              data-initial-focus={index === 0 ? 'true' : undefined}
              className={`tv-focus touch-target px-6 py-3 rounded-xl font-bold transition-colors ${
                action.variant === 'secondary'
                  ? 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                  : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-950/40'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
