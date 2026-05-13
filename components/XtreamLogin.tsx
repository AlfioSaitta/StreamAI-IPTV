import React, { useRef, useState, useActionState } from 'react';
import { XtreamCredentials } from '../types.ts';
import { Server, User, Key, AlertCircle, X } from 'lucide-react';
import { Button, Card, FormField, IconButton, Input } from './shared';
import { useFocusTrap } from '../hooks/useTvFocus.ts';

interface XtreamLoginProps {
  onLogin: (creds: XtreamCredentials) => Promise<void>;
  onClose: () => void;
}

interface LoginFormState {
  error: string | null;
  // Echoes the last submitted values so a failed submit keeps the form
  // filled (React 19 form actions implicitly reset uncontrolled inputs
  // unless we feed them `defaultValue`).
  url: string;
  username: string;
  password: string;
}

const INITIAL_STATE: LoginFormState = { error: null, url: '', username: '', password: '' };

const XtreamLogin: React.FC<XtreamLoginProps> = ({ onLogin, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const getFriendlyError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err || '');

    if (/auth|credential|401|403/i.test(message)) {
      return 'Credenziali errate, scadute o account non autorizzato. Controlla username, password e stato abbonamento.';
    }
    if (/404/i.test(message)) {
      return 'Server Xtream raggiunto, ma endpoint non trovato. Verifica URL e porta del provider.';
    }
    if (/failed to fetch|network|timeout|econnrefused|enotfound/i.test(message)) {
      return 'Server Xtream non raggiungibile. Verifica URL, connessione Internet, VPN/firewall e che il provider sia online.';
    }

    return message || 'Connessione non riuscita. Verifica i dati del server Xtream.';
  };

  // React 19 form action (B.5): the submit handler is wrapped in an
  // implicit transition; `isPending` is automatic and the form state
  // (error + echoed inputs) is managed by React itself.
  const [state, formAction, isPending] = useActionState<LoginFormState, FormData>(
    async (_prev, formData) => {
      const url = String(formData.get('url') ?? '').trim();
      const username = String(formData.get('username') ?? '').trim();
      const password = String(formData.get('password') ?? '').trim();

      if (!url || !username || !password) {
        return { error: 'Compila URL, username e password.', url, username, password };
      }
      try {
        await onLogin({ url, username, password });
        onClose();
        return { error: null, url: '', username: '', password: '' };
      } catch (err) {
        return { error: getFriendlyError(err), url, username, password };
      }
    },
    INITIAL_STATE,
  );

  // FocusTrap still wired to the modal; Esc is suppressed while a submit
  // is in-flight so the user doesn't accidentally cancel a pending request.
  useFocusTrap(true, modalRef, {
    onEscape: () => !isPending && onClose(),
    initialSelector: '[data-initial-focus="true"]',
  });

  // Per-field local state only for controlled UX (placeholder fade etc.).
  // The actual submitted values come from `FormData` inside the action.
  const [urlInput, setUrlInput] = useState(state.url);
  const [usernameInput, setUsernameInput] = useState(state.username);
  const [passwordInput, setPasswordInput] = useState(state.password);

  // Keep inputs in sync with the action state echo (on validation failure).
  // Only mirror non-empty strings so we don't blank out the form mid-typing.
  React.useEffect(() => {
    if (state.url && state.url !== urlInput) setUrlInput(state.url);
    if (state.username && state.username !== usernameInput) setUsernameInput(state.username);
    if (state.password && state.password !== passwordInput) setPasswordInput(state.password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const fields = [
    {
      icon: Server,
      val: urlInput,
      set: setUrlInput,
      name: 'url',
      pl: 'http://host:port',
      type: 'url',
      label: 'Host URL',
      autoComplete: 'url',
    },
    {
      icon: User,
      val: usernameInput,
      set: setUsernameInput,
      name: 'username',
      pl: 'Username',
      type: 'text',
      label: 'Username',
      autoComplete: 'username',
    },
    {
      icon: Key,
      val: passwordInput,
      set: setPasswordInput,
      name: 'password',
      pl: 'Password',
      type: 'password',
      label: 'Password',
      autoComplete: 'current-password',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay-hard backdrop-blur-md p-6 animate-fade-in safe-area-screen">
      <div
        ref={modalRef}
        className="relative w-full max-w-md p-8 rounded-modal bg-surface-1 backdrop-blur-xl border border-DEFAULT shadow-elev-3 animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label="Connessione server Xtream"
      >
        <div className="absolute top-5 right-5">
          <IconButton
            icon={X}
            aria-label="Chiudi login server"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          />
        </div>

        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-card bg-brand-primary mb-4 shadow-elev-2">
            <Server className="w-icon-xl h-icon-xl text-white" aria-hidden="true" />
          </div>
          <h2 className="text-3xl font-bold text-content-primary tracking-tight">Connect Server</h2>
          <p className="text-content-muted text-sm mt-2">Xtream Codes API</p>
        </div>

        <form action={formAction} className="space-y-5">
          {fields.map((f, i) => (
            <FormField key={f.name} label={f.label} htmlFor={`xtream-${f.name}`}>
              <Input
                id={`xtream-${f.name}`}
                name={f.name}
                type={f.type}
                placeholder={f.pl}
                disabled={isPending}
                value={f.val}
                onChange={(e) => f.set(e.target.value)}
                leftIcon={f.icon}
                autoComplete={f.autoComplete}
                data-initial-focus={i === 0 ? 'true' : undefined}
              />
            </FormField>
          ))}

          {state.error && (
            <Card
              elevation="flat"
              padding="sm"
              className="!border-state-error/30 !bg-state-error/10"
              role="alert"
            >
              <div className="flex items-start gap-3 text-state-error">
                <AlertCircle className="w-icon-md h-icon-md shrink-0 mt-0.5" aria-hidden="true" />
                <span className="text-sm">{state.error}</span>
              </div>
            </Card>
          )}

          <Button
            type="submit"
            disabled={isPending}
            loading={isPending}
            variant="primary"
            size="lg"
            fullWidth
            aria-busy={isPending}
            className="mt-4"
          >
            {isPending ? 'Connessione…' : 'Connect'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default XtreamLogin;

