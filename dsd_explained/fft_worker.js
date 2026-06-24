// fft_worker.js – Off-thread accurate frequency-response simulation.
//
// The main thread runs a slow, real-time-paced ΔΣ simulation purely to animate
// the time-domain waveform. The frequency spectrum, however, does not depend on
// playback speed: it only depends on the chosen parameters. This worker runs the
// exact same ΔΣ / reconstruction-LPF / decimation chain at full speed and uses
// Welch averaging (many FFT segments) to converge on the steady-state spectrum
// quickly, posting progressively refined results back to the page.
//
// NOTE: the DSP math here is deliberately kept identical to dsp.js so the
// converged spectrum matches what the live simulation would eventually show.
// If the modulator / filter math in dsp.js changes, mirror it here.

/* =====================================================================
   ΔΣ macro-model (error-feedback form) – mirrors DSP.deltaSigmaModulate
   ===================================================================== */
function createModulator(num, den, noiseOrder, initSpread = 1e-6) {
    const rnd = () => (Math.random() * 2 - 1) * initSpread;
    return {
        b: num,
        a: den,
        errorHistory: Array.from({ length: num.length - 1 }, rnd),
        noiseHistory: Array.from({ length: den.length - 1 }, rnd),
    };
}

const INSTABILITY_THRESHOLD = 10.0;

function modulate(m, inputSample, adBits) {
    const b = m.b, a = m.a, eH = m.errorHistory, yH = m.noiseHistory;

    let yPred = 0;
    for (let i = 1; i < b.length; ++i) yPred += b[i] * (eH[i - 1] || 0);
    for (let j = 1; j < a.length; ++j) yPred -= a[j] * (yH[j - 1] || 0);

    const u = inputSample + yPred;

    let q;
    if (adBits === 1) {
        q = u >= 0 ? 1 : -1;
    } else {
        const L = 1 << adBits;
        const span = (L - 1) / 2;
        let k = Math.round(u * span);
        k = Math.max(-span, Math.min(span, k));
        q = k / span;
    }

    const e = q - u;
    const y = yPred + b[0] * e;
    eH.unshift(e); if (eH.length > b.length - 1) eH.pop();
    yH.unshift(y); if (yH.length > a.length - 1) yH.pop();

    if (Math.abs(u) > INSTABILITY_THRESHOLD) return NaN;
    return q;
}

/* =====================================================================
   Butterworth reconstruction LPF – mirrors DSP.calculateButterworth* / applyLPF
   ===================================================================== */
function calculateButterworthCoefficients(order, fc, fs) {
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
            b0: K2 / norm, b1: 2 * K2 / norm, b2: K2 / norm,
            a1: 2 * (K2 - 1) / norm, a2: (1 - K / Q + K2) / norm,
        });
    }
    if (order % 2 === 1) {
        const K = warped;
        const norm = 1 + K;
        const b = 1 / norm;
        biquads.push({ b0: b, b1: b, b2: 0, a1: (1 - K) / norm, a2: 0 });
    }
    return biquads;
}

function createLPFState(coeffs) {
    return coeffs.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
}

function applyLPF(coeffs, state, x) {
    if (!coeffs.length) return x;
    for (let i = 0; i < coeffs.length; ++i) {
        const s = state[i], c = coeffs[i];
        const y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
        s.x2 = s.x1; s.x1 = x;
        s.y2 = s.y1; s.y1 = y;
        x = Number.isFinite(y) ? y : 0;
    }
    return x;
}

/* =====================================================================
   FIR down-sampler (Blackman-windowed sinc) – mirrors DSP.calculateDownsampling*
   ===================================================================== */
function calculateDownsamplingCoefficients(fs, targetFs) {
    if (fs <= targetFs) return { decimation: 1, coeffs: null };
    const decimation = Math.max(1, Math.floor(fs / targetFs));
    const cutoff = 120e3;
    const fc = (2 * cutoff) / fs;
    const M = 1023;
    const mid = (M - 1) / 2;
    const a0 = 0.42, a1 = 0.5, a2 = 0.08;
    const h = new Float64Array(M);
    let sum = 0;
    for (let n = 0; n < M; ++n) {
        const k = n - mid;
        const sinc = k === 0 ? fc : Math.sin(Math.PI * fc * k) / (Math.PI * k);
        const win = a0 - a1 * Math.cos(2 * Math.PI * n / (M - 1)) + a2 * Math.cos(4 * Math.PI * n / (M - 1));
        h[n] = sinc * win; sum += h[n];
    }
    for (let n = 0; n < M; ++n) h[n] /= sum;
    return { decimation, coeffs: h };
}

/* =====================================================================
   FFT with cached bit-reversal + twiddle tables (runs many times per job)
   ===================================================================== */
