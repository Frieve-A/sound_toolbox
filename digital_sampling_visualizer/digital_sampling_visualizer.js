(() => {
  "use strict";

  const canvas = document.getElementById("waveCanvas");
  if(!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  const marginLeft = 60;
  const marginRight = 40;
  const marginTop = 40;
  const marginBottom = 50;

  const srView = width - marginLeft - marginRight;
  const MARGIN = 1000;
  const srAll = srView + 2 * MARGIN;
  const BAND_LIMIT_FILTER_K = 512;
  const MAX_PHASE_MARGIN = 50000;
  const WHITE_NOISE_SEED = 0x5eed1234;

  const ui = {};
  [
    "showOriginal",
    "showSampling",
    "showSamplingLine",
    "showDAC",
    "signalFreq",
    "signalLevel",
    "noiseLevel",
    "bandLimitEnabled",
    "bandLimitFreq",
    "signalPhase",
    "phasePlaybackToggle",
    "ampRange",
    "timeRange",
    "sampleFreq",
    "bitDepth",
    "aaFilterK",
    "filterK",
    "signalFreqVal",
    "signalLevelVal",
    "noiseLevelVal",
    "bandLimitFreqVal",
    "bandLimitFreqUnit",
    "signalPhaseVal",
    "ampRangeVal",
    "timeRangeVal",
    "sampleFreqVal",
    "bitDepthVal",
    "aaFilterKVal",
    "filterKVal"
  ].forEach(id => {
    ui[id] = document.getElementById(id);
  });
  ui.signalTypeRadios = Array.from(document.querySelectorAll('input[name="signalType"]'));

  let bandlimitedSignalCache = { key: "", data: null, margin: MARGIN, version: 0 };
  let phasedSignalCache = { key: "", data: null };
  let additionalNoiseCache = { key: "", data: null };
  let originalSignalCache = { key: "", data: null };
  let aaSignalCache = { key: "", data: null };
  let sampleCache = { key: "", packet: null };
  let dacCache = { key: "", data: null };
  const kernelCache = new Map();
  const PHASE_PLAYBACK_FPS = 60;
  const PHASE_PLAYBACK_FRAME_MS = 1000 / PHASE_PLAYBACK_FPS;
  const PHASE_PLAYBACK_RANGE = 360;
  let phasePlaybackFrameId = null;
  let lastPhasePlaybackTime = 0;

  function clearBandlimitedCaches(){
    bandlimitedSignalCache = {
      key: "",
      data: null,
      margin: MARGIN,
      version: bandlimitedSignalCache.version + 1
    };
    clearPhasedCaches();
  }

  function clearPhasedCaches(){
    phasedSignalCache = { key: "", data: null };
    originalSignalCache = { key: "", data: null };
    clearSamplingCaches();
  }

  function clearAdditionalNoiseCaches(){
    additionalNoiseCache = { key: "", data: null };
    originalSignalCache = { key: "", data: null };
    clearSamplingCaches();
  }

  function clearSamplingCaches(){
    aaSignalCache = { key: "", data: null };
    sampleCache = { key: "", packet: null };
    clearDacCache();
  }

  function clearDacCache(){
    dacCache = { key: "", data: null };
  }

  function clearTimeRangeCaches(){
    clearPhasedCaches();
    clearAdditionalNoiseCaches();
  }

  function addInputListeners(elements, invalidate){
    elements.forEach(el => {
      el.addEventListener("input", () => {
        invalidate();
        updateVals();
        draw();
      });
    });
  }

  addInputListeners(
    [...ui.signalTypeRadios, ui.signalFreq, ui.bandLimitEnabled, ui.bandLimitFreq],
    clearBandlimitedCaches
  );
  addInputListeners([ui.signalLevel, ui.signalPhase], clearPhasedCaches);
  addInputListeners([ui.noiseLevel], clearAdditionalNoiseCaches);
  addInputListeners([ui.timeRange], clearTimeRangeCaches);
  addInputListeners([ui.sampleFreq, ui.bitDepth, ui.aaFilterK], clearSamplingCaches);
  addInputListeners([ui.filterK], clearDacCache);
  addInputListeners(
    [ui.showOriginal, ui.showSampling, ui.showSamplingLine, ui.showDAC, ui.ampRange],
    () => {}
  );

  function sliderToLogFreq(sliderValue){
    const baseFreq = 1000;
    return baseFreq * Math.pow(2, (sliderValue - 128) / 20);
  }

  function dbToLinear(db){
    if(db <= -145) return 0;
    return Math.pow(10, db / 20);
  }

  function clamp(v, vmin, vmax){
    return Math.max(vmin, Math.min(vmax, v));
  }

  function getSignalFreq(){
    return sliderToLogFreq(parseInt(ui.signalFreq.value, 10));
  }

  function getSignalType(){
    return document.querySelector('input[name="signalType"]:checked')?.value || "sine";
  }

  function getSampleFreq(){
    return parseInt(ui.sampleFreq.value, 10) * 100;
  }

  function getBandLimitFreq(){
    return sliderToLogFreq(parseInt(ui.bandLimitFreq.value, 10));
  }

  function isBandLimitEnabled(){
    return ui.bandLimitEnabled.checked;
  }

  function getSignalPhase(){
    return parseFloat(ui.signalPhase.value);
  }

  function getDisplayTimeSec(){
    return parseFloat(ui.timeRange.value) / 1000;
  }

  function getDisplaySampleRate(){
    return srView / getDisplayTimeSec();
  }

  function getMinDisplayTimeSec(){
    return parseFloat(ui.timeRange.min) / 1000;
  }

  function getMaxDisplayTimeSec(){
    return parseFloat(ui.timeRange.max) / 1000;
  }

  function getSourceSampleRate(){
    return srView / getMinDisplayTimeSec();
  }

  function getSourceVisibleSamples(){
    return Math.ceil(getMaxDisplayTimeSec() * getSourceSampleRate());
  }

  function updateVals(){
    ui.signalFreqVal.textContent = Math.round(getSignalFreq());
    ui.signalLevelVal.textContent = ui.signalLevel.value;
    ui.noiseLevelVal.textContent = ui.noiseLevel.value <= -145 ? "Off" : ui.noiseLevel.value;
    ui.bandLimitFreq.disabled = !isBandLimitEnabled();
    ui.bandLimitFreqVal.textContent = isBandLimitEnabled() ? Math.round(getBandLimitFreq()) : "Off";
    ui.bandLimitFreqUnit.textContent = isBandLimitEnabled() ? "Hz" : "";
    ui.signalPhaseVal.textContent = ui.signalPhase.value;
    ui.ampRangeVal.textContent = ui.ampRange.value;
    ui.timeRangeVal.textContent = ui.timeRange.value;
    ui.sampleFreqVal.textContent = getSampleFreq();
    ui.bitDepthVal.textContent = ui.bitDepth.value;
    ui.aaFilterKVal.textContent = parseInt(ui.aaFilterK.value, 10) * 2 + 1;
    ui.filterKVal.textContent = parseInt(ui.filterK.value, 10) * 2 + 1;
  }

  function normalizePhaseValue(value){
    const numericValue = Number(value);
    let phase = (Number.isFinite(numericValue) ? Math.floor(numericValue) : 0) % PHASE_PLAYBACK_RANGE;
    if(phase < 0) phase += PHASE_PLAYBACK_RANGE;
    return phase;
  }

  function setSignalPhaseValue(phase){
    ui.signalPhase.value = normalizePhaseValue(phase);
    clearPhasedCaches();
    updateVals();
    draw();
  }

  function updatePhasePlaybackButton(isPlaying){
    if(!ui.phasePlaybackToggle) return;

    const label = isPlaying
      ? ui.phasePlaybackToggle.dataset.stopLabel
      : ui.phasePlaybackToggle.dataset.playLabel;
    const title = isPlaying
      ? ui.phasePlaybackToggle.dataset.stopTitle
      : ui.phasePlaybackToggle.dataset.playTitle;

    ui.phasePlaybackToggle.textContent = label || (isPlaying ? "■" : "▶");
    ui.phasePlaybackToggle.title = title || "";
    ui.phasePlaybackToggle.setAttribute("aria-label", title || "");
    ui.phasePlaybackToggle.setAttribute("aria-pressed", isPlaying ? "true" : "false");
  }

  function stepPhasePlayback(timestamp){
    if(phasePlaybackFrameId === null) return;

    if(!lastPhasePlaybackTime){
      lastPhasePlaybackTime = timestamp;
    }

    const elapsed = timestamp - lastPhasePlaybackTime;
    const frames = Math.floor(elapsed / PHASE_PLAYBACK_FRAME_MS);
    if(frames > 0){
      lastPhasePlaybackTime += frames * PHASE_PLAYBACK_FRAME_MS;
      setSignalPhaseValue(parseInt(ui.signalPhase.value, 10) + frames);
    }

    phasePlaybackFrameId = requestAnimationFrame(stepPhasePlayback);
  }

  function startPhasePlayback(){
    if(phasePlaybackFrameId !== null) return;

    setSignalPhaseValue(ui.signalPhase.value);
    lastPhasePlaybackTime = 0;
    updatePhasePlaybackButton(true);
    phasePlaybackFrameId = requestAnimationFrame(stepPhasePlayback);
  }

  function stopPhasePlayback(){
    if(phasePlaybackFrameId === null) return;

    cancelAnimationFrame(phasePlaybackFrameId);
    phasePlaybackFrameId = null;
    lastPhasePlaybackTime = 0;
    updatePhasePlaybackButton(false);
  }

  if(ui.phasePlaybackToggle){
    ui.phasePlaybackToggle.addEventListener("click", () => {
      if(phasePlaybackFrameId !== null){
        stopPhasePlayback();
      } else {
        startPhasePlayback();
      }
    });
  }

  function timeToX(tSec){
    const x0 = marginLeft;
    const x1 = width - marginRight;
    return x0 + (x1 - x0) * (tSec / getDisplayTimeSec());
  }

  function ampToY(a){
    const y0 = marginTop;
    const y1 = height - marginBottom;
    const centerY = (y0 + y1) * 0.5;
    const topVal = dbToLinear(parseFloat(ui.ampRange.value));
    return centerY - (a / topVal) * (centerY - y0);
  }

  function getSignedPhaseDegrees(){
    let phase = getSignalPhase() % 360;
    if(phase < 0) phase += 360;
    if(phase > 180) phase -= 360;
    return phase;
  }

  function getPhaseShiftDegrees(){
    return getSignalType() === "white_noise" ? getSignalPhase() : getSignedPhaseDegrees();
  }

  function getPhaseMarginSamples(){
    const freq = Math.max(getSignalFreq(), 1);
    const maxShiftCycles = getSignalType() === "white_noise" ? 1 : 0.5;
    return Math.ceil(Math.min(getSourceSampleRate() * maxShiftCycles / freq, MAX_PHASE_MARGIN));
  }

  function getSourceMarginSamples(){
    const minDisplaySampleRate = srView / getMaxDisplayTimeSec();
    const maxDisplayMarginSamples = Math.ceil((MARGIN / minDisplaySampleRate) * getSourceSampleRate());
    return maxDisplayMarginSamples + getPhaseMarginSamples() + BAND_LIMIT_FILTER_K + 2;
  }

  function makeBandlimitedSignalKey(){
    return [
      getSignalType(),
      ui.signalFreq.value,
      isBandLimitEnabled() ? ui.bandLimitFreq.value : "off"
    ].join("|");
  }

  function sinc(x){
    if(Math.abs(x) < 1.0e-12) return 1.0;
    return Math.sin(Math.PI * x) / (Math.PI * x);
  }

  function blackmanWindow(k, kTotal){
    if(kTotal <= 0) return 1;
    const alpha = 0.16;
    const a0 = 0.5 * (1 - alpha);
    const a1 = 0.5;
    const a2 = alpha / 2;
    const w = 2 * Math.PI * k / kTotal;
    return a0 - a1 * Math.cos(w) + a2 * Math.cos(2 * w);
  }

  function getSincLowPassKernel(cutoffFreq, sampleRate, K){
    const fc = clamp(cutoffFreq, 0, sampleRate / 2);
    if(fc <= 0) return null;

    const key = `${K}|${fc.toFixed(6)}|${sampleRate.toFixed(6)}`;
    const cached = kernelCache.get(key);
    if(cached) return cached;

    const normalizedFc = fc / sampleRate;
    const kernel = new Float64Array(2 * K + 1);
    let kernelSum = 0;
    for(let k=-K; k<=K; k++){
      const idx = k + K;
      const arg = 2 * normalizedFc * k;
      let w = sinc(arg) * (2 * normalizedFc);
      w *= blackmanWindow(idx, 2 * K);
      kernel[idx] = w;
      kernelSum += w;
    }

    if(Math.abs(kernelSum) > 1.0e-12){
      for(let i=0; i<kernel.length; i++){
        kernel[i] /= kernelSum;
      }
    }

    if(kernelCache.size > 32){
      kernelCache.clear();
    }
    kernelCache.set(key, kernel);
    return kernel;
  }

  function nextPowerOfTwo(value){
    let size = 1;
    while(size < value) size <<= 1;
    return size;
  }

  function fftRadix2(real, imag, inverse){
    const n = real.length;
    for(let i=1, j=0; i<n; i++){
      let bit = n >> 1;
      while(j & bit){
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;

      if(i < j){
        const realTmp = real[i];
        const imagTmp = imag[i];
        real[i] = real[j];
        imag[i] = imag[j];
        real[j] = realTmp;
        imag[j] = imagTmp;
      }
    }

    for(let len=2; len<=n; len<<=1){
      const angle = (inverse ? 2 : -2) * Math.PI / len;
      const wLenReal = Math.cos(angle);
      const wLenImag = Math.sin(angle);
      const halfLen = len >> 1;

      for(let i=0; i<n; i+=len){
        let wReal = 1;
        let wImag = 0;
        for(let j=0; j<halfLen; j++){
          const evenReal = real[i + j];
          const evenImag = imag[i + j];
          const oddReal = real[i + j + halfLen] * wReal - imag[i + j + halfLen] * wImag;
          const oddImag = real[i + j + halfLen] * wImag + imag[i + j + halfLen] * wReal;

          real[i + j] = evenReal + oddReal;
          imag[i + j] = evenImag + oddImag;
          real[i + j + halfLen] = evenReal - oddReal;
          imag[i + j + halfLen] = evenImag - oddImag;

          const nextWReal = wReal * wLenReal - wImag * wLenImag;
          wImag = wReal * wLenImag + wImag * wLenReal;
          wReal = nextWReal;
        }
      }
    }

    if(inverse){
      for(let i=0; i<n; i++){
        real[i] /= n;
        imag[i] /= n;
      }
    }
  }

  function applySincLowPassDirect(dataF, kernel, K){
    const outF = new Float64Array(dataF.length);
    for(let i=0; i<dataF.length; i++){
      let sum = 0;
      for(let k=-K; k<=K; k++){
        const idx = clamp(i + k, 0, dataF.length - 1);
        sum += dataF[idx] * kernel[k + K];
      }
      outF[i] = sum;
    }
    return outF;
  }

  function applySincLowPass(dataF, cutoffFreq, sampleRate, K){
    if(K <= 0 || cutoffFreq >= sampleRate / 2) return new Float64Array(dataF);

    const kernel = getSincLowPassKernel(cutoffFreq, sampleRate, K);
    if(!kernel) return new Float64Array(dataF.length);

    if(dataF.length === 0) return new Float64Array(0);

    const kernelLength = kernel.length;
    if(dataF.length * kernelLength <= 1000000){
      return applySincLowPassDirect(dataF, kernel, K);
    }

    const paddedLength = dataF.length + 2 * K;
    const convLength = paddedLength + kernelLength - 1;
    const fftSize = nextPowerOfTwo(convLength);
    const dataReal = new Float64Array(fftSize);
    const dataImag = new Float64Array(fftSize);
    const kernelReal = new Float64Array(fftSize);
    const kernelImag = new Float64Array(fftSize);

    for(let i=0; i<paddedLength; i++){
      dataReal[i] = dataF[clamp(i - K, 0, dataF.length - 1)];
    }
    for(let i=0; i<kernelLength; i++){
      kernelReal[i] = kernel[kernelLength - 1 - i];
    }

    fftRadix2(dataReal, dataImag, false);
    fftRadix2(kernelReal, kernelImag, false);
    for(let i=0; i<fftSize; i++){
      const real = dataReal[i] * kernelReal[i] - dataImag[i] * kernelImag[i];
      const imag = dataReal[i] * kernelImag[i] + dataImag[i] * kernelReal[i];
      dataReal[i] = real;
      dataImag[i] = imag;
    }
    fftRadix2(dataReal, dataImag, true);

    const outF = new Float64Array(dataF.length);
    for(let i=0; i<dataF.length; i++){
      outF[i] = dataReal[i + kernelLength - 1];
    }
    return outF;
  }

  function rotl32(value, bits){
    return ((value << bits) | (value >>> (32 - bits))) >>> 0;
  }

  function createWhiteNoiseRandom(){
    let splitMixState = (WHITE_NOISE_SEED ^ Math.imul(parseInt(ui.signalFreq.value, 10), 0x9e3779b9)) >>> 0;
    function splitMix32(){
      splitMixState = (splitMixState + 0x9e3779b9) >>> 0;
      let value = splitMixState;
      value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
      value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
      return (value ^ (value >>> 15)) >>> 0;
    }

    let s0 = splitMix32();
    let s1 = splitMix32();
    let s2 = splitMix32();
    let s3 = splitMix32();
    if((s0 | s1 | s2 | s3) === 0){
      s0 = WHITE_NOISE_SEED;
    }

    return function(){
      const result = Math.imul(rotl32(Math.imul(s1, 5), 7), 9) >>> 0;
      const t = (s1 << 9) >>> 0;
      s2 ^= s0;
      s3 ^= s1;
      s1 ^= s2;
      s0 ^= s3;
      s2 ^= t;
      s3 = rotl32(s3, 11);
      return result / 4294967296;
    };
  }

  function normalizePeak(dataF){
    let peak = 0;
    for(let i=0; i<dataF.length; i++){
      peak = Math.max(peak, Math.abs(dataF[i]));
    }
    if(peak <= 1.0e-12) return dataF;

    for(let i=0; i<dataF.length; i++){
      dataF[i] /= peak;
    }
    return dataF;
  }

  function generateSourceFloat(marginSamples, visibleSamples, sampleRate){
    const type = getSignalType();
    const freq = getSignalFreq();
    const totalSamples = visibleSamples + 2 * marginSamples;
    const dataF = new Float64Array(totalSamples);
    const whiteNoiseRandom = type === "white_noise" ? createWhiteNoiseRandom() : null;

    for(let i=0; i<totalSamples; i++){
      const t = ((i + 0.5) - marginSamples) / sampleRate;
      const cyclePos = freq * t;
      let sample = 0;

      if(type === "sine"){
        sample = Math.sin(2 * Math.PI * cyclePos);
      } else if(type === "square"){
        sample = Math.sin(2 * Math.PI * cyclePos) >= 0 ? 1 : -1;
      } else if(type === "saw"){
        sample = 2 * (cyclePos - Math.floor(cyclePos)) - 1;
      } else if(type === "white_noise"){
        sample = whiteNoiseRandom() * 2 - 1;
      }

      dataF[i] = sample;
    }
    return type === "white_noise" ? normalizePeak(dataF) : dataF;
  }

  function getBandlimitedSignal(){
    const key = makeBandlimitedSignalKey();
    if(bandlimitedSignalCache.key === key && bandlimitedSignalCache.data){
      return bandlimitedSignalCache;
    }

    const sampleRate = getSourceSampleRate();
    const visibleSamples = getSourceVisibleSamples();
    const marginSamples = getSourceMarginSamples();
    const sourceF = generateSourceFloat(marginSamples, visibleSamples, sampleRate);
    const filteredF = isBandLimitEnabled()
      ? applySincLowPass(sourceF, Math.min(getBandLimitFreq(), sampleRate / 2), sampleRate, BAND_LIMIT_FILTER_K)
      : new Float64Array(sourceF);
    if(getSignalType() === "white_noise"){
      normalizePeak(filteredF);
    }

    bandlimitedSignalCache = {
      key,
      data: filteredF,
      margin: marginSamples,
      sampleRate,
      visibleSamples,
      version: bandlimitedSignalCache.version + 1
    };
    clearPhasedCaches();
    return bandlimitedSignalCache;
  }

  function sampleFloatAt(dataF, idx){
    if(idx <= 0) return dataF[0];
    if(idx >= dataF.length - 1) return dataF[dataF.length - 1];
    const idxLow = Math.floor(idx);
    const frac = idx - idxLow;
    return dataF[idxLow] + frac * (dataF[idxLow + 1] - dataF[idxLow]);
  }

  function getPhasedSignal(){
    const base = getBandlimitedSignal();
    const phaseShiftDegrees = getPhaseShiftDegrees();
    const phaseShiftSec = phaseShiftDegrees / 360 / getSignalFreq();
    const level = dbToLinear(parseFloat(ui.signalLevel.value));
    const key = [
      base.version,
      base.key,
      base.margin,
      base.sampleRate,
      ui.timeRange.value,
      ui.signalLevel.value,
      phaseShiftDegrees
    ].join("|");
    if(phasedSignalCache.key === key && phasedSignalCache.data){
      return phasedSignalCache.data;
    }

    const dataF = new Float64Array(srAll);
    const displaySampleRate = getDisplaySampleRate();
    for(let i=0; i<srAll; i++){
      const displayTimeSec = ((i + 0.5) - MARGIN) / displaySampleRate;
      const sourceIdx = (displayTimeSec + phaseShiftSec) * base.sampleRate + base.margin - 0.5;
      dataF[i] = sampleFloatAt(base.data, sourceIdx) * level;
    }

    phasedSignalCache = { key, data: dataF };
    originalSignalCache = { key: "", data: null };
    clearSamplingCaches();
    return dataF;
  }

  function getAdditionalNoise(){
    const level = dbToLinear(parseFloat(ui.noiseLevel.value));
    if(level <= 0) {
      additionalNoiseCache = { key: "off", data: null };
      return null;
    }

    const key = [ui.noiseLevel.value, ui.timeRange.value].join("|");
    if(additionalNoiseCache.key === key && additionalNoiseCache.data){
      return additionalNoiseCache.data;
    }

    const noiseF = new Float64Array(srAll);
    for(let i=0; i<srAll; i++){
      noiseF[i] = (Math.random() * 2 - 1) * level;
    }
    additionalNoiseCache = { key, data: noiseF };
    return noiseF;
  }

  function getOriginalSignal(){
    const phasedF = getPhasedSignal();
    const noiseF = getAdditionalNoise();
    const key = [phasedSignalCache.key, additionalNoiseCache.key].join("|");
    if(originalSignalCache.key === key && originalSignalCache.data){
      return originalSignalCache.data;
    }

    if(!noiseF){
      originalSignalCache = { key, data: phasedF };
      return phasedF;
    }

    const dataF = new Float64Array(srAll);
    for(let i=0; i<srAll; i++){
      dataF[i] = phasedF[i] + noiseF[i];
    }
    originalSignalCache = { key, data: dataF };
    return dataF;
  }

  function getAAFilteredSignal(origFloat){
    const aaK = parseInt(ui.aaFilterK.value, 10);
    if(aaK <= 0) return origFloat;

    const key = [originalSignalCache.key, ui.sampleFreq.value, aaK].join("|");
    if(aaSignalCache.key === key && aaSignalCache.data){
      return aaSignalCache.data;
    }

    const sampleRate = getDisplaySampleRate();
    const cutoffFreq = Math.min(getSampleFreq() / 2, sampleRate / 2);
    const filteredFloat = applySincLowPass(origFloat, cutoffFreq, sampleRate, aaK);
    aaSignalCache = { key, data: filteredFloat };
    return filteredFloat;
  }

  function getSamplePacket(){
    const origFloat = getOriginalSignal();
    const key = [
      originalSignalCache.key,
      ui.sampleFreq.value,
      ui.bitDepth.value,
      ui.aaFilterK.value,
      ui.timeRange.value
    ].join("|");
    if(sampleCache.key === key && sampleCache.packet){
      return sampleCache.packet;
    }

    const Fs = getSampleFreq();
    const bitDepth = parseInt(ui.bitDepth.value, 10);
    const maxAmp = (1 << (bitDepth - 1)) - 1;
    const tMax = getDisplayTimeSec();
    const filteredFloat = getAAFilteredSignal(origFloat);
    const visibleN = Math.floor(Fs * tMax);
    if(visibleN < 1){
      const emptyPacket = { key, values: new Int32Array(0), fs: Fs, maxAmp, bitDepth };
      sampleCache = { key, packet: emptyPacket };
      return emptyPacket;
    }

    const totalN = visibleN + 2 * MARGIN;
    const values = new Int32Array(totalN);
    for(let i=0; i<totalN; i++){
      const n = i - MARGIN;
      const t = n / Fs;
      const xIdx = (t / tMax) * srView + MARGIN;
      const valF = sampleFloatAt(filteredFloat, xIdx);
      values[i] = Math.round(clamp(valF * maxAmp, -maxAmp, maxAmp));
    }

    const packet = { key, values, fs: Fs, maxAmp, bitDepth };
    sampleCache = { key, packet };
    return packet;
  }

  function makeUpsampledFloat(packet){
    const values = packet.values;
    const N = values.length;
    if(N < 2) return new Float64Array(0);

    const Fs = packet.fs;
    const maxAmp = packet.maxAmp;
    const sampleRate = getDisplaySampleRate();
    const K = parseInt(ui.filterK.value, 10);
    const outF = new Float64Array(srView);

    if(K === 0){
      for(let i=0; i<srView; i++){
        const tOut = (i + 0.5) / sampleRate;
        const nCenter = Math.round(tOut * Fs + MARGIN);
        const idx = clamp(nCenter, 0, N - 1);
        outF[i] = values[idx] / maxAmp;
      }
      return outF;
    }

    const fc = Math.min(Fs / 2, sampleRate / 2);
    for(let i=0; i<srView; i++){
      const tOut = (i + 0.5) / sampleRate;
      const nCenter = tOut * Fs + MARGIN;
      let sum = 0;
      let wsum = 0;

      for(let k=-K; k<=K; k++){
        const n = clamp(Math.floor(nCenter) + k, 0, N - 1);
        const tIn = (n - MARGIN) / Fs;
        const tDiff = tOut - tIn;
        const arg = 2 * fc * tDiff;
        let w = sinc(arg) * (fc * 2);
        w *= blackmanWindow(k + K, 2 * K);
        sum += values[n] * w;
        wsum += w;
      }

      outF[i] = Math.abs(wsum) > 1.0e-12 ? (sum / wsum) / maxAmp : 0;
    }
    return outF;
  }

  function getDacFloat(packet){
    const key = [packet.key, ui.filterK.value].join("|");
    if(dacCache.key === key && dacCache.data){
      return dacCache.data;
    }

    const dacF = makeUpsampledFloat(packet);
    dacCache = { key, data: dacF };
    return dacF;
  }

  function startClipping(){
    const x0 = marginLeft;
    const x1 = width - marginRight;
    const y0 = marginTop;
    const y1 = height - marginBottom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
  }

  function endClipping(){
    ctx.restore();
  }

  function drawWaveFloat(dataF, color, offset, lineWidth){
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for(let i=0; i<srView; i++){
      const px = marginLeft + i;
      const py = ampToY(dataF[i + offset]);
      if(i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawSampleGrid(){
    startClipping();

    const Fs = getSampleFreq();
    const tMax = getDisplayTimeSec();
    if(Fs <= 0){
      endClipping();
      return;
    }

    const y0 = marginTop;
    const y1 = height - marginBottom;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;

    let n = 0;
    while(true){
      const tSamp = n / Fs;
      if(tSamp > tMax) break;
      const xx = timeToX(tSamp);
      ctx.beginPath();
      ctx.moveTo(xx, y0);
      ctx.lineTo(xx, y1);
      ctx.stroke();
      n++;
    }

    endClipping();
  }

  function drawBitBoundaries(){
    startClipping();

    const maxAmp = (1 << (parseInt(ui.bitDepth.value, 10) - 1)) - 1;
    if(maxAmp < 1){
      endClipping();
      return;
    }

    const stepVal = 1 / maxAmp;
    const pxPerStep = Math.abs(ampToY(0) - ampToY(stepVal));
    if(pxPerStep < 2){
      endClipping();
      return;
    }

    const x0 = marginLeft;
    const x1 = width - marginRight;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;

    outerLoop: for(let i=0; i<=maxAmp; i++){
      for(let j=-1; j<=1; j+=2){
        const fv = i * j / maxAmp;
        const y = ampToY(fv);
        if(y < marginTop){
          break outerLoop;
        }
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
    }

    endClipping();
  }

  function drawSteppedWave(packet, color){
    const values = packet.values;
    if(values.length < 2) return;

    const tMax = getDisplayTimeSec();
    const endIdx = Math.min(values.length - 1, MARGIN + Math.floor(packet.fs * tMax));
    if(endIdx <= MARGIN) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let t = 0;
    let y = ampToY(values[MARGIN] / packet.maxAmp);
    ctx.moveTo(timeToX(t), y);

    for(let i=MARGIN; i<endIdx; i++){
      const tNext = (i + 1 - MARGIN) / packet.fs;
      const yCur = ampToY(values[i] / packet.maxAmp);
      const yNext = ampToY(values[i + 1] / packet.maxAmp);
      const xNext = timeToX(tNext);
      ctx.lineTo(xNext, yCur);
      ctx.lineTo(xNext, yNext);
    }
    ctx.stroke();
  }

  function drawSampling(packet, color){
    const values = packet.values;
    if(values.length < 2) return;

    const tMax = getDisplayTimeSec();
    const endIdx = Math.min(values.length - 1, MARGIN + Math.floor(packet.fs * tMax));
    if(endIdx < MARGIN) return;

    ctx.fillStyle = color;
    for(let i=MARGIN; i<=endIdx; i++){
      const t = (i - MARGIN) / packet.fs;
      const x = timeToX(t);
      const y = ampToY(values[i] / packet.maxAmp);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2, false);
      ctx.fill();
    }
  }

  function drawAxis(){
    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, width, height);

    const x0 = marginLeft;
    const x1 = width - marginRight;
    const y0 = marginTop;
    const y1 = height - marginBottom;

    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.stroke();

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#ddd";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const topDb = parseFloat(ui.ampRange.value);
    let startDb = Math.floor(topDb / 6) * 6;
    if(startDb > topDb) startDb -= 6;

    for(let i=0; i<3; i++){
      const dbTick = startDb - 6 * i;
      if(dbTick < -144) break;
      const linVal = dbToLinear(dbTick);
      const ratio = linVal / dbToLinear(topDb);
      const centerY = (y0 + y1) * 0.5;
      const y = centerY - ratio * (centerY - y0);
      if(y < y0 - 2 || y > y1 + 2) continue;

      ctx.beginPath();
      ctx.moveTo(x0 - 4, y);
      ctx.lineTo(x0, y);
      ctx.stroke();
      ctx.fillText(`${dbTick} dB`, x0 - 6, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tMaxMs = parseFloat(ui.timeRange.value);
    const divNum = 5;
    for(let i=0; i<=divNum; i++){
      const msVal = tMaxMs / divNum * i;
      const xx = x0 + (x1 - x0) * (i / divNum);
      ctx.beginPath();
      ctx.moveTo(xx, y1);
      ctx.lineTo(xx, y1 + 5);
      ctx.stroke();
      ctx.fillText(`${msVal.toFixed(1)} ms`, xx, y1 + 7);
    }
  }

  function drawLegend(){
    ctx.font = "14px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    let legendY = marginTop + 10;
    const legendX = width - marginRight - 90;
    if(ui.showOriginal.checked){
      ctx.fillStyle = "#00aaff";
      ctx.fillText(canvas.dataset.legendOriginal || "Original", legendX, legendY);
      legendY += 18;
    }
    if(ui.showSampling.checked){
      ctx.fillStyle = "#ffdd00";
      ctx.fillText(canvas.dataset.legendSampling || "Sampling", legendX, legendY);
      legendY += 18;
    }
    if(ui.showDAC.checked){
      ctx.fillStyle = "#ff3333";
      ctx.fillText(canvas.dataset.legendDac || "DAC", legendX, legendY);
    }
  }

  function draw(){
    drawAxis();

    const origF = getOriginalSignal();
    const packet = getSamplePacket();
    const dacF = ui.showDAC.checked ? getDacFloat(packet) : null;

    startClipping();
    if(ui.showSampling.checked){
      drawSampleGrid();
      drawBitBoundaries();
    }
    if(ui.showOriginal.checked){
      drawWaveFloat(origF, "#00aaff", MARGIN, 1);
    }
    if(ui.showSampling.checked && packet.values.length > 0){
      if(ui.showSamplingLine.checked){
        drawSteppedWave(packet, "#ffdd00");
      } else {
        drawSampling(packet, "#ffdd00");
      }
    }
    if(ui.showDAC.checked && dacF && dacF.length === srView){
      drawWaveFloat(dacF, "#ff3333", 0, 2);
    }
    endClipping();

    drawLegend();
  }

  window.addEventListener("load", () => {
    updateVals();
    draw();
  });
})();
