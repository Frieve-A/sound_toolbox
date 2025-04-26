// dsp.js – Digital Signal Processing functions (fixed, full)

/* =====================================================================
   0.  GLOBAL DSP OBJECT
   ===================================================================== */

   const DSP = {
    /* -------------------------------------------------------------
       0‑1.  coefficient storage
    ------------------------------------------------------------- */
    deltasigmaCoeffs: null,        // pre‑computed NTF table (JSON)

    /* -------------------------------------------------------------
       0‑2.  state for ΔΣ macro‑model
    ------------------------------------------------------------- */
    ntfNumCoeffs: null,            // b[0..N]
    ntfDenCoeffs: null,            // a[0..N]
    errorHistory: [],              // e[n‑1], e[n‑2] …
    noiseHistory: [],              // y[n‑1], y[n‑2] …

    /* -------------------------------------------------------------
       0‑3.  state for post‑filtering / resampling
    ------------------------------------------------------------- */
    lpfState: [],
    lpfCoefficients: [],

    firDownsampleCoeffs: null,
    downsampleFIRBuffer: [],
    decimationFactor: 1,

    /* =================================================================
       1.  ΔΣ MACRO‑MODEL (error‑feedback form)
       ================================================================= */

    resetModulatorState(noiseOrder, initSpread = 1e-6) {
        // store dither amplitude (full-scale) for quantizer
        this.ditherAmplitude = initSpread;
        const rnd = () => (Math.random() * 2 - 1) * initSpread; // ±initSpread FS
        // Reset error-feedback histories
        if (this.ntfNumCoeffs && this.ntfDenCoeffs) {
            this.errorHistory = Array.from(
                                {length: this.ntfNumCoeffs.length-1}, rnd);;
            this.noiseHistory = Array.from(
                                {length: this.ntfDenCoeffs.length-1}, rnd);
        } else {
            this.errorHistory = [];
            this.noiseHistory = [];
        }
        // Initialize integrators for direct-form Nth-order 1-bit DSM
        if (noiseOrder > 0) {
            this.intState = Array.from({ length: noiseOrder }, rnd);
            this.lastQ = 0;
        } else {
            this.intState = [];
        }
    },

    /**
     * Delta‑Sigma quantiser with arbitrary order NTF.
     *  - inputSample …  range [‑1, +1]
     *  - adBits      …  1‑bit (DSD) to 6‑bit PCM
     *  - noiseOrder  …  0‑7 (0 disables noise shaping)
     */
    deltaSigmaModulate(inputSample, adBits, noiseOrder, osr) {
        // Require NTF coefficients loaded from JSON
        if (!this.ntfNumCoeffs || !this.ntfDenCoeffs) {
            throw new Error('NTF coefficients not loaded');
        }
        const b = this.ntfNumCoeffs;
        const a = this.ntfDenCoeffs;
        const eH = this.errorHistory;
        const yH = this.noiseHistory;

        /* ---- 1.  predict shaped noise (exclude current error) ---- */
        let yPred = 0;
        for (let i = 1; i < b.length; ++i) yPred += b[i] * (eH[i - 1] || 0);
        for (let j = 1; j < a.length; ++j) yPred -= a[j] * (yH[j - 1] || 0);

        /* ---- 2.  feedback loop: add prediction ---- */
        let u = inputSample + yPred;
        // add uniform dither noise at specified amplitude (e.g., -120dB => 1e-6)
        // u += (Math.random() * 2 - 1) * (this.ditherAmplitude || 0);

        /* ---- 3.  quantiser ---- */
        // 1-bit or multi-bit quantization using precomputed NTF
        let q;
        if (adBits === 1) {
            // simple sign quantizer for 1-bit
            q = u >= 0 ? 1 : -1;
        } else {
            // Use mid-tread quantizer: levels count = 2^bit - 1, ensuring a zero output step
            const M = (1 << adBits) - 1;
            const L = 1 << adBits;
            const span = (L - 1) / 2;
           
            let k = Math.round(u * span);
            k = Math.max(-span, Math.min(span, k));
            q = k / span;      
        }

        /* ---- 4.  update histories ---- */
        const e = q - u; // quantisation error
        const y = yPred + b[0] * e; // true shaped noise
        eH.unshift(e); if (eH.length > b.length - 1) eH.pop();
        yH.unshift(y); if (yH.length > a.length - 1) yH.pop();

        // Check for instability based on quantizer input magnitude
        const INSTABILITY_THRESHOLD = 10.0;
        if (Math.abs(u) > INSTABILITY_THRESHOLD) {
            return NaN; // Return NaN to signal instability
        }

        return q;
    },

    /* =================================================================
       2.  Butterworth LPF
       ================================================================= */

    resetLPFState(order) {
        const nSect = Math.floor((order + 1) / 2);
        this.lpfState = Array.from({ length: nSect }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
    },

    calculateButterworthCoefficients(order, fc, fs) {
        if (order < 1 || fs <= 0 || fc <= 0 || fc >= fs / 2) return [];
        const warped = Math.tan(Math.PI * fc / fs);
        const biquads = [];
        const nSect = Math.floor(order / 2);
        for (let k = 0; k < nSect; ++k) {
            const theta = Math.PI * (2 * k + 1) / (2 * order);
            const Q = 1 / (2 * Math.cos(theta));
            const K = warped;
            const K2 = K * K;
            const norm = 1 + K / Q + K2;
            biquads.push({
                b0: K2 / norm,
                b1: 2 * K2 / norm,
                b2: K2 / norm,
                a1: 2 * (K2 - 1) / norm,
                a2: (1 - K / Q + K2) / norm
            });
        }
        if (order % 2 === 1) {
            const K = warped;
            const norm = 1 + K;
            // first-order section with unity DC gain
            const b = 1 / norm;
            biquads.push({ b0: b, b1: b, b2: 0, a1: (1 - K) / norm, a2: 0 });
        }
        return biquads;
    },

    applyLPF(x) {
        if (!this.lpfCoefficients.length || this.lpfState.length !== this.lpfCoefficients.length) return x;
        for (let i = 0; i < this.lpfCoefficients.length; ++i) {
            const s = this.lpfState[i];
            const c = this.lpfCoefficients[i];
            const y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
            s.x2 = s.x1; s.x1 = x;
            s.y2 = s.y1; s.y1 = y;
            x = Number.isFinite(y) ? y : 0;
        }
        return x;
    },

    /* =================================================================
       3.  FIR down‑sampler (Blackman‑windowed sinc)
       ================================================================= */

    resetDownsampleFilterState() { this.downsampleFIRBuffer = []; },

    calculateDownsamplingCoefficients(fs, targetFs) {
        if (fs <= targetFs) { this.decimationFactor = 1; this.firDownsampleCoeffs = null; return; }
        this.decimationFactor = Math.max(1, Math.floor(fs / targetFs));
        const cutoff = 120e3;                    // 120 kHz
        const fc = (2 * cutoff) / fs;
        const M = 1023; // increase number of taps for higher attenuation
        const mid = (M - 1) / 2;
        const a0 = 0.42, a1 = 0.5, a2 = 0.08;
        const h = new Array(M);
        let sum = 0;
        for (let n = 0; n < M; ++n) {
            const k = n - mid;
            const sinc = k === 0 ? fc : Math.sin(Math.PI * fc * k) / (Math.PI * k);
            const win = a0 - a1 * Math.cos(2 * Math.PI * n / (M - 1)) + a2 * Math.cos(4 * Math.PI * n / (M - 1));
            h[n] = sinc * win; sum += h[n];
        }
        for (let n = 0; n < M; ++n) h[n] /= sum;
        this.firDownsampleCoeffs = h;
        this.resetDownsampleFilterState();
    },

    applyDownsamplingFilter(x) {
        if (!this.firDownsampleCoeffs) return x;
        const buf = this.downsampleFIRBuffer;
        buf.unshift(x); if (buf.length > this.firDownsampleCoeffs.length) buf.pop();
        let y = 0;
        for (let i = 0; i < this.firDownsampleCoeffs.length; ++i) y += (buf[i] || 0) * this.firDownsampleCoeffs[i];
        return y;
    },

    /* =================================================================
       4.  Window & FFT
       ================================================================= */

    applyHannWindow(arr) {
        const N = arr.length;
        if (!N) return [];
        const N1 = N - 1;
        return arr.map((v, i) => v * 0.5 * (1 - Math.cos(2 * Math.PI * i / N1)));
    },

    fft(real, imag) {
        const n = real.length;
        if (n !== imag.length) throw new Error("real/imag length mismatch");
        if (n === 0) return;
        if ((n & (n - 1)) !== 0) throw new Error(`FFT length ${n} must be power of 2`);

        const log2n = Math.log2(n);
        // bit‑reverse
        for (let i = 0; i < n; ++i) {
            let j = 0;
            for (let bit = 0; bit < log2n; ++bit) j |= ((i >>> bit) & 1) << (log2n - 1 - bit);
            if (j > i) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
        }
        // Cooley‑Tukey
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >>> 1;
            const angStep = -2 * Math.PI / size;
            for (let i = 0; i < n; i += size) {
                let ang = 0;
                for (let j = i; j < i + half; ++j) {
                    const k = j + half;
                    const cosA = Math.cos(ang), sinA = Math.sin(ang);
                    const treal = real[k] * cosA - imag[k] * sinA;
                    const timag = real[k] * sinA + imag[k] * cosA;
                    real[k] = real[j] - treal; imag[k] = imag[j] - timag;
                    real[j] += treal;         imag[j] += timag;
                    ang += angStep;
                }
            }
        }
    },

    /* =================================================================*/
    generateSignal(p) { return Math.sin(p); }
};

