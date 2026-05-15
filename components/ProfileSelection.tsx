import React, { useState, useEffect, useRef } from 'react';
import { Profile } from '../types.ts';
import { ProfileService } from '../services/profileService.ts';
import { Plus, Trash2, Tv } from 'lucide-react';
import { i18n } from '../services/i18n.ts';
import { useInitialTvFocus, useTvSpatialNavigation } from '../hooks/useTvFocus.ts';
import { Avatar } from './shared';
import OnboardingWizard from './OnboardingWizard.tsx';

interface ProfileSelectionProps {
  onSelectProfile: (profile: Profile) => void;
}

const ProfileSelection: React.FC<ProfileSelectionProps> = ({ onSelectProfile }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);

  useInitialTvFocus(true, screenRef, '[data-initial-focus="true"], .tv-focus');
  useTvSpatialNavigation(true, screenRef);

  useEffect(() => {
    setProfiles(ProfileService.getAll());
  }, []);

  // C.2: Onboarding wizard 3-step (identità → fonte → preferenze).
  // Sostituisce il vecchio modale "Nuovo profilo" inline.
  const handleWizardComplete = (profile: Profile) => {
    setProfiles(ProfileService.getAll());
    setShowWizard(false);
    // Selezione automatica del profilo appena creato per saltare in app.
    onSelectProfile(profile);
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
            onClick={() => setShowWizard(true)}
            className="tv-focus w-32 h-32 md:w-40 md:h-40 rounded-card border-2 border-dashed border-DEFAULT flex items-center justify-center bg-surface-1 hover:bg-surface-2 hover:border-strong transition-all duration-300"
            data-initial-focus={profiles.length === 0 ? 'true' : undefined}
            aria-label={t.addProfile}
          >
            <Plus className="w-icon-xl h-icon-xl text-content-muted" aria-hidden="true" />
          </button>
          <span className="text-xl font-medium text-content-muted">{t.addProfile}</span>
        </div>
      </div>

      <OnboardingWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />
    </div>
  );
};

export default ProfileSelection;