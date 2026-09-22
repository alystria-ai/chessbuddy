import { describe, expect, it } from 'vitest';
import { THEME_DEFINITIONS } from './theme';
import {
  CLASSIC_THEME_COPY,
  THEME_COPY_OVERRIDES,
  getThemeCopy,
} from './themeCopy';

describe('theme copy registry', () => {
  it('keeps Classic copy canonical and gives ready presets distinct product voices', () => {
    expect(getThemeCopy('classic')).toEqual(CLASSIC_THEME_COPY);
    expect(getThemeCopy('flat-icon')).toMatchObject(THEME_COPY_OVERRIDES['flat-icon']);
    expect(getThemeCopy('flat-icon').productTitle).not.toBe(CLASSIC_THEME_COPY.productTitle);
    expect(getThemeCopy('hand-drawn')).toMatchObject(THEME_COPY_OVERRIDES['hand-drawn']);
    expect(getThemeCopy('hand-drawn').productTitle).toBe('The Chess Marginalia');
    expect(getThemeCopy('swiss')).toMatchObject(THEME_COPY_OVERRIDES.swiss);
    expect(getThemeCopy('swiss').productTitle).toBe('Schach Raster');
    expect(getThemeCopy('art-deco')).toMatchObject(THEME_COPY_OVERRIDES['art-deco']);
    expect(getThemeCopy('art-deco').productTitle).toBe('The Gilded Gambit');
    expect(getThemeCopy('newspaper')).toMatchObject(THEME_COPY_OVERRIDES.newspaper);
    expect(getThemeCopy('newspaper').productTitle).toBe('The Daily Knight');
    expect(getThemeCopy('neo-brutalist')).toMatchObject(THEME_COPY_OVERRIDES['neo-brutalist']);
    expect(getThemeCopy('neo-brutalist').productTitle).toBe('CHESS / HARD MOVE');
    expect(getThemeCopy('terminal')).toMatchObject(THEME_COPY_OVERRIDES.terminal);
    expect(getThemeCopy('terminal').productTitle).toBe('KNIGHT//SHELL');
    expect(getThemeCopy('blueprint')).toMatchObject(THEME_COPY_OVERRIDES.blueprint);
    expect(getThemeCopy('blueprint').productTitle).toBe('The Knight Plan');
    expect(getThemeCopy('risograph')).toMatchObject(THEME_COPY_OVERRIDES.risograph);
    expect(getThemeCopy('risograph').productTitle).toBe('Knight Ink Press');
    expect(getThemeCopy('wooden')).toMatchObject(THEME_COPY_OVERRIDES.wooden);
    expect(getThemeCopy('wooden').productTitle).toBe('Walnut & Knight');
    expect(getThemeCopy('marble')).toMatchObject(THEME_COPY_OVERRIDES.marble);
    expect(getThemeCopy('marble').productTitle).toBe('The Quiet Gambit');
    expect(getThemeCopy('arcade-neon')).toMatchObject(THEME_COPY_OVERRIDES['arcade-neon']);
    expect(getThemeCopy('arcade-neon').productTitle).toBe('KNIGHT FORCE ’88');
    expect(getThemeCopy('frutiger-aero')).toMatchObject(THEME_COPY_OVERRIDES['frutiger-aero']);
    expect(getThemeCopy('frutiger-aero').productTitle).toBe('BlueSky Chessway');
    expect(getThemeCopy('desktop-90s')).toMatchObject(THEME_COPY_OVERRIDES['desktop-90s']);
    expect(getThemeCopy('desktop-90s').productTitle).toBe('KnightDesk 95');
    expect(getThemeCopy('editorial')).toMatchObject(THEME_COPY_OVERRIDES.editorial);
    expect(getThemeCopy('editorial').productTitle).toBe('Knight / Form');
    expect(getThemeCopy('cyberpunk-hud')).toMatchObject(THEME_COPY_OVERRIDES['cyberpunk-hud']);
    expect(getThemeCopy('cyberpunk-hud').productTitle).toBe('NIGHTGRID // CHESS');
    expect(getThemeCopy('japanese-minimal')).toMatchObject(THEME_COPY_OVERRIDES['japanese-minimal']);
    expect(getThemeCopy('japanese-minimal').productTitle).toBe('Chessbuddy');
    expect(getThemeCopy('stained-glass')).toMatchObject(THEME_COPY_OVERRIDES['stained-glass']);
    expect(getThemeCopy('stained-glass').productTitle).toBe('Lumen Boardworks');
    expect(getThemeCopy('bauhaus')).toMatchObject(THEME_COPY_OVERRIDES.bauhaus);
    expect(getThemeCopy('bauhaus').productTitle).toBe('Formspiel 64');
    expect(getThemeCopy('soft-clay')).toMatchObject(THEME_COPY_OVERRIDES['soft-clay']);
    expect(getThemeCopy('soft-clay').productTitle).toBe('Mallow & Move');
    expect(getThemeCopy('solarpunk-conservatory')).toMatchObject(THEME_COPY_OVERRIDES['solarpunk-conservatory']);
    expect(getThemeCopy('solarpunk-conservatory').productTitle).toBe('The Verdant Circuit');
    expect(getThemeCopy('noir-detective')).toMatchObject(THEME_COPY_OVERRIDES['noir-detective']);
    expect(getThemeCopy('noir-detective').productTitle).toBe('The Black Knight Files');
    expect(getThemeCopy('cosmic-observatory')).toMatchObject(THEME_COPY_OVERRIDES['cosmic-observatory']);
    expect(getThemeCopy('cosmic-observatory').productTitle).toBe('Asterion Move Atlas');
    expect(getThemeCopy('royal-opera')).toMatchObject(THEME_COPY_OVERRIDES['royal-opera']);
    expect(getThemeCopy('royal-opera').productTitle).toBe('The Grand Knight Theatre');
    expect(getThemeCopy('library-at-midnight')).toMatchObject(THEME_COPY_OVERRIDES['library-at-midnight']);
    expect(getThemeCopy('library-at-midnight').productTitle).toBe('The Nocturne Athenaeum');
    expect(getThemeCopy('mediterranean-ceramic')).toMatchObject(THEME_COPY_OVERRIDES['mediterranean-ceramic']);
    expect(getThemeCopy('mediterranean-ceramic').productTitle).toBe('Azul Mare Atelier');
    expect(getThemeCopy('botanical-engraving')).toMatchObject(THEME_COPY_OVERRIDES['botanical-engraving']);
    expect(getThemeCopy('botanical-engraving').productTitle).toBe('Knightwort Field Folio');
    expect(getThemeCopy('memphis-pop')).toMatchObject(THEME_COPY_OVERRIDES['memphis-pop']);
    expect(getThemeCopy('memphis-pop').productTitle).toBe('Squiggle Strategy Works');
    expect(getThemeCopy('desert-modernism')).toMatchObject(THEME_COPY_OVERRIDES['desert-modernism']);
    expect(getThemeCopy('desert-modernism').productTitle).toBe('The Suncourt Gambit');
    expect(getThemeCopy('oceanic-biome')).toMatchObject(THEME_COPY_OVERRIDES['oceanic-biome']);
    expect(getThemeCopy('oceanic-biome').productTitle).toBe('Pelagic Strategy Station');
    expect(getThemeCopy('alpine-lodge')).toMatchObject(THEME_COPY_OVERRIDES['alpine-lodge']);
    expect(getThemeCopy('alpine-lodge').productTitle).toBe('The High Pass Chess Room');
    expect(getThemeCopy('candy-kawaii')).toMatchObject(THEME_COPY_OVERRIDES['candy-kawaii']);
    expect(getThemeCopy('candy-kawaii').productTitle).toBe('Bonbon Knight Parade');
    expect(getThemeCopy('lunar-colony')).toMatchObject(THEME_COPY_OVERRIDES['lunar-colony']);
    expect(getThemeCopy('lunar-colony').productTitle).toBe('Mare Tranquillitatis Chess Control');
    expect(getThemeCopy('persian-miniature')).toMatchObject(THEME_COPY_OVERRIDES['persian-miniature']);
    expect(getThemeCopy('persian-miniature').productTitle).toBe('The Azure Garden Album');
    expect(getThemeCopy('vaporwave-dream')).toMatchObject(THEME_COPY_OVERRIDES['vaporwave-dream']);
    expect(getThemeCopy('vaporwave-dream').productTitle).toBe('The Afterimage Channel');
    expect(getThemeCopy('dark-academia')).toMatchObject(THEME_COPY_OVERRIDES['dark-academia']);
    expect(getThemeCopy('dark-academia').productTitle).toBe('The Rook & Reason Society');
    expect(getThemeCopy('pop-art-comic')).toMatchObject(THEME_COPY_OVERRIDES['pop-art-comic']);
    expect(getThemeCopy('pop-art-comic').productTitle).toBe('CHECK! The Illustrated Clash');
    expect(getThemeCopy('nordic-frost')).toMatchObject(THEME_COPY_OVERRIDES['nordic-frost']);
    expect(getThemeCopy('nordic-frost').productTitle).toBe('Northlight Route Institute');
    expect(getThemeCopy('tropical-resort')).toMatchObject(THEME_COPY_OVERRIDES['tropical-resort']);
    expect(getThemeCopy('tropical-resort').productTitle).toBe('The Canopy Gambit Club');
    expect(getThemeCopy('kinetic-chrome')).toMatchObject(THEME_COPY_OVERRIDES['kinetic-chrome']);
    expect(getThemeCopy('kinetic-chrome').productTitle).toBe('Vectorforge Motion Works');
  });

  it('keeps every Kinetic Chrome phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
      ...Object.values(THEME_COPY_OVERRIDES['persian-miniature']),
      ...Object.values(THEME_COPY_OVERRIDES['vaporwave-dream']),
      ...Object.values(THEME_COPY_OVERRIDES['dark-academia']),
      ...Object.values(THEME_COPY_OVERRIDES['pop-art-comic']),
      ...Object.values(THEME_COPY_OVERRIDES['nordic-frost']),
      ...Object.values(THEME_COPY_OVERRIDES['tropical-resort']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['kinetic-chrome'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Tropical Resort phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
      ...Object.values(THEME_COPY_OVERRIDES['persian-miniature']),
      ...Object.values(THEME_COPY_OVERRIDES['vaporwave-dream']),
      ...Object.values(THEME_COPY_OVERRIDES['dark-academia']),
      ...Object.values(THEME_COPY_OVERRIDES['pop-art-comic']),
      ...Object.values(THEME_COPY_OVERRIDES['nordic-frost']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['tropical-resort'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Nordic Frost phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
      ...Object.values(THEME_COPY_OVERRIDES['persian-miniature']),
      ...Object.values(THEME_COPY_OVERRIDES['vaporwave-dream']),
      ...Object.values(THEME_COPY_OVERRIDES['dark-academia']),
      ...Object.values(THEME_COPY_OVERRIDES['pop-art-comic']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['nordic-frost'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Pop Art Comic phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
      ...Object.values(THEME_COPY_OVERRIDES['persian-miniature']),
      ...Object.values(THEME_COPY_OVERRIDES['vaporwave-dream']),
      ...Object.values(THEME_COPY_OVERRIDES['dark-academia']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['pop-art-comic'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Dark Academia phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
      ...Object.values(THEME_COPY_OVERRIDES['persian-miniature']),
      ...Object.values(THEME_COPY_OVERRIDES['vaporwave-dream']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['dark-academia'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Vaporwave Dream phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
      ...Object.values(THEME_COPY_OVERRIDES['persian-miniature']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['vaporwave-dream'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Persian Miniature phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
      ...Object.values(THEME_COPY_OVERRIDES['lunar-colony']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['persian-miniature'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Lunar Colony phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
      ...Object.values(THEME_COPY_OVERRIDES['candy-kawaii']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['lunar-colony'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Candy Kawaii phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
      ...Object.values(THEME_COPY_OVERRIDES['alpine-lodge']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['candy-kawaii'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Alpine Lodge phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
      ...Object.values(THEME_COPY_OVERRIDES['oceanic-biome']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['alpine-lodge'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Oceanic Biome phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
      ...Object.values(THEME_COPY_OVERRIDES['desert-modernism']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['oceanic-biome'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Desert Modernism phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
      ...Object.values(THEME_COPY_OVERRIDES['memphis-pop']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['desert-modernism'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Memphis Pop phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
      ...Object.values(THEME_COPY_OVERRIDES['botanical-engraving']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['memphis-pop'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Botanical Engraving phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
      ...Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['botanical-engraving'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Mediterranean Ceramic phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
      ...Object.values(THEME_COPY_OVERRIDES['library-at-midnight']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['mediterranean-ceramic'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Library at Midnight phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
      ...Object.values(THEME_COPY_OVERRIDES['royal-opera']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['library-at-midnight'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Royal Opera phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
      ...Object.values(THEME_COPY_OVERRIDES['cosmic-observatory']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['royal-opera'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Cosmic Observatory phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
      ...Object.values(THEME_COPY_OVERRIDES['noir-detective']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['cosmic-observatory'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Noir Detective phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
      ...Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['noir-detective'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Solarpunk Conservatory phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
      ...Object.values(THEME_COPY_OVERRIDES['soft-clay']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['solarpunk-conservatory'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Soft Clay phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
      ...Object.values(THEME_COPY_OVERRIDES.bauhaus),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['soft-clay'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Bauhaus phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
      ...Object.values(THEME_COPY_OVERRIDES['stained-glass']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.bauhaus)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Stained Glass phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
      ...Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud']),
      ...Object.values(THEME_COPY_OVERRIDES['japanese-minimal']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['stained-glass'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('uses the same direct Chessbuddy product language in the dormant base theme', () => {
    expect(THEME_COPY_OVERRIDES['japanese-minimal']).toEqual(CLASSIC_THEME_COPY);
  });

  it('keeps every Cyberpunk HUD phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
      ...Object.values(THEME_COPY_OVERRIDES.editorial),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['cyberpunk-hud'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Editorial phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
      ...Object.values(THEME_COPY_OVERRIDES['desktop-90s']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.editorial)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Desktop 90s phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
      ...Object.values(THEME_COPY_OVERRIDES['frutiger-aero']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['desktop-90s'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Frutiger Aero phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
      ...Object.values(THEME_COPY_OVERRIDES['arcade-neon']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['frutiger-aero'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Arcade Neon phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
      ...Object.values(THEME_COPY_OVERRIDES.marble),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['arcade-neon'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Marble phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
      ...Object.values(THEME_COPY_OVERRIDES.wooden),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.marble)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Wooden phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
      ...Object.values(THEME_COPY_OVERRIDES.risograph),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.wooden)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Risograph phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
      ...Object.values(THEME_COPY_OVERRIDES.blueprint),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.risograph)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Blueprint phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
      ...Object.values(THEME_COPY_OVERRIDES.terminal),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.blueprint)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Terminal phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
      ...Object.values(THEME_COPY_OVERRIDES['neo-brutalist']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.terminal)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Neo-Brutalist phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
      ...Object.values(THEME_COPY_OVERRIDES.newspaper),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['neo-brutalist'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Newspaper phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
      ...Object.values(THEME_COPY_OVERRIDES['art-deco']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.newspaper)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Art Deco phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
      ...Object.values(THEME_COPY_OVERRIDES.swiss),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['art-deco'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Swiss phrase distinct from existing preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
      ...Object.values(THEME_COPY_OVERRIDES['hand-drawn']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES.swiss)) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('keeps every Hand-Drawn phrase distinct from current preset and Classic copy', () => {
    const existingPhrases = new Set([
      ...Object.values(CLASSIC_THEME_COPY),
      ...Object.values(THEME_COPY_OVERRIDES['flat-icon']),
    ]);
    for (const phrase of Object.values(THEME_COPY_OVERRIDES['hand-drawn'])) {
      expect(existingPhrases.has(phrase)).toBe(false);
    }
  });

  it('gives every non-Classic preset a complete theme-specific copy override', () => {
    const presetIds = THEME_DEFINITIONS
      .map((theme) => theme.id)
      .filter((themeId) => themeId !== 'classic');
    expect(Object.keys(THEME_COPY_OVERRIDES).sort()).toEqual([...presetIds].sort());
  });

  it('only registers known theme ids', () => {
    const knownIds = new Set(THEME_DEFINITIONS.map((theme) => theme.id));
    for (const themeId of Object.keys(THEME_COPY_OVERRIDES)) {
      expect(knownIds.has(themeId as never)).toBe(true);
    }
  });
});
