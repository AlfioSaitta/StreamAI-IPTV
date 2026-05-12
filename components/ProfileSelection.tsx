import React, { useState, useEffect, useRef } from 'react';
import { Profile } from '../types.ts';
import { ProfileService } from '../services/profileService.ts';
import { Plus, User, Trash2, Tv } from 'lucide-react';
import { i18n } from '../services/i18n.ts';
import { useEscapeKey, useInitialTvFocus, useTvSpatialNavigation } from '../hooks/useTvFocus.ts';

interface ProfileSelectionProps {
  onSelectProfile: (profile: Profile) => void;
}

const ProfileSelection: React.FC<ProfileSelectionProps> = ({ onSelectProfile }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const screenRef = useRef<HTMLDivElement>(null);

  useInitialTvFocus(true, screenRef, '[data-initial-focus="true"], .tv-focus');
  useTvSpatialNavigation(true, screenRef);
  useEscapeKey(isCreating, () => setIsCreating(false));

  useEffect(() => {
    setProfiles(ProfileService.getAll());
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    ProfileService.create(newName.trim());
    setProfiles(ProfileService.getAll());
    setIsCreating(false);
    setNewName('');
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // Use i18n directly since this component is outside LanguageProvider
    const t = i18n.t();
    if (confirm(t.deleteProfile)) {
        ProfileService.delete(id);
        setProfiles(ProfileService.getAll());
    }
  };

  // Use i18n directly since this component is outside LanguageProvider
  const t = i18n.t();

  return (
    <div ref={screenRef} className="flex flex-col items-center justify-center min-h-screen bg-black bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 to-black text-white animate-fade-in safe-area-screen px-4">

       <div className="mb-16 flex flex-col items-center gap-4 animate-slide-up">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-purple-600 to-blue-600 flex items-center justify-center shadow-[0_0_50px_rgba(124,58,237,0.4)] mb-4">
                <Tv className="w-10 h-10 text-white" />
            </div>
           <h1 className="text-5xl font-light tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">{t.whoIsWatching}</h1>
       </div>

       {isCreating ? (
           <form onSubmit={handleCreate} className="flex flex-col gap-6 w-full max-w-sm animate-slide-up bg-white/5 p-8 rounded-3xl border border-white/10 backdrop-blur-xl">
               <h3 className="text-xl font-medium text-center">{t.newProfile}</h3>
               <input
                 autoFocus
                 type="text" 
                 placeholder={t.profileName}
                 className="tv-focus bg-black/50 text-white px-6 py-4 rounded-xl text-xl outline-none border border-white/10 focus:border-purple-500 text-center transition-all"
                 value={newName}
                 onChange={e => setNewName(e.target.value)}
                 data-initial-focus="true"
               />
               <div className="flex gap-4">
                   <button 
                    type="button" 
                    onClick={() => setIsCreating(false)}
                    className="tv-focus flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
                   >
                       {t.cancel}
                   </button>
                   <button 
                    type="submit"
                    disabled={!newName.trim()}
                     className="tv-focus flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/50 transition-all disabled:opacity-50"
                   >
                       {t.create}
                   </button>
               </div>
           </form>
       ) : (
           <div className="flex flex-wrap justify-center gap-10 md:gap-16 px-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
               {profiles.map(profile => (
                   <div key={profile.id} className="group relative flex flex-col items-center gap-4">
                       <button 
                        onClick={() => onSelectProfile(profile)}
                        className="tv-focus w-32 h-32 md:w-40 md:h-40 rounded-3xl flex items-center justify-center transition-all duration-300 hover:scale-105 relative overflow-hidden"
                        style={{ backgroundColor: profile.color }}
                        data-initial-focus={profiles[0]?.id === profile.id ? 'true' : undefined}
                       >
                           <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
                           <User className="w-16 h-16 md:w-20 md:h-20 text-white/90 relative z-10" />
                       </button>
                       <span className="text-xl font-medium text-gray-400 group-hover:text-white transition-colors tracking-wide">
                           {profile.name}
                       </span>
                       
                       <button 
                        onClick={(e) => handleDelete(e, profile.id)}
                         className="tv-focus touch-target absolute -top-2 -right-2 bg-red-600 p-2 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:scale-110 shadow-lg"
                       >
                           <Trash2 className="w-4 h-4 text-white" />
                       </button>
                   </div>
               ))}

               {/* Add Profile */}
               <div className="flex flex-col items-center gap-4">
                   <button 
                    onClick={() => setIsCreating(true)}
                    className="tv-focus w-32 h-32 md:w-40 md:h-40 rounded-3xl border-2 border-dashed border-gray-700 flex items-center justify-center hover:bg-white/5 hover:border-gray-500 transition-all duration-300"
                     data-initial-focus={profiles.length === 0 ? 'true' : undefined}
                   >
                       <Plus className="w-12 h-12 text-gray-500 group-hover:text-gray-300" />
                   </button>
                   <span className="text-xl font-medium text-gray-500">{t.addProfile}</span>
               </div>
           </div>
       )}
    </div>
  );
};

export default ProfileSelection;