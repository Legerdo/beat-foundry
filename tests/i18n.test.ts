import { afterEach, describe, expect, it } from 'vitest';
import { LAYER_ORDER, METAS, MODS } from '../src/game/defs';
import { DICTIONARIES, layerText, metaName, metaText, modName, modText, setLang, t } from '../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('Korean and English use the same placeholders for every key', () => {
    const { en, ko } = DICTIONARIES;
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(ko[key]), key).toEqual(placeholders(en[key]));
      expect(ko[key].length, key).toBeGreaterThan(0);
    }
  });

  it('fills placeholders', () => {
    expect(t('sec.drop', { n: 3 })).toBe('DROP · 3 BARS LEFT');
    setLang('ko');
    expect(t('sec.drop', { n: 3 })).toBe('드롭 · 3마디 남음');
  });

  it('every layer, mod and upgrade has text in both languages', () => {
    for (const lang of ['en', 'ko'] as const) {
      setLang(lang);
      for (const l of LAYER_ORDER) expect(layerText(l).name.length).toBeGreaterThan(0);
      for (const m of MODS) expect(modName(m.id).length * modText(m.id).length).toBeGreaterThan(0);
      for (const m of METAS) expect(metaName(m.id).length * metaText(m.id).length).toBeGreaterThan(0);
    }
  });
});
