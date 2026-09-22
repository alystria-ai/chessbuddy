import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  THEME_CATEGORIES,
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeCategory,
  getThemeDefinition,
  getThemesInCategory,
  normalizeThemeId,
  persistTheme,
  readStoredTheme,
  safelyReadBrowserStorage,
  type ThemeGroup,
  type ThemeId,
} from './theme';

const SWATCH_STYLE_PROPERTY = '--theme-preview-colour';
const MOBILE_CATEGORY_QUERY = '(max-width: 760px)';

function notifyThemeLayoutChanged() {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      document.documentElement.classList.remove('theme-switching');
    });
  });
}

function beginThemeSwitch() {
  document.documentElement.classList.add('theme-switching');
}

type CategoryOrientation = 'horizontal' | 'vertical';

export function getNextCategoryIndex(
  key: string,
  index: number,
  itemCount: number,
  orientation: CategoryOrientation,
): number | null {
  if (itemCount <= 0) return null;
  const forwardKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const backwardKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

  if (key === forwardKey) return (index + 1) % itemCount;
  if (key === backwardKey) return (index - 1 + itemCount) % itemCount;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  return null;
}

function previewStyle(colour: string): CSSProperties {
  return { [SWATCH_STYLE_PROPERTY]: colour, backgroundColor: colour } as CSSProperties;
}

