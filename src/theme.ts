export const THEME_STORAGE_KEY = 'classic-chess.theme.v1';
export const THEME_CHANGE_EVENT = 'classic-chess:theme-change';

export const THEME_CATEGORIES = [
  {
    id: 'original',
    name: 'Original Classic',
    shortName: 'Original',
    symbol: '♞',
    description: 'The warm, dark Classic Chess interface exactly as the site was originally designed.',
  },
  {
    id: 'modernist',
    name: 'Modernist & Bold',
    shortName: 'Modern',
    symbol: '◆',
    description: 'Graphic systems built from grids, geometry, and unapologetic colour.',
  },
  {
    id: 'print-editorial',
    name: 'Print & Editorial',
    shortName: 'Print',
    symbol: '¶',
    description: 'Tactile pages, expressive typography, ink, grain, and publishing craft.',
  },
  {
    id: 'heritage',
    name: 'Heritage & Ornament',
    shortName: 'Heritage',
    symbol: '✦',
    description: 'Historic ateliers, ceremonial spaces, and intricate decorative traditions.',
  },
  {
    id: 'material',
    name: 'Tactile Materials',
    shortName: 'Material',
    symbol: '⬡',
    description: 'Wood, stone, clay, ceramic, and metal with a tangible sense of surface.',
  },
  {
    id: 'retro-digital',
    name: 'Retro Digital',
    shortName: 'Retro',
    symbol: '▣',
    description: 'Beloved screens and interfaces from phosphor terminals to Y2K dreamscapes.',
  },
  {
    id: 'future-worlds',
    name: 'Future Worlds',
    shortName: 'Future',
    symbol: '◉',
    description: 'Speculative systems, celestial architecture, and optimistic tomorrow-tech.',
  },
  {
    id: 'story-drama',
    name: 'Story & Drama',
    shortName: 'Stories',
    symbol: '❦',
    description: 'Cinematic, literary, playful, and character-rich worlds with a strong voice.',
  },
  {
    id: 'escapes',
    name: 'Escapes & Elements',
    shortName: 'Escapes',
    symbol: '≈',
    description: 'Atmospheric destinations shaped by climate, landscape, and natural light.',
  },
] as const;

export type ThemeCategory = (typeof THEME_CATEGORIES)[number];
export type ThemeGroup = ThemeCategory['id'];

