// EffeTune ABX Challenge: a blind ABX test between the original clip (A) and one processed clip (B).
// Both clips loop in sync; switching only changes which one is heard, so the position is kept.
(() => {
  const TRIALS = 20;
  const FADE_S = 0.01;
  const CLIPS = { easy: 'clips/easy.flac', medium: 'clips/medium.flac', hard: 'clips/hard.flac' };
  const SHORT_ORIGINAL = { easy: 'A', medium: 'B', hard: 'A' };

  // The same comparisons as EffeTune Double Blind Test pipelines (share-URL plugin states).
  // B carries the loudness-matching gain the clips were rendered with; A is a 0 dB Volume.
  const volume = vl => ({ nm: 'Volume', en: true, vl });
  const PIPELINE_A = [volume(0)];
  const PIPELINES_B = {
    easy: [{ nm: 'MP3 Codec Simulator', en: true, br: '64' }, volume(0.2)],
    medium: [{ nm: 'Earphone Cable Sim', en: true, zo: 10, rc: 0.3, lc: 0.5, lv: 0.35, zb: 16 }, volume(0.3)],
    hard: [{ nm: 'Earphone Cable Sim', en: true, zo: 0.5, rc: 1.2, lc: 3, lv: 0.2, zb: 16 }],
  };

  const TEXT = {
    en: {
      ui: {
        pageTitle: 'EffeTune ABX Challenge - Can You Hear the Difference?',
        kicker: 'EffeTune ABX Challenge',
        title: 'Can you hear the difference?',
        lead: 'Each challenge compares the original recording with one processed version in a blind ABX test. A is the original and B is processed. X is one of them, chosen at random for each trial. Listen, then answer whether X is A or B.',
        easy: 'Easy', easyWhat: 'Low-bitrate MP3',
        medium: 'Medium', mediumWhat: 'High-impedance amp',
        hard: 'Hard', hardWhat: 'Long, thin cable',
        choose: 'Choose a challenge to start.',
        original: 'original', processed: 'processed',
        voteA: 'X is A', voteB: 'X is B',
        keys: 'Keys: A / B / X switch · Q answers A · W answers B · Space plays or stops',
        howTitle: 'How to listen',
        how1: 'Use headphones or speakers you know well, in a quiet room. Set the volume once and leave it.',
        how2: 'All versions are matched in loudness, so a louder version cannot give the answer away.',
        how3: 'Switching keeps the playback position. Find a short passage where you think you hear a difference, move the slider there, and switch back and forth.',
        how4: 'Guessing gets about half right. With 20 trials, 15 or more correct gives p < 0.05: a result that is unlikely to be luck. Fewer correct answers do not prove the two sound identical, only that this test did not show a difference.',
        aboutTitle: 'About the sound',
        about: 'The music is Grieg\'s “In the Hall of the Mountain King”, a public-domain recording by the Musopen Symphony (Wikimedia Commons): 12 seconds of the full orchestra at 48 kHz. The processed versions were rendered with EffeTune\'s own effects. What each one is appears after the test.',
        ownTitle: 'Try it with your own music',
        own: 'The same test is built into <a href="https://effetune.frieve.com/?utm_source=sound_toolbox&amp;utm_medium=referral&amp;utm_campaign=abx_challenge">EffeTune</a>, a free, open-source audio effect app. Build two pipelines with the AB toggle, then start an ABX or A/B Preference Test from the toggle\'s menu, with any music and any effects. See the <a href="https://effetune.frieve.com/docs/double-blind-test.html">Double Blind Test guide</a>.',
        tester: 'Frieve Sound ABX Tester: test your own files',
      },
      levels: {
        easy: {
          question: 'Easy: is X the original or the MP3?',
          processing: 'MP3 Codec Simulator at 64 kbit/s, joint stereo (44.1 kHz MPEG-1). A low bitrate removes high frequencies and adds coding artifacts.',
          short: 'Original or 64k MP3?',
        },
        medium: {
          question: 'Medium: is X the original or the high-impedance amplifier?',
          processing: 'Earphone Cable Sim, preset High Impedance Source: a 10 Ω output impedance driving 16 Ω earphones with an impedance peak at 120 Hz. The level changes by roughly -1 to +2 dB across the band.',
          short: 'Original or a high-impedance amp?',
        },
        hard: {
          question: 'Hard: is X the original or the long, thin cable?',
          processing: 'Earphone Cable Sim, preset Long Thin Cable: 1.2 Ω cable resistance and 3 µH cable inductance with a 0.5 Ω amplifier output impedance, driving 16 Ω earphones. The level changes by less than 0.5 dB across the band.',
          short: 'Original or a long, thin cable?',
        },
      },
      play: 'Play',
      stop: 'Stop',
      loading: 'Loading…',
      loadError: 'The sound could not be loaded. Check your connection and choose the challenge again.',
      playError: 'Playback could not start. Press Play to try again.',
      ready: 'A is the original, B is processed. Is X the same as A or B?',
      trial: n => `Trial ${n} of ${TRIALS}`,
      score: correct => `${correct} / ${TRIALS} correct`,
      best: correct => `Best: ${correct} / ${TRIALS}`,
      significant: 'Statistically significant: you could tell the two apart.',
      notSignificant: 'Not significant: this test did not show that you could tell them apart. That does not prove they sound identical.',
      pSep: '. ',
      whatB: 'What B was:',
      shortAnswer: (short, original) => `<strong>The Short “${short}”:</strong> the original was ${original}.`,
      again: 'Try again',
      openEffetune: 'Open this test in EffeTune',
      openNote: 'Opens the EffeTune web app with the same two pipelines, loudness matching included, ready to start an ABX test with any music you play. For the desktop app, copy this link and paste it into EffeTune (Ctrl+V, or Command+V on macOS).',
      testName: what => `EffeTune ABX Challenge: ${what}`,
      finished: 'Test finished.',
    },
    ja: {
      ui: {
        pageTitle: 'EffeTune ABX チャレンジ - その違い、聴き分けられますか？',
        kicker: 'EffeTune ABX チャレンジ',
        title: 'その違い、聴き分けられますか？',
        lead: 'どのチャレンジも、元の録音と加工した音の 2 つをブラインドの ABX テストで比べます。A が元の音、B が加工した音です。X は毎回ランダムに A か B のどちらかになります。聴き比べて、X が A と B のどちらかを答えてください。',
        easy: 'やさしい', easyWhat: '低ビットレートの MP3',
        medium: 'ふつう', mediumWhat: '出力インピーダンスの高いアンプ',
        hard: 'むずかしい', hardWhat: '細く長いケーブル',
        choose: 'チャレンジを選ぶと始まります。',
        original: '元の音', processed: '加工',
        voteA: 'X は A', voteB: 'X は B',
        keys: 'キー操作：A / B / X で切り替え・Q で「A」と回答・W で「B」と回答・スペースで再生／停止',
        howTitle: '聴き方',
        how1: '聴き慣れたヘッドホンかスピーカーを使い、静かな部屋で聴いてください。音量は最初に決めたら変えないでください。',
        how2: 'どの音も音量をそろえてあるので、大きく聞こえるほうが答え、ということはありません。',
        how3: '切り替えても再生位置はそのままです。違いがありそうな短い部分を見つけたら、スライダーでそこへ移動して、何度も切り替えてみてください。',
        how4: '当てずっぽうでもおよそ半分は正解します。20 回中 15 回以上正解すると p < 0.05 となり、偶然とは考えにくい結果です。正解が少なくても 2 つが同じ音だという証明にはならず、このテストでは違いを示せなかった、というだけです。',
        aboutTitle: '音源について',
        about: '曲はグリーグの「山の魔王の宮殿にて」。Musopen Symphony によるパブリックドメインの録音（Wikimedia Commons）から、オーケストラ全体が鳴る 12 秒間を 48 kHz で切り出しました。加工した音は EffeTune 自身のエフェクトで作っています。それぞれの中身はテストの後で表示されます。',
        ownTitle: '自分の音楽で試す',
        own: '同じテストは、無料のオープンソース音響エフェクトアプリ <a href="https://effetune.frieve.com/?utm_source=sound_toolbox&amp;utm_medium=referral&amp;utm_campaign=abx_challenge">EffeTune</a> に組み込まれています。AB トグルで 2 つのパイプラインを作り、トグルのメニューから ABX テストや A/B Preference Test を始めれば、好きな曲と好きなエフェクトで試せます。詳しくは<a href="https://effetune.frieve.com/docs/i18n/ja/double-blind-test.html">ダブルブラインドテストのガイド</a>をご覧ください。',
        tester: 'Frieve Sound ABX Tester：手持ちのファイルでテスト',
      },
      levels: {
        easy: {
          question: 'やさしい：X は元の音？ それとも MP3？',
          processing: 'MP3 Codec Simulator、64 kbps、ジョイントステレオ（44.1 kHz の MPEG-1）。低いビットレートでは高音が削られ、圧縮による歪みが加わります。',
          short: '元の音か64k MP3か',
        },
        medium: {
          question: 'ふつう：X は元の音？ それとも出力インピーダンスの高いアンプ？',
          processing: 'Earphone Cable Sim のプリセット High Impedance Source：出力インピーダンス 10 Ω のアンプで、120 Hz にインピーダンスのピークがある 16 Ω のイヤホンを鳴らした音です。帯域全体で音量がおよそ -1〜+2 dB 変わります。',
          short: '元の音か出力インピーダンスの高いアンプか',
        },
        hard: {
          question: 'むずかしい：X は元の音？ それとも細く長いケーブル？',
          processing: 'Earphone Cable Sim のプリセット Long Thin Cable：ケーブル抵抗 1.2 Ω、インダクタンス 3 µH、アンプの出力インピーダンス 0.5 Ω で 16 Ω のイヤホンを鳴らした音です。帯域全体での音量の変化は 0.5 dB 未満です。',
          short: '元の音か細く長いケーブルか',
        },
      },
      play: '再生',
      stop: '停止',
      loading: '読み込み中…',
      loadError: '音声を読み込めませんでした。接続を確かめて、もう一度チャレンジを選んでください。',
      playError: '再生を開始できませんでした。再生ボタンでもう一度お試しください。',
      ready: 'A が元の音、B が加工した音です。X は A と B のどちらと同じでしょうか。',
      trial: n => `${TRIALS} 回中 ${n} 回目`,
      score: correct => `${TRIALS} 回中 ${correct} 回正解`,
      best: correct => `最高 ${correct} / ${TRIALS}`,
      significant: '統計的に有意です。2 つを聴き分けられたと言えます。',
      notSignificant: '有意ではありません。このテストでは聴き分けられたとは示せませんでした。ただし、2 つが同じ音だという証明にはなりません。',
      pSep: '。',
      whatB: 'B の正体：',
      shortAnswer: (short, original) => `<strong>ショート動画「${short}」の答え：</strong>元の音は ${original} でした。`,
      again: 'もう一度',
      openEffetune: 'このテストを EffeTune で開く',
      openNote: '音量合わせも含めて同じ 2 つのパイプラインを EffeTune の Web アプリに読み込み、好きな曲で ABX テストを始められる状態で開きます。デスクトップ版では、このリンクをコピーして EffeTune に貼り付けてください（Ctrl+V、macOS は Command+V）。',
      testName: what => `EffeTune ABX チャレンジ：${what}`,
      finished: 'テスト終了です。',
    },
  };

  // Per-viewer conveniences; storage may be unavailable (private mode, blocked site data).
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* not persisted */ } },
  };

  const root = document.querySelector('[data-abx]');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const els = {
    question: $('[data-question]'),
    status: $('[data-status]'),
    player: $('[data-player]'),
    position: $('[data-position]'),
    trials: $('[data-trials]'),
    progress: $('[data-progress]'),
    result: $('[data-result]'),
  };

  const buffers = new Map();
  const fades = new WeakMap();
  let t = TEXT.en;
  let context = null;
  let level = null;
  let clips = null; // { A: AudioBuffer, B: AudioBuffer }
  let playing = null; // { sources, gains, startedAt, offset }
  let selected = null; // 'A' | 'B' | 'X'
  let xIsA = true;
  let answers = [];
  let state = 'idle'; // 'idle' | 'loading' | 'error' | 'testing' | 'finished'
  let loadRequest = 0;
  let playRequest = 0;
  let playPending = false;
  let seekPointerId = null;

  const load = async url => {
    if (!buffers.has(url)) {
      const pending = fetch(url)
        .then(response => {
          if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then(data => context.decodeAudioData(data));
      pending.catch(() => buffers.delete(url));
      buffers.set(url, pending);
    }
    return buffers.get(url);
  };

  const heard = () => (selected === 'X' ? (xIsA ? 'A' : 'B') : selected);

  const position = () => {
    if (!playing) return Number(els.position.value) * clips.A.duration;
    return (playing.offset + Math.max(0, context.currentTime - playing.startedAt)) % clips.A.duration;
  };

  const fadeGain = (node, target, when, until = when + FADE_S) => {
    const previous = fades.get(node);
    const progress = !previous || when <= previous.start ? 0
      : when >= previous.end ? 1 : (when - previous.start) / (previous.end - previous.start);
    const value = previous ? previous.from + (previous.to - previous.from) * progress : 0;
    const gain = node.gain;
    gain.cancelScheduledValues(when);
    // Reconstruct the interrupted ramp, then explicitly anchor the next one.
    // AudioParam.value can lag a render block; cancelAndHoldAtTime alone does
    // not add an anchor when the previous ramp has already finished.
    if (previous && when > previous.start && when < previous.end) {
      gain.linearRampToValueAtTime(value, when);
    }
    gain.setValueAtTime(value, when);
    gain.linearRampToValueAtTime(target, until);
    fades.set(node, { from: value, to: target, start: when, end: until });
  };

  const applyGains = () => {
    if (!playing) return;
    // Both sources start together in the future; fade in only once they can be heard.
    const when = Math.max(context.currentTime, playing.startedAt);
    for (const label of ['A', 'B']) {
      fadeGain(playing.gains[label], label === heard() ? 1 : 0, when);
    }
  };

  const stop = () => {
    ++playRequest;
    playPending = false;
    if (!playing) return;
    els.position.value = String(position() / clips.A.duration);
    const now = context.currentTime;
    const stopAt = now < playing.startedAt ? now : now + FADE_S;
    for (const label of ['A', 'B']) {
      const source = playing.sources[label];
      const gain = playing.gains[label];
      fadeGain(gain, 0, now, stopAt);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.stop(stopAt);
    }
    playing = null;
  };

  const start = offset => {
    offset %= clips.A.duration;
    const startedAt = context.currentTime + 0.02;
    const sources = {}, gains = {};
    for (const label of ['A', 'B']) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      const source = context.createBufferSource();
      source.buffer = clips[label];
      source.loop = true;
      source.connect(gain);
      source.start(startedAt, offset);
      sources[label] = source;
      gains[label] = gain;
    }
    playing = { sources, gains, startedAt, offset };
    applyGains();
  };

  const showSelection = () => {
    for (const button of root.querySelectorAll('[data-play]')) {
      button.classList.toggle('is-active', !!playing && button.dataset.play === selected);
    }
    const playStop = $('[data-stop]');
    playStop.textContent = playing || playPending ? t.stop : t.play;
    playStop.classList.toggle('is-playing', !!playing || playPending);
  };

  const play = async label => {
    if (state !== 'testing' || !clips) return;
    const request = ++playRequest;
    playPending = true;
    showSelection();
    try {
      if (context.state !== 'running') await context.resume();
      // A level change, stop, or later play request may have superseded this one.
      if (request !== playRequest || state !== 'testing') return;
      playPending = false;
      selected = label;
      if (!playing) start(Number(els.position.value) * clips.A.duration);
      else applyGains();
      els.status.textContent = t.ready;
      showSelection();
    } catch (error) {
      if (request !== playRequest) return;
      playPending = false;
      els.status.textContent = t.playError;
      showSelection();
      console.error('ABX Challenge: could not start playback.', error);
    }
  };

  const toggle = () => {
    if (playing || playPending) stop();
    else play(selected || 'A');
    showSelection();
  };

  // While playing, the slider follows the playback position unless it is being dragged.
  setInterval(() => {
    if (playing && seekPointerId === null) els.position.value = String(position() / clips.A.duration);
  }, 200);

  // One-sided binomial p-value: the chance of at least `correct` right answers by guessing.
  const pValue = correct => {
    let p = 0;
    let ways = 1;
    for (let k = 0; k <= TRIALS; k++) {
      if (k >= correct) p += ways;
      ways = (ways * (TRIALS - k)) / (k + 1);
    }
    return p / 2 ** TRIALS;
  };

  const bestKey = name => `effetune-abx-challenge-best-${name}`;

  const renderBest = () => {
    for (const el of root.querySelectorAll('[data-best]')) {
      const best = storage.get(bestKey(el.dataset.best));
      el.textContent = best === null ? '' : t.best(Number(best));
    }
  };

  const renderTrials = () => {
    els.trials.replaceChildren(...Array.from({ length: TRIALS }, (_, i) => {
      const dot = document.createElement('span');
      if (i < answers.length) dot.className = 'done';
      else if (i === answers.length) dot.className = 'current';
      return dot;
    }));
    els.progress.textContent = answers.length < TRIALS ? t.trial(answers.length + 1) : '';
  };

  const renderResult = () => {
    const correct = answers.filter(Boolean).length;
    const p = pValue(correct);
    const info = t.levels[level];
    const significant = p < 0.05;
    els.result.innerHTML = `
      <p class="score ${significant ? 'is-significant' : ''}">${t.score(correct)}</p>
      <p class="verdict">p ${p < 0.001 ? '&lt; 0.001' : `= ${p.toFixed(3)}`}${t.pSep}${significant ? t.significant : t.notSignificant}</p>
      <p><strong>${t.whatB}</strong> ${info.processing}</p>
      <p>${t.shortAnswer(info.short, SHORT_ORIGINAL[level])}</p>
      <button type="button" class="again" data-again>${t.again}</button>
      <div class="effetune-box">
        <a class="open-effetune" href="${effetuneUrl()}" target="_blank" rel="noopener">${t.openEffetune}</a>
        <p class="open-note">${t.openNote}</p>
      </div>`;
  };

  // Same payload and URL as EffeTune's "Share this test" (UTF-8 JSON in base64, `dbt` parameter).
  const effetuneUrl = () => {
    const payload = {
      v: 1, n: '', tn: t.testName(t.ui[`${level}What`]), tT: 'ABX', tc: TRIALS, fAB: true,
      cC: 0, tC: 0, pa: 0, ts: 0, pA: PIPELINE_A, pB: PIPELINES_B[level],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const url = new URL('https://effetune.frieve.com/effetune.html');
    url.searchParams.set('dbt', btoa(String.fromCharCode(...bytes)));
    return url.href;
  };

  // Rewrites every language-dependent text for the current state.
  const render = () => {
    els.question.textContent = level ? t.levels[level].question : '';
    els.status.textContent = { idle: t.ui.choose, loading: t.loading, error: t.loadError, testing: t.ready, finished: t.finished }[state];
    els.player.hidden = state !== 'testing';
    els.result.hidden = state !== 'finished';
    if (state === 'testing') renderTrials();
    if (state === 'finished') renderResult();
    renderBest();
    showSelection();
  };

  const finish = () => {
    stop();
    const correct = answers.filter(Boolean).length;
    if (correct > Number(storage.get(bestKey(level)) ?? -1)) storage.set(bestKey(level), String(correct));
    state = 'finished';
    render();
  };

  const nextTrial = () => {
    xIsA = Math.random() < 0.5;
    applyGains();
    renderTrials();
  };

  const vote = label => {
    if (state !== 'testing') return;
    answers.push((label === 'A') === xIsA);
    if (answers.length >= TRIALS) finish();
    else nextTrial();
  };

  const choose = async name => {
    const request = ++loadRequest;
    stop();
    seekPointerId = null;
    level = name;
    clips = null;
    selected = null;
    answers = [];
    for (const tab of root.querySelectorAll('[data-level]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.level === name));
    }
    els.position.value = '0';
    state = 'loading';
    render();
    try {
      context ??= new AudioContext();
      const [original, processed] = await Promise.all([load('clips/original.flac'), load(CLIPS[name])]);
      if (request !== loadRequest) return;
      clips = { A: original, B: processed };
    } catch (error) {
      console.error('ABX Challenge: could not load the clips.', error);
      if (request === loadRequest) { state = 'error'; render(); }
      return;
    }
    state = 'testing';
    render();
    nextTrial();
  };

  const setLanguage = lang => {
    t = TEXT[lang];
    document.documentElement.lang = lang;
    document.title = t.ui.pageTitle;
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t.ui[el.dataset.t];
    for (const el of document.querySelectorAll('[data-t-html]')) el.innerHTML = t.ui[el.dataset.tHtml];
    for (const button of document.querySelectorAll('[data-lang]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    }
    render();
  };

  const initialLanguage = () => {
    const requested = new URLSearchParams(location.search).get('lang') ?? storage.get('effetune-abx-challenge-lang');
    if (Object.hasOwn(TEXT, requested)) return requested;
    return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-lang]');
    if (!button) return;
    storage.set('effetune-abx-challenge-lang', button.dataset.lang);
    const url = new URL(location.href);
    url.searchParams.set('lang', button.dataset.lang);
    history.replaceState(null, '', url);
    setLanguage(button.dataset.lang);
  });

  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.level) choose(target.dataset.level);
    else if (target.dataset.play) play(target.dataset.play);
    else if (target.hasAttribute('data-stop')) toggle();
    else if (target.dataset.vote) vote(target.dataset.vote);
    else if (target.hasAttribute('data-again')) choose(level);
  });

  els.position.addEventListener('pointerdown', event => {
    if (event.button === 0) seekPointerId = event.pointerId;
  });
  const endSeek = event => {
    if (event.pointerId === seekPointerId) seekPointerId = null;
  };
  document.addEventListener('pointerup', endSeek);
  document.addEventListener('pointercancel', endSeek);
  els.position.addEventListener('lostpointercapture', endSeek);
  window.addEventListener('blur', () => { seekPointerId = null; });

  els.position.addEventListener('input', () => {
    if (!playing) return;
    const nextPosition = els.position.value;
    stop();
    els.position.value = nextPosition;
    start(Number(nextPosition) * clips.A.duration);
  });

  document.addEventListener('keydown', event => {
    if (state !== 'testing' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input:not([type="range"]), textarea, select')) return;
    const key = event.key.toLowerCase();
    if (!['a', 'b', 'x', 'q', 'w', ' '].includes(key)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (key === 'a' || key === 'b' || key === 'x') play(key.toUpperCase());
    else if (key === 'q') vote('A');
    else if (key === 'w') vote('B');
    else if (key === ' ') toggle();
  });

  // A focused button would also activate on the Space keyup; Space is reserved for play/stop.
  document.addEventListener('keyup', event => {
    if (state === 'testing' && event.key === ' ') event.preventDefault();
  });

  setLanguage(initialLanguage());
})();
