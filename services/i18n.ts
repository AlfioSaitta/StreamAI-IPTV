// Internationalization (i18n) service for StreamAI-IPTV

export type SupportedLanguage = 'it' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'ja' | 'ko' | 'zh' | 'ar';

export interface Translations {
  // Common
  back: string;
  save: string;
  cancel: string;
  delete: string;
  close: string;
  loading: string;
  search: string;
  settings: string;
  logout: string;
  
  // Profile Selection
  whoIsWatching: string;
  newProfile: string;
  addProfile: string;
  profileName: string;
  create: string;
  deleteProfile: string;
  
  // Channel List / Navigation
  home: string;
  live: string;
  movies: string;
  series: string;
  continueWatching: string;
  myList: string;
  recommended: string;
  recentlyAdded: string;
  popular: string;
  searchPlaceholder: string;
  noResults: string;
  refreshCache: string;
  
  // Video Player
  play: string;
  pause: string;
  resume: string;
  restart: string;
  nextEpisode: string;
  previousEpisode: string;
  fullscreen: string;
  exitFullscreen: string;
  mute: string;
  unmute: string;
  cast: string;
  castConnected: string;
  castDisconnected: string;
  casting: string;
  castTo: string;
  chromecast: string;
  chromecastDesc: string;
  airplay: string;
  airplayDesc: string;
  externalPlayer: string;
  externalPlayerDesc: string;
  shareLink: string;
  shareLinkDesc: string;
  copyUrl: string;
  copyUrlDesc: string;
  urlCopied: string;

  // Movie/Series Details
  watchNow: string;
  addToList: string;
  removeFromList: string;
  moreInfo: string;
  castActors: string;
  director: string;
  genre: string;
  year: string;
  rating: string;
  duration: string;
  seasons: string;
  episodes: string;
  similarContent: string;
  
  // Profile Settings
  profileSettings: string;
  profile: string;
  languageAndSubtitles: string;
  contentLanguage: string;
  contentLanguageDesc: string;
  subtitleLanguage: string;
  subtitleLanguageDesc: string;
  playback: string;
  aiSettings: string;
  aiCaching: string;
  aiCachingDesc: string;
  debugOverlay: string;
  debugOverlayDesc: string;
  appearance: string;
  themeInterface: string;
  themeInterfaceDesc: string;
  clearCache: string;
  clearCacheDesc: string;
  cacheCleared: string;
  saveChanges: string;
  
  // Quality Options
  qualityAuto: string;
  quality4k: string;
  quality1080p: string;
  quality720p: string;
  quality480p: string;
  
  // Server / Login
  connectServer: string;
  serverUrl: string;
  username: string;
  password: string;
  connect: string;
  welcome: string;
  welcomeDesc: string;
  
  // AI Recommender
  aiRecommendations: string;
  askAI: string;
  aiPlaceholder: string;
  
  // Misc
  activeProfile: string;
  loadingLibrary: string;
}

