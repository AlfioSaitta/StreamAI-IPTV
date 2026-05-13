import React, { useState, useEffect, useRef } from 'react';
import { Profile } from '../types.ts';
import { ProfileService } from '../services/profileService.ts';
import { Plus, Trash2, Tv } from 'lucide-react';
import { i18n } from '../services/i18n.ts';
import { useInitialTvFocus, useTvSpatialNavigation } from '../hooks/useTvFocus.ts';
import { pickDefaultAvatarFor } from '../services/avatars.ts';
import { Avatar, AvatarPicker, Button, FormField, Input, Modal } from './shared';

// Palette colori coerente con i token DS (brand + accenti pop).
const NEW_PROFILE_COLORS = [
  '#dc2626', // brand-primary (rosso)
  '#a855f7', // brand-accent (viola)
  '#ec4899', // pink-500
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
];

interface ProfileSelectionProps {
  onSelectProfile: (profile: Profile) => void;
}

const ProfileSelection: React.FC<ProfileSelectionProps> = ({ onSelectProfile }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState<string>(pickDefaultAvatarFor(0));
  const [newColor, setNewColor] = useState<string>(NEW_PROFILE_COLORS[0]);
  const screenRef = useRef<HTMLDivElement>(null);

  useInitialTvFocus(true, screenRef, '[data-initial-focus="true"], .tv-focus');
  useTvSpatialNavigation(true, screenRef);

  useEffect(() => {
    setProfiles(ProfileService.getAll());
  }, []);

  // Quando si apre il form di creazione, suggerisce un avatar/colore
  // deterministico in base al numero di profili esistenti.
  const openCreateForm = () => {
    const idx = profiles.length;
    setNewAvatar(pickDefaultAvatarFor(idx));
    setNewColor(NEW_PROFILE_COLORS[idx % NEW_PROFILE_COLORS.length]);
    setNewName('');
    setIsCreating(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    ProfileService.create(newName.trim(), { color: newColor, avatar: newAvatar });
    setProfiles(ProfileService.getAll());
    setIsCreating(false);
    setNewName('');
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const t = i18n.t();
    if (confirm(t.deleteProfile)) {
      ProfileService.delete(id);
      setProfiles(ProfileService.getAll());
    }
  };

  const t = i18n.t();

  return (
    <div
      ref={screenRef}
      className="flex flex-col items-center justify-center min-h-screen bg-surface-0 text-content-primary animate-fade-in safe-area-screen px-4"
    >
      <div className="mb-16 flex flex-col items-center gap-4 animate-slide-up">
        <div className="w-20 h-20 rounded-card bg-brand-primary flex items-center justify-center shadow-glow-brand mb-4">
          <Tv className="w-icon-xl h-icon-xl text-white" aria-hidden="true" />
        </div>
        <h1 className="text-5xl font-light tracking-tight text-content-primary">
          {t.whoIsWatching}
        </h1>
      </div>

      <div
        className="flex flex-wrap justify-center gap-10 md:gap-16 px-8 animate-slide-up"
        style={{ animationDelay: '0.1s' }}
      >
        {profiles.map(profile => (
          <div key={profile.id} className="group relative flex flex-col items-center gap-4">
            <button
              onClick={() => onSelectProfile(profile)}
              className="tv-focus transition-all duration-300 hover:scale-105 rounded-card"
              data-initial-focus={profiles[0]?.id === profile.id ? 'true' : undefined}
              aria-label={profile.name}
            >
              <Avatar
                avatarId={profile.avatar}
                color={profile.color}
                size="2xl"
                shape="card"
              />
            </button>
            <span className="text-xl font-medium text-content-muted group-hover:text-content-primary transition-colors tracking-wide">
              {profile.name}
            </span>

            <button
              onClick={(e) => handleDelete(e, profile.id)}
              className="tv-focus touch-target absolute -top-2 -right-2 bg-brand-primary hover:bg-brand-primary-hover p-2 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:scale-110 shadow-elev-2"
              aria-label={`${t.deleteProfile} ${profile.name}`}
            >
              <Trash2 className="w-icon-sm h-icon-sm text-white" aria-hidden="true" />
            </button>
          </div>
        ))}

        {/* Add Profile */}
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={openCreateForm}
            className="tv-focus w-32 h-32 md:w-40 md:h-40 rounded-card border-2 border-dashed border-DEFAULT flex items-center justify-center bg-surface-1 hover:bg-surface-2 hover:border-strong transition-all duration-300"
            data-initial-focus={profiles.length === 0 ? 'true' : undefined}
            aria-label={t.addProfile}
          >
            <Plus className="w-icon-xl h-icon-xl text-content-muted" aria-hidden="true" />
          </button>
          <span className="text-xl font-medium text-content-muted">{t.addProfile}</span>
        </div>
      </div>

      <Modal
        open={isCreating}
        onClose={() => setIsCreating(false)}
        title={t.newProfile}
        size="md"
        ariaLabel={t.newProfile}
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-6">
          {/* Live preview */}
          <div className="flex items-center gap-4">
            <Avatar avatarId={newAvatar} color={newColor} size="xl" shape="card" />
            <div className="flex-1">
              <p className="text-xs uppercase tracking-widest text-content-muted mb-1">
                Anteprima
              </p>
              <p className="text-lg font-semibold text-content-primary truncate">
                {newName.trim() || t.profileName}
              </p>
            </div>
          </div>

          <FormField label={t.profileName} htmlFor="profile-name-input">
            <Input
              id="profile-name-input"
              autoFocus
              type="text"
              placeholder={t.profileName}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              data-initial-focus="true"
              inputSize="lg"
            />
          </FormField>

          {/* Color picker — palette ridotta, stile uniforme */}
          <FormField label="Colore" htmlFor="profile-color-grid">
            <div id="profile-color-grid" role="radiogroup" aria-label="Colore profilo" className="flex flex-wrap gap-2">
              {NEW_PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={newColor === c}
                  onClick={() => setNewColor(c)}
                  className={`tv-focus-dense w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                    newColor === c ? 'ring-2 ring-content-primary ring-offset-2 ring-offset-surface-0' : ''
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Colore ${c}`}
                />
              ))}
            </div>
          </FormField>

          <FormField label="Avatar">
            <AvatarPicker value={newAvatar} color={newColor} onChange={setNewAvatar} />
          </FormField>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setIsCreating(false)}
            >
              {t.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              disabled={!newName.trim()}
            >
              {t.create}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ProfileSelection;