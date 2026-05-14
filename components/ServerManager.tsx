import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Server as ServerIcon,
  Plus,
  Edit3,
  Trash2,
  Check,
  AlertCircle,
  Cable,
  KeyRound,
  User as UserIcon,
} from 'lucide-react';
import type { Profile, XtreamCredentials, XtreamServer } from '../types.ts';
import { ProfileService } from '../services/profileService.ts';
import { Badge, Button, Card, FormField, IconButton, Input, Modal } from './shared';

/**
 * StreamAI — ServerManager (2026-05-14).
 *
 * Modale di gestione multi-server per profilo. Lista i server salvati e
 * permette di:
 *  - aggiungere un nuovo server (form inline);
 *  - modificarne uno esistente;
 *  - eliminare un server (chiede conferma);
 *  - marcare un server come attivo e connettersi.
 *
 * Sostituisce l'aper­tura diretta della `<XtreamLogin>` come "gestione
 * server" quando il profilo ha già almeno un server configurato. Quando
 * la lista è vuota il pannello si apre direttamente in modalità "aggiungi".
 */

interface ServerManagerProps {
  profile: Profile;
  open: boolean;
  onClose: () => void;
  /** Avvia la connessione al server scelto (set attivo + login). */
  onConnect: (creds: XtreamCredentials) => Promise<void>;
  /** Callback dopo qualunque modifica alla lista server, per sync UI. */
  onProfileChange?: (profile: Profile) => void;
}

type EditingState = { mode: 'add' } | { mode: 'edit'; serverId: string } | null;

