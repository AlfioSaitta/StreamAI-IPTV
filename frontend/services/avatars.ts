/**
 * StreamAI — Avatar catalog (UI feature 2026-05-13).
 *
 * Set di 16 avatar predefiniti per i profili utente. Tutti gli avatar usano
 * lo stesso linguaggio grafico: icona Lucide a stroke uniforme (linea
 * costante 2 px) renderizzata in bianco al 92% di opacità su un cerchio
 * con gradient verticale derivato dal `color` del profilo. Questo garantisce
 * coerenza visiva totale a prescindere dall'avatar scelto: divertente ma
 * moderno e "design-system friendly".
 *
 * Categorie:
 *  - animals  → fauna friendly (cat, dog, bird, rabbit, fish, squirrel, turtle, paw)
 *  - fun      → oggetti pop / gaming (ghost, gamepad, rocket, crown)
 *  - lifestyle → cibo + sparkle (cherry, ice-cream, pizza, sparkles)
 *
 * Stabilità id: gli `id` devono restare stabili (salvati in `localStorage`
 * dentro `Profile.avatar`). Per aggiungere nuovi avatar usare nuovi id e
 * spingerli in coda all'array.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Cat,
  Dog,
  Bird,
  Rabbit,
  Fish,
  Squirrel,
  Turtle,
  PawPrint,
  Ghost,
  Gamepad2,
  Rocket,
  Crown,
  Cherry,
  IceCream2,
  Pizza,
  Sparkles,
  User,
} from 'lucide-react';

export type AvatarCategory = 'animals' | 'fun' | 'lifestyle';

export interface AvatarOption {
  /** ID stabile salvato in `Profile.avatar`. */
  id: string;
  /** Label leggibile (it). */
  label: string;
  /** Icona Lucide renderizzata al centro del cerchio. */
  icon: LucideIcon;
  category: AvatarCategory;
}

export const AVATARS: AvatarOption[] = [
  // Animals
  { id: 'cat',       label: 'Gatto',        icon: Cat,         category: 'animals' },
  { id: 'dog',       label: 'Cane',         icon: Dog,         category: 'animals' },
  { id: 'bird',      label: 'Uccellino',    icon: Bird,        category: 'animals' },
  { id: 'rabbit',    label: 'Coniglio',     icon: Rabbit,      category: 'animals' },
  { id: 'fish',      label: 'Pesce',        icon: Fish,        category: 'animals' },
  { id: 'squirrel',  label: 'Scoiattolo',   icon: Squirrel,    category: 'animals' },
  { id: 'turtle',    label: 'Tartaruga',    icon: Turtle,      category: 'animals' },
  { id: 'paw',       label: 'Zampetta',     icon: PawPrint,    category: 'animals' },

  // Fun / Pop
  { id: 'ghost',     label: 'Fantasmino',   icon: Ghost,       category: 'fun' },
  { id: 'gamepad',   label: 'Gamer',        icon: Gamepad2,    category: 'fun' },
  { id: 'rocket',    label: 'Razzo',        icon: Rocket,      category: 'fun' },
  { id: 'crown',     label: 'Re',           icon: Crown,       category: 'fun' },

  // Lifestyle
  { id: 'cherry',    label: 'Ciliegia',     icon: Cherry,      category: 'lifestyle' },
  { id: 'ice-cream', label: 'Gelato',       icon: IceCream2,    category: 'lifestyle' },
  { id: 'pizza',     label: 'Pizza',        icon: Pizza,       category: 'lifestyle' },
  { id: 'sparkles',  label: 'Magia',        icon: Sparkles,    category: 'lifestyle' },
];

export const DEFAULT_AVATAR_ID = 'cat';

const AVATAR_INDEX = new Map<string, AvatarOption>(
  AVATARS.map((a) => [a.id, a]),
);

/**
 * Ritorna l'opzione avatar per l'id, oppure un fallback generico (User) se
 * l'id non è riconosciuto (es. profilo legacy senza campo `avatar`).
 */
export function getAvatar(id?: string | null): AvatarOption {
  if (id) {
    const found = AVATAR_INDEX.get(id);
    if (found) return found;
  }
  return AVATAR_INDEX.get(DEFAULT_AVATAR_ID) ?? {
    id: 'fallback',
    label: 'Profilo',
    icon: User,
    category: 'fun',
  };
}

/**
 * Assegna un avatar deterministico in base all'indice del profilo: usato in
 * fase di creazione quando l'utente non sceglie esplicitamente nulla.
 */
export function pickDefaultAvatarFor(index: number): string {
  return AVATARS[index % AVATARS.length].id;
}

