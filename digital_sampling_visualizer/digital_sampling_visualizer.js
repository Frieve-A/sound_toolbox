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
    clearBandlimitedCaches();
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
    [...ui.signalTypeRadios, ui.signalFreq, ui.signalLevel, ui.bandLimitEnabled, ui.bandLimitFreq],
    clearBandlimitedCaches
  );
  addInputListeners([ui.signalPhase], clearPhasedCaches);
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

  function getPhaseMarginSamples(){
    const freq = Math.max(getSignalFreq(), 1);
    return Math.ceil(Math.min(getDisplaySampleRate() / (2 * freq), MAX_PHASE_MARGIN));
  }

  function makeBandlimitedSignalKey(){
    return [
      getSignalType(),
      ui.signalFreq.value,
      ui.signalLevel.value,
      isBandLimitEnabled() ? ui.bandLimitFreq.value : "off",
      ui.timeRange.value
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

  function applySincLowPass(dataF, cutoffFreq, sampleRate, K){
    if(K <= 0 || cutoffFreq >= sampleRate / 2) return new Float64Array(dataF);

    const kernel = getSincLowPassKernel(cutoffFreq, sampleRate, K);
    if(!kernel) return new Float64Array(dataF.length);

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

  function normalizeTruePeak(dataF, targetPeak, allowBoost){
    if(targetPeak <= 0) return dataF;

    const start = Math.min(BAND_LIMIT_FILTER_K, dataF.length);
    const end = Math.max(start, dataF.length - BAND_LIMIT_FILTER_K);
    let peak = 0;
    for(let i=start; i<end; i++){
      const absValue = Math.abs(dataF[i]);
      if(absValue > peak) peak = absValue;
    }
    if(peak <= 1.0e-12) return dataF;
    if(!allowBoost && peak <= targetPeak) return dataF;

    const scale = targetPeak / peak;
    for(let i=0; i<dataF.length; i++){
      dataF[i] *= scale;
    }
    return dataF;
  }

  function makeNoiseCycle(periodSamples){
    const len = Math.max(2, Math.ceil(periodSamples));
    const cycle = new Float64Array(len);
    for(let i=0; i<len; i++){
      cycle[i] = Math.random() * 2 - 1;
    }
    return cycle;
  }

  function sampleNoiseCycle(cycle, phase){
    const len = cycle.length;
    let pos = phase % len;
    if(pos < 0) pos += len;
    const idx0 = Math.floor(pos);
    const idx1 = (idx0 + 1) % len;
    const frac = pos - idx0;
    return cycle[idx0] + frac * (cycle[idx1] - cycle[idx0]);
  }

  function generateSourceFloat(marginSamples){
    const type = getSignalType();
    const freq = getSignalFreq();
    const level = dbToLinear(parseFloat(ui.signalLevel.value));
    const sampleRate = getDisplaySampleRate();
    const totalSamples = srView + 2 * marginSamples;
    const dataF = new Float64Array(totalSamples);
    const noiseCycle = type === "white_noise" ? makeNoiseCycle(sampleRate / freq) : null;

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
        sample = sampleNoiseCycle(noiseCycle, cyclePos * noiseCycle.length);
      }

      dataF[i] = level * sample;
    }
    return dataF;
  }

  function getBandlimitedSignal(){
    const key = makeBandlimitedSignalKey();
    if(bandlimitedSignalCache.key === key && bandlimitedSignalCache.data){
      return bandlimitedSignalCache;
    }

    const sampleRate = getDisplaySampleRate();
    const marginSamples = MARGIN + getPhaseMarginSamples() + BAND_LIMIT_FILTER_K + 2;
    const sourceF = generateSourceFloat(marginSamples);
    const filteredF = isBandLimitEnabled()
      ? applySincLowPass(sourceF, Math.min(getBandLimitFreq(), sampleRate / 2), sampleRate, BAND_LIMIT_FILTER_K)
      : new Float64Array(sourceF);
    normalizeTruePeak(
      filteredF,
      dbToLinear(parseFloat(ui.signalLevel.value)),
      getSignalType() === "white_noise"
    );

    bandlimitedSignalCache = {
      key,
      data: filteredF,
      margin: marginSamples,
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
    const phaseShiftSamples = getSignedPhaseDegrees() / 360 * getDisplaySampleRate() / getSignalFreq();
    const key = [base.version, base.key, base.margin, getSignedPhaseDegrees()].join("|");
    if(phasedSignalCache.key === key && phasedSignalCache.data){
      return phasedSignalCache.data;
    }

    const dataF = new Float64Array(srAll);
    const marginOffset = base.margin - MARGIN;
    for(let i=0; i<srAll; i++){
      dataF[i] = sampleFloatAt(base.data, i + marginOffset + phaseShiftSamples);
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
