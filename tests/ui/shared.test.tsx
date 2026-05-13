// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  Input,
  Modal,
  Spinner,
} from '../../components/shared';
import { Play, Search } from 'lucide-react';

/**
 * UI-1.5 — Smoke test sui componenti shared del Design System v1.
 * Niente jest-dom: usiamo solo expect "vanilla" su attributi DOM.
 */

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('renders label and triggers onClick', () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Play</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('renders disabled state and ignores clicks', () => {
    const fn = vi.fn();
    render(<Button disabled onClick={fn}>Disabled</Button>);
    const btn = screen.getByRole('button', { name: 'Disabled' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('disables interaction in loading state', () => {
    render(<Button loading leftIcon={Play}>Loading</Button>);
    const btn = screen.getByRole('button', { name: /Loading/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it.each(['primary', 'secondary', 'ghost', 'danger', 'accent'] as const)(
    'supports variant=%s',
    (variant) => {
      render(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button', { name: 'x' })).toBeTruthy();
    },
  );
});

describe('IconButton', () => {
  it('requires aria-label and renders it', () => {
    render(<IconButton icon={Play} aria-label="Play stream" />);
    expect(screen.getByRole('button', { name: 'Play stream' })).toBeTruthy();
  });
});

describe('Input', () => {
  it('renders placeholder and accepts typing', () => {
    render(<Input placeholder="Cerca" leftIcon={Search} />);
    const input = screen.getByPlaceholderText('Cerca') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hbo' } });
    expect(input.value).toBe('hbo');
  });

  it('marks aria-invalid when invalid', () => {
    render(<Input placeholder="x" invalid />);
    expect(screen.getByPlaceholderText('x').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('Chip', () => {
  it('toggles aria-pressed when selected', () => {
    const { rerender } = render(<Chip>All</Chip>);
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
    rerender(<Chip selected>All</Chip>);
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Badge', () => {
  it('renders the label and tone class', () => {
    const { container } = render(<Badge tone="success">HD</Badge>);
    expect(screen.getByText('HD')).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain('text-state-success');
  });
});

describe('Spinner', () => {
  it('exposes status role when label is provided', () => {
    render(<Spinner label="Loading…" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('omits status role without label', () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe('Card', () => {
  it('renders children inside the chosen tag', () => {
    render(
      <Card as="section" elevation="raised">
        <p>Content</p>
      </Card>,
    );
    expect(screen.getByText('Content').parentElement?.tagName).toBe('SECTION');
  });
});

describe('Modal', () => {
  it('shows when open and hides when closed', () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByText('Body')).toBeNull();
    rerender(
      <Modal open onClose={() => {}} title="Titolo">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Titolo')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const fn = vi.fn();
    render(
      <Modal open onClose={fn}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(fn).toHaveBeenCalledOnce();
  });
});