export const THEME_DEFINITIONS = [
  {
    id: 'classic',
    name: 'Original Classic',
    description: 'The untouched original site skin: cream, walnut, evergreen, and tournament gold.',
    group: 'original',
    swatches: ['#171812', '#f4ead8', '#d8a74f'],
  },
  {
    id: 'flat-icon',
    name: 'Flat Icon',
    description: 'Bold vector shapes and a bright, joyful Material-era palette.',
    group: 'modernist',
    swatches: ['#ff6b6b', '#4ecdc4', '#ffd93d'],
  },
  {
    id: 'hand-drawn',
    name: 'Hand-Drawn Sketchbook',
    description: 'Notebook paper, lively ink marks, and red-pencil annotations.',
    group: 'print-editorial',
    swatches: ['#fbf7ec', '#1f4e9c', '#c4362f'],
  },
  {
    id: 'swiss',
    name: 'Swiss International',
    description: 'A rigorous grid with monumental type and one signal red.',
    group: 'modernist',
    swatches: ['#ffffff', '#000000', '#e4002b'],
  },
  {
    id: 'art-deco',
    name: 'Gilded Salon',
    description: 'A symmetrical 1920s club in forest green, ivory, and gold.',
    group: 'heritage',
    swatches: ['#0e2a22', '#c9a227', '#efe6d2'],
  },
  {
    id: 'newspaper',
    name: 'Daily Knight',
    description: 'Broadsheet newsprint, masthead rules, and halftone portraiture.',
    group: 'print-editorial',
    swatches: ['#f2ede1', '#1a1a1a', '#8c1d18'],
  },
  {
    id: 'neo-brutalist',
    name: 'Neo-Brutalist',
    description: 'Hard shadows, thick black outlines, and fearless colour blocks.',
    group: 'modernist',
    swatches: ['#ffd93d', '#ff5e5b', '#00cecb'],
  },
  {
    id: 'terminal',
    name: 'Terminal / Engine Console',
    description: 'A phosphor chess-engine console with crisp text-mode readouts.',
    group: 'retro-digital',
    swatches: ['#0a0e0a', '#33ff66', '#d9ffe1'],
  },
  {
    id: 'blueprint',
    name: 'Blueprint / Technical Drawing',
    description: 'Drafting navy, cyan construction lines, and measured annotations.',
    group: 'future-worlds',
    swatches: ['#0d2b45', '#7fc4e8', '#ffb84d'],
  },
  {
    id: 'risograph',
    name: 'Risograph Print',
    description: 'Fluorescent spot inks, paper grain, and playful misregistration.',
    group: 'print-editorial',
    swatches: ['#f4efe3', '#ff48b0', '#0b63f6'],
  },
  {
    id: 'wooden',
    name: 'Wooden Chess Set',
    description: 'Walnut, green baize, brass, and warm tournament-room tactility.',
    group: 'material',
    swatches: ['#4a2c17', '#1e5631', '#d4af6a'],
  },
  {
    id: 'marble',
    name: 'Marble Museum',
    description: 'Gallery-white stone, bronze details, and contemplative space.',
    group: 'material',
    swatches: ['#fafaf8', '#d5d2cb', '#8a7350'],
  },
  {
    id: 'arcade-neon',
    name: '80s Arcade Neon',
    description: 'A synthwave attract screen glowing in electric cyan and magenta.',
    group: 'retro-digital',
    swatches: ['#0a0118', '#ff2e97', '#00f0ff'],
  },
  {
    id: 'frutiger-aero',
    name: 'Frutiger Aero',
    description: 'Optimistic Y2K glass, aqua skies, and glossy gel controls.',
    group: 'retro-digital',
    swatches: ['#8fd9f5', '#d7f0fa', '#6bc24a'],
  },
  {
    id: 'desktop-90s',
    name: '90s Desktop OS',
    description: 'Teal desktop, grey window chrome, and satisfyingly bevelled buttons.',
    group: 'retro-digital',
    swatches: ['#008080', '#c0c0c0', '#000080'],
  },
  {
    id: 'editorial',
    name: 'Editorial Magazine',
    description: 'A luxurious asymmetric spread with expressive display serif type.',
    group: 'print-editorial',
    swatches: ['#f7f4ef', '#16130f', '#6e1f2a'],
  },
  {
    id: 'cyberpunk-hud',
    name: 'Cyberpunk HUD',
    description: 'Angular tactical readouts in holographic cyan and warning amber.',
    group: 'future-worlds',
    swatches: ['#06090d', '#22d3ee', '#f59e0b'],
  },
  {
    id: 'japanese-minimal',
    name: 'Japanese Minimal',
    description: 'Washi, sumi ink, a vermilion seal, and generous quiet space.',
    group: 'heritage',
    swatches: ['#f5f2ea', '#1c1a17', '#c7382e'],
  },
  {
    id: 'stained-glass',
    name: 'Stained Glass',
    description: 'Cathedral jewel tones, illuminated gold, and leaded geometry.',
    group: 'heritage',
    swatches: ['#14102a', '#1b3fa0', '#c8a951'],
  },
  {
    id: 'bauhaus',
    name: 'Bauhaus Constructivist',
    description: 'Dynamic primary geometry shaped like a modernist chess poster.',
    group: 'modernist',
    swatches: ['#e63329', '#1b4fa0', '#f5c518'],
  },
  {
    id: 'soft-clay',
    name: 'Soft Clay',
    description: 'Puffy pastel pieces with toy-like depth and tactile softness.',
    group: 'material',
    swatches: ['#efe9ff', '#7be0c0', '#ff9e9e'],
  },
  {
    id: 'solarpunk-conservatory',
    name: 'Solarpunk Conservatory',
    description: 'A sunlit greenhouse where living systems and elegant technology intertwine.',
    group: 'future-worlds',
    swatches: ['#073b2a', '#89e86d', '#f4c95d'],
  },
  {
    id: 'noir-detective',
    name: 'Noir Detective',
    description: 'Rain-cut shadows, silver gelatin, and a single dangerous slash of red.',
    group: 'story-drama',
    swatches: ['#090b10', '#c8cdd3', '#b81f2d'],
  },
  {
    id: 'cosmic-observatory',
    name: 'Cosmic Observatory',
    description: 'A deep-space planetarium of orbital diagrams, starlight, and quiet wonder.',
    group: 'future-worlds',
    swatches: ['#07051a', '#7765ff', '#f2d47c'],
  },
  {
    id: 'royal-opera',
    name: 'Royal Opera',
    description: 'Crimson velvet, gilded balconies, and the theatrical hush before a performance.',
    group: 'heritage',
    swatches: ['#240816', '#a30d48', '#e7c36a'],
  },
  {
    id: 'library-at-midnight',
    name: 'Library at Midnight',
    description: 'Lamplit stacks, leather bindings, brass ladders, and secrets after closing.',
    group: 'story-drama',
    swatches: ['#16100b', '#583a24', '#d0a75a'],
  },
  {
    id: 'mediterranean-ceramic',
    name: 'Mediterranean Ceramic',
    description: 'Hand-painted cobalt tile, sun-warmed plaster, and lively terracotta accents.',
    group: 'material',
    swatches: ['#f7f0dc', '#176b87', '#d56f3e'],
  },
  {
    id: 'botanical-engraving',
    name: 'Botanical Engraving',
    description: 'A naturalist folio of fine crosshatching, specimen labels, and pressed colour.',
    group: 'print-editorial',
    swatches: ['#f1ead8', '#273d2b', '#9c3c32'],
  },
  {
    id: 'memphis-pop',
    name: 'Memphis Pop',
    description: 'Playful 1980s squiggles, confetti geometry, and irreverent candy colour.',
    group: 'modernist',
    swatches: ['#fff4db', '#f05496', '#2c7be5'],
  },
  {
    id: 'desert-modernism',
    name: 'Desert Modernism',
    description: 'Adobe planes, long architectural shadows, and a cool oasis of desert green.',
    group: 'escapes',
    swatches: ['#e8c39e', '#a84c32', '#3d6e69'],
  },
  {
    id: 'oceanic-biome',
    name: 'Oceanic Biome',
    description: 'A bioluminescent underwater world with tidal glass and drifting sea life.',
    group: 'escapes',
    swatches: ['#031d2d', '#04a6a6', '#a7efdb'],
  },
  {
    id: 'alpine-lodge',
    name: 'Alpine Lodge',
    description: 'Snow-bright windows, carved timber, wool blankets, and an ember-warm hearth.',
    group: 'escapes',
    swatches: ['#edf2ed', '#244638', '#b44536'],
  },
  {
    id: 'candy-kawaii',
    name: 'Candy Kawaii',
    description: 'Tiny mascots, sticker-bright controls, sprinkles, and unapologetic sweetness.',
    group: 'story-drama',
    swatches: ['#fff0f6', '#ff6fb5', '#6c66e8'],
  },
  {
    id: 'lunar-colony',
    name: 'Lunar Colony',
    description: 'Utilitarian moonbase panels, regolith dust, and vivid mission-orange signals.',
    group: 'future-worlds',
    swatches: ['#080c16', '#b8c3cc', '#ff7a45'],
  },
  {
    id: 'persian-miniature',
    name: 'Persian Miniature',
    description: 'Lapis gardens, turquoise arabesques, gold borders, and jewel-like storytelling.',
    group: 'heritage',
    swatches: ['#172a5e', '#1fa6a0', '#e0a02b'],
  },
  {
    id: 'vaporwave-dream',
    name: 'Vaporwave Dream',
    description: 'A surreal mall-at-midnight haze of marble, palms, magenta, and cyan.',
    group: 'retro-digital',
    swatches: ['#160b34', '#f45cff', '#56e1ff'],
  },
  {
    id: 'dark-academia',
    name: 'Dark Academia',
    description: 'Oxidized ink, old oak, scholarly marginalia, and candlelit concentration.',
    group: 'story-drama',
    swatches: ['#17130f', '#704a2d', '#b99962'],
  },
  {
    id: 'pop-art-comic',
    name: 'Pop Art Comic',
    description: 'Ben-Day dots, explosive captions, primary inks, and panel-to-panel energy.',
    group: 'story-drama',
    swatches: ['#fff026', '#ed1c24', '#1d4ed8'],
  },
  {
    id: 'nordic-frost',
    name: 'Nordic Frost',
    description: 'Pale winter daylight, smoky blue glass, and one hearth-red human accent.',
    group: 'escapes',
    swatches: ['#eaf6f5', '#668e9b', '#c7634d'],
  },
  {
    id: 'tropical-resort',
    name: 'Tropical Resort',
    description: 'Poolside modernism, lush palms, sunset coral, and woven island textures.',
    group: 'escapes',
    swatches: ['#063d38', '#f2784b', '#f4d35e'],
  },
  {
    id: 'kinetic-chrome',
    name: 'Kinetic Chrome',
    description: 'Polished liquid metal, machined edges, and cool highlights in constant motion.',
    group: 'material',
    swatches: ['#10141a', '#bfcad4', '#59d8e8'],
  },
] as const;

