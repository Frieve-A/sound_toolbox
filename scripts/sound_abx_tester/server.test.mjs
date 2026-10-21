import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dev } from 'astro';

test('real Astro dev server redirects directories and serves legacy and generated pages', async t => {
  const server = await dev({
    root: new URL('../../', import.meta.url),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  t.after(() => server.stop());
  const origin = `http://127.0.0.1:${server.address.port}`;
  const base = '/sound_toolbox';
  const challengePath = `${base}/sound_abx_tester/effetune_challenge`;

  for (const method of ['GET', 'HEAD']) {
    const redirect = await fetch(`${origin}${challengePath}?lang=ja&test=1`, { method, redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), `${challengePath}/?lang=ja&test=1`);
    await redirect.text();
  }
  for (const suffix of ['/', '/index.html']) {
    const result = await fetch(`${origin}${challengePath}${suffix}?lang=ja`);
    assert.equal(result.status, 200);
    assert.match(await result.text(), /data-abx/);
  }
  for (const file of ['challenge.css', 'challenge.js', 'clips/original.flac', 'clips/easy.flac', 'clips/medium.flac', 'clips/hard.flac']) {
    const result = await fetch(`${origin}${challengePath}/${file}`);
    assert.equal(result.status, 200);
    const expected = await readFile(new URL(`../../sound_abx_tester/effetune_challenge/${file}`, import.meta.url));
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), expected);
    const head = await fetch(`${origin}${challengePath}/${file}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(expected.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  for (const route of ['', 'sound_abx_tester', 'vinyl_explained', 'oscillator']) {
    const result = await fetch(`${origin}${base}/${route ? `${route}/` : ''}`);
    assert.equal(result.status, 200, route);
    assert.match(await result.text(), /<html/);
  }
  for (const name of ['sound_abx_tester.html', 'sound_abx_tester_ja.html', 'sound_abx_tester.js']) {
    const result = await fetch(`${origin}${base}/sound_abx_tester/${name}`);
    assert.equal(result.status, 200);
    await result.text();
  }
  for (const suffix of ['/missing.flac', '/missing/']) {
    const result = await fetch(`${origin}${challengePath}${suffix}`);
    assert.equal(result.status, 404);
    await result.text();
  }
  const outside = await fetch(`${origin}${base}/sound_abx_tester/..%2f..%2fpackage.json`, { redirect: 'manual' });
  assert.notEqual(outside.status, 200);
  assert.notEqual(outside.status, 301);
  await outside.text();
});
