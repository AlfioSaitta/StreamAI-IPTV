import React, { useState } from 'react';
import {
  Play, Pause, Settings, Cast, Search, Sparkles, Tv, Film, Heart,
  CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';
import {
  Badge, Button, Card, Chip, EmptyState, ErrorState, FormField, Icon,
  IconButton, Input, LoadingState, Modal, Select, Sheet, Spinner,
} from './shared';

/**
 * DS Preview — pagina dev-only di smoke test visivo per il Design System
 * v1 (UI-1.5). Non viene linkata dalla navigazione di produzione: si
 * accede tramite il route `/__/ds-preview` o impostando
 * `window.__SHOW_DS_PREVIEW = true`.
 */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-4">
    <h2 className="text-xs font-semibold tracking-widest uppercase text-content-muted">{title}</h2>
    <Card padding="lg" className="space-y-4">{children}</Card>
  </section>
);

const Row: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-3 ${className}`}>{children}</div>
);

const DesignSystemPreview: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [showError, setShowError] = useState(false);
  const [chip, setChip] = useState<string>('all');
  const [name, setName] = useState('');

  return (
    <div className="min-h-screen bg-surface-0 text-content-primary safe-area-screen">
      <header className="sticky top-0 z-10 bg-surface-0/95 backdrop-blur-md border-b border-DEFAULT px-8 py-5">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Icon icon={Sparkles} size="lg" className="text-brand-accent" />
          StreamAI DS v1 — Preview
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          Galleria componenti shared. UI-1 — token, scala dimensionale, varianti.
        </p>
      </header>

      <main className="px-8 py-10 space-y-10 max-w-6xl">
        <Section title="Buttons">
          <Row>
            <Button variant="primary" leftIcon={Play}>Play</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost" leftIcon={Settings}>Ghost</Button>
            <Button variant="accent" leftIcon={Sparkles}>AI Suggest</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" loading>Loading</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </Row>
          <Row>
            <Button size="sm" variant="primary">Small</Button>
            <Button size="md" variant="primary">Medium</Button>
            <Button size="lg" variant="primary">Large</Button>
          </Row>
          <Row>
            <IconButton icon={Play} aria-label="Play" variant="primary" />
            <IconButton icon={Pause} aria-label="Pause" variant="secondary" />
            <IconButton icon={Cast} aria-label="Cast" variant="ghost" />
            <IconButton icon={Sparkles} aria-label="AI" variant="accent" />
            <IconButton icon={Settings} aria-label="Settings" size="sm" />
            <IconButton icon={Settings} aria-label="Settings" size="lg" />
          </Row>
        </Section>

        <Section title="Inputs & Forms">
          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Nome profilo" helper="Visualizzato in alto a destra.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="es. Soggiorno"
                leftIcon={Tv}
              />
            </FormField>
            <FormField label="Server URL" error="URL non valido" required>
              <Input defaultValue="http://" leftIcon={Cast} />
            </FormField>
            <FormField label="Lingua">
              <Select defaultValue="it">
                <option value="it">Italiano</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </Select>
            </FormField>
            <FormField label="Cerca">
              <Input placeholder="Titolo, canale, episodio…" leftIcon={Search} accent="accent" />
            </FormField>
          </div>
        </Section>

        <Section title="Chips & Badges">
          <Row>
            {['all', 'live', 'movies', 'series'].map((id) => (
              <Chip key={id} selected={chip === id} onClick={() => setChip(id)}>
                {id.toUpperCase()}
              </Chip>
            ))}
          </Row>
          <Row>
            <Badge tone="brand">HD</Badge>
            <Badge tone="brand">4K</Badge>
            <Badge tone="error" pulse>LIVE</Badge>
            <Badge tone="success" icon={CheckCircle2}>Match 87%</Badge>
            <Badge tone="warning" icon={AlertTriangle}>EPG mancante</Badge>
            <Badge tone="info" icon={Info}>Beta</Badge>
            <Badge tone="accent" icon={Sparkles}>AI Pick</Badge>
            <Badge tone="neutral">SD</Badge>
          </Row>
        </Section>

        <Section title="Cards">
          <div className="grid sm:grid-cols-3 gap-4">
            <Card elevation="flat" padding="md">
              <h3 className="font-semibold mb-1">Flat</h3>
              <p className="text-sm text-content-muted">Pannelli secondari.</p>
            </Card>
            <Card elevation="raised" padding="md">
              <h3 className="font-semibold mb-1">Raised</h3>
              <p className="text-sm text-content-muted">Pannelli primari / card.</p>
            </Card>
            <Card elevation="overlay" padding="md">
              <h3 className="font-semibold mb-1">Overlay</h3>
              <p className="text-sm text-content-muted">Dropdown / floating.</p>
            </Card>
          </div>
        </Section>

        <Section title="Spinners">
          <Row>
            <Spinner size="sm" />
            <Spinner size="md" tone="brand" />
            <Spinner size="lg" tone="accent" />
            <Spinner size="xl" tone="brand" label="Caricamento in corso" />
          </Row>
        </Section>

        <Section title="Modal & Sheet">
          <Row>
            <Button onClick={() => setModalOpen(true)}>Apri Modal</Button>
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>Apri Sheet</Button>
            <Button variant="ghost" onClick={() => setShowLoading(true)}>LoadingState</Button>
            <Button variant="ghost" onClick={() => setShowError(true)}>ErrorState</Button>
          </Row>
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon={Film}
            title="Nessun film trovato"
            description="Prova a rivedere i filtri o aggiungi un'altra sorgente Xtream."
            actions={[
              { label: 'Aggiungi sorgente', onClick: () => {}, variant: 'primary' },
              { label: 'Cambia filtri', onClick: () => {}, variant: 'secondary' },
            ]}
          />
        </Section>

        <Section title="Color tokens">
          <div className="grid sm:grid-cols-4 gap-3">
            {[
              ['surface-0', 'bg-surface-0 border'],
              ['surface-1', 'bg-surface-1'],
              ['surface-2', 'bg-surface-2'],
              ['surface-3', 'bg-surface-3'],
              ['brand-primary', 'bg-brand-primary'],
              ['brand-accent', 'bg-brand-accent'],
              ['state-error', 'bg-state-error'],
              ['state-warning', 'bg-state-warning'],
              ['state-success', 'bg-state-success'],
              ['state-info', 'bg-state-info'],
            ].map(([name, cls]) => (
              <div key={name} className={`rounded-control p-3 ${cls}`}>
                <span className="text-xs font-semibold drop-shadow">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Icon scale">
          <Row>
            {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
              <div key={s} className="flex flex-col items-center gap-1 text-content-muted text-xs">
                <Icon icon={Heart} size={s} />
                <span>{s}</span>
              </div>
            ))}
          </Row>
        </Section>
      </main>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Conferma azione"
        description="Questa è una modale standard del DS."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Annulla</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>Conferma</Button>
          </>
        }
      >
        <p className="text-content-secondary">
          Il pulsante primario è rosso (CTA universale), il pulsante secondario è ghost.
        </p>
      </Modal>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Pannello laterale"
        size="md"
      >
        <p className="text-content-secondary">
          Sheet ancorato in basso: utile per cast picker, sleep timer e impostazioni sottotitoli
          (VideoPlayerNew, step UI-1.3.4 #9).
        </p>
      </Sheet>

      {showLoading && (
        <div onClick={() => setShowLoading(false)}>
          <LoadingState message="Caricamento dettagli…" variant="movie" />
        </div>
      )}

      {showError && (
        <ErrorState
          variant="movie"
          message="Errore di connessione al server"
          buttonText="Riprova"
          onButtonClick={() => setShowError(false)}
        />
      )}
    </div>
  );
};

export default DesignSystemPreview;

