const maskingExperienceConfig = window.maskingExperienceConfig || {};
const maskingExperienceText = {
  timeAgoLabel: "1 second ago",
  ...(maskingExperienceConfig.text || {})
};

    /***********************************************************************
     * Global Variables
     ***********************************************************************/
    let audioCtx  = null;
    let analyser  = null;
    let masterGain= null; // -6dB (0.5x) master node
    let isPlaying = false;
    let startTime = 0;    // Playback start time

    // Oscillator for continuous operation (tone)
    let maskerOsc     = null; // Red (masker - for tone/burst)
    let maskerGain    = null;
    let maskeeOsc     = null; // Blue (maskee - for tone/burst)
    let maskeeGain    = null;

    // For noise: three bandpass filters in series
    let maskerNoiseSource  = null;
    let maskerNoiseFilter1 = null;
    let maskerNoiseFilter2 = null;
    let maskerNoiseFilter3 = null;
    let maskerNoiseGain    = null;

    // Indices for generating tone bursts at 0.5-second intervals
    let nextMaskerBurstIndex = 0;
    let nextMaskeeBurstIndex = 0;

    // Analyzer
    let dataFreq = null;
    let dataTime = null;

    // Graph Canvas
    const freqGraph = document.getElementById("freqGraph");
    const timeGraph = document.getElementById("timeGraph");
    const freqCanvas = document.createElement('canvas');
    const timeCanvas = document.createElement('canvas');
    freqGraph.appendChild(freqCanvas);
    timeGraph.appendChild(timeCanvas);

    // Buffer for time-series RMS
    let timeDataPoints = [];

    // Arrays to record burst times (stores "time tBurst" and "maximum dB to draw")
    let burstMaskerTimes = [];
    let burstMaskeeTimes = [];

    /***********************************************************************
     * Retrieve parameters from UI
     ***********************************************************************/
    function getParams(){
      const maskerFreqSlider    = document.getElementById("maskerFreq");
      const maskeeFreqSlider    = document.getElementById("maskeeFreq");
      const maskeeGainSlider    = document.getElementById("maskeeGain");
      const maskeeDelaySlider   = document.getElementById("maskeeDelay");
      const burstRampSlider     = document.getElementById("burstRamp");
      const maskeeEnableCB      = document.getElementById("maskeeEnable");
      const toneTypeVal         = document.querySelector('input[name="toneType"]:checked').value;
      const maskerNoiseBWSlider = document.getElementById("maskerNoiseBW");

      // Slider(1..500) -> frequency(20..20000) in log scale
      const freqMin = 20, freqMax = 20000;
      function sliderToFreq(val) {
        const logMin = Math.log10(freqMin);
        const logMax = Math.log10(freqMax);
        const ratio  = (val - 1)/(500 - 1);
        const logF   = logMin + ratio*(logMax - logMin);
        return Math.pow(10, logF);
      }
      const maskerFreq = sliderToFreq(Number(maskerFreqSlider.value));
      const maskeeFreq = sliderToFreq(Number(maskeeFreqSlider.value));

      // Convert dB to linear gain
      const maskeeDB   = Number(maskeeGainSlider.value);
      const maskeeGainLinear = Math.pow(10, maskeeDB/20);

      // Masker noise bandwidth (numeric value, 50..2000)
      const maskerNoiseBW = Number(maskerNoiseBWSlider.value);

      return {
        maskerFreq,
        maskeeFreq,
        maskeeDB,
        maskeeGainLin: maskeeGainLinear,
        maskeeDelay: Number(maskeeDelaySlider.value), // ms
        burstRamp:   Number(burstRampSlider.value),   // ms
        toneType:    toneTypeVal,                     // "burst", "tone", or "noiseTone"
        maskeeEnabled: maskeeEnableCB.checked,
        maskerNoiseBW
      };
    }

    function updateLabels(){
      const p = getParams();
      document.getElementById("maskerFreqLabel").textContent    = p.maskerFreq.toFixed(1) + " Hz";
      document.getElementById("maskeeFreqLabel").textContent    = p.maskeeFreq.toFixed(1) + " Hz";
      document.getElementById("maskeeGainLabel").textContent    = p.maskeeDB + " dB";
      document.getElementById("maskeeDelayLabel").textContent   = p.maskeeDelay + " ms";
      document.getElementById("burstRampLabel").textContent     = p.burstRamp + " ms";
      document.getElementById("maskerNoiseBWLabel").textContent = p.maskerNoiseBW + " Hz";
    }

    /***********************************************************************
     * Audio start / stop / initialization
     ***********************************************************************/
    function startAudio(){
      if(isPlaying) return;
      isPlaying = true;

      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      dataFreq = new Float32Array(analyser.frequencyBinCount);
      dataTime = new Uint8Array(analyser.fftSize);

      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.5; // -6dB
      analyser.connect(masterGain).connect(audioCtx.destination);

      startTime = audioCtx.currentTime;
      nextMaskerBurstIndex = 0;
      nextMaskeeBurstIndex = 0;

      burstMaskerTimes = [];
      burstMaskeeTimes = [];
      timeDataPoints = [];

      // Masker oscillator (red) - used only for burst/tone mode
      maskerOsc = audioCtx.createOscillator();
      maskerOsc.type = "sine";
      maskerGain = audioCtx.createGain();
      maskerGain.gain.value = 0; // Initially silent
      maskerOsc.connect(maskerGain).connect(analyser);
      maskerOsc.start();

      // Maskee oscillator (blue)
      maskeeOsc = audioCtx.createOscillator();
      maskeeOsc.type = "sine";
      maskeeGain = audioCtx.createGain();
      maskeeGain.gain.value = 0;
      maskeeOsc.connect(maskeeGain).connect(analyser);
      maskeeOsc.start();

      // Noise: three bandpass filters in series
      maskerNoiseGain   = audioCtx.createGain();
      maskerNoiseGain.gain.value = 0; // Initially 0

      maskerNoiseFilter1 = audioCtx.createBiquadFilter();
      maskerNoiseFilter1.type = "bandpass";

      maskerNoiseFilter2 = audioCtx.createBiquadFilter();
      maskerNoiseFilter2.type = "bandpass";

      maskerNoiseFilter3 = audioCtx.createBiquadFilter();
      maskerNoiseFilter3.type = "bandpass";

      maskerNoiseSource = audioCtx.createBufferSource();
      maskerNoiseSource.connect(maskerNoiseFilter1)
        .connect(maskerNoiseFilter2)
        .connect(maskerNoiseFilter3)
        .connect(maskerNoiseGain)
        .connect(analyser);

      // Prepare 2 seconds of white noise and loop
      const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for(let i=0; i<noiseBuf.length; i++){
        noiseData[i] = Math.random()*2 - 1; // -1..+1
      }
      maskerNoiseSource.buffer = noiseBuf;
      maskerNoiseSource.loop = true;
      maskerNoiseSource.start();

      // Apply parameters from UI
      applyParamChanges();

      // Schedule bursts at 0.5s intervals, up to 1 second ahead
      schedulingLoop();

      // Start drawing
      requestAnimationFrame(drawLoop);
    }

    function stopAudio(){
      if(!isPlaying) return;
      isPlaying = false;

      // Masker oscillator
      if(maskerOsc){
        try{ maskerOsc.stop(); } catch(e){}
        maskerOsc.disconnect();
        maskerOsc=null;
      }
      if(maskerGain){ maskerGain.disconnect(); maskerGain=null; }

      // Maskee oscillator
      if(maskeeOsc){
        try{ maskeeOsc.stop(); } catch(e){}
        maskeeOsc.disconnect();
        maskeeOsc=null;
      }
      if(maskeeGain){ maskeeGain.disconnect(); maskeeGain=null; }

      // Noise-related nodes
      if(maskerNoiseSource){
        try{ maskerNoiseSource.stop(); } catch(e){}
        maskerNoiseSource.disconnect();
        maskerNoiseSource=null;
      }
      if(maskerNoiseFilter1){
        maskerNoiseFilter1.disconnect();
        maskerNoiseFilter1=null;
      }
      if(maskerNoiseFilter2){
        maskerNoiseFilter2.disconnect();
        maskerNoiseFilter2=null;
      }
      if(maskerNoiseFilter3){
        maskerNoiseFilter3.disconnect();
        maskerNoiseFilter3=null;
      }
      if(maskerNoiseGain){
        maskerNoiseGain.disconnect();
        maskerNoiseGain=null;
      }

      if(audioCtx){
        audioCtx.close();
        audioCtx=null;
      }
      timeDataPoints = [];
    }

    /***********************************************************************
     * Scheduling bursts every 0.5 seconds
     ***********************************************************************/
    function schedulingLoop(){
      if(!isPlaying) return;
      const p = getParams();
      const now = audioCtx.currentTime;
      const lookahead = 1.0; // schedule 1 second ahead

      // Masker (if toneType="burst")
      if(p.toneType === "burst"){
        while( startTime + nextMaskerBurstIndex*0.5 < (now + lookahead) ){
          const tBurst = startTime + nextMaskerBurstIndex*0.5;
          if(tBurst < now){
            nextMaskerBurstIndex++;
            continue;
          }
          scheduleMaskerBurst(tBurst, p);
          nextMaskerBurstIndex++;
        }
      }

      // Maskee (only if ENABLED and toneType="burst")
      if(p.maskeeEnabled && p.toneType === "burst"){
        while( startTime + nextMaskeeBurstIndex*0.5 < (now + lookahead) ){
          const tBurst = startTime + nextMaskeeBurstIndex*0.5;
          if(tBurst < now){
            nextMaskeeBurstIndex++;
            continue;
          }
          scheduleMaskeeBurst(tBurst, p);
          nextMaskeeBurstIndex++;
        }
      }

      requestAnimationFrame(schedulingLoop);
    }

    /***********************************************************************
     * Apply parameter changes
     ***********************************************************************/
    function applyParamChanges(){
      if(!isPlaying) return;
      const now = audioCtx.currentTime;
      const p = getParams();

      // Set oscillator frequencies
      maskerOsc.frequency.setValueAtTime(p.maskerFreq, now);
      maskeeOsc.frequency.setValueAtTime(p.maskeeFreq, now);

      // Update bandpass filters
      if(maskerNoiseFilter1 && maskerNoiseFilter2 && maskerNoiseFilter3){
        let bw = Math.max(1, 2 * p.maskerNoiseBW);
        let Q = p.maskerFreq / bw;
        if(Q < 0.0001) Q = 0.0001;
        if(Q > 1000)   Q = 1000;
        [maskerNoiseFilter1, maskerNoiseFilter2, maskerNoiseFilter3].forEach(flt => {
          flt.frequency.setValueAtTime(p.maskerFreq, now);
          flt.Q.setValueAtTime(Q, now);
        });
      }

      // Masker settings based on tone type
      if(p.toneType === "tone"){
        // Continuous tone => oscillator: 1.0, noise: 0
        maskerGain.gain.setValueAtTime(1.0, now);
        if(maskerNoiseGain) {
          maskerNoiseGain.gain.setValueAtTime(0, now);
        }
      }
      else if(p.toneType === "noiseTone"){
        // Noise + tone => oscillator: 0, noise: 1.0
        maskerGain.gain.setValueAtTime(0, now);
        if(maskerNoiseGain) {
          maskerNoiseGain.gain.setValueAtTime(1.0, now);
        }
      }

      // Maskee settings
      if(!p.maskeeEnabled){
        maskeeGain.gain.setValueAtTime(0, now);
      } else {
        if(p.toneType === "tone"){
          // Continuous tone => turn on maskee after the specified delay
          maskeeGain.gain.setValueAtTime(0, now);
          const tStart = now + p.maskeeDelay/1000;
          maskeeGain.gain.setValueAtTime(p.maskeeGainLin, tStart);
        }
        else if(p.toneType === "noiseTone"){
          // Noise + tone => maskee is continuous tone
          maskeeGain.gain.setValueAtTime(0, now);
          const tStart = now + p.maskeeDelay/1000;
          maskeeGain.gain.setValueAtTime(p.maskeeGainLin, tStart);
        }
      }
    }

    /***********************************************************************
     * Schedule bursts (masker / maskee)
     ***********************************************************************/
    function scheduleMaskerBurst(tBurst, p){
      const rampSec = p.burstRamp / 1000;
      const totalDur= 2 * rampSec;

      maskerGain.gain.cancelScheduledValues(tBurst);

      let sampleCount = Math.floor(audioCtx.sampleRate * totalDur);
      sampleCount = Math.min(4096, Math.max(2, sampleCount));

      const curve = new Float32Array(sampleCount);
      // Raised cosine envelope
      for(let i=0; i<sampleCount; i++){
        const x = i / (sampleCount - 1);
        let env = 0.5 * (1 - Math.cos(2*Math.PI*x));
        curve[i] = env;
      }
      curve[0] = 0;
      curve[sampleCount-1] = 0;

      maskerGain.gain.setValueAtTime(0, tBurst);
      maskerGain.gain.setValueCurveAtTime(curve, tBurst, totalDur);
      maskerGain.gain.setValueAtTime(0, tBurst + totalDur);

      burstMaskerTimes.push({
        time: tBurst,
        dB: 0
      });
    }

    function scheduleMaskeeBurst(tBurst, p){
      const rampSec = p.burstRamp / 1000;
      const totalDur= 2 * rampSec;
      const tStart  = tBurst + p.maskeeDelay/1000 > 0 ? tBurst + p.maskeeDelay/1000 : 0;

      maskeeGain.gain.cancelScheduledValues(tStart);

      let sampleCount = Math.floor(audioCtx.sampleRate * totalDur);
      sampleCount = Math.min(4096, Math.max(2, sampleCount));

      const curve = new Float32Array(sampleCount);
      for(let i=0; i<sampleCount; i++){
        const x = i / (sampleCount - 1);
        let env = 0.5 * (1 - Math.cos(2*Math.PI*x));
        curve[i] = env * p.maskeeGainLin;
      }
      curve[0] = 0;
      curve[sampleCount-1] = 0;

      maskeeGain.gain.setValueAtTime(0, tStart);
      maskeeGain.gain.setValueCurveAtTime(curve, tStart, totalDur);
      maskeeGain.gain.setValueAtTime(0, tStart + totalDur);

      burstMaskeeTimes.push({
        time: tStart,
        dB: p.maskeeDB
      });
    }

    /***********************************************************************
     * Graph drawing loop
     ***********************************************************************/
    function drawLoop(){
      if(!isPlaying) return;

      analyser.getFloatFrequencyData(dataFreq);
      analyser.getByteTimeDomainData(dataTime);

      const nowSec = audioCtx.currentTime - startTime;

      // RMS calculation
      let sum=0;
      for(let i=0;i<dataTime.length;i++){
        const val = (dataTime[i]-128)/128; // -1..1
        sum+= val*val;
      }
      sum/= dataTime.length;
      let rms = Math.sqrt(sum);
      if(rms<1e-9) rms=1e-9;
      let dBVal = 20*Math.log10(rms);

      // Add data to a ~1-second buffer
      timeDataPoints.push({ t: nowSec, dB: dBVal });
      while(timeDataPoints.length>0 && (nowSec - timeDataPoints[0].t)>1.0){
        timeDataPoints.shift();
      }

      // Remove burst records older than 1 second
      while(burstMaskerTimes.length>0 && (nowSec - (burstMaskerTimes[0].time - startTime))>1){
        burstMaskerTimes.shift();
      }
      while(burstMaskeeTimes.length>0 && (nowSec - (burstMaskeeTimes[0].time - startTime))>1){
        burstMaskeeTimes.shift();
      }

      drawFrequencySpectrum();
      drawTimeWave(nowSec);

      requestAnimationFrame(drawLoop);
    }

    function resizeCanvas(){
      freqCanvas.width = freqGraph.clientWidth;
      freqCanvas.height= freqGraph.clientHeight;
      timeCanvas.width = timeGraph.clientWidth;
      timeCanvas.height= timeGraph.clientHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    /***********************************************************************
     * Draw frequency spectrum
     ***********************************************************************/
    function drawFrequencySpectrum(){
      const ctx = freqCanvas.getContext('2d');
      const w = freqCanvas.width;
      const h = freqCanvas.height;

      ctx.fillStyle = "#2c2c2c";
      ctx.fillRect(0,0,w,h);

      const p = getParams();
      const dBMin = -60, dBMax = 0;
      const freqMin=20, freqMax=20000;

      function freqToX(ff){
        const logMin = Math.log10(freqMin);
        const logMax = Math.log10(freqMax);
        const fl = Math.log10(ff);
        let ratio = (fl - logMin)/(logMax - logMin);
        if(ratio<0) ratio=0; 
        if(ratio>1) ratio=1;
        return ratio*w;
      }

      function dBToY(dd){
        const ratio = (dBMax - dd) / (dBMax - dBMin);
        return ratio*h;
      }

      // Grid lines
      ctx.strokeStyle="#555";
      ctx.lineWidth=1;
      ctx.beginPath();
      const freqTicks = [20,50,100,200,500,1000,2000,5000,10000,20000];
      freqTicks.forEach(fv=>{
        let x=freqToX(fv);
        ctx.moveTo(x,0);
        ctx.lineTo(x,h);
      });
      for(let d=dBMin; d<=0; d+=6){
        let y=dBToY(d);
        ctx.moveTo(0,y);
        ctx.lineTo(w,y);
      }
      ctx.stroke();

      // Show noise bandwidth area (only for noiseTone)
      if(p.toneType === "noiseTone"){
        const fL = Math.max(20, p.maskerFreq - p.maskerNoiseBW);
        const fR = Math.min(20000, p.maskerFreq + p.maskerNoiseBW);
        if(fL < fR){
          const xL = freqToX(fL);
          const xR = freqToX(fR);
          ctx.fillStyle = "rgba(255,0,0,0.2)";
          ctx.fillRect(xL, 0, xR - xL, h);
        }
      }

      // Red line for masker
      ctx.strokeStyle="red";
      ctx.lineWidth=2;
      let xM = freqToX(p.maskerFreq);
      ctx.beginPath();
      ctx.moveTo(xM, dBToY(dBMin));
      ctx.lineTo(xM, dBToY(0));
      ctx.stroke();

      // Blue line for maskee
      if(p.maskeeEnabled){
        ctx.strokeStyle="blue";
        ctx.lineWidth=2;
        let xMs = freqToX(p.maskeeFreq);
        ctx.beginPath();
        ctx.moveTo(xMs, dBToY(dBMin));
        ctx.lineTo(xMs, dBToY(p.maskeeDB));
        ctx.stroke();
      }

      // Spectrum (yellow)
      ctx.strokeStyle="yellow";
      ctx.lineWidth=1;
      ctx.beginPath();
      const N=dataFreq.length;
      for(let i=0; i<N; i++){
        let dBv = dataFreq[i] + 12.0; // +12 dB offset for visibility
        let ff = i*(audioCtx.sampleRate/2)/N;
        if(ff<freqMin || ff>freqMax) continue;
        let xx = freqToX(ff);
        let yy = dBToY(dBv);
        if(i===0){
          ctx.moveTo(xx,yy);
        } else {
          ctx.lineTo(xx,yy);
        }
      }
      ctx.stroke();

      // Frequency & dB labels
      ctx.save();
      ctx.fillStyle = "white";
      ctx.font = "14px sans-serif";

      // X-axis labels
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const x100  = freqToX(100);
      const x1k   = freqToX(1000);
      const x10k  = freqToX(10000);
      ctx.fillText("100Hz",  x100,  h-5);
      ctx.fillText("1kHz",   x1k,   h-5);
      ctx.fillText("10kHz",  x10k,  h-5);

      // Y-axis labels
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const yMinus12 = dBToY(-12);
      const yMinus24 = dBToY(-24);
      const yMinus36 = dBToY(-36);
      const yMinus48 = dBToY(-48);
      ctx.fillText("-12dB",  5, yMinus12);
      ctx.fillText("-24dB",  5, yMinus24);
      ctx.fillText("-36dB",  5, yMinus36);
      ctx.fillText("-48dB",  5, yMinus48);

      ctx.restore();
    }

    /***********************************************************************
     * Draw time-domain waveform (1s window, right edge is the latest)
     ***********************************************************************/
    function drawTimeWave(nowSec){
      const ctx = timeCanvas.getContext('2d');
      const w = timeCanvas.width;
      const h = timeCanvas.height;

      ctx.fillStyle="#2c2c2c";
      ctx.fillRect(0,0,w,h);

      const dBMin=-60, dBMax=0;

      function dBToY(dd){
        let ratio = (dBMax - dd) / (dBMax - dBMin);
        return ratio*h;
      }

      // Vertical lines every 0.1s in the 1-second window
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1;
      ctx.beginPath();

      const tStart = Math.ceil( (nowSec - 1) * 10 ) / 10;
      const tEnd   = Math.floor( nowSec * 10 ) / 10;
      for(let tLine = tStart; tLine <= tEnd; tLine += 0.1){
        const dt = nowSec - tLine;
        if(dt < 0 || dt > 1) continue;
        const x = w - dt * w;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();

      // Grid lines (6 dB steps)
      ctx.strokeStyle="#555";
      ctx.lineWidth=1;
      ctx.beginPath();
      for(let d=dBMin; d<=0; d+=6){
        let yy=dBToY(d);
        ctx.moveTo(0,yy);
        ctx.lineTo(w,yy);
      }
      // Left & right borders
      ctx.moveTo(0,0);
      ctx.lineTo(0,h);
      ctx.moveTo(w,0);
      ctx.lineTo(w,h);
      ctx.stroke();

      // RMS waveform (yellow)
      ctx.strokeStyle="yellow";
      ctx.lineWidth=1;
      ctx.beginPath();
      for(let i=0; i<timeDataPoints.length; i++){
        const dp = timeDataPoints[i];
        const dt = nowSec - dp.t;
        const x = w - dt*w;
        const y = dBToY(dp.dB);
        if(i===0) ctx.moveTo(x,y);
        else      ctx.lineTo(x,y);
      }
      ctx.stroke();

      // Mark bursts (red: masker, blue: maskee)
      burstMaskerTimes.forEach(b=>{
        ctx.strokeStyle = "red";
        const dt = nowSec - (b.time - startTime);
        if(dt<0 || dt>1) return;
        const x = w - dt*w;
        const y1= dBToY(dBMin);
        const y2= dBToY(b.dB);
        ctx.beginPath();
        ctx.moveTo(x,y1);
        ctx.lineTo(x,y2);
        ctx.stroke();
      });
      burstMaskeeTimes.forEach(b=>{
        ctx.strokeStyle = "blue";
        const dt = nowSec - (b.time - startTime);
        if(dt<0 || dt>1) return;
        const x = w - dt*w;
        const y1= dBToY(dBMin);
        const y2= dBToY(b.dB);
        ctx.beginPath();
        ctx.moveTo(x,y1);
        ctx.lineTo(x,y2);
        ctx.stroke();
      });

      // "1 second ago" label and dB markers
      ctx.save();
      ctx.fillStyle = "white";
      ctx.font = "14px sans-serif";

      // Bottom-left label
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(maskingExperienceText.timeAgoLabel, 5, h - 5);

      // Y-axis labels
      ctx.textBaseline = "middle";
      const yMinus12 = dBToY(-12);
      const yMinus24 = dBToY(-24);
      const yMinus36 = dBToY(-36);
      const yMinus48 = dBToY(-48);
      ctx.fillText("-12dB",  5, yMinus12);
      ctx.fillText("-24dB",  5, yMinus24);
      ctx.fillText("-36dB",  5, yMinus36);
      ctx.fillText("-48dB",  5, yMinus48);

      ctx.restore();
    }

    /***********************************************************************
     * UI event listeners
     ***********************************************************************/
    const controls = document.querySelectorAll(
      'input[type="range"], input[name="toneType"], #maskeeEnable'
    );
    controls.forEach(ctrl=>{
      ctrl.addEventListener('input', ()=>{
        updateLabels();
        applyParamChanges();
      });
    });

    document.getElementById("playBtn").addEventListener('click', ()=>{
      stopAudio();
      startAudio();
    });
    document.getElementById("stopBtn").addEventListener('click', ()=>{
      stopAudio();
    });

    window.addEventListener('keydown', (e)=>{
      if(e.code==="Space"){
        e.preventDefault();
        if(isPlaying) stopAudio(); else startAudio();
      }
    });

    function updateUIforToneType(){
      const val = document.querySelector('input[name="toneType"]:checked').value;
      const burstRampRow = document.getElementById("burstRampRow");
      const delaySlider  = document.getElementById("maskeeDelay");
      const maskerNoiseBWRow = document.getElementById("maskerNoiseBWRow");

      // If burst, enable ramp slider and delay
      if(val==="burst"){
        burstRampRow.style.opacity="1.0";
        burstRampRow.style.pointerEvents="auto";
        delaySlider.style.opacity="1.0";
        delaySlider.style.pointerEvents="auto";
      } else {
        burstRampRow.style.opacity="0.5";
        burstRampRow.style.pointerEvents="none";
        delaySlider.style.opacity="0.5";
        delaySlider.style.pointerEvents="none";
      }

      // If noiseTone, enable noise bandwidth slider
      if(val==="noiseTone"){
        maskerNoiseBWRow.style.opacity="1.0";
        maskerNoiseBWRow.style.pointerEvents="auto";
      } else {
        maskerNoiseBWRow.style.opacity="0.5";
        maskerNoiseBWRow.style.pointerEvents="none";
      }
    }

    let lastMaskeeEnabled = null;
    document.getElementById("maskeeEnable").addEventListener('change', (event)=>{
      const newMaskeeEnabled = event.target.checked;
      if(isPlaying && lastMaskeeEnabled !== newMaskeeEnabled){
        stopAudio(100);
        startAudio();
      }
      updateUIforToneType();
      lastMaskeeEnabled = newMaskeeEnabled;
    });

    let lastToneType = null;
    document.querySelectorAll('input[name="toneType"]').forEach(r=>{
      r.addEventListener('change', ()=>{
        const newToneType = getParams().toneType;
        if(isPlaying && lastToneType && lastToneType !== newToneType){
          stopAudio();
          startAudio();
        }
        updateUIforToneType();
        lastToneType = newToneType;
      });
    });

    // Initialize
    updateLabels();
    updateUIforToneType();
    lastToneType = getParams().toneType;