export type ThemeDefinition = (typeof THEME_DEFINITIONS)[number];
export type ThemeId = ThemeDefinition['id'];

export type ThemeLayoutFamily =
  | 'original'
  | 'publication'
  | 'poster'
  | 'workstation'
  | 'cabinet'
  | 'gallery'
  | 'playroom'
  | 'orbital'
  | 'terrace'
  | 'proscenium'
  | 'instrument';

export type ThemeLayoutVariant =
  | 'canonical'
  | 'mirror'
  | 'hero-dominant'
  | 'interaction-dominant';

export type ThemeLayoutIdentity = Readonly<{
  family: ThemeLayoutFamily;
  variant: ThemeLayoutVariant;
}>;

/**
 * Stable composition identities for the original skin and all 40 presets.
 * These values are deliberately separate from colour/style categories: they
 * describe screen architecture and let CSS create premium macro-layouts
 * without rendering alternate React trees or remounting a live game.
 */
export const THEME_LAYOUT_IDENTITIES = {
  classic: { family: 'original', variant: 'canonical' },

  'hand-drawn': { family: 'publication', variant: 'canonical' },
  newspaper: { family: 'publication', variant: 'mirror' },
  risograph: { family: 'publication', variant: 'hero-dominant' },
  editorial: { family: 'publication', variant: 'interaction-dominant' },

  swiss: { family: 'poster', variant: 'canonical' },
  bauhaus: { family: 'poster', variant: 'mirror' },
  'neo-brutalist': { family: 'poster', variant: 'hero-dominant' },
  'pop-art-comic': { family: 'poster', variant: 'interaction-dominant' },

  terminal: { family: 'workstation', variant: 'canonical' },
  blueprint: { family: 'workstation', variant: 'mirror' },
  'desktop-90s': { family: 'workstation', variant: 'hero-dominant' },
  'cyberpunk-hud': { family: 'workstation', variant: 'interaction-dominant' },

  wooden: { family: 'cabinet', variant: 'canonical' },
  'art-deco': { family: 'cabinet', variant: 'mirror' },
  'dark-academia': { family: 'cabinet', variant: 'hero-dominant' },
  'library-at-midnight': { family: 'cabinet', variant: 'interaction-dominant' },

  marble: { family: 'gallery', variant: 'canonical' },
  'japanese-minimal': { family: 'gallery', variant: 'mirror' },
  'nordic-frost': { family: 'gallery', variant: 'hero-dominant' },
  'botanical-engraving': { family: 'gallery', variant: 'interaction-dominant' },

  'flat-icon': { family: 'playroom', variant: 'canonical' },
  'soft-clay': { family: 'playroom', variant: 'mirror' },
  'candy-kawaii': { family: 'playroom', variant: 'hero-dominant' },
  'memphis-pop': { family: 'playroom', variant: 'interaction-dominant' },

  'cosmic-observatory': { family: 'orbital', variant: 'canonical' },
  'solarpunk-conservatory': { family: 'orbital', variant: 'mirror' },
  'oceanic-biome': { family: 'orbital', variant: 'hero-dominant' },
  'vaporwave-dream': { family: 'orbital', variant: 'interaction-dominant' },

  'desert-modernism': { family: 'terrace', variant: 'canonical' },
  'mediterranean-ceramic': { family: 'terrace', variant: 'mirror' },
  'alpine-lodge': { family: 'terrace', variant: 'hero-dominant' },
  'tropical-resort': { family: 'terrace', variant: 'interaction-dominant' },

  'stained-glass': { family: 'proscenium', variant: 'canonical' },
  'noir-detective': { family: 'proscenium', variant: 'mirror' },
  'royal-opera': { family: 'proscenium', variant: 'hero-dominant' },
  'persian-miniature': { family: 'proscenium', variant: 'interaction-dominant' },

  'arcade-neon': { family: 'instrument', variant: 'canonical' },
  'frutiger-aero': { family: 'instrument', variant: 'mirror' },
  'lunar-colony': { family: 'instrument', variant: 'hero-dominant' },
  'kinetic-chrome': { family: 'instrument', variant: 'interaction-dominant' },
} as const satisfies Record<ThemeId, ThemeLayoutIdentity>;

