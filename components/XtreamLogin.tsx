import React, { useRef, useState, useActionState } from 'react';
import { XtreamCredentials } from '../types.ts';
import { Server, User, Key, AlertCircle, X } from 'lucide-react';
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
    INITIAL_STATE
  );

  // FocusTrap still wired to the modal; Esc is suppressed while a submit
  // is in-flight so the user doesn't accidentally cancel a pending request.
  useFocusTrap(true, modalRef, { onEscape: () => !isPending && onClose(), initialSelector: '[data-initial-focus="true"]' });

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
    { icon: Server, val: urlInput, set: setUrlInput, name: 'url', pl: 'http://host:port', type: 'url', label: 'Host URL' },
    { icon: User, val: usernameInput, set: setUsernameInput, name: 'username', pl: 'Username', type: 'text', label: 'Username' },
    { icon: Key, val: passwordInput, set: setPasswordInput, name: 'password', pl: 'Password', type: 'password', label: 'Password' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6 animate-fade-in safe-area-screen">
      <div ref={modalRef} className="bg-gray-900/80 backdrop-blur-xl border border-white/10 w-full max-w-md p-8 rounded-3xl shadow-[0_0_100px_rgba(100,0,255,0.1)] relative animate-slide-up" role="dialog" aria-modal="true" aria-label="Connessione server Xtream">
        <button onClick={onClose} disabled={isPending} className="tv-focus touch-target absolute top-6 right-6 text-gray-500 hover:text-white transition-colors rounded-full disabled:opacity-50" aria-label="Chiudi login server">
            <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 mb-4 shadow-lg">
                <Server className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Connect Server</h2>
            <p className="text-gray-400 text-sm mt-2">Xtream Codes API</p>
        </div>

        <form action={formAction} className="space-y-5">
            {fields.map((f, i) => (
                <div key={f.name} className="group">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5 ml-1 uppercase tracking-wider" htmlFor={`xtream-${f.name}`}>{f.label}</label>
                    <div className="relative">
                        <f.icon className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-purple-400 transition-colors" />
                        <input
                            id={`xtream-${f.name}`}
                            name={f.name}
                            type={f.type}
                            placeholder={f.pl}
                            disabled={isPending}
                            className="tv-focus w-full bg-black/50 text-white rounded-xl py-3 pl-12 pr-4 border border-white/10 focus:border-purple-500 focus:bg-black/80 focus:ring-1 focus:ring-purple-500 outline-none transition-all placeholder:text-gray-700 disabled:opacity-60"
                            value={f.val}
                            onChange={(e) => f.set(e.target.value)}
                            data-initial-focus={i === 0 ? 'true' : undefined}
                            autoComplete={f.name === 'password' ? 'current-password' : f.name === 'username' ? 'username' : 'url'}
                        />
                    </div>
                </div>
            ))}

            {state.error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl text-sm flex gap-3 items-center" role="alert">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{state.error}</span>
                </div>
            )}

            <button
                type="submit"
                disabled={isPending}
                className="tv-focus w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-900/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-4 text-lg"
                aria-busy={isPending}
            >
                {isPending ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Connect'}
            </button>
        </form>
      </div>
    </div>
  );
};

export default XtreamLogin;

