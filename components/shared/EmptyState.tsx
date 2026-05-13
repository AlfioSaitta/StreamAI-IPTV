import React from 'react';
import { LucideIcon } from 'lucide-react';
import Button, { ButtonVariant } from './Button';

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

const ACTION_VARIANT: Record<NonNullable<EmptyStateAction['variant']>, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
};

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actions = [],
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-20 text-content-secondary ${className}`}
    >
      <div className="w-24 h-24 rounded-full bg-surface-1 border border-DEFAULT flex items-center justify-center mb-6">
        <Icon className="w-12 h-12 text-content-disabled" aria-hidden="true" />
      </div>
      <h2 className="text-3xl md:text-4xl font-bold text-content-primary mb-3">{title}</h2>
      <p className="text-base md:text-lg text-content-muted max-w-2xl leading-relaxed mb-8">
        {description}
      </p>

      {actions.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {actions.map((action, index) => (
            <Button
              key={action.label}
              onClick={action.onClick}
              autoFocus={index === 0}
              data-initial-focus={index === 0 ? 'true' : undefined}
              variant={ACTION_VARIANT[action.variant ?? 'primary']}
              size="lg"
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