function makeFFT(n) {
    const levels = Math.log2(n);
    if (!Number.isInteger(levels)) throw new Error(`FFT length ${n} must be power of 2`);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; ++i) {
        let j = 0;
        for (let bit = 0; bit < levels; ++bit) j |= ((i >>> bit) & 1) << (levels - 1 - bit);
        rev[i] = j;
    }
    const half = n >> 1;
    const cosT = new Float64Array(half), sinT = new Float64Array(half);
    for (let i = 0; i < half; ++i) {
        const a = -2 * Math.PI * i / n;
        cosT[i] = Math.cos(a); sinT[i] = Math.sin(a);
    }
    return function (re, im) {
        for (let i = 0; i < n; ++i) {
            const j = rev[i];
            if (j > i) {
                const tr = re[i]; re[i] = re[j]; re[j] = tr;
                const ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (let size = 2; size <= n; size <<= 1) {
            const h = size >> 1;
            const step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + h; ++j, k += step) {
                    const c = cosT[k], s = sinT[k];
                    const l = j + h;
                    const tr = re[l] * c - im[l] * s;
                    const ti = re[l] * s + im[l] * c;
                    re[l] = re[j] - tr; im[l] = im[j] - ti;
                    re[j] += tr; im[j] += ti;
                }
            }
        }
    };
}

function hannWindow(n) {
    const w = new Float64Array(n);
    const N1 = n - 1;
    for (let i = 0; i < n; ++i) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N1));
    return w;
}

/* =====================================================================
   Job management – chunked so a newer request can pre-empt the current one
   ===================================================================== */
let currentJob = 0;
const MIN_DB = -192;

self.onmessage = (e) => {
    const cfg = e.data;
    currentJob = cfg.job;
    try {
        startJob(cfg);
    } catch (err) {
        // On any setup error just report a flat floor so the page isn't stuck.
        const half = cfg.fftSize / 2;
        const spectrumDb = new Float64Array(half).fill(MIN_DB);
        self.postMessage({ job: cfg.job, progress: 1, spectrumDb, decimatedFs: cfg.baseSamplingRate });
    }
};

function startJob(cfg) {
    const {
        job, signalFreq, fsMultiplier, adBits, noiseOrder,
        lpfCutoff, lpfOrder, ntfNum, ntfDen,
        fftSize, targetDownsampleFreq, baseSamplingRate, totalSegments,
    } = cfg;

    const fs = baseSamplingRate * fsMultiplier;
    const dt = 1.0 / fs;
    const phaseInc = Math.PI * 2.0 * signalFreq * dt;

    const lpfCoeffs = calculateButterworthCoefficients(lpfOrder, lpfCutoff, fs);
    const lpfState = createLPFState(lpfCoeffs);
    const { decimation, coeffs: firCoeffs } = calculateDownsamplingCoefficients(fs, targetDownsampleFreq);
    const decimatedFs = fs / decimation;

    const half = fftSize >> 1;
    const fft = makeFFT(fftSize);
    const window = hannWindow(fftSize);

    // FIR ring buffer; the decimator only evaluates output at decimation points.
    const M = firCoeffs ? firCoeffs.length : 0;
    const ring = M ? new Float64Array(M) : null;
    let ringPos = 0;

    let modulator = createModulator(ntfNum, ntfDen, noiseOrder);

    // Continuous signal phase + sub-sample decimation counter shared across segments.
    let phase = 0;
    let subCounter = 0;
    let resets = 0;

    // Produce the next decimated sample of the reconstructed stream.
    function nextDecimatedSample() {
        let out = 0;
        do {
            const original = Math.sin(phase) * 0.5;
            let digital = modulate(modulator, original, adBits);
            if (Number.isNaN(digital)) {
                // Re-seed on instability (matches the live path's reset behaviour).
                if (resets++ < 8) {
                    modulator = createModulator(ntfNum, ntfDen, noiseOrder);
                }
                digital = 0;
            }
            const recon = applyLPF(lpfCoeffs, lpfState, digital);
            if (M) {
                ring[ringPos] = recon;
                ringPos = (ringPos + 1) % M;
            } else {
                out = recon;
            }
            phase += phaseInc;
            if (phase > Math.PI * 2.0) phase -= Math.PI * 2.0;
            subCounter++;
        } while (M && subCounter % decimation !== 0);

        if (M) {
            // Dot product of FIR taps with newest→oldest ring samples.
            let acc = 0;
            let idx = (ringPos - 1 + M) % M;
            for (let i = 0; i < M; ++i) {
                acc += firCoeffs[i] * ring[idx];
                if (--idx < 0) idx += M;
            }
            out = acc;
        }
        return out;
    }

    // Warm-up: settle the modulator / LPF and fully prime the FIR buffer.
    const warmup = fftSize;
    for (let i = 0; i < warmup; ++i) nextDecimatedSample();

    // Welch accumulation.
    const power = new Float64Array(half);
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    let segDone = 0;

    function processChunk() {
        if (job !== currentJob) return; // pre-empted by a newer request

        const CHUNK = 2;
        for (let c = 0; c < CHUNK && segDone < totalSegments; ++c, ++segDone) {
            for (let i = 0; i < fftSize; ++i) {
                re[i] = nextDecimatedSample() * window[i];
                im[i] = 0;
            }
            fft(re, im);
            const scale = 2 / fftSize;
            for (let i = 0; i < half; ++i) {
                const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * scale;
                power[i] += mag * mag;
            }
        }

        const spectrumDb = new Float64Array(half);
        for (let i = 0; i < half; ++i) {
            const avg = power[i] / segDone;
            spectrumDb[i] = avg > 0 ? Math.max(MIN_DB, 10 * Math.log10(avg)) : MIN_DB;
        }

        self.postMessage({
            job, progress: segDone / totalSegments, spectrumDb, decimatedFs,
        }, [spectrumDb.buffer]);

        if (segDone < totalSegments && job === currentJob) {
            setTimeout(processChunk, 0);
        }
    }

    processChunk();
}
