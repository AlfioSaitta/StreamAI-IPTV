import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  '.tv-focus:not([disabled]):not([aria-hidden="true"])',
  'button:not([disabled]):not([aria-hidden="true"])',
  'a[href]:not([aria-hidden="true"])',
  'input:not([disabled]):not([aria-hidden="true"])',
  'select:not([disabled]):not([aria-hidden="true"])',
  'textarea:not([disabled]):not([aria-hidden="true"])',
  '[tabindex]:not([tabindex="-1"]):not([disabled]):not([aria-hidden="true"])',
].join(',');

export const isElementVisible = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
};

export const getFocusableElements = (root: Document | HTMLElement = document): HTMLElement[] => {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled'))
    .filter(isElementVisible);
};

export const focusFirstTvElement = (
  root: Document | HTMLElement = document,
  preferredSelector = '[data-initial-focus="true"], .tv-focus'
): boolean => {
  const preferred = Array.from(root.querySelectorAll<HTMLElement>(preferredSelector)).filter(isElementVisible);
  const target = preferred[0] || getFocusableElements(root)[0];

  if (!target) return false;

  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  return true;
};

export const moveTvFocus = (root: Document | HTMLElement, key: string): boolean => {
  const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (!navKeys.includes(key)) return false;

  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!current) return false;

  if (root instanceof HTMLElement && !root.contains(current)) return false;

  const tagName = current.tagName.toLowerCase();
  if ((tagName === 'input' || tagName === 'textarea' || tagName === 'select') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    return false;
  }

  const focusableElements = getFocusableElements(root).filter((element) => element !== current);
  if (focusableElements.length === 0) return false;

  const currentRect = current.getBoundingClientRect();
  const currentX = currentRect.left + currentRect.width / 2;
  const currentY = currentRect.top + currentRect.height / 2;
  let bestCandidate: HTMLElement | null = null;
  let bestScore = Infinity;

  focusableElements.forEach((candidate) => {
    const rect = candidate.getBoundingClientRect();
    const candidateX = rect.left + rect.width / 2;
    const candidateY = rect.top + rect.height / 2;
    const dx = candidateX - currentX;
    const dy = candidateY - currentY;

    let directionPenalty = Infinity;
    switch (key) {
      case 'ArrowRight':
        if (dx > 8) directionPenalty = Math.abs(dy) * 2 + dx;
        break;
      case 'ArrowLeft':
        if (dx < -8) directionPenalty = Math.abs(dy) * 2 + Math.abs(dx);
        break;
      case 'ArrowDown':
        if (dy > 8) directionPenalty = Math.abs(dx) * 1.5 + dy;
        break;
      case 'ArrowUp':
        if (dy < -8) directionPenalty = Math.abs(dx) * 1.5 + Math.abs(dy);
        break;
    }

    if (directionPenalty < bestScore) {
      bestScore = directionPenalty;
      bestCandidate = candidate;
    }
  });

  const target = bestCandidate as HTMLElement | null;
  if (!target) return false;

  target.focus();
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  return true;
};

export const useTvSpatialNavigation = (isActive: boolean, rootRef?: RefObject<HTMLElement>) => {
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const root = rootRef?.current || document;
      if (moveTvFocus(root, event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, rootRef]);
};

export const useInitialTvFocus = (
  isActive: boolean,
  rootRef?: RefObject<HTMLElement>,
  preferredSelector?: string,
  delay = 80
) => {
  useEffect(() => {
    if (!isActive) return;

    const timeoutId = window.setTimeout(() => {
      focusFirstTvElement(rootRef?.current || document, preferredSelector);
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [isActive, rootRef, preferredSelector, delay]);
};

export const useEscapeKey = (isActive: boolean, onEscape: () => void) => {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive]);
};

export const useFocusTrap = (
  isActive: boolean,
  containerRef: RefObject<HTMLElement>,
  options: { onEscape?: () => void; initialSelector?: string; restoreFocus?: boolean } = {}
) => {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!isActive) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimeoutId = window.setTimeout(() => {
      if (containerRef.current) {
        focusFirstTvElement(containerRef.current, optionsRef.current.initialSelector);
      }
    }, 80);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!containerRef.current) return;

      if (event.key === 'Escape' && optionsRef.current.onEscape) {
        event.preventDefault();
        event.stopPropagation();
        optionsRef.current.onEscape();
        return;
      }

      if (moveTvFocus(containerRef.current, event.key)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(containerRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        containerRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimeoutId);
      document.removeEventListener('keydown', handleKeyDown, true);

      if (optionsRef.current.restoreFocus !== false && previouslyFocusedRef.current && isElementVisible(previouslyFocusedRef.current)) {
        window.setTimeout(() => previouslyFocusedRef.current?.focus({ preventScroll: true }), 0);
      }
    };
  }, [isActive, containerRef]);
};
