import test from 'node:test';
import assert from 'node:assert/strict';
import { challenge, deferred, flush, response } from './harness.mjs';

async function ready(options) {
  const app = challenge(options);
  app.click('level', 'easy');
  await flush();
  assert.equal(app.el('player').hidden, false);
  return app;
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('start and seek fade from silence at the scheduled, synchronized source start', async () => {
  const app = await ready();
  app.seek(0.5);
  app.click('play', 'A');
  const [a, b] = app.audio.sources;
  assert.equal(a.startTime, b.startTime);
  assert.equal(a.offset, 6);
  near(app.audio.gains[0].gain.at(a.startTime), 0);
  near(app.audio.gains[0].gain.at(a.startTime + 0.005), 0.5);
  near(app.audio.gains[0].gain.at(a.startTime + 0.01), 1);
  near(app.audio.gains[1].gain.at(a.startTime + 0.01), 0);
  app.tick(0.5);
  app.seek(0.25);
  const seekSource = app.audio.sources[2];
  assert.equal(seekSource.offset, 3);
  near(app.audio.gains[2].gain.at(seekSource.startTime), 0);
  assert.ok(a.stopTime > app.audio.currentTime);
  near(app.audio.gains[0].gain.at(a.stopTime), 0);
});

test('switching before startup does not bypass the initial fade', async () => {
  const app = await ready();
  app.click('play', 'A');
  app.click('play', 'B');
  const start = app.audio.sources[0].startTime;
  near(app.audio.gains[1].gain.at(start), 0);
  near(app.audio.gains[1].gain.at(start + 0.01), 1);
  near(app.audio.gains[0].gain.at(start + 0.01), 0);
  assert.equal(app.audio.sources.length, 2);
});

test('rapid switches and stop preserve the current envelope and release audio nodes', async () => {
  const app = await ready();
  app.click('play', 'A');
  app.tick(0.025);
  near(app.audio.gains[0].gain.value, 0.5);
  app.click('play', 'B');
  near(app.audio.gains[0].gain.value, 0.5);
  app.tick(0.005);
  near(app.audio.gains[0].gain.value, 0.25);
  app.click('stop');
  near(app.audio.gains[0].gain.value, 0.25);
  const [a, b] = app.audio.sources;
  assert.equal(a.stopTime, b.stopTime);
  near(app.audio.gains[0].gain.at(a.stopTime), 0);
  near(app.audio.gains[1].gain.at(a.stopTime), 0);
  a.onended(); b.onended();
  assert.ok(app.audio.sources.every(node => node.disconnected));
  assert.ok(app.audio.gains.every(node => node.disconnected));
});

test('early stop keeps the seek position and cancels sources before they start', async () => {
  const app = await ready();
  app.seek(0.5);
  app.click('play', 'A');
  app.tick(0.005);
  app.click('stop');
  near(Number(app.el('position').value), 0.5);
  assert.ok(app.audio.sources.every(node => node.stopTime < node.startTime));
  app.click('stop');
  assert.equal(app.audio.sources[2].offset, 6);
});

test('automation also works without cancelAndHoldAtTime', async () => {
  const app = await ready({ noCancelAndHold: true });
  app.click('play', 'A');
  const start = app.audio.sources[0].startTime;
  near(app.audio.gains[0].gain.at(start), 0);
  app.tick(0.025);
  app.click('play', 'B');
  near(app.audio.gains[0].gain.value, 0.5);
  app.click('stop');
  near(app.audio.gains[0].gain.at(app.audio.sources[0].stopTime), 0);
});

test('position follows playback while the slider is focused, but pauses during a pointer drag', async () => {
  const app = await ready();
  app.click('play', 'A');
  app.document.activeElement = app.el('position');
  app.tick(1);
  const before = Number(app.el('position').value);
  assert.ok(before > 0);
  app.el('position').emit('pointerdown', { button: 0, pointerId: 7 });
  app.tick(1);
  near(Number(app.el('position').value), before);
  app.document.emit('pointerup', { pointerId: 7 });
  app.tick(1);
  assert.ok(Number(app.el('position').value) > before);
  for (const end of ['pointercancel', 'lostpointercapture', 'blur']) {
    app.el('position').emit('pointerdown', { button: 0, pointerId: 9 });
    const saved = app.el('position').value;
    if (end === 'blur') app.window.emit(end);
    else (end === 'lostpointercapture' ? app.el('position') : app.document).emit(end, { pointerId: 9 });
    app.tick(0.2);
    assert.notEqual(app.el('position').value, saved);
  }
});

test('seek to the end loops to the beginning; keyboard controls do not restart the sources', async () => {
  const app = await ready();
  app.seek(1);
  app.key('x');
  assert.equal(app.audio.sources[0].offset, 0);
  app.tick(0.1);
  app.key('b');
  app.tick(0.02);
  near(app.audio.gains[1].gain.value, 1);
  assert.equal(app.audio.sources.length, 2);
  app.key('q', { repeat: true });
  app.key('q', { ctrlKey: true });
  assert.match(app.el('progress').textContent, /Trial 1 /);
  app.key('q');
  assert.match(app.el('progress').textContent, /Trial 2 /);
  app.key(' ');
  assert.ok(app.audio.sources.every(node => node.stopTime !== undefined));
});

test('pending playback can be cancelled or superseded without starting stale audio', async () => {
  for (const action of ['stop', 'level', 'finish']) {
    const app = await ready();
    const resume = deferred();
    app.audio.state = 'suspended';
    app.audio.resume = () => resume.promise;
    app.click('play', 'A');
    if (action === 'level') app.click('level', 'hard');
    else if (action === 'finish') for (let i = 0; i < 20; i++) app.click('vote', 'A');
    else app.click('stop');
    resume.resolve();
    await flush();
    assert.equal(app.audio.sources.length, 0, action);
    assert.deepEqual(app.errors, []);
  }
  const app = await ready();
  const resume = deferred();
  app.audio.state = 'suspended';
  app.audio.resume = () => resume.promise;
  app.click('play', 'A');
  app.click('play', 'B');
  resume.resolve();
  await flush();
  assert.equal(app.audio.sources.length, 2);
  near(app.audio.gains[1].gain.at(app.audio.sources[1].startTime + 0.01), 1);
});

test('a rejected resume is handled and playback can be retried', async () => {
  const app = await ready();
  app.audio.state = 'suspended';
  app.audio.resume = async () => { throw new Error('device unavailable'); };
  app.click('play', 'A');
  await flush();
  assert.match(app.el('status').textContent, /could not start/);
  assert.equal(app.errors.length, 1);
  app.audio.state = 'running';
  app.click('stop');
  assert.equal(app.audio.sources.length, 2);
  assert.match(app.el('status').textContent, /A is the original/);
});

test('rapid repeated difficulty selections accept only the newest load', async () => {
  let randomCalls = 0;
  const gate = deferred();
  const app = challenge({
    random: () => { randomCalls++; return 0.1; },
    fetch: url => gate.promise.then(() => response(url)),
  });
  app.click('level', 'easy'); app.click('level', 'hard'); app.click('level', 'easy');
  gate.resolve();
  await flush();
  assert.equal(randomCalls, 1);
  assert.match(app.el('question').textContent, /^Easy/);
  assert.equal(app.requests.filter(url => url === 'clips/original.flac').length, 1);
});

test('failed clip fetches are evicted from cache and can be retried', async () => {
  let fail = true;
  const app = challenge({ fetch: async url => response(url, url.endsWith('easy.flac') && fail ? 404 : 200) });
  app.click('level', 'easy');
  await flush();
  assert.match(app.el('status').textContent, /could not be loaded/);
  assert.equal(app.el('player').hidden, true);
  fail = false;
  app.click('level', 'easy');
  await flush();
  assert.equal(app.el('player').hidden, false);
  assert.equal(app.requests.filter(url => url.endsWith('easy.flac')).length, 2);
  assert.equal(app.requests.filter(url => url.endsWith('original.flac')).length, 1);
});

test('all levels finish at 20 trials, render the significance boundary and preserve language/results', async () => {
  for (const level of ['easy', 'medium', 'hard']) {
    for (const correct of [14, 15]) {
      const app = challenge();
      app.click('level', level);
      await flush();
      app.click('play', 'X');
      app.tick(0.1);
      for (let i = 0; i < 20; i++) app.click('vote', i < correct ? 'A' : 'B');
      assert.equal(app.el('player').hidden, true);
      assert.equal(app.el('result').hidden, false);
      assert.match(app.el('result').innerHTML, new RegExp(`${correct} / 20 correct`));
      assert.equal(app.el('result').innerHTML.includes('Statistically significant:'), correct === 15);
      const effetuneLink = /<a\b[^>]*\bclass="open-effetune"[^>]*\bhref="([^"]+)"/.exec(app.el('result').innerHTML);
      assert.ok(effetuneLink, 'the results include the EffeTune test link');
      const url = effetuneLink[1];
      const payload = JSON.parse(Buffer.from(new URL(url).searchParams.get('dbt'), 'base64').toString('utf8'));
      assert.equal(payload.fAB, true);
      assert.equal(payload.pB[0].nm, level === 'easy' ? 'MP3 Codec Simulator' : 'Earphone Cable Sim');
      assert.equal(app.stored.get(`effetune-abx-challenge-best-${level}`), String(correct));
      app.click('lang', 'ja');
      assert.match(app.el('result').innerHTML, new RegExp(`20 回中 ${correct} 回正解`));
      app.click('again');
      await flush();
      assert.match(app.el('progress').textContent, /1 回目/);
      assert.equal(app.el('result').hidden, true);
    }
  }
});

test('unavailable local storage and invalid language parameters do not prevent a test', async () => {
  const app = await ready({ storageBlocked: true, search: '?lang=invalid' });
  for (let i = 0; i < 20; i++) app.click('vote', 'A');
  assert.match(app.el('result').innerHTML, /20 \/ 20 correct/);
});
