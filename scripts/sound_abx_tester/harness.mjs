import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const flush = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class Element {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.value = '0';
    this.checked = false;
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.events = new Map();
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force = !classes.has(name)) { force ? classes.add(name) : classes.delete(name); },
    };
  }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(listener);
  }
  emit(type, options = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...options };
    for (const listener of this.events.get(type) ?? []) listener(event);
    return event;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  hasAttribute(name) { return name.startsWith('data-') && name.slice(5) in this.dataset; }
  replaceChildren(...children) { this.children = children; }
  closest(selector) {
    return selector === 'button' || (selector === '[data-lang]' && this.dataset.lang) ? this : null;
  }
}

// A small automation timeline, so tests assert audible gains at specific times,
// rather than just checking which Web Audio methods were called.
class AudioParam {
  constructor(context) { this.context = context; this.initial = 0; this.events = []; }
  get value() { return this.at(this.context.currentTime); }
  set value(value) { this.initial = value; }
  at(time) {
    let previous = { time: 0, value: this.initial };
    for (const event of this.events) {
      if (event.time > time) {
        if (event.type === 'ramp' && time >= previous.time) {
          return previous.value + (event.value - previous.value) * (time - previous.time) / (event.time - previous.time);
        }
        break;
      }
      previous = event;
    }
    return previous.value;
  }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
  cancelAndHoldAtTime(time) {
    const value = this.at(time);
    const ramp = this.events.find(event => event.time >= time)?.type === 'ramp';
    this.cancelScheduledValues(time);
    this.events.push({ type: ramp ? 'ramp' : 'set', value, time });
  }
}

export function challenge(options = {}) {
  const elements = new Map();
  const el = name => {
    if (!elements.has(name)) elements.set(name, new Element({ [name]: '' }));
    return elements.get(name);
  };
  const buttons = [
    ...['easy', 'medium', 'hard'].map(level => new Element({ level })),
    ...['A', 'B', 'X'].map(play => new Element({ play })),
    ...['A', 'B'].map(vote => new Element({ vote })),
    ...['en', 'ja'].map(lang => new Element({ lang })),
    ...['easy', 'medium', 'hard'].map(best => new Element({ best })),
    new Element({ stop: '' }), new Element({ again: '' }),
  ];
  const root = new Element();
  root.querySelector = selector => el(selector.slice(6, -1));
  root.querySelectorAll = selector => buttons.filter(button => selector.slice(6, -1) in button.dataset);
  const document = new Element();
  document.querySelector = () => root;
  document.querySelectorAll = root.querySelectorAll;
  document.createElement = () => new Element();
  document.documentElement = {};
  document.activeElement = null;
  const window = new Element();
  const intervals = [];
  const stored = new Map();
  const requests = [];
  const errors = [];
  let audio;
  class AudioContext {
    constructor() {
      audio = this;
      this.currentTime = 1;
      this.state = 'running';
      this.destination = {};
      this.sources = [];
      this.gains = [];
    }
    decodeAudioData(data) { return Promise.resolve({ duration: 12, url: data.url }); }
    createGain() {
      const node = { gain: new AudioParam(this), connect() {}, disconnect() { this.disconnected = true; } };
      if (options.noCancelAndHold) node.gain.cancelAndHoldAtTime = undefined;
      this.gains.push(node);
      return node;
    }
    createBufferSource() {
      const node = {
        connect() {}, disconnect() { this.disconnected = true; },
        start(time, offset) { this.startTime = time; this.offset = offset; },
        stop(time) { this.stopTime = time; },
      };
      this.sources.push(node);
      return node;
    }
    async resume() { this.state = 'running'; }
  }
  const sandbox = {
    document, window, AudioContext, URL, URLSearchParams, TextEncoder, btoa,
    location: new URL(`http://localhost/challenge/${options.search ?? ''}`),
    navigator: { language: 'en' }, history: { replaceState() {} },
    Math: Object.assign(Object.create(Math), { random: options.random ?? (() => 0.1) }),
    console: { error: (...args) => errors.push(args) },
    localStorage: {
      getItem(key) { if (options.storageBlocked) throw new Error('blocked'); return stored.get(key) ?? null; },
      setItem(key, value) { if (options.storageBlocked) throw new Error('blocked'); stored.set(key, value); },
    },
    setInterval: callback => intervals.push(callback),
    fetch(url) {
      requests.push(url);
      return options.fetch ? options.fetch(url) : Promise.resolve(response(url));
    },
  };
  vm.runInNewContext(readFileSync(new URL('../../sound_abx_tester/effetune_challenge/challenge.js', import.meta.url), 'utf8'), sandbox);
  return {
    el, document, window, stored, requests, errors,
    get audio() { return audio; },
    click(key, value = '') {
      const target = buttons.find(button => button.dataset[key] === value);
      if (!target) throw new Error(`Unknown button: ${key}=${value}`);
      root.emit('click', { target }); document.emit('click', { target });
    },
    key(key, options = {}) { return document.emit('keydown', { key, ...options }); },
    tick(seconds) { audio.currentTime += seconds; for (const callback of intervals) callback(); },
    seek(fraction) { el('position').value = String(fraction); el('position').emit('input'); },
  };
}

export function response(url, status = 200) {
  return { ok: status === 200, status, arrayBuffer: async () => ({ url }) };
}