/**
 * Presets enter the premium composition system only after their layout, copy,
 * responsive behavior, and visual QA land together. Keeping this rollout list
 * explicit prevents foundation CSS from changing unfinished presets.
 */
export const PREMIUM_READY_THEME_IDS = ['flat-icon', 'hand-drawn', 'swiss', 'art-deco', 'newspaper', 'neo-brutalist', 'terminal', 'blueprint', 'risograph', 'wooden', 'marble', 'arcade-neon', 'frutiger-aero', 'desktop-90s', 'editorial', 'cyberpunk-hud', 'japanese-minimal', 'stained-glass', 'bauhaus', 'soft-clay', 'solarpunk-conservatory', 'noir-detective', 'cosmic-observatory', 'royal-opera', 'library-at-midnight', 'mediterranean-ceramic', 'botanical-engraving', 'memphis-pop', 'desert-modernism', 'oceanic-biome', 'alpine-lodge', 'candy-kawaii', 'lunar-colony', 'persian-miniature', 'vaporwave-dream', 'dark-academia', 'pop-art-comic', 'nordic-frost', 'tropical-resort', 'kinetic-chrome'] as const satisfies readonly ThemeId[];

const PREMIUM_READY_THEME_ID_SET = new Set<ThemeId>(PREMIUM_READY_THEME_IDS);

