// ui.js - UI Drawing and Control Handling

const UI = {
    // --- Canvas Contexts ---
    timeCtx: null,
    freqCtx: null,
    timeDomainCanvas: null,
    frequencyDomainCanvas: null,

    // --- Control Elements ---
    speedSlider: null, speedValueText: null,
    fsRadios: null, fsLabels: null,
    adBitsSlider: null, adBitsValueText: null,
    freqSlider: null, freqValueText: null,
    noiseOrderSlider: null, noiseOrderValueText: null,
    originalCheckbox: null, digitalCheckbox: null, reconstructedCheckbox: null,
    lpfFreqSlider: null, lpfFreqValueText: null,
    lpfOrderSlider: null, lpfOrderValueText: null,

    // --- Initialization ---
    init: function(appStateUpdateCallback) {
        this.timeDomainCanvas = document.getElementById('timeDomainCanvas');
        this.frequencyDomainCanvas = document.getElementById('frequencyDomainCanvas');
        if (!this.timeDomainCanvas || !this.frequencyDomainCanvas) {
             console.error("Canvas elements not found!");
             return false;
        }
        this.timeCtx = this.timeDomainCanvas.getContext('2d');
        this.freqCtx = this.frequencyDomainCanvas.getContext('2d');

        if (!this.timeCtx || !this.freqCtx) {
             console.error("Failed to get canvas contexts!");
             return false;
        }

        this.setupControls(appStateUpdateCallback);
        this.setupResizeObserver();
        return true;
    },

    // --- Drawing Functions ---
    drawTimeDomain: function(displayBuffer, params) {
         if (!this.timeCtx || !this.timeDomainCanvas) return;
         const { currentSamplingFrequency, time, adBits, showOriginal, showDigital, showReconstructed, lpfOrder } = params;

         this.timeCtx.clearRect(0, 0, this.timeDomainCanvas.width, this.timeDomainCanvas.height);
         this.timeCtx.lineWidth = 1;

         const width = this.timeDomainCanvas.width;
         const height = this.timeDomainCanvas.height;
         if (width <= 0 || height <= 0) return; // Skip drawing if canvas has no size
         const midY = height / 2;
         const scaleY = height / 2 * 0.9;

         // Draw grid lines
         const samplesPerMs = currentSamplingFrequency * 0.001;
         if (samplesPerMs <= 0) return; // Avoid division by zero for invalid sampling frequency
         const pixelsPerGridLine = samplesPerMs * 0.1;
         this.timeCtx.strokeStyle = '#ddd';
         this.timeCtx.beginPath();
         // Calculate pixel offset for grid alignment
         const totalSamples = Math.round(time * currentSamplingFrequency);
         const offset = totalSamples % pixelsPerGridLine; // pixel offset of last grid line
         let gridX = width - offset;
         while (gridX >= 0) {
             this.timeCtx.moveTo(gridX, 0);
             this.timeCtx.lineTo(gridX, height);
             gridX -= pixelsPerGridLine;
         }
         this.timeCtx.stroke();

         // Draw waveforms
         // Calculate how many samples to draw and starting positions to fill from the right
         const samplesToDraw = Math.min(displayBuffer.length, width);
         const startDrawIndex = Math.max(0, displayBuffer.length - width);
         const xOffset = width - samplesToDraw;

         // Original (Blue)
         if (showOriginal) {
             this.timeCtx.strokeStyle = '#44f';
             this.timeCtx.lineWidth = 2;
             this.timeCtx.beginPath();
             let first = true;
             for (let i = 0; i < samplesToDraw; ++i) {
                 const bufferIndex = startDrawIndex + i;
                 const sample = displayBuffer[bufferIndex];
                 const x = xOffset + i + 0.5;
                 const y = midY - sample.original * scaleY;
                 if (first) { this.timeCtx.moveTo(x, y); first = false; }
                 else { this.timeCtx.lineTo(x, y); }
             }
             this.timeCtx.stroke();
         }

         // Digital (Yellow)
         if (showDigital) {
             this.timeCtx.strokeStyle = 'yellow';
             this.timeCtx.lineWidth = 1;
             this.timeCtx.beginPath();
             if (adBits === 1) {
                 // 1-bit DSD: draw short central lines to show density
                 const barHalfHeight = scaleY * 0.1; // 10% of full vertical scale
                 for (let i = 0; i < samplesToDraw; ++i) {
                     const bufferIndex = startDrawIndex + i;
                     const sample = displayBuffer[bufferIndex];
                     // only draw positive pulses
                     if (sample.digital <= 0) continue;
                     const x = xOffset + i + 0.5;
                     this.timeCtx.moveTo(x, midY - barHalfHeight);
                     this.timeCtx.lineTo(x, midY + barHalfHeight);
                 }
             } else {
                 // Multi-bit PCM: use quantized digital value directly
                 let firstSig = true;
                 for (let i = 0; i < samplesToDraw; ++i) {
                     const bufferIndex = startDrawIndex + i;
                     const sample = displayBuffer[bufferIndex];
                     const x = xOffset + i + 0.5;
                     const q = sample.digital; // already quantized by DSP
                     const y = midY - q * scaleY;
                     if (firstSig) {
                         this.timeCtx.moveTo(x, y);
                         firstSig = false;
                     } else {
                         const prevSample = displayBuffer[bufferIndex - 1];
                         const prevY = midY - prevSample.digital * scaleY;
                         this.timeCtx.lineTo(x, prevY);
                         this.timeCtx.lineTo(x, y);
                     }
                 }
             }
             this.timeCtx.stroke();
         }

         // Reconstructed (Red)
         if (showReconstructed) {
             this.timeCtx.strokeStyle = 'red';
             if (lpfOrder > 0) {
                this.timeCtx.lineWidth = 2;
             } else {
                this.timeCtx.lineWidth = 1;
             }
             this.timeCtx.beginPath();
             let prevBufferIdx = -1;
             for (let i = 0; i < samplesToDraw; ++i) {
                 const bufferIndex = startDrawIndex + i;
                 const sample = displayBuffer[bufferIndex];
                 const x = xOffset + i + 0.5;
                 const y = midY - sample.reconstructed * scaleY;
                 // Only connect line if sample indices are consecutive
                 if (bufferIndex === prevBufferIdx + 1) {
                     this.timeCtx.lineTo(x, y);
                 } else {
                     this.timeCtx.moveTo(x, y);
                 }
                 prevBufferIdx = bufferIndex;
             }
             this.timeCtx.stroke();
         }

          // Draw Center Line
         this.timeCtx.strokeStyle = '#666';
         this.timeCtx.lineWidth = 0.5;
         this.timeCtx.beginPath();
         this.timeCtx.moveTo(0, midY);
         this.timeCtx.lineTo(width, midY);
         this.timeCtx.stroke();
    },

    drawFrequencyDomain: function(spectrumDb, targetDownsampleFreq) {
        if (!this.freqCtx || !this.frequencyDomainCanvas) return;

        this.freqCtx.clearRect(0, 0, this.frequencyDomainCanvas.width, this.frequencyDomainCanvas.height);
        // Draw FFT buffer fill progress
        if (App.fftProgress !== undefined && App.fftProgress < 1) {
            this.freqCtx.fillStyle = '#888';
            const barWidth = this.frequencyDomainCanvas.width * App.fftProgress;
            this.freqCtx.fillRect(0, this.frequencyDomainCanvas.height - 5, barWidth, 5);
        }

        const width = this.frequencyDomainCanvas.width;
        const height = this.frequencyDomainCanvas.height;
         if (width <= 0 || height <= 0) return; // Skip drawing if canvas has no size

        const numBins = spectrumDb.length; // Should be FFT_SIZE / 2
        if (numBins === 0) return; // Nothing to draw

        // Frequency axis (Logarithmic scale: 20Hz to 96kHz)
        const minFreqLog = Math.log10(20);
        const maxFreqLog = Math.log10(96000);
        const freqRangeLog = maxFreqLog - minFreqLog;
        if (freqRangeLog <= 0) return; // Avoid division by zero

        // Amplitude axis (Linear scale: 0dB to -144dB)
        const minDb = -192;
        const maxDb = 0;

         // Draw Grid
        this.freqCtx.strokeStyle = '#666';
        this.freqCtx.lineWidth = 0.5;
        this.freqCtx.beginPath();
        const decades = [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000];
        decades.forEach(f => {
             // for (let f = base; f < base * 10; f += base) {
                 if (f > 96000) return;
                  if (f >= 20) {
                      const x = width * (Math.log10(f) - minFreqLog) / freqRangeLog;
                      // Make major lines (10, 100, 1k, 10k) slightly darker/thicker?
                      this.freqCtx.moveTo(x, 0); this.freqCtx.lineTo(x, height);
                  }
             // }
        });
        for (let db = maxDb; db >= minDb; db -= 24) {
             const y = height * (db - maxDb) / (minDb - maxDb);
             this.freqCtx.moveTo(0, y); this.freqCtx.lineTo(width, y);
        }
        this.freqCtx.stroke();

        // Draw spectrum line
        this.freqCtx.strokeStyle = 'green';
        this.freqCtx.lineWidth = 2;
        this.freqCtx.beginPath();
        let firstPoint = true;
        const effectiveNyquist = targetDownsampleFreq / 2;
        for (let i = 1; i < numBins; i++) { // Start from i=1 to avoid freq=0 issues with log scale
            const freq = (i / numBins) * effectiveNyquist; // Frequency of this bin
            if (freq >= 20 && freq <= 96000) {
                 const x = width * (Math.log10(freq) - minFreqLog) / freqRangeLog;
                 let dbValue = Math.max(minDb, spectrumDb[i]);
                  if (isNaN(dbValue)) dbValue = minDb; // Handle potential NaNs
                 const y = height * (dbValue - maxDb) / (minDb - maxDb);
                  if (isNaN(x) || isNaN(y)) continue; // Skip if coordinates are invalid

                 if (firstPoint) { this.freqCtx.moveTo(x, y); firstPoint = false; }
                 else { this.freqCtx.lineTo(x, y); }
            }
             if (freq > 96000) break; // Stop drawing past max frequency
        }
        this.freqCtx.stroke();

        // Draw Axes Labels
        this.freqCtx.fillStyle = '#888';
        this.freqCtx.font = '14px sans-serif';
        this.freqCtx.textAlign = 'center';
        [100, 1000, 10000].forEach(f => {
            const x = width * (Math.log10(f) - minFreqLog) / freqRangeLog;
            this.freqCtx.fillText(`${f < 1000 ? f : f/1000+'k'}`, x, height - 5);
        });
        this.freqCtx.textAlign = 'left';
        for (let db = maxDb - 24 ; db > minDb; db -= 24) {
             const y = height * (db - maxDb) / (minDb - maxDb);
             this.freqCtx.fillText(`${db}dB`, 5, Math.max(10, Math.min(height - 5, y + 4))); // Adjust label position within bounds
        }
    },

    setupControls: function(updateCallback) {
        // Get references
        this.speedSlider = document.getElementById('speedSlider');
        this.speedValueText = document.getElementById('speedValueText');
        this.fsRadios = document.querySelectorAll('input[name="samplingFrequency"]');
        this.fsLabels = document.querySelectorAll('.fs-label');
        this.adBitsSlider = document.getElementById('adBitsSlider');
        this.adBitsValueText = document.getElementById('adBitsValueText');
        this.freqSlider = document.getElementById('freqSlider');
        this.freqValueText = document.getElementById('freqValueText');
        this.noiseOrderSlider = document.getElementById('noiseOrderSlider');
        this.noiseOrderValueText = document.getElementById('noiseOrderValueText');
        this.originalCheckbox = document.getElementById('originalCheckbox');
        this.digitalCheckbox = document.getElementById('digitalCheckbox');
        this.reconstructedCheckbox = document.getElementById('reconstructedCheckbox');
        this.lpfFreqSlider = document.getElementById('lpfFreqSlider');
        this.lpfFreqValueText = document.getElementById('lpfFreqValueText');
        this.lpfOrderSlider = document.getElementById('lpfOrderSlider');
        this.lpfOrderValueText = document.getElementById('lpfOrderValueText');

        // Check if all elements were found
        const allControls = [
             this.speedSlider, this.speedValueText, this.adBitsSlider, this.adBitsValueText,
             this.freqSlider, this.freqValueText, this.noiseOrderSlider, this.noiseOrderValueText,
             this.originalCheckbox, this.digitalCheckbox, this.reconstructedCheckbox,
             this.lpfFreqSlider, this.lpfFreqValueText, this.lpfOrderSlider, this.lpfOrderValueText
        ];
         if (allControls.some(el => !el) || !this.fsRadios || this.fsRadios.length === 0 || !this.fsLabels || this.fsLabels.length === 0) {
            console.error("One or more control elements not found in the DOM!");
            // Provide more detail which elements are missing
            const missing = allControls.map((el, i) => el ? null : `Control ${i}`).filter(x => x);
            console.error("Missing controls:", missing, "FsRadios found:", this.fsRadios?.length, "FsLabels found:", this.fsLabels?.length);
            return; // Stop setup if elements are missing
        }


        // Add Event Listeners
        const setupSliderTextPair = (slider, text, isLogScale = false) => {
            const updateFromSlider = () => {
                const val = parseFloat(slider.value);
                text.value = isLogScale ? val.toFixed(1) : val;
                updateCallback();
            };
             const updateFromText = () => {
                 let val = isLogScale ? parseFloat(text.value) : parseInt(text.value);
                 const min = parseFloat(slider.min);
                 const max = parseFloat(slider.max);
                 if (isNaN(val)) val = parseFloat(slider.value); // Revert if invalid
                 val = Math.max(min, Math.min(max, val)); // Clamp to range
                 slider.value = val;
                 text.value = isLogScale ? val.toFixed(1) : val; // Update text field too after clamping
                 updateCallback();
             };
            slider.addEventListener('input', updateFromSlider);
            text.addEventListener('change', updateFromText);
            // Set initial text value
             text.value = isLogScale ? parseFloat(slider.value).toFixed(1) : slider.value;
        };

        setupSliderTextPair(this.speedSlider, this.speedValueText, true);
        setupSliderTextPair(this.adBitsSlider, this.adBitsValueText);
        setupSliderTextPair(this.freqSlider, this.freqValueText);
        setupSliderTextPair(this.noiseOrderSlider, this.noiseOrderValueText);
        setupSliderTextPair(this.lpfFreqSlider, this.lpfFreqValueText);
        setupSliderTextPair(this.lpfOrderSlider, this.lpfOrderValueText);

        this.fsRadios.forEach(radio => radio.addEventListener('change', () => updateCallback(true))); // Indicate Fs possibly changed
        // Show Waveforms checkboxes only trigger redraw, not DSP state change
        [this.originalCheckbox, this.digitalCheckbox, this.reconstructedCheckbox].forEach(cb => {
            cb.addEventListener('change', () => {
                // Schedule a redraw on next animation frame
                if (typeof App !== 'undefined') {
                    requestAnimationFrame(App.run.bind(App));
                }
            });
        });

        // Special handling for AD Bits changing FS labels
        const adBitsUpdate = () => {
             let val = parseInt(this.adBitsValueText.value);
             const min = parseInt(this.adBitsSlider.min);
             const max = parseInt(this.adBitsSlider.max);
              if (isNaN(val)) val = parseInt(this.adBitsSlider.value);
             val = Math.max(min, Math.min(max, val));
             this.adBitsSlider.value = val;
             this.adBitsValueText.value = val;
             updateCallback(true); // Pass flag indicating adBits changed for label update
        };
        this.adBitsSlider.addEventListener('input', adBitsUpdate);
         this.adBitsValueText.addEventListener('change', adBitsUpdate);
         this.adBitsValueText.value = this.adBitsSlider.value; // Initial value


        console.log("UI Controls setup complete.");
    },

    setupResizeObserver: function() {
        const resizeObserver = new ResizeObserver(entries => {
            let widthChanged = false;
            for (let entry of entries) {
                const canvas = entry.target;
                const width = Math.floor(entry.contentRect.width);
                if (canvas.width !== width && width > 0) { // Ensure width is positive
                    canvas.width = width;
                    canvas.height = 256;
                    widthChanged = true;
                }
            }
             // No longer clear the simulation buffer on resize to decouple UI resizing from data generation
             // if (widthChanged && typeof App !== 'undefined' && App.clearDisplayBuffer) {
             //     App.clearDisplayBuffer();
             // }
        });

         if (this.timeDomainCanvas && this.frequencyDomainCanvas) {
            resizeObserver.observe(this.timeDomainCanvas);
            resizeObserver.observe(this.frequencyDomainCanvas);
         }
    },

     // Helper to get current values from controls
     getControlValues: function() {
         if (!this.speedSlider) { // Check if controls are initialized
             console.warn("getControlValues called before UI init.");
             return null;
         }
         let selectedFsValue = Array.from(this.fsRadios).find(radio => radio.checked)?.value || '64'; // Default if not found
         return {
             speed: parseFloat(this.speedSlider.value),
             fsMultiplier: parseInt(selectedFsValue),
             adBits: parseInt(this.adBitsSlider.value),
             signalFreq: parseInt(this.freqSlider.value),
             noiseOrder: parseInt(this.noiseOrderSlider.value),
             showOriginal: this.originalCheckbox.checked,
             showDigital: this.digitalCheckbox.checked,
             showRecon: this.reconstructedCheckbox.checked,
             lpfCutoff: parseInt(this.lpfFreqSlider.value),
             lpfOrder: parseInt(this.lpfOrderSlider.value),
         };
     }
}; 