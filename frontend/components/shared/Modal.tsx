import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';

/**
 * StreamAI Design System — Modal + Sheet (UI-1.3.3)
 *
 * Sostituisce le 3+ implementazioni custom di dialog/sheet trovate nei
 * componenti (MovieDetail / XtreamLogin / AIRecommender / CommandPalette /
 * ProfileSettings color picker).
 *
 * Layout standard:
 * - Overlay scuro fullscreen (`surface-overlay-soft|hard`).
 * - Contenitore centrato con `rounded-modal`.
 * - Chiusura via Esc, click outside o pulsante X.
 *
 * Sheet = Modal con anchor in basso (mobile / control panels nel player).
 */

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalAnchor = 'center' | 'bottom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Etichetta accessibile quando `title` non è una stringa. */
  ariaLabel?: string;
  size?: ModalSize;
  anchor?: ModalAnchor;
  /** Nasconde il pulsante X di chiusura (es. flussi obbligatori). */
  hideCloseButton?: boolean;
  /** Chiude su click fuori dal pannello (default true). */
  closeOnBackdrop?: boolean;
  /** Chiude su Escape (default true). */
  closeOnEscape?: boolean;
  /** Backdrop "hard" più opaco — usare per modali fullscreen. */
  backdropVariant?: 'soft' | 'hard';
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[min(96vw,1200px)]',
};

const ANCHOR_CLASSES: Record<ModalAnchor, string> = {
  center: 'items-center justify-center',
  bottom: 'items-end justify-center sm:items-center',
};

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  size = 'md',
  anchor = 'center',
  hideCloseButton = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  backdropVariant = 'hard',
  footer,
  className = '',
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc-to-close (UI-1: shortcut standard).
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closeOnEscape, onClose]);

  // Focus iniziale al pannello per la navigazione tastiera/telecomando.
  useEffect(() => {
    if (open && panelRef.current) {
      const target =
        panelRef.current.querySelector<HTMLElement>('[data-initial-focus="true"]') ||
        panelRef.current.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
      target?.focus();
    }
  }, [open]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!closeOnBackdrop) return;
      if (e.target === e.currentTarget) onClose();
    },
    [closeOnBackdrop, onClose],
  );

  if (!open) return null;

  const labelledById = typeof title === 'string' ? 'modal-title' : undefined;
  const describedById = description ? 'modal-desc' : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={labelledById ? undefined : ariaLabel}
      aria-labelledby={labelledById}
      aria-describedby={describedById}
      onClick={onBackdropClick}
      className={[
        'fixed inset-0 z-50 flex p-4 sm:p-6',
        ANCHOR_CLASSES[anchor],
        backdropVariant === 'hard' ? 'bg-surface-overlay-hard' : 'bg-surface-overlay-soft',
        'backdrop-blur-md animate-fade-in',
      ].join(' ')}
    >
      <div
        ref={panelRef}
        className={[
          'relative w-full bg-surface-0 border border-DEFAULT rounded-modal shadow-elev-3',
          'flex flex-col max-h-[calc(100vh-2rem)]',
          SIZE_CLASSES[size],
          anchor === 'bottom' ? 'animate-slide-up' : 'animate-fade-in',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-subtle">
            <div className="min-w-0">
              {title && (
                <h2
                  id={labelledById}
                  className="text-lg sm:text-xl font-bold text-content-primary truncate"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p id={describedById} className="mt-1 text-sm text-content-muted">
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <IconButton
                icon={X}
                aria-label="Chiudi"
                variant="ghost"
                size="sm"
                onClick={onClose}
              />
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;

/**
 * Sheet — variante bottom-anchored di Modal, ottimizzata per i pannelli
 * del player (cast picker, subtitle settings, sleep timer).
 */
export const Sheet: React.FC<Omit<ModalProps, 'anchor'>> = (props) => (
  <Modal {...props} anchor="bottom" />
);