/**
 * The multi-theme system remains available for future experiments, but the
 * public product currently ships as one authored visual identity.
 */
export const THEME_SWITCHING_ENABLED = false;
export const DEFAULT_THEME_ID: ThemeId = 'japanese-minimal';

const THEME_IDS = new Set<string>(THEME_DEFINITIONS.map((theme) => theme.id));

export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ThemeRoot = Pick<HTMLElement, 'dataset'>;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value);
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function readStoredTheme(storage?: ThemeStorage | null): ThemeId {
  if (!THEME_SWITCHING_ENABLED) return DEFAULT_THEME_ID;
  if (!storage) return DEFAULT_THEME_ID;
  try {
    return normalizeThemeId(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function persistTheme(themeId: ThemeId, storage?: ThemeStorage | null): void {
  if (!THEME_SWITCHING_ENABLED) return;
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Browsers can reject storage in private mode or under strict policies.
  }
}

export function applyTheme(themeId: ThemeId, root?: ThemeRoot | null): ThemeId {
  const resolvedThemeId = normalizeThemeId(themeId);
  if (root) {
    const theme = getThemeDefinition(resolvedThemeId);
    const layout = THEME_LAYOUT_IDENTITIES[resolvedThemeId];
    root.dataset.theme = resolvedThemeId;
    root.dataset.themeGroup = theme.group;
    root.dataset.layoutFamily = layout.family;
    root.dataset.layoutVariant = layout.variant;
    root.dataset.premiumLayout = PREMIUM_READY_THEME_ID_SET.has(resolvedThemeId) ? 'true' : 'false';
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
      detail: { themeId: resolvedThemeId },
    }));
  }
  return resolvedThemeId;
}

export function initializeTheme(
  documentLike?: Pick<Document, 'documentElement'> | null,
  storage?: ThemeStorage | null,
): ThemeId {
  const resolvedStorage = storage === undefined
    ? safelyReadBrowserStorage()
    : storage;
  const themeId = readStoredTheme(resolvedStorage);
  return applyTheme(themeId, documentLike?.documentElement);
}

export function safelyReadBrowserStorage(): ThemeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
  return THEME_DEFINITIONS.find((theme) => theme.id === themeId)
    ?? THEME_DEFINITIONS.find((theme) => theme.id === DEFAULT_THEME_ID)!;
}

export function getThemeCategory(group: ThemeGroup): ThemeCategory {
  return THEME_CATEGORIES.find((category) => category.id === group)
    ?? THEME_CATEGORIES[0];
}

export function getThemesInCategory(group: ThemeGroup): readonly ThemeDefinition[] {
  return THEME_DEFINITIONS.filter((theme) => theme.group === group);
}
