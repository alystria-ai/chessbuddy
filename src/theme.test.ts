import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME_ID,
  THEME_SWITCHING_ENABLED,
  THEME_CHANGE_EVENT,
  THEME_CATEGORIES,
  THEME_DEFINITIONS,
  THEME_LAYOUT_IDENTITIES,
  PREMIUM_READY_THEME_IDS,
  THEME_STORAGE_KEY,
  applyTheme,
  initializeTheme,
  getThemeCategory,
  getThemesInCategory,
  isThemeId,
  normalizeThemeId,
  persistTheme,
  readStoredTheme,
  type ThemeStorage,
} from './theme';

function storageWith(initialValue: string | null = null): ThemeStorage & { value: string | null } {
  return {
    value: initialValue,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
}

describe('theme registry', () => {
  it('contains the original default plus the exact 40 design preset ids once each', () => {
    const expectedIds = [
      'classic',
      'flat-icon', 'hand-drawn', 'swiss', 'art-deco', 'newspaper',
      'neo-brutalist', 'terminal', 'blueprint', 'risograph', 'wooden',
      'marble', 'arcade-neon', 'frutiger-aero', 'desktop-90s', 'editorial',
      'cyberpunk-hud', 'japanese-minimal', 'stained-glass', 'bauhaus', 'soft-clay',
      'solarpunk-conservatory', 'noir-detective', 'cosmic-observatory', 'royal-opera',
      'library-at-midnight', 'mediterranean-ceramic', 'botanical-engraving', 'memphis-pop',
      'desert-modernism', 'oceanic-biome', 'alpine-lodge', 'candy-kawaii', 'lunar-colony',
      'persian-miniature', 'vaporwave-dream', 'dark-academia', 'pop-art-comic',
      'nordic-frost', 'tropical-resort', 'kinetic-chrome',
    ];

    expect(THEME_DEFINITIONS.map((theme) => theme.id)).toEqual(expectedIds);
    expect(new Set(THEME_DEFINITIONS.map((theme) => theme.id)).size).toBe(41);
    for (const theme of THEME_DEFINITIONS) {
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.group.length).toBeGreaterThan(0);
      expect(theme.swatches).toHaveLength(3);
    }
  });

  it('keeps the original in its own collection and the presets in eight five-style collections', () => {
    expect(THEME_CATEGORIES.map((category) => category.id)).toEqual([
      'original',
      'modernist',
      'print-editorial',
      'heritage',
      'material',
      'retro-digital',
      'future-worlds',
      'story-drama',
      'escapes',
    ]);

    for (const category of THEME_CATEGORIES) {
      expect(getThemesInCategory(category.id)).toHaveLength(category.id === 'original' ? 1 : 5);
      expect(getThemeCategory(category.id)).toBe(category);
      expect(category.name.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });

  it('assigns every theme one complete typed layout identity', () => {
    expect(Object.keys(THEME_LAYOUT_IDENTITIES).sort()).toEqual(
      THEME_DEFINITIONS.map((theme) => theme.id).sort(),
    );
    expect(THEME_LAYOUT_IDENTITIES.classic).toEqual({
      family: 'original',
      variant: 'canonical',
    });

    const artisticFamilies = [
      'publication', 'poster', 'workstation', 'cabinet', 'gallery',
      'playroom', 'orbital', 'terrace', 'proscenium', 'instrument',
    ] as const;
    const expectedVariants = [
      'canonical', 'mirror', 'hero-dominant', 'interaction-dominant',
    ];

    for (const family of artisticFamilies) {
      const variants = Object.values(THEME_LAYOUT_IDENTITIES)
        .filter((layout) => layout.family === family)
        .map((layout) => layout.variant)
        .sort();
      expect(variants).toEqual([...expectedVariants].sort());
    }
  });

  it('only enables premium composition for presets completed end to end', () => {
    expect(PREMIUM_READY_THEME_IDS).toEqual(['flat-icon', 'hand-drawn', 'swiss', 'art-deco', 'newspaper', 'neo-brutalist', 'terminal', 'blueprint', 'risograph', 'wooden', 'marble', 'arcade-neon', 'frutiger-aero', 'desktop-90s', 'editorial', 'cyberpunk-hud', 'japanese-minimal', 'stained-glass', 'bauhaus', 'soft-clay', 'solarpunk-conservatory', 'noir-detective', 'cosmic-observatory', 'royal-opera', 'library-at-midnight', 'mediterranean-ceramic', 'botanical-engraving', 'memphis-pop', 'desert-modernism', 'oceanic-biome', 'alpine-lodge', 'candy-kawaii', 'lunar-colony', 'persian-miniature', 'vaporwave-dream', 'dark-academia', 'pop-art-comic', 'nordic-frost', 'tropical-resort', 'kinetic-chrome']);
    for (const themeId of PREMIUM_READY_THEME_IDS) {
      expect(isThemeId(themeId)).toBe(true);
      expect(isThemeId(themeId)).toBe(true);
    }
  });

  it('validates ids and normalizes stale values', () => {
    expect(DEFAULT_THEME_ID).toBe('japanese-minimal');
    expect(THEME_SWITCHING_ENABLED).toBe(false);
    expect(isThemeId('classic')).toBe(true);
    expect(isThemeId('arcade-neon')).toBe(true);
    expect(isThemeId('cosmic-observatory')).toBe(true);
    expect(isThemeId('future-theme')).toBe(false);
    expect(normalizeThemeId('future-theme')).toBe(DEFAULT_THEME_ID);
    expect(normalizeThemeId(null)).toBe(DEFAULT_THEME_ID);
  });
});

describe('theme persistence', () => {
  it('keeps stored theme preferences dormant while theme switching is disabled', () => {
    const storage = storageWith('swiss');
    expect(readStoredTheme(storage)).toBe('japanese-minimal');

    persistTheme('bauhaus', storage);
    expect(storage.value).toBe('swiss');
  });

  it('falls back safely for missing, stale, or inaccessible storage', () => {
    expect(readStoredTheme(storageWith())).toBe(DEFAULT_THEME_ID);
    expect(readStoredTheme(storageWith('removed-preset'))).toBe(DEFAULT_THEME_ID);
    expect(readStoredTheme({
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    })).toBe(DEFAULT_THEME_ID);

    expect(() => persistTheme('marble', {
      getItem() { return null; },
      setItem() { throw new Error('quota'); },
    })).not.toThrow();
  });

  it('retains the versioned key for a future re-enabled selector', () => {
    let observedKey = '';
    readStoredTheme({
      getItem(key) { observedKey = key; return 'terminal'; },
      setItem() {},
    });
    expect(observedKey).toBe('');
    expect(THEME_STORAGE_KEY).toBe('classic-chess.theme.v1');
  });
});

describe('theme initialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies the stored theme to documentElement synchronously', () => {
    const root = { dataset: {} as DOMStringMap };
    const selected = initializeTheme(
      { documentElement: root as HTMLElement },
      storageWith('japanese-minimal'),
    );

    expect(selected).toBe('japanese-minimal');
    expect(root.dataset.theme).toBe('japanese-minimal');
    expect(root.dataset.themeGroup).toBe('heritage');
    expect(root.dataset.layoutFamily).toBe('gallery');
    expect(root.dataset.layoutVariant).toBe('mirror');
    expect(root.dataset.premiumLayout).toBe('true');
  });

  it('normalizes an invalid theme to a complete original layout dataset', () => {
    const root = {
      dataset: {
        theme: 'stale',
        themeGroup: 'stale',
        layoutFamily: 'stale',
        layoutVariant: 'stale',
        premiumLayout: 'true',
      } as DOMStringMap,
    };
    expect(applyTheme('invalid' as never, root as HTMLElement)).toBe(DEFAULT_THEME_ID);
    expect(root.dataset.theme).toBe(DEFAULT_THEME_ID);
    expect(root.dataset.themeGroup).toBe('heritage');
    expect(root.dataset.layoutFamily).toBe('gallery');
    expect(root.dataset.layoutVariant).toBe('mirror');
    expect(root.dataset.premiumLayout).toBe('true');
  });

  it('sets the premium composition gate for a ready preset', () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme('flat-icon', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('hand-drawn', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('swiss', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('art-deco', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('newspaper', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('neo-brutalist', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('terminal', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('blueprint', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('risograph', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('wooden', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('marble', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('arcade-neon', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('frutiger-aero', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('desktop-90s', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('editorial', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('cyberpunk-hud', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('japanese-minimal', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('stained-glass', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('bauhaus', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('soft-clay', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('solarpunk-conservatory', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('noir-detective', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('cosmic-observatory', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('royal-opera', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('library-at-midnight', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('mediterranean-ceramic', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('botanical-engraving', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('memphis-pop', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('desert-modernism', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('oceanic-biome', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('alpine-lodge', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('candy-kawaii', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('lunar-colony', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('persian-miniature', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('vaporwave-dream', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('dark-academia', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('pop-art-comic', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('nordic-frost', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('tropical-resort', root);
    expect(root.dataset.premiumLayout).toBe('true');

    applyTheme('kinetic-chrome', root);
    expect(root.dataset.premiumLayout).toBe('true');
  });

  it('publishes a theme-change event for external React subscribers', () => {
    const dispatchEvent = vi.fn();
    class FakeCustomEvent {
      constructor(public type: string, public init: { detail: unknown }) {}
    }
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', FakeCustomEvent);

    applyTheme('flat-icon', { dataset: {} as DOMStringMap });

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: THEME_CHANGE_EVENT,
      init: { detail: { themeId: 'flat-icon' } },
    });
  });
});