// =============================================
// Main Application Logic
// =============================================
const App = {
    // --- Configuration ---
    BASE_SAMPLING_RATE: 44100, // Hz
    TARGET_DOWNSAMPLE_FREQ: 352800, // Hz for FFT pre-processing
    FFT_SIZE: 8192, // Must be power of 2

    // --- State ---
    isRunning: false,
    lastTimestamp: 0,
    // Debug flags for isolating signal processing
    debugBypassDeltaSigma: false, // if true, skip ΔΣ and use raw signal
    debugBypassLPF: false,        // if true, skip LPF and use digital directly
    lastBatchTimestamp: 0,    // Last timestamp for simulation batch
    simulationTime: 0,         // Accumulated simulation time in seconds
    simulationPhase: 0,         // Accumulated simulation phase in seconds
    sampleRemainder: 0,        // Fractional samples leftover
    currentParams: {}, // Holds parameters read from UI
    needsCoefficientUpdate: true, // Flag to recalculate filters
    needsStateReset: true, // Flag to reset filter/modulator states

    // --- Buffers ---
    timeDomainBuffer: [], // Circular buffer for time domain display {original, digital, reconstructed}
    fftInputBuffer: [], // Buffer for collecting samples for FFT (after downsampling)
    downsampleCounter: 0, // Counter for decimation

    // Timer-driven simulation processing separate from rendering
    simulationBatch: function() {
        if (document.hidden) {
            // Skip simulation when page not visible
            this.lastBatchTimestamp = performance.now();
            return;
        }
        // Calculate elapsed wall-time since last batch
        const now = performance.now();
        const elapsed = (now - this.lastBatchTimestamp) / 1000.0; // seconds
        this.lastBatchTimestamp = now;
        // Apply parameter updates if flagged
        if (this.needsCoefficientUpdate || this.needsStateReset) {
            this.updateState();
        }
        const fs = this.BASE_SAMPLING_RATE * this.currentParams.fsMultiplier;
        // Speed slider range [-5,-3], direct mapping: factor = 10^speed
        const speedFactor = Math.pow(10, this.currentParams.speed);
        // Prevent runaway: cap maximum simulation steps per batch
        const MAX_STEPS_PER_BATCH = fs; // at most 1 second worth of samples
        let samplesFloat = elapsed * fs * speedFactor + this.sampleRemainder;
        if (samplesFloat > MAX_STEPS_PER_BATCH) {
            console.warn("Clamping large simulation batch from", samplesFloat, "to", MAX_STEPS_PER_BATCH);
            samplesFloat = MAX_STEPS_PER_BATCH;
        }
        const steps = Math.floor(samplesFloat);
        this.sampleRemainder = samplesFloat - steps;
        for (let i = 0; i < steps; i++) {
            this.simulationStep();
        }
    },

    init: function() {
        console.log("Initializing App...");
        if (!UI.init(this.handleUIUpdate.bind(this))) {
            console.error("UI Initialization failed.");
            return;
        }
        // Initial setup
        this.updateState();
        this.lastTimestamp = performance.now();
        this.lastBatchTimestamp = this.lastTimestamp;
        this.sampleRemainder = 0;
        this.isRunning = true;
        // Schedule continuous simulation at 1ms resolution
        this.simulationTimer = setInterval(this.simulationBatch.bind(this), 1);
        // Start rendering loop
        requestAnimationFrame(this.run.bind(this));
        console.log("App Initialized and Running.");
    },

    // Callback function passed to UI.init: update state on any control change
    handleUIUpdate: function() {
        this.updateState();
    },

    updateState: function() {
        const newParams = UI.getControlValues();
        if (!newParams) {
            return; // Exit early if UI values are not ready
        }

        // Detect parameter changes via strict comparison
        let fsChanged = this.currentParams.fsMultiplier !== newParams.fsMultiplier;
        let adBitsChanged = this.currentParams.adBits !== newParams.adBits;
        let lpfParamsChanged = this.currentParams.lpfCutoff !== newParams.lpfCutoff || this.currentParams.lpfOrder !== newParams.lpfOrder;
        let noiseOrderChanged = this.currentParams.noiseOrder !== newParams.noiseOrder;

        this.currentParams = newParams;

        const currentSamplingFrequency = this.BASE_SAMPLING_RATE * this.currentParams.fsMultiplier;

        if (this.needsCoefficientUpdate || fsChanged || lpfParamsChanged) {
            console.log("Recalculating LPF coefficients...");
            DSP.lpfCoefficients = DSP.calculateButterworthCoefficients(
                this.currentParams.lpfOrder,
                this.currentParams.lpfCutoff,
                currentSamplingFrequency
            );
            this.needsStateReset = true; // Reset state after coeff change
        }

        if (this.needsCoefficientUpdate || fsChanged) {
             console.log("Recalculating Downsampling coefficients...");
             DSP.calculateDownsamplingCoefficients(
                 currentSamplingFrequency,
                 this.TARGET_DOWNSAMPLE_FREQ
             );
             this.needsStateReset = true;
        }

        if (this.needsStateReset || noiseOrderChanged || adBitsChanged || fsChanged) {
            console.log("Resetting DSP states...");
            DSP.resetLPFState(this.currentParams.lpfOrder);
            DSP.resetDownsampleFilterState(); // Uses DSP.downsampleCoefficients.length internally
            // Clear buffers and reset simulation time
            this.fftInputBuffer = [];
            this.downsampleCounter = 0;
            this.timeDomainBuffer = [];
            this.simulationTime = 0;
            this.simulationPhase = 0;
            // Load NTF coefficients for ΔΣ macro-model on state reset
            if (DSP.deltasigmaCoeffs) {
                const cfg = DSP.deltasigmaCoeffs[this.currentParams.noiseOrder]?.[this.currentParams.fsMultiplier]?.[this.currentParams.adBits];
                if (cfg) {
                    DSP.ntfNumCoeffs = cfg.num;
                    DSP.ntfDenCoeffs = cfg.den;
                } else {
                    DSP.ntfNumCoeffs = null;
                    DSP.ntfDenCoeffs = null;
                }
            } else {
                 DSP.ntfNumCoeffs = null;
                 DSP.ntfDenCoeffs = null;
            }
            // Initialize modulator state after NTF coeffs are loaded
            DSP.resetModulatorState(this.currentParams.noiseOrder);
            this.sampleRemainder   = 0;
            this.downsampleCounter = 0;
            this.lastBatchTimestamp = performance.now();
            this.fftProgress       = 0;
            this.needsStateReset = false; // Reset flag
        }

        this.needsCoefficientUpdate = false; // Reset flag
    },

    run: function(timestamp) {
        if (!this.isRunning) return;
        if (document.hidden) {
            // Skip rendering when page not visible
            requestAnimationFrame(this.run.bind(this));
            return;
        }
        // Only perform FFT and drawing here
        const spectrum = this.performFFT();

        // Fetch display-only flags (Show Waveforms)
        const flags = UI.getControlValues() || {};
        const displayParams = {
            currentSamplingFrequency: this.BASE_SAMPLING_RATE * this.currentParams.fsMultiplier,
            time: this.simulationTime,
            adBits: this.currentParams.adBits,
            showOriginal: flags.showOriginal,
            showDigital: flags.showDigital,
            showReconstructed: flags.showRecon,
            lpfOrder: this.currentParams.lpfOrder,
        };
        // Draw time and frequency domains
        UI.drawTimeDomain(this.timeDomainBuffer, displayParams);
        // Use actual decimated sampling frequency for FFT axis
        const decimatedFs = (this.BASE_SAMPLING_RATE * this.currentParams.fsMultiplier) / DSP.decimationFactor;
        UI.drawFrequencyDomain(spectrum || [], decimatedFs);
        requestAnimationFrame(this.run.bind(this));
    },

    performFFT: function() {
        // Always compute FFT: pad buffer with zeros if not full
        const bufLen = this.fftInputBuffer.length;
        // Track FFT buffer fill progress (0 to 1)
        this.fftProgress = Math.min(1, bufLen / this.FFT_SIZE);
        // Apply Hann window only to existing samples, then zero-pad to FFT_SIZE
        const windowedPart = DSP.applyHannWindow([...this.fftInputBuffer]);
        const windowed = windowedPart.concat(Array(Math.max(0, this.FFT_SIZE - bufLen)).fill(0));
        const fftDataReal = windowed;
        const fftDataImag = new Array(this.FFT_SIZE).fill(0.0);

        // 2. Perform FFT
        try {
            DSP.fft(fftDataReal, fftDataImag);
        } catch (e) {
            console.error("FFT Error:", e);
            return null; // Stop FFT processing on error
        }


        // 3. Calculate Magnitude Spectrum (dB)
        const spectrumDb = new Array(this.FFT_SIZE / 2).fill(-192); // Initialize with floor dB
        const ref = 1.0; // Reference for dB calculation (assuming max signal is 1.0)
        const minDb = -192;

        for (let i = 0; i < this.FFT_SIZE / 2; i++) {
            const mag = Math.sqrt(fftDataReal[i] * fftDataReal[i] + fftDataImag[i] * fftDataImag[i]);
            // Normalize magnitude by FFT size and compensate Hann window (coherent gain ~0.5)
            const normalizedMag = (mag * 2) / this.FFT_SIZE;
             if (normalizedMag > 0) { // Avoid log(0)
                 spectrumDb[i] = Math.max(minDb, 20 * Math.log10(normalizedMag / ref));
             } else {
                 spectrumDb[i] = minDb;
             }
        }
        // console.log("FFT performed. Spectrum length:", spectrumDb.length);
        return spectrumDb;
    },

    simulationStep: function() {
        const currentSamplingFrequency = this.BASE_SAMPLING_RATE * this.currentParams.fsMultiplier;
        if (currentSamplingFrequency <= 0) return;

        const dt = 1.0 / currentSamplingFrequency;

        // Generate original analog sample
        const originalSample = DSP.generateSignal(this.simulationPhase) * 0.5;
        // ΔΣ modulation (or bypass)
        const digitalSample = this.debugBypassDeltaSigma
            ? originalSample
            : DSP.deltaSigmaModulate(originalSample, this.currentParams.adBits, this.currentParams.noiseOrder, this.currentParams.fsMultiplier);

        // Check for numerical instability before storing/using values
        const checkFiniteAndTriggerReset = (val, name) => {
            // Check for NaN (returned by deltaSigmaModulate on instability) or non-finite values
            if (isNaN(val) || !Number.isFinite(val)) {
                // Set flag to request a full state reset
                this.needsStateReset = true;
                // Schedule updateState on the next frame to perform the reset
                requestAnimationFrame(() => {
                    if (this.needsStateReset) { // Check flag again in case it was already handled
                         this.updateState();
                    }
                });
                return false; // Indicate instability
            }
            return true; // Indicate stable
        };

        // Check key signals and stop if unstable
        // Note: digitalSample check now catches instability from deltaSigmaModulate returning NaN
        if (!checkFiniteAndTriggerReset(digitalSample, 'digitalSample')) return;
        // Apply reconstruction LPF (or bypass)
        let reconstructedSample = this.debugBypassLPF
            ? digitalSample
            : DSP.applyLPF(digitalSample);
        // Check reconstructed sample AFTER LPF
        if (!checkFiniteAndTriggerReset(reconstructedSample, 'reconstructedSample')) return;

        // Apply downsampling filter ONLY AFTER checking reconstructedSample is stable
        const filteredForDownsample = DSP.applyDownsamplingFilter(reconstructedSample);
        if (!checkFiniteAndTriggerReset(filteredForDownsample, 'filteredForDownsample')) return;

        // Store for Time Domain Display
        const displayBufferSize = UI.timeDomainCanvas ? UI.timeDomainCanvas.width : 1000;
        this.timeDomainBuffer.push({ original: originalSample, digital: digitalSample, reconstructed: reconstructedSample });
        if (this.timeDomainBuffer.length > displayBufferSize * 1.5) { // Keep slightly more than needed
            this.timeDomainBuffer.shift(); // Remove oldest sample
        }

        // Decimate
        if (this.downsampleCounter % DSP.decimationFactor === 0) {
            this.fftInputBuffer.push(filteredForDownsample); // Use the filtered value from above
            // Keep FFT buffer at required size
            if (this.fftInputBuffer.length > this.FFT_SIZE) {
                this.fftInputBuffer.shift();
            }
        }
        this.downsampleCounter++;


        // Increment simulation time
        this.simulationTime += dt;
        this.simulationPhase += Math.PI * 2.0 * this.currentParams.signalFreq * dt;
        if (this.simulationPhase > Math.PI * 2.0) {
            this.simulationPhase -= Math.PI * 2.0;
        }
    },

    clearDisplayBuffer: function() {
        console.log("Clearing display buffer due to resize.");
        this.timeDomainBuffer = [];
        // Optionally clear FFT buffer too? Or let it refill?
        // this.fftInputBuffer = [];
        // this.needsStateReset = true; // Force state reset might be too much, just clear buffer
    },
};

// --- Auto-Initialization ---
// Load ΔΣ noise-shaping coefficients then start the application
fetch('assets/deltasigma_coeffs.json')
    .then(response => response.json())
    .then(coeffs => {
        console.log('Loaded deltasigma_coeffs.json', coeffs);
        DSP.deltasigmaCoeffs = coeffs;
        App.init();
    })
    .catch(error => {
        console.error('Failed to load ΔΣ coefficients, falling back to default modulator', error);
        App.init();
    });