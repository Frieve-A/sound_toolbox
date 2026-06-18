// Initialize Audio Context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContext();

        let oscillator = null;
        let gainNode = null;
        let panner = null;
        let noiseSource = null;
        let isPlaying = false;

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
            oscillator.type = waveform;
            oscillator.frequency.setValueAtTime(getFrequency(frequencySlider.value), audioCtx.currentTime);
            oscillator.connect(gainNode);
            oscillator.start();
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
