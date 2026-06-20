// Initialize Audio Context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContext();

        let oscillator = null;
        let gainNode = null;
        let panner = null;
        let noiseSource = null;
        let isPlaying = false;
        let oscillatorWaveform = null;
        let oscillatorHarmonicLimit = null;

        // Get Elements
        const frequencySlider = document.getElementById('frequency');
        const freqValue = document.getElementById('freqValue');
        const volumeSlider = document.getElementById('volume');
        const volValue = document.getElementById('volValue');
        const panningRadios = document.getElementsByName('panning');
        const waveformRadios = document.getElementsByName('waveform');
        const playPauseButton = document.getElementById('playPause');

        // Frequency Mapping Constants
        const minFreq = 20;
        const maxFreq = 96000;
        const bandLimitedWaveforms = new Set(['sawtooth', 'square', 'triangle']);
        const periodicWaveCache = new Map();
        const maxPeriodicWaveCacheEntries = 128;
        const nyquistGuardHz = 1;

        // Display Initial Values
        const initialFreq = getFrequency(frequencySlider.value);
        freqValue.textContent = formatFrequency(initialFreq);
        console.log(`Initial Slider Value: ${frequencySlider.value}, Frequency: ${initialFreq} Hz`);
        volValue.textContent = volumeSlider.value;

        // Function to Map Slider Value to Logarithmic Frequency
        function getFrequency(sliderValue) {
            const scale = Math.log(maxFreq / minFreq);
            const freq = minFreq * Math.exp((sliderValue / frequencySlider.max) * scale);
            return Math.round(freq); // Round to nearest integer
        }

        // Function to Format Frequency Display with Integer Values
        function formatFrequency(freq) {
            if (freq >= 1000) {
                return (freq / 1000).toFixed(2) + ' kHz';
            }
            return freq + ' Hz';
        }

        // Frequency Slider Event Listener
        frequencySlider.addEventListener('input', () => {
            const freq = getFrequency(frequencySlider.value);
            freqValue.textContent = formatFrequency(freq);
            console.log(`Slider Value: ${frequencySlider.value}, Frequency: ${freq} Hz`);
            if (oscillator) {
                oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
                updateOscillatorWaveform(getSelectedWaveform(), freq);
            }
        });

        // Volume Slider Event Listener
        volumeSlider.addEventListener('input', () => {
            volValue.textContent = volumeSlider.value;
            if (gainNode) {
                // Convert dB to Linear Gain
                const linearGain = dbToLinear(volumeSlider.value);
                gainNode.gain.setValueAtTime(linearGain, audioCtx.currentTime);
            }
        });

        // Panning Setup
        function updatePanning() {
            if (panner) {
                const selected = Array.from(panningRadios).find(radio => radio.checked).value;
                switch (selected) {
                    case 'left':
                        panner.pan.setValueAtTime(-1, audioCtx.currentTime);
                        break;
                    case 'right':
                        panner.pan.setValueAtTime(1, audioCtx.currentTime);
                        break;
                    default:
                        panner.pan.setValueAtTime(0, audioCtx.currentTime);
                }
            }
        }

        // Waveform Selection
        function getSelectedWaveform() {
            return Array.from(waveformRadios).find(radio => radio.checked).value;
        }

        // Convert dB to Linear Gain
        function dbToLinear(db) {
            return Math.pow(10, db / 20);
        }

        // Event Listeners for Panning Radio Buttons
        panningRadios.forEach(radio => {
            radio.addEventListener('change', updatePanning);
        });

        // Event Listeners for Waveform Radio Buttons
        waveformRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const selectedWaveform = getSelectedWaveform();
                if (isPlaying) {
                    stopAllSources();
                    if (selectedWaveform === 'white' || selectedWaveform === 'pink') {
                        startNoise(selectedWaveform);
                        disableFrequencySlider(true);
                    } else {
                        startOscillator(selectedWaveform);
                        disableFrequencySlider(false);
                    }
                }
            });
        });

        // Play/Pause Button Event Listener
        playPauseButton.addEventListener('click', () => {
            toggleAudio();
        });

        // Toggle Audio Playback Function
        function toggleAudio() {
            if (!isPlaying) {
                startAudio();
            } else {
                stopAudio();
            }
        }

        // Start Audio Function
        function startAudio() {
            gainNode = audioCtx.createGain();
            panner = new StereoPannerNode(audioCtx, { pan: 0 });

            // Convert dB to Linear Gain
            const linearGain = dbToLinear(volumeSlider.value);
            gainNode.gain.setValueAtTime(linearGain, audioCtx.currentTime);

            gainNode.connect(panner);
            panner.connect(audioCtx.destination);

            updatePanning();

            const selectedWaveform = getSelectedWaveform();
            if (selectedWaveform === 'white' || selectedWaveform === 'pink') {
                startNoise(selectedWaveform);
                disableFrequencySlider(true);
            } else {
                startOscillator(selectedWaveform);
                disableFrequencySlider(false);
            }

            isPlaying = true;
            playPauseButton.textContent = 'Pause';
            playPauseButton.classList.add('paused');
        }

        // Start Oscillator Function
        function startOscillator(waveform) {
            oscillator = audioCtx.createOscillator();
            const frequency = getFrequency(frequencySlider.value);
            oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
            updateOscillatorWaveform(waveform, frequency);
            oscillator.connect(gainNode);
            oscillator.start();
        }

        // Configure harmonic-limited periodic waves for shapes that otherwise
        // contain discontinuities or sharp corners above Nyquist.
        function updateOscillatorWaveform(waveform, frequency) {
            if (!oscillator) {
                return;
            }

            if (!bandLimitedWaveforms.has(waveform)) {
                if (oscillatorWaveform !== waveform) {
                    oscillator.type = waveform;
                    oscillatorWaveform = waveform;
                    oscillatorHarmonicLimit = null;
                }
                return;
            }

            const harmonicLimit = getHarmonicLimit(frequency);
            if (harmonicLimit === 0) {
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(0, audioCtx.currentTime);
                oscillatorWaveform = waveform;
                oscillatorHarmonicLimit = harmonicLimit;
                return;
            }

            if (oscillatorWaveform === waveform && oscillatorHarmonicLimit === harmonicLimit) {
                return;
            }

            oscillator.setPeriodicWave(getBandLimitedPeriodicWave(waveform, harmonicLimit));
            oscillatorWaveform = waveform;
            oscillatorHarmonicLimit = harmonicLimit;
        }

        function getHarmonicLimit(frequency) {
            const usableNyquist = Math.max(0, audioCtx.sampleRate / 2 - nyquistGuardHz);
            if (frequency <= 0 || frequency > usableNyquist) {
                return 0;
            }
            return Math.floor(usableNyquist / frequency);
        }

        function getBandLimitedPeriodicWave(waveform, harmonicLimit) {
            const cacheKey = `${waveform}:${audioCtx.sampleRate}:${harmonicLimit}`;
            const cached = periodicWaveCache.get(cacheKey);
            if (cached) {
                return cached;
            }

            const coefficientLength = Math.max(2, harmonicLimit + 1);
            const real = new Float32Array(coefficientLength);
            const imag = new Float32Array(coefficientLength);

            for (let harmonic = 1; harmonic <= harmonicLimit; harmonic++) {
                if (waveform === 'square' && harmonic % 2 === 0) {
                    continue;
                }
                if (waveform === 'triangle' && harmonic % 2 === 0) {
                    continue;
                }

                imag[harmonic] = getBandLimitedCoefficient(waveform, harmonic);
            }

            const periodicWave = audioCtx.createPeriodicWave(real, imag);
            periodicWaveCache.set(cacheKey, periodicWave);
            trimPeriodicWaveCache();
            return periodicWave;
        }

        function getBandLimitedCoefficient(waveform, harmonic) {
            switch (waveform) {
                case 'sawtooth':
                    return (2 / Math.PI) * (harmonic % 2 === 0 ? -1 : 1) / harmonic;
                case 'square':
                    return 4 / (Math.PI * harmonic);
                case 'triangle': {
                    const oddIndex = (harmonic - 1) / 2;
                    const sign = oddIndex % 2 === 0 ? 1 : -1;
                    return sign * 8 / (Math.PI * Math.PI * harmonic * harmonic);
                }
                default:
                    return 0;
            }
        }

        function trimPeriodicWaveCache() {
            while (periodicWaveCache.size > maxPeriodicWaveCacheEntries) {
                const oldestKey = periodicWaveCache.keys().next().value;
                periodicWaveCache.delete(oldestKey);
            }
        }

        // Stop Audio Function
        function stopAudio() {
            stopAllSources();
            if (gainNode) {
                gainNode.disconnect();
                gainNode = null;
            }
            if (panner) {
                panner.disconnect();
                panner = null;
            }
            isPlaying = false;
            playPauseButton.textContent = 'Play';
            playPauseButton.classList.remove('paused');
        }

        // Start Noise Function
        function startNoise(type) {
            // Ensure no other noise source is active
            stopNoise();

            const bufferSize = audioCtx.sampleRate * 2; // 2 seconds buffer
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const output = buffer.getChannelData(0);

            if (type === 'white') {
                for (let i = 0; i < bufferSize; i++) {
                    output[i] = Math.random() * 2 - 1;
                }
            } else if (type === 'pink') {
                // Improved Pink Noise Generator using Voss-McCartney Algorithm
                const numRows = 16;
                const rows = new Array(numRows).fill(0).map(() => Math.random());
                let runningSum = rows.reduce((a, b) => a + b, 0);

                for (let i = 0; i < bufferSize; i++) {
                    const row = Math.floor(Math.random() * numRows);
                    runningSum -= rows[row];
                    rows[row] = Math.random();
                    runningSum += rows[row];
                    output[i] = runningSum / numRows; // Removed Math.round to prevent clipping
                }
            }

            // Normalize the pink noise to prevent clipping
            normalizeBuffer(output);

            noiseSource = audioCtx.createBufferSource();
            noiseSource.buffer = buffer;
            noiseSource.loop = true;
            noiseSource.connect(gainNode);
            noiseSource.start();
        }

        // Normalize Buffer to prevent clipping
        function normalizeBuffer(buffer) {
            let max = 0;
            for (let i = 0; i < buffer.length; i++) {
                if (Math.abs(buffer[i]) > max) {
                    max = Math.abs(buffer[i]);
                }
            }
            if (max > 0) {
                for (let i = 0; i < buffer.length; i++) {
                    buffer[i] /= max;
                }
            }
        }

        // Stop Noise Function
        function stopNoise() {
            if (noiseSource) {
                noiseSource.stop();
                noiseSource.disconnect();
                noiseSource = null;
            }
        }

        // Stop Oscillator Function
        function stopOscillator() {
            if (oscillator) {
                oscillator.stop();
                oscillator.disconnect();
                oscillator = null;
                oscillatorWaveform = null;
                oscillatorHarmonicLimit = null;
            }
        }

        // Stop All Active Sources Function
        function stopAllSources() {
            stopOscillator();
            stopNoise();
        }

        // Disable or Enable Frequency Slider
        function disableFrequencySlider(disable) {
            frequencySlider.disabled = disable;
            frequencySlider.parentElement.style.opacity = disable ? '0.5' : '1';
        }

        // Handle SPACE Key for Play/Pause
        window.addEventListener('keydown', (event) => {
            if (event.code === 'Space') {
                event.preventDefault(); // Prevent default spacebar scrolling
                toggleAudio();
            }
        });

        // Cleanup Audio on Page Unload
        window.addEventListener('beforeunload', () => {
            stopAudio();
        });

        // Initial Setup: Ensure frequency slider is enabled
        disableFrequencySlider(false);