const translations: Record<SupportedLanguage, Translations> = {
  it: {
    // Common
    back: 'Indietro',
    save: 'Salva',
    cancel: 'Annulla',
    delete: 'Elimina',
    close: 'Chiudi',
    loading: 'Caricamento...',
    search: 'Cerca',
    settings: 'Impostazioni',
    logout: 'Esci',
    
    // Profile Selection
    whoIsWatching: 'Chi sta guardando?',
    newProfile: 'Nuovo Profilo',
    addProfile: 'Aggiungi Profilo',
    profileName: 'Nome',
    create: 'Crea',
    deleteProfile: 'Elimina Profilo?',
    
    // Channel List / Navigation
    home: 'Home',
    live: 'Live TV',
    movies: 'Film',
    series: 'Serie TV',
    continueWatching: 'Continua a guardare',
    myList: 'La mia lista',
    recommended: 'Consigliati per te',
    recentlyAdded: 'Aggiunti di recente',
    popular: 'Popolari',
    searchPlaceholder: 'Titoli, attori, generi...',
    noResults: 'Nessun risultato',
    refreshCache: 'Aggiorna Cache',
    
    // Video Player
    play: 'Riproduci',
    pause: 'Pausa',
    resume: 'Riprendi',
    restart: 'Riparti dall\'inizio',
    nextEpisode: 'Prossimo episodio',
    previousEpisode: 'Episodio precedente',
    fullscreen: 'Schermo intero',
    exitFullscreen: 'Esci da schermo intero',
    mute: 'Silenzia',
    unmute: 'Attiva audio',
    cast: 'Trasmetti',
    castConnected: 'Trasmissione in corso',
    castDisconnected: 'Cast disconnesso',
    casting: 'Trasmissione...',
    castTo: 'Trasmetti su',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, dispositivi iOS',
    externalPlayer: 'Player esterno',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Condividi',
    shareLinkDesc: 'Invia link ad altre app',
    copyUrl: 'Copia URL',
    copyUrlDesc: 'Incolla in altro player',
    urlCopied: 'URL copiato!',

    // Movie/Series Details
    watchNow: 'Guarda ora',
    addToList: 'Aggiungi alla lista',
    removeFromList: 'Rimuovi dalla lista',
    moreInfo: 'Altre info',
    castActors: 'Cast',
    director: 'Regia',
    genre: 'Genere',
    year: 'Anno',
    rating: 'Valutazione',
    duration: 'Durata',
    seasons: 'Stagioni',
    episodes: 'Episodi',
    similarContent: 'Contenuti simili',
    
    // Profile Settings
    profileSettings: 'Impostazioni Profilo',
    profile: 'Profilo',
    languageAndSubtitles: 'Lingua e Sottotitoli',
    contentLanguage: 'Lingua contenuti',
    contentLanguageDesc: 'Lingua preferita per i contenuti audio',
    subtitleLanguage: 'Lingua sottotitoli',
    subtitleLanguageDesc: 'Sottotitoli predefiniti quando disponibili',
    playback: 'Riproduzione',
    aiSettings: 'Intelligenza Artificiale',
    aiCaching: 'Cache Risposte AI',
    aiCachingDesc: 'Salva le risposte di Gemini per risparmiare tempo e dati',
    debugOverlay: 'Info Debug Network',
    debugOverlayDesc: 'Mostra velocità di rete e stato buffering nel player',
    appearance: 'Aspetto',
    themeInterface: 'Tema Interfaccia',
    themeInterfaceDesc: 'Scegli tra Dark standard o OLED (Nero Assoluto)',
    clearCache: 'Svuota Cache Contenuti',
    clearCacheDesc: 'Ricarica tutte le liste e le immagini dal server',
    cacheCleared: 'Cache svuotata con successo',
    saveChanges: 'Salva Modifiche',
    
    // Quality Options
    qualityAuto: 'Automatica',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Connetti Server',
    serverUrl: 'URL Server',
    username: 'Nome utente',
    password: 'Password',
    connect: 'Connetti',
    welcome: 'Benvenuto su StreamAI',
    welcomeDesc: 'Connetti il tuo account per accedere a migliaia di contenuti.',
    
    // AI Recommender
    aiRecommendations: 'Raccomandazioni AI',
    askAI: 'Chiedi all\'AI',
    aiPlaceholder: 'Cosa vorresti guardare?',
    
    // Misc
    activeProfile: 'Profilo attivo',
    loadingLibrary: 'Caricamento Libreria...',
  },
  
  en: {
    // Common
    back: 'Back',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    close: 'Close',
    loading: 'Loading...',
    search: 'Search',
    settings: 'Settings',
    logout: 'Logout',
    
    // Profile Selection
    whoIsWatching: 'Who is watching?',
    newProfile: 'New Profile',
    addProfile: 'Add Profile',
    profileName: 'Name',
    create: 'Create',
    deleteProfile: 'Delete Profile?',
    
    // Channel List / Navigation
    home: 'Home',
    live: 'Live TV',
    movies: 'Movies',
    series: 'TV Series',
    continueWatching: 'Continue Watching',
    myList: 'My List',
    recommended: 'Recommended for you',
    recentlyAdded: 'Recently Added',
    popular: 'Popular',
    searchPlaceholder: 'Titles, actors, genres...',
    noResults: 'No results',
    refreshCache: 'Refresh Cache',
    
    // Video Player
    play: 'Play',
    pause: 'Pause',
    resume: 'Resume',
    restart: 'Restart',
    nextEpisode: 'Next episode',
    previousEpisode: 'Previous episode',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    mute: 'Mute',
    unmute: 'Unmute',
    cast: 'Cast',
    castConnected: 'Casting',
    castDisconnected: 'Cast disconnected',
    casting: 'Casting...',
    castTo: 'Cast to',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, iOS devices',
    externalPlayer: 'External Player',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Share',
    shareLinkDesc: 'Send link to other apps',
    copyUrl: 'Copy URL',
    copyUrlDesc: 'Paste in another player',
    urlCopied: 'URL copied!',

    // Movie/Series Details
    watchNow: 'Watch Now',
    addToList: 'Add to List',
    removeFromList: 'Remove from List',
    moreInfo: 'More Info',
    castActors: 'Cast',
    director: 'Director',
    genre: 'Genre',
    year: 'Year',
    rating: 'Rating',
    duration: 'Duration',
    seasons: 'Seasons',
    episodes: 'Episodes',
    similarContent: 'Similar Content',
    
    // Profile Settings
    profileSettings: 'Profile Settings',
    profile: 'Profile',
    languageAndSubtitles: 'Language & Subtitles',
    contentLanguage: 'Content Language',
    contentLanguageDesc: 'Preferred language for audio content',
    subtitleLanguage: 'Subtitle Language',
    subtitleLanguageDesc: 'Default subtitles when available',
    playback: 'Playback',
    aiSettings: 'Artificial Intelligence',
    aiCaching: 'AI Response Cache',
    aiCachingDesc: 'Save Gemini responses to save time and data',
    debugOverlay: 'Network Debug Info',
    debugOverlayDesc: 'Show network speed and buffering status in the player',
    appearance: 'Appearance',
    themeInterface: 'Interface Theme',
    themeInterfaceDesc: 'Choose between standard Dark or OLED (Pure Black)',
    clearCache: 'Clear Content Cache',
    clearCacheDesc: 'Reload all lists and images from the server',
    cacheCleared: 'Cache cleared successfully',
    saveChanges: 'Save Changes',
    
    // Quality Options
    qualityAuto: 'Auto',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Connect Server',
    serverUrl: 'Server URL',
    username: 'Username',
    password: 'Password',
    connect: 'Connect',
    welcome: 'Welcome to StreamAI',
    welcomeDesc: 'Connect your account to access thousands of contents.',
    
    // AI Recommender
    aiRecommendations: 'AI Recommendations',
    askAI: 'Ask AI',
    aiPlaceholder: 'What would you like to watch?',
    
    // Misc
    activeProfile: 'Active profile',
    loadingLibrary: 'Loading Library...',
  },
  
  es: {
    // Common
    back: 'Atrás',
    save: 'Guardar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    close: 'Cerrar',
    loading: 'Cargando...',
    search: 'Buscar',
    settings: 'Configuración',
    logout: 'Salir',
    
    // Profile Selection
    whoIsWatching: '¿Quién está viendo?',
    newProfile: 'Nuevo Perfil',
    addProfile: 'Añadir Perfil',
    profileName: 'Nombre',
    create: 'Crear',
    deleteProfile: '¿Eliminar Perfil?',
    
    // Channel List / Navigation
    home: 'Inicio',
    live: 'TV en vivo',
    movies: 'Películas',
    series: 'Series',
    continueWatching: 'Seguir viendo',
    myList: 'Mi lista',
    recommended: 'Recomendados para ti',
    recentlyAdded: 'Añadidos recientemente',
    popular: 'Populares',
    searchPlaceholder: 'Títulos, actores, géneros...',
    noResults: 'Sin resultados',
    refreshCache: 'Actualizar caché',
    
    // Video Player
    play: 'Reproducir',
    pause: 'Pausar',
    resume: 'Reanudar',
    restart: 'Reiniciar',
    nextEpisode: 'Siguiente episodio',
    previousEpisode: 'Episodio anterior',
    fullscreen: 'Pantalla completa',
    exitFullscreen: 'Salir de pantalla completa',
    mute: 'Silenciar',
    unmute: 'Activar sonido',
    cast: 'Transmitir',
    castConnected: 'Transmitiendo',
    castDisconnected: 'Cast desconectado',
    casting: 'Transmitiendo...',
    castTo: 'Transmitir a',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, dispositivos iOS',
    externalPlayer: 'Reproductor externo',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Compartir',
    shareLinkDesc: 'Enviar enlace a otras apps',
    copyUrl: 'Copiar URL',
    copyUrlDesc: 'Pegar en otro reproductor',
    urlCopied: '¡URL copiada!',

    // Movie/Series Details
    watchNow: 'Ver ahora',
    addToList: 'Añadir a la lista',
    removeFromList: 'Quitar de la lista',
    moreInfo: 'Más información',
    castActors: 'Reparto',
    director: 'Director',
    genre: 'Género',
    year: 'Año',
    rating: 'Valoración',
    duration: 'Duración',
    seasons: 'Temporadas',
    episodes: 'Episodios',
    similarContent: 'Contenido similar',
    
    // Profile Settings
    profileSettings: 'Configuración del Perfil',
    profile: 'Perfil',
    languageAndSubtitles: 'Idioma y Subtítulos',
    contentLanguage: 'Idioma del contenido',
    contentLanguageDesc: 'Idioma preferido para el audio',
    subtitleLanguage: 'Idioma de subtítulos',
    subtitleLanguageDesc: 'Subtítulos predeterminados',
    playback: 'Reproducción',
    videoQuality: 'Calidad de video',
    videoQualityDesc: 'Calidad de streaming predeterminada',
    autoPlay: 'Reproducción automática',
    autoPlayDesc: 'Reproducir siguiente episodio automáticamente',
    skipIntro: 'Saltar intro',
    skipIntroDesc: 'Saltar automáticamente los créditos iniciales',
    parentalControls: 'Control Parental',
    matureContent: 'Contenido para adultos',
    matureContentDesc: 'Mostrar contenido para adultos',
    saveChanges: 'Guardar Cambios',
    
    // Quality Options
    qualityAuto: 'Automática',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Conectar Servidor',
    serverUrl: 'URL del Servidor',
    username: 'Usuario',
    password: 'Contraseña',
    connect: 'Conectar',
    welcome: 'Bienvenido a StreamAI',
    welcomeDesc: 'Conecta tu cuenta para acceder a miles de contenidos.',
    
    // AI Recommender
    aiRecommendations: 'Recomendaciones IA',
    askAI: 'Preguntar a la IA',
    aiPlaceholder: '¿Qué te gustaría ver?',
    
    // Misc
    activeProfile: 'Perfil activo',
    loadingLibrary: 'Cargando biblioteca...',
  },
  
  fr: {
    // Common
    back: 'Retour',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    close: 'Fermer',
    loading: 'Chargement...',
    search: 'Rechercher',
    settings: 'Paramètres',
    logout: 'Déconnexion',
    
    // Profile Selection
    whoIsWatching: 'Qui regarde?',
    newProfile: 'Nouveau Profil',
    addProfile: 'Ajouter un Profil',
    profileName: 'Nom',
    create: 'Créer',
    deleteProfile: 'Supprimer le Profil?',
    
    // Channel List / Navigation
    home: 'Accueil',
    live: 'TV en direct',
    movies: 'Films',
    series: 'Séries',
    continueWatching: 'Reprendre',
    myList: 'Ma liste',
    recommended: 'Recommandés pour vous',
    recentlyAdded: 'Ajoutés récemment',
    popular: 'Populaires',
    searchPlaceholder: 'Titres, acteurs, genres...',
    noResults: 'Aucun résultat',
    refreshCache: 'Actualiser le cache',
    
    // Video Player
    play: 'Lecture',
    pause: 'Pause',
    resume: 'Reprendre',
    restart: 'Recommencer',
    nextEpisode: 'Épisode suivant',
    previousEpisode: 'Épisode précédent',
    fullscreen: 'Plein écran',
    exitFullscreen: 'Quitter le plein écran',
    mute: 'Couper le son',
    unmute: 'Activer le son',
    cast: 'Diffuser',
    castConnected: 'Diffusion en cours',
    castDisconnected: 'Cast déconnecté',
    casting: 'Diffusion...',
    castTo: 'Diffuser sur',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, appareils iOS',
    externalPlayer: 'Lecteur externe',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Partager',
    shareLinkDesc: 'Envoyer le lien à d\'autres apps',
    copyUrl: 'Copier l\'URL',
    copyUrlDesc: 'Coller dans un autre lecteur',
    urlCopied: 'URL copiée!',

    // Movie/Series Details
    watchNow: 'Regarder',
    addToList: 'Ajouter à la liste',
    removeFromList: 'Retirer de la liste',
    moreInfo: 'Plus d\'infos',
    castActors: 'Distribution',
    director: 'Réalisateur',
    genre: 'Genre',
    year: 'Année',
    rating: 'Note',
    duration: 'Durée',
    seasons: 'Saisons',
    episodes: 'Épisodes',
    similarContent: 'Contenus similaires',
    
    // Profile Settings
    profileSettings: 'Paramètres du Profil',
    profile: 'Profil',
    languageAndSubtitles: 'Langue et Sous-titres',
    contentLanguage: 'Langue du contenu',
    contentLanguageDesc: 'Langue préférée pour l\'audio',
    subtitleLanguage: 'Langue des sous-titres',
    subtitleLanguageDesc: 'Sous-titres par défaut',
    playback: 'Lecture',
    videoQuality: 'Qualité vidéo',
    videoQualityDesc: 'Qualité de streaming par défaut',
    autoPlay: 'Lecture automatique',
    autoPlayDesc: 'Lire l\'épisode suivant automatiquement',
    skipIntro: 'Passer l\'intro',
    skipIntroDesc: 'Passer automatiquement le générique',
    parentalControls: 'Contrôle Parental',
    matureContent: 'Contenu adulte',
    matureContentDesc: 'Afficher le contenu pour adultes',
    saveChanges: 'Enregistrer',
    
    // Quality Options
    qualityAuto: 'Automatique',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Connecter le Serveur',
    serverUrl: 'URL du Serveur',
    username: 'Utilisateur',
    password: 'Mot de passe',
    connect: 'Connecter',
    welcome: 'Bienvenue sur StreamAI',
    welcomeDesc: 'Connectez votre compte pour accéder à des milliers de contenus.',
    
    // AI Recommender
    aiRecommendations: 'Recommandations IA',
    askAI: 'Demander à l\'IA',
    aiPlaceholder: 'Que souhaitez-vous regarder?',
    
    // Misc
    activeProfile: 'Profil actif',
    loadingLibrary: 'Chargement de la bibliothèque...',
  },
  
  de: {
    // Common
    back: 'Zurück',
    save: 'Speichern',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    close: 'Schließen',
    loading: 'Wird geladen...',
    search: 'Suchen',
    settings: 'Einstellungen',
    logout: 'Abmelden',
    
    // Profile Selection
    whoIsWatching: 'Wer schaut?',
    newProfile: 'Neues Profil',
    addProfile: 'Profil hinzufügen',
    profileName: 'Name',
    create: 'Erstellen',
    deleteProfile: 'Profil löschen?',
    
    // Channel List / Navigation
    home: 'Startseite',
    live: 'Live-TV',
    movies: 'Filme',
    series: 'Serien',
    continueWatching: 'Weiterschauen',
    myList: 'Meine Liste',
    recommended: 'Empfohlen für dich',
    recentlyAdded: 'Kürzlich hinzugefügt',
    popular: 'Beliebt',
    searchPlaceholder: 'Titel, Schauspieler, Genres...',
    noResults: 'Keine Ergebnisse',
    refreshCache: 'Cache aktualisieren',
    
    // Video Player
    play: 'Abspielen',
    pause: 'Pause',
    resume: 'Fortsetzen',
    restart: 'Neu starten',
    nextEpisode: 'Nächste Folge',
    previousEpisode: 'Vorherige Folge',
    fullscreen: 'Vollbild',
    exitFullscreen: 'Vollbild beenden',
    mute: 'Stumm',
    unmute: 'Ton an',
    cast: 'Streamen',
    castConnected: 'Wird gestreamt',
    castDisconnected: 'Cast getrennt',
    casting: 'Streaming...',
    castTo: 'Streamen auf',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, iOS-Geräte',
    externalPlayer: 'Externer Player',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Teilen',
    shareLinkDesc: 'Link an andere Apps senden',
    copyUrl: 'URL kopieren',
    copyUrlDesc: 'In anderen Player einfügen',
    urlCopied: 'URL kopiert!',

    // Movie/Series Details
    watchNow: 'Jetzt ansehen',
    addToList: 'Zur Liste hinzufügen',
    removeFromList: 'Von Liste entfernen',
    moreInfo: 'Mehr Infos',
    castActors: 'Besetzung',
    director: 'Regie',
    genre: 'Genre',
    year: 'Jahr',
    rating: 'Bewertung',
    duration: 'Dauer',
    seasons: 'Staffeln',
    episodes: 'Folgen',
    similarContent: 'Ähnliche Inhalte',
    
    // Profile Settings
    profileSettings: 'Profileinstellungen',
    profile: 'Profil',
    languageAndSubtitles: 'Sprache & Untertitel',
    contentLanguage: 'Inhaltssprache',
    contentLanguageDesc: 'Bevorzugte Audiosprache',
    subtitleLanguage: 'Untertitelsprache',
    subtitleLanguageDesc: 'Standard-Untertitel',
    playback: 'Wiedergabe',
    videoQuality: 'Videoqualität',
    videoQualityDesc: 'Standard-Streaming-Qualität',
    autoPlay: 'Automatische Wiedergabe',
    autoPlayDesc: 'Nächste Folge automatisch abspielen',
    skipIntro: 'Intro überspringen',
    skipIntroDesc: 'Vorspann automatisch überspringen',
    parentalControls: 'Kindersicherung',
    matureContent: 'Erwachseneninhalte',
    matureContentDesc: 'Inhalte für Erwachsene anzeigen',
    saveChanges: 'Änderungen speichern',
    
    // Quality Options
    qualityAuto: 'Automatisch',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Server verbinden',
    serverUrl: 'Server-URL',
    username: 'Benutzername',
    password: 'Passwort',
    connect: 'Verbinden',
    welcome: 'Willkommen bei StreamAI',
    welcomeDesc: 'Verbinde dein Konto für Zugang zu tausenden Inhalten.',
    
    // AI Recommender
    aiRecommendations: 'KI-Empfehlungen',
    askAI: 'KI fragen',
    aiPlaceholder: 'Was möchtest du sehen?',
    
    // Misc
    activeProfile: 'Aktives Profil',
    loadingLibrary: 'Bibliothek wird geladen...',
  },
  
  pt: {
    // Common
    back: 'Voltar',
    save: 'Salvar',
    cancel: 'Cancelar',
    delete: 'Excluir',
    close: 'Fechar',
    loading: 'Carregando...',
    search: 'Buscar',
    settings: 'Configurações',
    logout: 'Sair',
    
    // Profile Selection
    whoIsWatching: 'Quem está assistindo?',
    newProfile: 'Novo Perfil',
    addProfile: 'Adicionar Perfil',
    profileName: 'Nome',
    create: 'Criar',
    deleteProfile: 'Excluir Perfil?',
    
    // Channel List / Navigation
    home: 'Início',
    live: 'TV ao vivo',
    movies: 'Filmes',
    series: 'Séries',
    continueWatching: 'Continuar assistindo',
    myList: 'Minha lista',
    recommended: 'Recomendados para você',
    recentlyAdded: 'Adicionados recentemente',
    popular: 'Populares',
    searchPlaceholder: 'Títulos, atores, gêneros...',
    noResults: 'Sem resultados',
    refreshCache: 'Atualizar cache',
    
    // Video Player
    play: 'Reproduzir',
    pause: 'Pausar',
    resume: 'Retomar',
    restart: 'Reiniciar',
    nextEpisode: 'Próximo episódio',
    previousEpisode: 'Episódio anterior',
    fullscreen: 'Tela cheia',
    exitFullscreen: 'Sair da tela cheia',
    mute: 'Mudo',
    unmute: 'Ativar som',
    cast: 'Transmitir',
    castConnected: 'Transmitindo',
    castDisconnected: 'Cast desconectado',
    casting: 'Transmitindo...',
    castTo: 'Transmitir para',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, dispositivos iOS',
    externalPlayer: 'Player externo',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Compartilhar',
    shareLinkDesc: 'Enviar link para outros apps',
    copyUrl: 'Copiar URL',
    copyUrlDesc: 'Colar em outro player',
    urlCopied: 'URL copiada!',

    // Movie/Series Details
    watchNow: 'Assistir agora',
    addToList: 'Adicionar à lista',
    removeFromList: 'Remover da lista',
    moreInfo: 'Mais informações',
    castActors: 'Elenco',
    director: 'Diretor',
    genre: 'Gênero',
    year: 'Ano',
    rating: 'Avaliação',
    duration: 'Duração',
    seasons: 'Temporadas',
    episodes: 'Episódios',
    similarContent: 'Conteúdo similar',
    
    // Profile Settings
    profileSettings: 'Configurações do Perfil',
    profile: 'Perfil',
    languageAndSubtitles: 'Idioma e Legendas',
    contentLanguage: 'Idioma do conteúdo',
    contentLanguageDesc: 'Idioma preferido para áudio',
    subtitleLanguage: 'Idioma das legendas',
    subtitleLanguageDesc: 'Legendas padrão',
    playback: 'Reprodução',
    videoQuality: 'Qualidade de vídeo',
    videoQualityDesc: 'Qualidade de streaming padrão',
    autoPlay: 'Reprodução automática',
    autoPlayDesc: 'Reproduzir próximo episódio automaticamente',
    skipIntro: 'Pular intro',
    skipIntroDesc: 'Pular abertura automaticamente',
    parentalControls: 'Controle dos Pais',
    matureContent: 'Conteúdo adulto',
    matureContentDesc: 'Mostrar conteúdo para adultos',
    saveChanges: 'Salvar Alterações',
    
    // Quality Options
    qualityAuto: 'Automática',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Conectar Servidor',
    serverUrl: 'URL do Servidor',
    username: 'Usuário',
    password: 'Senha',
    connect: 'Conectar',
    welcome: 'Bem-vindo ao StreamAI',
    welcomeDesc: 'Conecte sua conta para acessar milhares de conteúdos.',
    
    // AI Recommender
    aiRecommendations: 'Recomendações IA',
    askAI: 'Perguntar à IA',
    aiPlaceholder: 'O que você gostaria de assistir?',
    
    // Misc
    activeProfile: 'Perfil ativo',
    loadingLibrary: 'Carregando biblioteca...',
  },
  
  ru: {
    // Common
    back: 'Назад',
    save: 'Сохранить',
    cancel: 'Отмена',
    delete: 'Удалить',
    close: 'Закрыть',
    loading: 'Загрузка...',
    search: 'Поиск',
    settings: 'Настройки',
    logout: 'Выйти',
    
    // Profile Selection
    whoIsWatching: 'Кто смотрит?',
    newProfile: 'Новый профиль',
    addProfile: 'Добавить профиль',
    profileName: 'Имя',
    create: 'Создать',
    deleteProfile: 'Удалить профиль?',
    
    // Channel List / Navigation
    home: 'Главная',
    live: 'Прямой эфир',
    movies: 'Фильмы',
    series: 'Сериалы',
    continueWatching: 'Продолжить просмотр',
    myList: 'Мой список',
    recommended: 'Рекомендуем вам',
    recentlyAdded: 'Недавно добавленные',
    popular: 'Популярное',
    searchPlaceholder: 'Названия, актёры, жанры...',
    noResults: 'Нет результатов',
    refreshCache: 'Обновить кэш',
    
    // Video Player
    play: 'Воспроизвести',
    pause: 'Пауза',
    resume: 'Продолжить',
    restart: 'Начать сначала',
    nextEpisode: 'Следующий эпизод',
    previousEpisode: 'Предыдущий эпизод',
    fullscreen: 'Полный экран',
    exitFullscreen: 'Выйти из полноэкранного режима',
    mute: 'Выключить звук',
    unmute: 'Включить звук',
    cast: 'Транслировать',
    castConnected: 'Трансляция',
    castDisconnected: 'Cast отключен',
    casting: 'Трансляция...',
    castTo: 'Транслировать на',
    chromecast: 'Chromecast / Smart TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, устройства iOS',
    externalPlayer: 'Внешний плеер',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: 'Поделиться',
    shareLinkDesc: 'Отправить ссылку в другие приложения',
    copyUrl: 'Копировать URL',
    copyUrlDesc: 'Вставить в другой плеер',
    urlCopied: 'URL скопирован!',

    // Movie/Series Details
    watchNow: 'Смотреть сейчас',
    addToList: 'Добавить в список',
    removeFromList: 'Удалить из списка',
    moreInfo: 'Подробнее',
    castActors: 'В ролях',
    director: 'Режиссёр',
    genre: 'Жанр',
    year: 'Год',
    rating: 'Рейтинг',
    duration: 'Длительность',
    seasons: 'Сезоны',
    episodes: 'Эпизоды',
    similarContent: 'Похожее',
    
    // Profile Settings
    profileSettings: 'Настройки профиля',
    profile: 'Профиль',
    languageAndSubtitles: 'Язык и субтитры',
    contentLanguage: 'Язык контента',
    contentLanguageDesc: 'Предпочтительный язык аудио',
    subtitleLanguage: 'Язык субтитров',
    subtitleLanguageDesc: 'Субтитры по умолчанию',
    playback: 'Воспроизведение',
    videoQuality: 'Качество видео',
    videoQualityDesc: 'Качество потока по умолчанию',
    autoPlay: 'Автовоспроизведение',
    autoPlayDesc: 'Автоматически воспроизводить следующий эпизод',
    skipIntro: 'Пропустить заставку',
    skipIntroDesc: 'Автоматически пропускать заставку',
    parentalControls: 'Родительский контроль',
    matureContent: 'Контент для взрослых',
    matureContentDesc: 'Показывать контент для взрослых',
    saveChanges: 'Сохранить изменения',
    
    // Quality Options
    qualityAuto: 'Авто',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'Подключить сервер',
    serverUrl: 'URL сервера',
    username: 'Имя пользователя',
    password: 'Пароль',
    connect: 'Подключить',
    welcome: 'Добро пожаловать в StreamAI',
    welcomeDesc: 'Подключите аккаунт для доступа к тысячам контента.',
    
    // AI Recommender
    aiRecommendations: 'Рекомендации ИИ',
    askAI: 'Спросить ИИ',
    aiPlaceholder: 'Что вы хотите посмотреть?',
    
    // Misc
    activeProfile: 'Активный профиль',
    loadingLibrary: 'Загрузка библиотеки...',
  },
  
  ja: {
    // Common
    back: '戻る',
    save: '保存',
    cancel: 'キャンセル',
    delete: '削除',
    close: '閉じる',
    loading: '読み込み中...',
    search: '検索',
    settings: '設定',
    logout: 'ログアウト',
    
    // Profile Selection
    whoIsWatching: '視聴するのは誰ですか？',
    newProfile: '新しいプロフィール',
    addProfile: 'プロフィールを追加',
    profileName: '名前',
    create: '作成',
    deleteProfile: 'プロフィールを削除しますか？',
    
    // Channel List / Navigation
    home: 'ホーム',
    live: 'ライブTV',
    movies: '映画',
    series: 'ドラマ',
    continueWatching: '視聴を続ける',
    myList: 'マイリスト',
    recommended: 'おすすめ',
    recentlyAdded: '最近追加',
    popular: '人気',
    searchPlaceholder: 'タイトル、俳優、ジャンル...',
    noResults: '結果なし',
    refreshCache: 'キャッシュを更新',
    
    // Video Player
    play: '再生',
    pause: '一時停止',
    resume: '再開',
    restart: '最初から',
    nextEpisode: '次のエピソード',
    previousEpisode: '前のエピソード',
    fullscreen: '全画面',
    exitFullscreen: '全画面を終了',
    mute: 'ミュート',
    unmute: 'ミュート解除',
    cast: 'キャスト',
    castConnected: 'キャスト中',
    castDisconnected: 'キャスト切断',
    casting: 'キャスト中...',
    castTo: 'キャスト先',
    chromecast: 'Chromecast / スマートTV',
    chromecastDesc: 'Google Cast、Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV、iOSデバイス',
    externalPlayer: '外部プレーヤー',
    externalPlayerDesc: 'VLC、MX Player、Kodi',
    shareLink: '共有',
    shareLinkDesc: '他のアプリにリンクを送信',
    copyUrl: 'URLをコピー',
    copyUrlDesc: '他のプレーヤーに貼り付け',
    urlCopied: 'URLをコピーしました！',

    // Movie/Series Details
    watchNow: '今すぐ視聴',
    addToList: 'リストに追加',
    removeFromList: 'リストから削除',
    moreInfo: '詳細',
    castActors: 'キャスト',
    director: '監督',
    genre: 'ジャンル',
    year: '年',
    rating: '評価',
    duration: '時間',
    seasons: 'シーズン',
    episodes: 'エピソード',
    similarContent: '類似コンテンツ',
    
    // Profile Settings
    profileSettings: 'プロフィール設定',
    profile: 'プロフィール',
    languageAndSubtitles: '言語と字幕',
    contentLanguage: 'コンテンツの言語',
    contentLanguageDesc: '優先する音声言語',
    subtitleLanguage: '字幕の言語',
    subtitleLanguageDesc: 'デフォルトの字幕',
    playback: '再生',
    videoQuality: '画質',
    videoQualityDesc: 'デフォルトのストリーミング画質',
    autoPlay: '自動再生',
    autoPlayDesc: '次のエピソードを自動再生',
    skipIntro: 'イントロをスキップ',
    skipIntroDesc: 'オープニングを自動スキップ',
    parentalControls: 'ペアレンタルコントロール',
    matureContent: '成人向けコンテンツ',
    matureContentDesc: '成人向けコンテンツを表示',
    saveChanges: '変更を保存',
    
    // Quality Options
    qualityAuto: '自動',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'サーバーに接続',
    serverUrl: 'サーバーURL',
    username: 'ユーザー名',
    password: 'パスワード',
    connect: '接続',
    welcome: 'StreamAIへようこそ',
    welcomeDesc: 'アカウントを接続して数千のコンテンツにアクセス',
    
    // AI Recommender
    aiRecommendations: 'AIおすすめ',
    askAI: 'AIに聞く',
    aiPlaceholder: '何を見たいですか？',
    
    // Misc
    activeProfile: 'アクティブなプロフィール',
    loadingLibrary: 'ライブラリを読み込み中...',
  },
  
  ko: {
    // Common
    back: '뒤로',
    save: '저장',
    cancel: '취소',
    delete: '삭제',
    close: '닫기',
    loading: '로딩 중...',
    search: '검색',
    settings: '설정',
    logout: '로그아웃',
    
    // Profile Selection
    whoIsWatching: '시청자를 선택하세요',
    newProfile: '새 프로필',
    addProfile: '프로필 추가',
    profileName: '이름',
    create: '만들기',
    deleteProfile: '프로필을 삭제하시겠습니까?',
    
    // Channel List / Navigation
    home: '홈',
    live: '실시간 TV',
    movies: '영화',
    series: '시리즈',
    continueWatching: '계속 시청하기',
    myList: '내 목록',
    recommended: '추천',
    recentlyAdded: '최근 추가',
    popular: '인기',
    searchPlaceholder: '제목, 배우, 장르...',
    noResults: '결과 없음',
    refreshCache: '캐시 새로고침',
    
    // Video Player
    play: '재생',
    pause: '일시정지',
    resume: '다시 시작',
    restart: '처음부터',
    nextEpisode: '다음 에피소드',
    previousEpisode: '이전 에피소드',
    fullscreen: '전체화면',
    exitFullscreen: '전체화면 종료',
    mute: '음소거',
    unmute: '음소거 해제',
    cast: '전송',
    castConnected: '전송 중',
    castDisconnected: '전송 연결 해제',
    casting: '전송 중...',
    castTo: '전송 대상',
    chromecast: 'Chromecast / 스마트 TV',
    chromecastDesc: 'Google Cast, Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV, iOS 기기',
    externalPlayer: '외부 플레이어',
    externalPlayerDesc: 'VLC, MX Player, Kodi',
    shareLink: '공유',
    shareLinkDesc: '다른 앱으로 링크 보내기',
    copyUrl: 'URL 복사',
    copyUrlDesc: '다른 플레이어에 붙여넣기',
    urlCopied: 'URL 복사됨!',

    // Movie/Series Details
    watchNow: '지금 시청',
    addToList: '목록에 추가',
    removeFromList: '목록에서 제거',
    moreInfo: '상세정보',
    castActors: '출연',
    director: '감독',
    genre: '장르',
    year: '년도',
    rating: '평점',
    duration: '시간',
    seasons: '시즌',
    episodes: '에피소드',
    similarContent: '비슷한 콘텐츠',
    
    // Profile Settings
    profileSettings: '프로필 설정',
    profile: '프로필',
    languageAndSubtitles: '언어 및 자막',
    contentLanguage: '콘텐츠 언어',
    contentLanguageDesc: '선호하는 오디오 언어',
    subtitleLanguage: '자막 언어',
    subtitleLanguageDesc: '기본 자막',
    playback: '재생',
    videoQuality: '화질',
    videoQualityDesc: '기본 스트리밍 화질',
    autoPlay: '자동 재생',
    autoPlayDesc: '다음 에피소드 자동 재생',
    skipIntro: '인트로 건너뛰기',
    skipIntroDesc: '오프닝 자동 건너뛰기',
    parentalControls: '자녀 보호',
    matureContent: '성인 콘텐츠',
    matureContentDesc: '성인 콘텐츠 표시',
    saveChanges: '변경사항 저장',
    
    // Quality Options
    qualityAuto: '자동',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: '서버 연결',
    serverUrl: '서버 URL',
    username: '사용자명',
    password: '비밀번호',
    connect: '연결',
    welcome: 'StreamAI에 오신 것을 환영합니다',
    welcomeDesc: '계정을 연결하여 수천 개의 콘텐츠에 접근하세요.',
    
    // AI Recommender
    aiRecommendations: 'AI 추천',
    askAI: 'AI에게 물어보기',
    aiPlaceholder: '무엇을 보고 싶으세요?',
    
    // Misc
    activeProfile: '활성 프로필',
    loadingLibrary: '라이브러리 로딩 중...',
  },
  
  zh: {
    // Common
    back: '返回',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    close: '关闭',
    loading: '加载中...',
    search: '搜索',
    settings: '设置',
    logout: '退出',
    
    // Profile Selection
    whoIsWatching: '谁在观看？',
    newProfile: '新建档案',
    addProfile: '添加档案',
    profileName: '名称',
    create: '创建',
    deleteProfile: '删除档案？',
    
    // Channel List / Navigation
    home: '首页',
    live: '直播',
    movies: '电影',
    series: '电视剧',
    continueWatching: '继续观看',
    myList: '我的列表',
    recommended: '为您推荐',
    recentlyAdded: '最近添加',
    popular: '热门',
    searchPlaceholder: '标题、演员、类型...',
    noResults: '无结果',
    refreshCache: '刷新缓存',
    
    // Video Player
    play: '播放',
    pause: '暂停',
    resume: '继续',
    restart: '重新开始',
    nextEpisode: '下一集',
    previousEpisode: '上一集',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏',
    mute: '静音',
    unmute: '取消静音',
    cast: '投屏',
    castConnected: '正在投屏',
    castDisconnected: '投屏已断开',
    casting: '投屏中...',
    castTo: '投屏到',
    chromecast: 'Chromecast / 智能电视',
    chromecastDesc: 'Google Cast、Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV、iOS设备',
    externalPlayer: '外部播放器',
    externalPlayerDesc: 'VLC、MX Player、Kodi',
    shareLink: '分享',
    shareLinkDesc: '发送链接到其他应用',
    copyUrl: '复制链接',
    copyUrlDesc: '粘贴到其他播放器',
    urlCopied: '链接已复制！',

    // Movie/Series Details
    watchNow: '立即观看',
    addToList: '添加到列表',
    removeFromList: '从列表移除',
    moreInfo: '更多信息',
    castActors: '演员',
    director: '导演',
    genre: '类型',
    year: '年份',
    rating: '评分',
    duration: '时长',
    seasons: '季',
    episodes: '集',
    similarContent: '相似内容',
    
    // Profile Settings
    profileSettings: '档案设置',
    profile: '档案',
    languageAndSubtitles: '语言和字幕',
    contentLanguage: '内容语言',
    contentLanguageDesc: '首选音频语言',
    subtitleLanguage: '字幕语言',
    subtitleLanguageDesc: '默认字幕',
    playback: '播放',
    videoQuality: '画质',
    videoQualityDesc: '默认流媒体画质',
    autoPlay: '自动播放',
    autoPlayDesc: '自动播放下一集',
    skipIntro: '跳过片头',
    skipIntroDesc: '自动跳过片头',
    parentalControls: '家长控制',
    matureContent: '成人内容',
    matureContentDesc: '显示成人内容',
    saveChanges: '保存更改',
    
    // Quality Options
    qualityAuto: '自动',
    quality4k: '4K 超高清',
    quality1080p: '1080p 全高清',
    quality720p: '720p 高清',
    quality480p: '480p 标清',
    
    // Server / Login
    connectServer: '连接服务器',
    serverUrl: '服务器地址',
    username: '用户名',
    password: '密码',
    connect: '连接',
    welcome: '欢迎使用 StreamAI',
    welcomeDesc: '连接您的账户以访问数千种内容。',
    
    // AI Recommender
    aiRecommendations: 'AI 推荐',
    askAI: '询问 AI',
    aiPlaceholder: '您想看什么？',
    
    // Misc
    activeProfile: '当前档案',
    loadingLibrary: '加载媒体库...',
  },
  
  ar: {
    // Common
    back: 'رجوع',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    close: 'إغلاق',
    loading: 'جاري التحميل...',
    search: 'بحث',
    settings: 'الإعدادات',
    logout: 'تسجيل الخروج',
    
    // Profile Selection
    whoIsWatching: 'من يشاهد؟',
    newProfile: 'ملف شخصي جديد',
    addProfile: 'إضافة ملف شخصي',
    profileName: 'الاسم',
    create: 'إنشاء',
    deleteProfile: 'حذف الملف الشخصي؟',
    
    // Channel List / Navigation
    home: 'الرئيسية',
    live: 'البث المباشر',
    movies: 'الأفلام',
    series: 'المسلسلات',
    continueWatching: 'متابعة المشاهدة',
    myList: 'قائمتي',
    recommended: 'موصى به لك',
    recentlyAdded: 'أضيف مؤخراً',
    popular: 'الشائع',
    searchPlaceholder: 'العناوين، الممثلين، الأنواع...',
    noResults: 'لا توجد نتائج',
    refreshCache: 'تحديث الذاكرة المؤقتة',
    
    // Video Player
    play: 'تشغيل',
    pause: 'إيقاف مؤقت',
    resume: 'استئناف',
    restart: 'إعادة التشغيل',
    nextEpisode: 'الحلقة التالية',
    previousEpisode: 'الحلقة السابقة',
    fullscreen: 'ملء الشاشة',
    exitFullscreen: 'الخروج من ملء الشاشة',
    mute: 'كتم الصوت',
    unmute: 'إلغاء كتم الصوت',
    cast: 'بث',
    castConnected: 'جارٍ البث',
    castDisconnected: 'تم قطع البث',
    casting: 'جارٍ البث...',
    castTo: 'بث إلى',
    chromecast: 'Chromecast / تلفزيون ذكي',
    chromecastDesc: 'Google Cast، Android TV',
    airplay: 'AirPlay',
    airplayDesc: 'Apple TV، أجهزة iOS',
    externalPlayer: 'مشغل خارجي',
    externalPlayerDesc: 'VLC، MX Player، Kodi',
    shareLink: 'مشاركة',
    shareLinkDesc: 'إرسال الرابط إلى تطبيقات أخرى',
    copyUrl: 'نسخ الرابط',
    copyUrlDesc: 'لصق في مشغل آخر',
    urlCopied: 'تم نسخ الرابط!',

    // Movie/Series Details
    watchNow: 'شاهد الآن',
    addToList: 'إضافة إلى القائمة',
    removeFromList: 'إزالة من القائمة',
    moreInfo: 'مزيد من المعلومات',
    castActors: 'طاقم التمثيل',
    director: 'المخرج',
    genre: 'النوع',
    year: 'السنة',
    rating: 'التقييم',
    duration: 'المدة',
    seasons: 'المواسم',
    episodes: 'الحلقات',
    similarContent: 'محتوى مشابه',
    
    // Profile Settings
    profileSettings: 'إعدادات الملف الشخصي',
    profile: 'الملف الشخصي',
    languageAndSubtitles: 'اللغة والترجمة',
    contentLanguage: 'لغة المحتوى',
    contentLanguageDesc: 'اللغة المفضلة للصوت',
    subtitleLanguage: 'لغة الترجمة',
    subtitleLanguageDesc: 'الترجمة الافتراضية',
    playback: 'التشغيل',
    videoQuality: 'جودة الفيديو',
    videoQualityDesc: 'جودة البث الافتراضية',
    autoPlay: 'التشغيل التلقائي',
    autoPlayDesc: 'تشغيل الحلقة التالية تلقائياً',
    skipIntro: 'تخطي المقدمة',
    skipIntroDesc: 'تخطي المقدمة تلقائياً',
    parentalControls: 'الرقابة الأبوية',
    matureContent: 'محتوى للبالغين',
    matureContentDesc: 'عرض المحتوى للبالغين',
    saveChanges: 'حفظ التغييرات',
    
    // Quality Options
    qualityAuto: 'تلقائي',
    quality4k: '4K Ultra HD',
    quality1080p: '1080p Full HD',
    quality720p: '720p HD',
    quality480p: '480p SD',
    
    // Server / Login
    connectServer: 'الاتصال بالخادم',
    serverUrl: 'عنوان الخادم',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    connect: 'اتصال',
    welcome: 'مرحباً بك في StreamAI',
    welcomeDesc: 'قم بتوصيل حسابك للوصول إلى آلاف المحتويات.',
    
    // AI Recommender
    aiRecommendations: 'توصيات الذكاء الاصطناعي',
    askAI: 'اسأل الذكاء الاصطناعي',
    aiPlaceholder: 'ماذا تريد أن تشاهد؟',
    
    // Misc
    activeProfile: 'الملف الشخصي النشط',
    loadingLibrary: 'جاري تحميل المكتبة...',
  }
};

// Current language state
let currentLanguage: SupportedLanguage = 'it';

export const i18n = {
  /**
   * Set the current language
   */
  setLanguage: (lang: string) => {
    if (lang in translations) {
      currentLanguage = lang as SupportedLanguage;
    } else {
      // Fallback to English if language not supported
      currentLanguage = 'en';
    }
  },
  
  /**
   * Get the current language code
   */
  getLanguage: (): SupportedLanguage => currentLanguage,
  
  /**
   * Get all translations for the current language
   */
  t: (): Translations => translations[currentLanguage] || translations.en,
  
  /**
   * Get a specific translation key
   */
  get: (key: keyof Translations): string => {
    return translations[currentLanguage]?.[key] || translations.en[key] || key;
  },
  
  /**
   * Get translations for a specific language
   */
  forLanguage: (lang: string): Translations => {
    return translations[lang as SupportedLanguage] || translations.en;
  },
  
  /**
   * Check if a language is supported
   */
  isSupported: (lang: string): boolean => lang in translations,
  
  /**
   * Get the list of supported languages
   */
  getSupportedLanguages: (): SupportedLanguage[] => Object.keys(translations) as SupportedLanguage[]
};

export default i18n;

