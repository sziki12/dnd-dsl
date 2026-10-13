import { describe, expect, test } from 'vitest';
import {
  DEFAULT_COLORS,
  EDGE_KINDS,
  FILL_STRENGTH,
  NODE_KINDS,
  SIZE_MAX,
  SIZE_MIN,
  defaultSettings,
  effectiveNodeScale,
  isDefaultSettings,
  isHexColor,
  resolveColor,
  sanitizeSettings,
  setColor,
  settingsToClasses,
  settingsToCssVars,
  settingsToStored,
  type MapViewSettings,
} from './map-view-settings';

describe('defaults', () => {
  test('everything shown, full size, no custom colours', () => {
    expect(defaultSettings()).toEqual({
      version: 1,
      labels: true,
      nodes: { visible: true, opacity: 1, sizeMode: 'map', size: 1 },
      edges: { visible: true },
      colors: {},
    });
  });

  test('each call returns a fresh object', () => {
    const a = defaultSettings();
    a.colors.all = '#ffffff';
    expect(defaultSettings().colors).toEqual({});
  });

  test('there is a picker colour for every kind', () => {
    for (const kind of [...NODE_KINDS, ...EDGE_KINDS]) expect(isHexColor(DEFAULT_COLORS[kind])).toBe(true);
  });
});

describe('sanitizeSettings', () => {
  test('anything that is not an object gives the defaults', () => {
    for (const bad of [null, undefined, 3, 'x', []]) expect(sanitizeSettings(bad)).toEqual(defaultSettings());
  });

  test('a valid object is kept', () => {
    const wanted: MapViewSettings = {
      version: 1,
      labels: false,
      nodes: { visible: false, opacity: 0.4, sizeMode: 'screen', size: 1.5 },
      edges: { visible: false },
      colors: { all: '#112233', exit: '#abcdef' },
    };
    expect(sanitizeSettings(wanted)).toEqual(wanted);
  });

  test('numbers are clamped, NaN and strings fall back', () => {
    const s = sanitizeSettings({ nodes: { opacity: 5, size: 99 } });
    expect(s.nodes.opacity).toBe(1);
    expect(s.nodes.size).toBe(SIZE_MAX);
    expect(sanitizeSettings({ nodes: { opacity: -3, size: 0 } }).nodes).toMatchObject({ opacity: 0, size: SIZE_MIN });
    expect(sanitizeSettings({ nodes: { opacity: NaN, size: '2' } }).nodes).toMatchObject({ opacity: 1, size: 1 });
  });

  test('bad colours and unknown scopes are dropped, hex is lower-cased', () => {
    const s = sanitizeSettings({ colors: { all: 'red', nodes: '#ABCDEF', bogus: '#000000', edges: '#12345' } });
    expect(s.colors).toEqual({ nodes: '#abcdef' });
  });

  test('an unknown size mode becomes "map"', () => {
    expect(sanitizeSettings({ nodes: { sizeMode: 'wat' } }).nodes.sizeMode).toBe('map');
  });

  test('non-boolean switches fall back to on', () => {
    const s = sanitizeSettings({ labels: 'no', nodes: { visible: 0 }, edges: { visible: null } });
    expect(s.labels).toBe(true);
    expect(s.nodes.visible).toBe(true);
    expect(s.edges.visible).toBe(true);
  });
});

describe('setColor and resolveColor', () => {
  test('a kind colour wins over its group, which wins over "all"', () => {
    let s = defaultSettings();
    s = setColor(s, 'all', '#111111');
    expect(resolveColor(s.colors, 'sub')).toBe('#111111');
    expect(resolveColor(s.colors, 'exit')).toBe('#111111');
    s = setColor(s, 'nodes', '#222222');
    expect(resolveColor(s.colors, 'sub')).toBe('#222222');
    expect(resolveColor(s.colors, 'exit')).toBe('#111111');
    s = setColor(s, 'sub', '#333333');
    expect(resolveColor(s.colors, 'sub')).toBe('#333333');
    expect(resolveColor(s.colors, 'root')).toBe('#222222');
  });

  test('nothing set resolves to undefined', () => {
    expect(resolveColor({}, 'root')).toBeUndefined();
  });

  test('setting a broader scope clears the narrower overrides, so the new colour is what shows', () => {
    let s = setColor(setColor(defaultSettings(), 'sub', '#aaaaaa'), 'exit', '#bbbbbb');
    s = setColor(s, 'nodes', '#cccccc');
    expect(s.colors).toEqual({ exit: '#bbbbbb', nodes: '#cccccc' });
    s = setColor(s, 'all', '#dddddd');
    expect(s.colors).toEqual({ all: '#dddddd' });
  });

  test('setting a kind leaves the others alone', () => {
    const s = setColor(setColor(defaultSettings(), 'nodes', '#111111'), 'entry', '#222222');
    expect(s.colors).toEqual({ nodes: '#111111', entry: '#222222' });
  });

  test('undefined or an invalid colour clears just that scope', () => {
    const s = setColor(setColor(defaultSettings(), 'nodes', '#111111'), 'sub', '#222222');
    expect(setColor(s, 'sub', undefined).colors).toEqual({ nodes: '#111111' });
    expect(setColor(s, 'sub', 'not-a-colour').colors).toEqual({ nodes: '#111111' });
  });

  test('does not mutate its input', () => {
    const s = defaultSettings();
    setColor(s, 'all', '#111111');
    expect(s.colors).toEqual({});
  });
});