export default function ThemeSwitcher() {
  const popoverId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const categoryRefs = useRef(new Map<ThemeGroup, HTMLButtonElement>());
  const optionRefs = useRef(new Map<ThemeId, HTMLButtonElement>());
  const [open, setOpen] = useState(false);
  const [mobileCategoryStrip, setMobileCategoryStrip] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_CATEGORY_QUERY).matches
  ));
  const [themeId, setThemeId] = useState<ThemeId>(() => readStoredTheme(safelyReadBrowserStorage()));
  const currentTheme = getThemeDefinition(themeId);
  const [activeGroup, setActiveGroup] = useState<ThemeGroup>(currentTheme.group);
  const activeCategory = getThemeCategory(activeGroup);
  const visibleThemes = useMemo(() => getThemesInCategory(activeGroup), [activeGroup]);
  const presetCount = THEME_CATEGORIES.reduce(
    (count, category) => count + getThemesInCategory(category.id).length,
    0,
  );
  const selectedThemeIsVisible = visibleThemes.some((theme) => theme.id === themeId);
  const categoryOrientation: CategoryOrientation = mobileCategoryStrip ? 'horizontal' : 'vertical';

  const tabId = (group: ThemeGroup) => `${popoverId}-tab-${group}`;
  const panelId = `${popoverId}-panel`;

  const selectTheme = useCallback((nextThemeId: ThemeId) => {
    const nextTheme = getThemeDefinition(nextThemeId);
    beginThemeSwitch();
    applyTheme(nextThemeId, document.documentElement);
    persistTheme(nextThemeId, safelyReadBrowserStorage());
    setThemeId(nextThemeId);
    setActiveGroup(nextTheme.group);
    notifyThemeLayoutChanged();
  }, []);

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openPicker = useCallback(() => {
    setActiveGroup(getThemeDefinition(themeId).group);
    setOpen(true);
  }, [themeId]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(MOBILE_CATEGORY_QUERY);
    const updateOrientation = () => setMobileCategoryStrip(mediaQuery.matches);
    updateOrientation();
    mediaQuery.addEventListener('change', updateOrientation);
    return () => mediaQuery.removeEventListener('change', updateOrientation);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => categoryRefs.current.get(activeGroup)?.focus());
    // Only opening the picker moves focus. Changing tabs manages focus directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeAndRestoreFocus();
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeAndRestoreFocus, open]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextThemeId = normalizeThemeId(event.newValue);
      const nextTheme = getThemeDefinition(nextThemeId);
      beginThemeSwitch();
      applyTheme(nextThemeId, document.documentElement);
      setThemeId(nextThemeId);
      setActiveGroup(nextTheme.group);
      notifyThemeLayoutChanged();
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const activateCategory = (group: ThemeGroup, focus = false) => {
    setActiveGroup(group);
    if (focus) window.requestAnimationFrame(() => categoryRefs.current.get(group)?.focus());
  };

  const handleCategoryKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = getNextCategoryIndex(
      event.key,
      index,
      THEME_CATEGORIES.length,
      categoryOrientation,
    );

    if (nextIndex === null) return;
    event.preventDefault();
    activateCategory(THEME_CATEGORIES[nextIndex].id, true);
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % visibleThemes.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + visibleThemes.length) % visibleThemes.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = visibleThemes.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTheme = visibleThemes[nextIndex];
    selectTheme(nextTheme.id);
    optionRefs.current.get(nextTheme.id)?.focus();
  };

  return (
    <div
      className={`theme-switcher theme-switcher--rail${open ? ' is-open' : ''}`}
      data-active-category={activeGroup}
      ref={switcherRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="theme-switcher-trigger theme-switcher-compact-trigger"
        aria-label={`Change visual style. Current style: ${currentTheme.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          if (open) setOpen(false);
          else openPicker();
        }}
      >
        <span className="theme-switcher-icon" aria-hidden="true">
          <span style={previewStyle(currentTheme.swatches[0])} />
          <span style={previewStyle(currentTheme.swatches[1])} />
          <span style={previewStyle(currentTheme.swatches[2])} />
        </span>
        <span className="theme-switcher-copy">
          <span className="theme-switcher-kicker">Visual style</span>
          <span className="theme-switcher-current">{currentTheme.name}</span>
        </span>
        <span className="theme-switcher-chevron" aria-hidden="true">›</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="theme-switcher-scrim"
            aria-label="Close visual style picker"
            tabIndex={-1}
            onClick={closeAndRestoreFocus}
          />
          <div
            id={popoverId}
            className="theme-switcher-popover theme-switcher-sheet"
            role="dialog"
            aria-modal="false"
            aria-label="Choose a visual style"
          >
            <div className="theme-switcher-sheet-handle" aria-hidden="true" />
            <div className="theme-switcher-heading">
              <div>
                <span className="theme-switcher-kicker">Style collection</span>
                <h2>Choose your world</h2>
              </div>
              <div className="theme-switcher-heading-actions">
                <span className="theme-switcher-count">{presetCount - 1} presets + Original</span>
                <button
                  type="button"
                  className="theme-switcher-close"
                  aria-label="Close visual style picker"
                  onClick={closeAndRestoreFocus}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
            <p className="theme-switcher-intro">
              Explore nine collections. Every change is instant, while your game and position stay untouched.
            </p>

            <div className="theme-switcher-browser">
              <div
                className="theme-category-rail"
                role="tablist"
                aria-label="Visual style collections"
                aria-orientation={categoryOrientation}
              >
                {THEME_CATEGORIES.map((category, index) => {
                  const selected = category.id === activeGroup;
                  const categoryThemeCount = getThemesInCategory(category.id).length;
                  return (
                    <button
                      key={category.id}
                      ref={(element) => {
                        if (element) categoryRefs.current.set(category.id, element);
                        else categoryRefs.current.delete(category.id);
                      }}
                      id={tabId(category.id)}
                      type="button"
                      role="tab"
                      data-category-id={category.id}
                      aria-selected={selected}
                      aria-controls={panelId}
                      tabIndex={selected ? 0 : -1}
                      className={`theme-category-tab${selected ? ' is-active' : ''}`}
                      onClick={() => activateCategory(category.id)}
                      onKeyDown={(event) => handleCategoryKeyDown(event, index)}
                    >
                      <span className="theme-category-symbol" aria-hidden="true">{category.symbol}</span>
                      <span className="theme-category-label">{category.shortName}</span>
                      <span
                        className="theme-category-count"
                        aria-label={`${categoryThemeCount} ${categoryThemeCount === 1 ? 'style' : 'styles'}`}
                      >
                        {categoryThemeCount}
                      </span>
                    </button>
                  );
                })}
              </div>

              <section
                id={panelId}
                className="theme-style-panel"
                role="tabpanel"
                data-category-id={activeGroup}
                aria-labelledby={tabId(activeGroup)}
                tabIndex={-1}
              >
                <div className="theme-style-panel-heading">
                  <div className="theme-style-panel-copy">
                    <span className="theme-switcher-kicker">{activeCategory.shortName} collection</span>
                    <h3 className="theme-style-panel-title">{activeCategory.name}</h3>
                    <p className="theme-style-panel-description">{activeCategory.description}</p>
                  </div>
                  <span className="theme-style-panel-index" aria-hidden="true">
                    {String(THEME_CATEGORIES.findIndex((category) => category.id === activeGroup) + 1).padStart(2, '0')}
                  </span>
                </div>

                <div
                  className="theme-switcher-options theme-style-options"
                  role="radiogroup"
                  aria-label={`${activeCategory.name} visual styles`}
                >
                  {visibleThemes.map((theme, index) => {
                    const selected = theme.id === themeId;
                    const keyboardEntry = selected || (!selectedThemeIsVisible && index === 0);
                    return (
                      <button
                        key={theme.id}
                        ref={(element) => {
                          if (element) optionRefs.current.set(theme.id, element);
                          else optionRefs.current.delete(theme.id);
                        }}
                        type="button"
                        role="radio"
                        data-theme-id={theme.id}
                        aria-checked={selected}
                        tabIndex={keyboardEntry ? 0 : -1}
                        className={`theme-option theme-preset-button${selected ? ' is-selected' : ''}`}
                        onClick={() => selectTheme(theme.id)}
                        onKeyDown={(event) => handleOptionKeyDown(event, index)}
                      >
                        <span className="theme-option-preview" aria-hidden="true">
                          {theme.swatches.map((colour) => (
                            <span key={colour} style={previewStyle(colour)} />
                          ))}
                        </span>
                        <span className="theme-option-copy">
                          <span className="theme-option-name">{theme.name}</span>
                          <span className="theme-option-description">{theme.description}</span>
                        </span>
                        <span className="theme-option-meta">
                          <span className="theme-option-group">{activeCategory.shortName}</span>
                          <span className="theme-option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            <p className="theme-switcher-help">
              Arrow keys browse collections and styles · Escape closes
            </p>
          </div>
        </>
      )}
    </div>
  );
}
