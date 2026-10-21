import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './harness.mjs';

function tester(payload, lang = 'en') {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  el('abxFixedAB').checked = true;
  el('testCountInput').value = '20';
  el('uriHigh').value = 'http://localhost/original.flac';
  el('uriLow').value = 'http://localhost/easy.flac';
  const location = new URL('http://localhost/sound_abx_tester.html');
  if (payload) location.searchParams.set('data', Buffer.from(JSON.stringify(payload)).toString('base64')
    .replaceAll('=', '-').replaceAll('/', '_').replaceAll('+', '.'));
  const window = {
    location, AudioContext: class { constructor() { this.sampleRate = 48000; } },
    history: { replaceState(_state, _title, url) { window.location = new URL(url); } },
  };
  const sandbox = vm.createContext({
    window, document: { getElementById: el }, navigator: {}, URL, URLSearchParams,
    btoa, atob, console, setTimeout, Math: Object.create(Math),
  });
  const run = code => vm.runInContext(code, sandbox);
  run(readFileSync(new URL(`../../sound_abx_tester/sound_abx_tester.locale.${lang}.js`, import.meta.url), 'utf8'));
  run(readFileSync(new URL('../../sound_abx_tester/sound_abx_tester.js', import.meta.url), 'utf8'));
  const saved = () => JSON.parse(Buffer.from(new URL(window.location).searchParams.get('data')
    .replaceAll('-', '=').replaceAll('_', '/').replaceAll('.', '+'), 'base64').toString('utf8'));
  return { el, run, saved, sandbox };
}

for (const lang of ['en', 'ja']) {
  test(`${lang}: fixed ABX, random X, shuffled ABX and preference tests`, () => {
    const app = tester(null, lang);
    app.sandbox.Math.random = () => 0.9;
    app.run('startTest("ABX")');
    assert.equal(app.run('abxAIsHigh'), true);
    assert.equal(app.run('abxXisA'), false);
    assert.equal(app.el('abxSourceA').textContent, 'http://localhost/original.flac');
    app.sandbox.Math.random = () => 0.1;
    app.run('updateABXUI()');
    assert.equal(app.run('abxXisA'), true);
    app.el('abxFixedAB').checked = false;
    app.el('abxFixedAB').emit('change');
    app.sandbox.Math.random = () => 0.9;
    app.run('startTest("ABX")');
    assert.equal(app.run('abxAIsHigh'), false);
    assert.equal(app.el('abxSources').classList.contains('hidden'), true);
    app.el('abxFixedAB').checked = true;
    app.run('startTest("ABPREF")');
    assert.equal(app.run('abprefCurrentHigherIsA'), false);
    app.sandbox.Math.random = () => 0.1;
    app.run('updateABPrefUI()');
    assert.equal(app.run('abprefCurrentHigherIsA'), true);
  });

  test(`${lang}: setting URL round-trip, legacy default and local filename display`, () => {
    const app = tester(null, lang);
    app.el('abxFixedAB').checked = false;
    app.run('startTest("ABX")');
    assert.equal(tester(app.saved(), lang).el('abxFixedAB').checked, false);
    assert.equal(tester({ uH: 'a', uL: 'b', tc: 20 }, lang).el('abxFixedAB').checked, true);
    app.run('blobUrlHigh = "blob:high"; fileNameHigh = "日本語.wav"; blobUrlLow = "blob:low"; fileNameLow = "processed.wav";');
    app.el('uriHigh').value = 'blob:high';
    app.el('uriLow').value = 'blob:low';
    app.el('abxFixedAB').checked = true;
    app.run('startTest("ABX")');
    assert.equal(app.el('abxSourceA').textContent, '日本語.wav');
    assert.equal(app.el('abxSourceB').textContent, 'processed.wav');
  });

  test(`${lang}: changing fixed AB invalidates ABX results but preserves preference results`, () => {
    for (const type of ['ABX', 'ABPREF']) {
      const app = tester({ tT: type, tc: 20, tC: 20, cC: 15, n: 'Listener', ts: 10000 }, lang);
      assert.equal(app.el('testResultArea').classList.contains('hidden'), false);
      app.el('abxFixedAB').checked = false;
      app.el('abxFixedAB').emit('change');
      assert.equal(app.saved().tC, type === 'ABX' ? 0 : 20);
      assert.equal(app.el('testResultArea').classList.contains('hidden'), type === 'ABX');
    }
  });
}