const ServerManager: React.FC<ServerManagerProps> = ({
  profile,
  open,
  onClose,
  onConnect,
  onProfileChange,
}) => {
  const [servers, setServers] = useState<XtreamServer[]>(() =>
    ProfileService.getServers(profile.id),
  );
  const [activeId, setActiveId] = useState<string | null>(() =>
    ProfileService.getActiveServerId(profile.id),
  );
  const [editing, setEditing] = useState<EditingState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form fields (used by both add and edit).
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const formAnchorRef = useRef<HTMLDivElement>(null);

  // Apri direttamente in modalità "add" se non c'è nessun server.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (servers.length === 0 && !editing) setEditing({ mode: 'add' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing) return;
    if (editing.mode === 'edit') {
      const s = servers.find((x) => x.id === editing.serverId);
      if (s) {
        setName(s.name);
        setUrl(s.url);
        setUsername(s.username);
        setPassword(s.password);
      }
    } else {
      setName('');
      setUrl('');
      setUsername('');
      setPassword('');
    }
    // Scroll del form in vista per UX.
    requestAnimationFrame(() => formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [editing, servers]);

  const refresh = () => {
    setServers(ProfileService.getServers(profile.id));
    setActiveId(ProfileService.getActiveServerId(profile.id));
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = { name: name.trim(), url: url.trim(), username: username.trim(), password: password.trim() };
    if (!trimmed.url || !trimmed.username || !trimmed.password) {
      setError('Compila URL, username e password.');
      return;
    }
    if (editing?.mode === 'add') {
      const { profile: updated } = ProfileService.addServer(profile.id, trimmed);
      if (updated) onProfileChange?.(updated);
    } else if (editing?.mode === 'edit') {
      const updated = ProfileService.updateServer(profile.id, editing.serverId, trimmed);
      if (updated) onProfileChange?.(updated);
    }
    setEditing(null);
    refresh();
  };

  const handleConnect = async (server: XtreamServer) => {
    setError(null);
    setBusyId(server.id);
    try {
      const updated = ProfileService.setActiveServer(profile.id, server.id);
      if (updated) onProfileChange?.(updated);
      await onConnect({ url: server.url, username: server.username, password: server.password });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connessione non riuscita.');
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const handleDelete = (serverId: string) => {
    const updated = ProfileService.deleteServer(profile.id, serverId);
    if (updated) onProfileChange?.(updated);
    setConfirmDeleteId(null);
    setEditing((cur) => (cur?.mode === 'edit' && cur.serverId === serverId ? null : cur));
    refresh();
  };

  const hostOf = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };

  const formTitle = editing?.mode === 'edit' ? 'Modifica server' : 'Aggiungi server';
  const submitLabel = editing?.mode === 'edit' ? 'Salva modifiche' : 'Aggiungi server';

  const listEmpty = servers.length === 0;
  const showForm = editing !== null;

  // Titolo modale dinamico
  const headerTitle = useMemo(
    () => `Server del profilo "${profile.name}"`,
    [profile.name],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={headerTitle}
      description={
        listEmpty
          ? 'Nessun server configurato. Aggiungine uno per iniziare a guardare i contenuti.'
          : `${servers.length} server salvat${servers.length === 1 ? 'o' : 'i'} per questo profilo.`
      }
      size="lg"
      ariaLabel="Gestione server"
    >
      {error && (
        <Card
          elevation="flat"
          padding="sm"
          className="border-state-error/30 bg-state-error/10 mb-4"
          role="alert"
        >
          <div className="flex items-start gap-3 text-state-error">
            <AlertCircle className="w-icon-md h-icon-md shrink-0 mt-0.5" aria-hidden="true" />
            <span className="text-sm">{error}</span>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {servers.map((s) => {
          const isActive = s.id === activeId;
          const isBusy = busyId === s.id;
          const isEditing = editing?.mode === 'edit' && editing.serverId === s.id;
          const confirming = confirmDeleteId === s.id;

          return (
            <Card
              key={s.id}
              elevation={isActive ? 'raised' : 'flat'}
              padding="md"
              className={
                isActive
                  ? 'border-brand-primary/40 bg-brand-primary/5'
                  : 'hover:bg-surface-2'
              }
            >
              <div className="flex items-start gap-4">
                <div
                  className={
                    'w-10 h-10 rounded-control flex items-center justify-center shrink-0 ' +
                    (isActive
                      ? 'bg-brand-primary/20 text-brand-primary'
                      : 'bg-surface-2 text-content-secondary')
                  }
                  aria-hidden="true"
                >
                  <ServerIcon className="w-icon-md h-icon-md" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-content-primary truncate">
                      {s.name}
                    </h3>
                    {isActive && <Badge tone="success">Attivo</Badge>}
                  </div>
                  <p className="text-xs text-content-muted truncate mt-0.5">
                    {hostOf(s.url)} · {s.username}
                  </p>
                </div>

                {!confirming && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleConnect(s)}
                        disabled={isBusy}
                        loading={isBusy}
                        leftIcon={isBusy ? undefined : Cable}
                      >
                        Connetti
                      </Button>
                    )}
                    {isActive && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleConnect(s)}
                        disabled={isBusy}
                        loading={isBusy}
                        leftIcon={isBusy ? undefined : Check}
                      >
                        Riconnetti
                      </Button>
                    )}
                    <IconButton
                      icon={Edit3}
                      aria-label={`Modifica ${s.name}`}
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing(isEditing ? null : { mode: 'edit', serverId: s.id })
                      }
                    />
                    <IconButton
                      icon={Trash2}
                      aria-label={`Elimina ${s.name}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(s.id)}
                    />
                  </div>
                )}

                {confirming && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-content-muted hidden sm:inline">
                      Confermi l'eliminazione?
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(s.id)}
                    >
                      Elimina
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Annulla
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}

        {/* Add / Edit form (inline) */}
        <div ref={formAnchorRef} />
        {showForm ? (
          <Card elevation="raised" padding="md" className="">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-content-muted">
                {formTitle}
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Annulla
              </Button>
            </div>
            <form onSubmit={handleSubmitForm} className="space-y-3">
              <FormField label="Nome (facoltativo)" htmlFor="server-name">
                <Input
                  id="server-name"
                  type="text"
                  placeholder="Es. Provider principale"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  inputSize="md"
                  data-initial-focus="true"
                />
              </FormField>
              <FormField label="URL host" htmlFor="server-url">
                <Input
                  id="server-url"
                  type="url"
                  placeholder="http://host:port"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  leftIcon={ServerIcon}
                  autoComplete="url"
                />
              </FormField>
              <FormField label="Username" htmlFor="server-user">
                <Input
                  id="server-user"
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  leftIcon={UserIcon}
                  autoComplete="username"
                />
              </FormField>
              <FormField label="Password" htmlFor="server-pass">
                <Input
                  id="server-pass"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftIcon={KeyRound}
                  autoComplete="current-password"
                />
              </FormField>
              <div className="flex justify-end pt-2">
                <Button type="submit" variant="primary" size="md" leftIcon={Check}>
                  {submitLabel}
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Button
            variant="secondary"
            size="md"
            leftIcon={Plus}
            onClick={() => setEditing({ mode: 'add' })}
            className="self-start"
          >
            Aggiungi server
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default ServerManager;