describe('settingsToCssVars', () => {
  test('no custom colour: no colour variables, so the theme applies', () => {
    const vars = settingsToCssVars(defaultSettings(), 'map');
    expect(Object.keys(vars)).toEqual(['--map-node-opacity']);
  });

  test('a node colour sets its border colour and a tinted fill; an edge colour only the colour', () => {
    const s = setColor(setColor(defaultSettings(), 'root', '#ff0000'), 'exit', '#00ff00');
    const vars = settingsToCssVars(s, 'map');
    expect(vars['--map-color-root']).toBe('#ff0000');
    expect(vars['--map-fill-root']).toBe(`color-mix(in srgb, #ff0000 ${FILL_STRENGTH}%, var(--bg-panel))`);
    expect(vars['--map-color-exit']).toBe('#00ff00');
    expect(vars['--map-fill-exit']).toBeUndefined();
    expect(vars['--map-color-sub']).toBeUndefined();
  });

  test('"all" colours every kind', () => {
    const vars = settingsToCssVars(setColor(defaultSettings(), 'all', '#123456'), 'tree');
    for (const kind of [...NODE_KINDS, ...EDGE_KINDS]) expect(vars[`--map-color-${kind}`]).toBe('#123456');
  });

  test('opacity applies in map mode only', () => {
    const s = { ...defaultSettings(), nodes: { ...defaultSettings().nodes, opacity: 0.3 } };
    expect(settingsToCssVars(s, 'map')['--map-node-opacity']).toBe('0.3');
    expect(settingsToCssVars(s, 'tree')['--map-node-opacity']).toBe('1');
  });
});

describe('settingsToClasses', () => {
  test('nothing off: no classes', () => {
    expect(settingsToClasses(defaultSettings(), 'map')).toEqual([]);
  });

  test('each switch maps to its class', () => {
    const s: MapViewSettings = { ...defaultSettings(), labels: false, edges: { visible: false }, nodes: { ...defaultSettings().nodes, visible: false } };
    expect(settingsToClasses(s, 'map')).toEqual(['map-hide-labels', 'map-hide-nodes', 'map-hide-edges']);
  });

  test('hiding nodes is a map-mode setting only', () => {
    const s: MapViewSettings = { ...defaultSettings(), nodes: { ...defaultSettings().nodes, visible: false } };
    expect(settingsToClasses(s, 'tree')).toEqual([]);
  });
});

describe('effectiveNodeScale', () => {
  test('scales with the map: the size setting, whatever the zoom', () => {
    expect(effectiveNodeScale({ sizeMode: 'map', size: 1.5 }, 0.2)).toBe(1.5);
    expect(effectiveNodeScale({ sizeMode: 'map', size: 1.5 }, 4)).toBe(1.5);
  });

  test('fixed on screen: counter-scaled by the zoom, so the on-screen size stays the setting', () => {
    const scale = effectiveNodeScale({ sizeMode: 'screen', size: 1.2 }, 0.5);
    expect(scale).toBeCloseTo(2.4);
    expect(scale * 0.5).toBeCloseTo(1.2);
  });

  test('a zero or negative zoom does not divide by zero', () => {
    expect(effectiveNodeScale({ sizeMode: 'screen', size: 1 }, 0)).toBe(1);
    expect(effectiveNodeScale({ sizeMode: 'screen', size: 1 }, -1)).toBe(1);
  });
});

describe('what gets stored', () => {
  test('the defaults are recognised, however they were reached', () => {
    expect(isDefaultSettings(defaultSettings())).toBe(true);
    expect(isDefaultSettings(setColor(setColor(defaultSettings(), 'sub', '#111111'), 'sub', undefined))).toBe(true);
  });

  test('any change is not the defaults', () => {
    expect(isDefaultSettings({ ...defaultSettings(), labels: false })).toBe(false);
    expect(isDefaultSettings(setColor(defaultSettings(), 'all', '#111111'))).toBe(false);
    expect(isDefaultSettings({ ...defaultSettings(), nodes: { ...defaultSettings().nodes, size: 1.5 } })).toBe(false);
  });

  test('defaults are stored as an empty object, which the server reads as "remove the entry"', () => {
    expect(settingsToStored(defaultSettings())).toEqual({});
  });

  test('changed settings are stored as they are, and survive a round trip through the sanitiser', () => {
    const changed = setColor({ ...defaultSettings(), labels: false }, 'nodes', '#abcdef');
    expect(settingsToStored(changed)).toEqual(changed);
    expect(sanitizeSettings(JSON.parse(JSON.stringify(settingsToStored(changed))))).toEqual(changed);
  });
});
