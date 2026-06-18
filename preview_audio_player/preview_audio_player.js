// Unique ID generator
        let uniqueIdCounter = 0;
        function generateUniqueId() {
            return 'track-' + uniqueIdCounter++;
        }

        // Track constructor
        class Track {
            constructor(uri = '', start = 0, length = 0, memo = '', id = generateUniqueId()) {
                this.uri = uri;
                this.start = start; // in ms
                this.length = length; // in ms
                this.memo = memo;
                this.id = id;
                this.audio = new Audio();
                this.audio.preload = 'metadata';
                this.audio.src = this.uri;
                this.audio.addEventListener('loadedmetadata', () => {
                    this.length = this.audio.duration * 1000;
                    if (this.start > this.length) this.start = 0;
                    updateURL();
                    renderPlaylist();
                });
                this.audio.addEventListener('ended', () => {
                    // Ensure only the current playing track is stopped
                    if (currentPlayingId === this.id) {
                        stopCurrentTrack();
                    }
                });
            }
        }

        // Playlist array
        let playlist = [];

        // Currently playing track ID
        let currentPlayingId = null;
        let lastPlayedId = null;

        // Initialize playlist from URL or start with one track
        function initializePlaylist() {
            const params = new URLSearchParams(window.location.search);
            const playlistParam = params.get('playlist');
            if (playlistParam) {
                try {
                    const decoded = decodeURIComponent(playlistParam);
                    const loadedPlaylist = JSON.parse(decoded);
                    playlist = loadedPlaylist.map(t => new Track(t.uri, t.start, t.length, t.memo, t.id));
                    
                    // Determine the highest existing ID number
                    let maxId = -1;
                    loadedPlaylist.forEach(t => {
                        const idParts = t.id.split('-');
                        if (idParts.length === 2) {
                            const num = parseInt(idParts[1]);
                            if (!isNaN(num) && num > maxId) {
                                maxId = num;
                            }
                        }
                    });
                    uniqueIdCounter = maxId + 1;
                } catch (e) {
                    console.error('Failed to parse playlist from URL. Starting with one empty track.');
                    playlist.push(new Track());
                }
            } else {
                playlist.push(new Track());
            }
        }

        // Render the playlist UI
        function renderPlaylist() {
            const playlistDiv = document.getElementById('playlist');
            playlistDiv.innerHTML = '';
            playlist.forEach((track, index) => {
                const trackDiv = document.createElement('div');
                trackDiv.className = 'track';
                if (track.id === currentPlayingId) {
                    trackDiv.classList.add('playing');
                }

                // Index
                const indexDiv = document.createElement('div');
                indexDiv.className = 'track-index';
                indexDiv.textContent = index + 1;
                trackDiv.appendChild(indexDiv);

                // Play/Stop Toggle Button
                const toggleButton = document.createElement('button');
                toggleButton.className = 'toggle-button';
                if (track.id === currentPlayingId) {
                    toggleButton.textContent = 'Stop';
                    toggleButton.classList.add('paused');
                } else {
                    toggleButton.textContent = 'Play';
                }
                toggleButton.addEventListener('click', () => togglePlayTrack(track.id));
                trackDiv.appendChild(toggleButton);

                // Track Details Container (URI and Memo)
                const trackDetailsContainer = document.createElement('div');
                trackDetailsContainer.className = 'track-details-container';

                // URI and Memo Container
                const uriMemoContainer = document.createElement('div');
                uriMemoContainer.className = 'uri-memo-container';

                // URI Container
                const uriContainer = document.createElement('div');
                uriContainer.className = 'uri-container';
                const uriInput = document.createElement('input');
                uriInput.type = 'text';
                uriInput.value = track.uri;
                uriInput.placeholder = 'Enter URI';
                uriInput.addEventListener('change', (e) => {
                    track.uri = e.target.value;
                    track.audio.src = track.uri;
                    // Reset start and length
                    track.start = 0;
                    track.length = 0;
                });
                uriContainer.appendChild(uriInput);
                uriMemoContainer.appendChild(uriContainer);

                // Memo Container
                const memoContainer = document.createElement('div');
                memoContainer.className = 'memo-container';
                const memoInput = document.createElement('input');
                memoInput.type = 'text';
                memoInput.value = track.memo;
                memoInput.placeholder = 'Enter Memo';
                memoInput.addEventListener('change', (e) => {
                    track.memo = e.target.value;
                    updateURL();
                });
                memoContainer.appendChild(memoInput);
                uriMemoContainer.appendChild(memoContainer);

                trackDetailsContainer.appendChild(uriMemoContainer);

                // Start Slider and Display Container
                const startSliderContainer = document.createElement('div');
                startSliderContainer.className = 'start-slider-container';
                const startSlider = document.createElement('input');
                startSlider.type = 'range';
                startSlider.min = 0;
                startSlider.max = track.length;
                startSlider.value = track.start;
                startSlider.addEventListener('input', (e) => {
                    track.start = parseInt(e.target.value);
                    startPosDisplay.textContent = formatTime(track.start);
                    if (track.id === currentPlayingId) {
                        track.audio.currentTime = track.start / 1000;
                    }
                    updateURL();
                });
                startSlider.addEventListener('change', (e) => {
                    // Ensure slider max is updated if track length changes
                    startSlider.max = track.length;
                });
                startSliderContainer.appendChild(startSlider);

                const startPosDisplay = document.createElement('div');
                startPosDisplay.className = 'start-position-display';
                startPosDisplay.textContent = formatTime(track.start);
                startSliderContainer.appendChild(startPosDisplay);

                trackDetailsContainer.appendChild(startSliderContainer);
                trackDiv.appendChild(trackDetailsContainer);

                // Move Up Button
                const moveUpButton = document.createElement('button');
                moveUpButton.textContent = '▲';
                moveUpButton.className = 'move-up';
                moveUpButton.title = 'Move Up';
                moveUpButton.addEventListener('click', () => moveTrackUp(index));
                trackDiv.appendChild(moveUpButton);

                // Move Down Button
                const moveDownButton = document.createElement('button');
                moveDownButton.textContent = '▼';
                moveDownButton.className = 'move-down';
                moveDownButton.title = 'Move Down';
                moveDownButton.addEventListener('click', () => moveTrackDown(index));
                trackDiv.appendChild(moveDownButton);

                // Delete Button
                const deleteButton = document.createElement('button');
                deleteButton.textContent = '✖';
                deleteButton.className = 'delete-button';
                deleteButton.title = 'Delete Track';
                deleteButton.addEventListener('click', () => deleteTrack(index));
                trackDiv.appendChild(deleteButton);

                playlistDiv.appendChild(trackDiv);
            });
            updateURL();
        }

        // Format milliseconds to 00:00.000
        function formatTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            const milliseconds = ms % 1000;
            return `${pad(minutes)}:${pad(seconds)}.${padMillis(milliseconds)}`;
        }

        function pad(num) {
            return num.toString().padStart(2, '0');
        }

        function padMillis(num) {
            return num.toString().padStart(3, '0');
        }

        // Add a new track
        function addTrack() {
            playlist.push(new Track());
            renderPlaylist();
        }

        // Delete a track
        function deleteTrack(index) {
            if (playlist[index].id === currentPlayingId) {
                stopCurrentTrack();
            }
            playlist.splice(index, 1);
            renderPlaylist();
        }

        // Move track up
        function moveTrackUp(index) {
            if (index > 0) {
                [playlist[index - 1], playlist[index]] = [playlist[index], playlist[index - 1]];
                renderPlaylist();
            }
        }

        // Move track down
        function moveTrackDown(index) {
            if (index < playlist.length - 1) {
                [playlist[index + 1], playlist[index]] = [playlist[index], playlist[index + 1]];
                renderPlaylist();
            }
        }

        // Toggle Play/Stop a track by ID
        function togglePlayTrack(id) {
            if (currentPlayingId === id) {
                stopCurrentTrack();
            } else {
                playTrack(id);
            }
        }

        // Play a track by ID
        function playTrack(id) {
            stopCurrentTrack();
            const track = playlist.find(t => t.id === id);
            if (track) {
                track.audio.currentTime = track.start / 1000;
                track.audio.play();
                currentPlayingId = id;
                lastPlayedId = id;
                renderPlaylist();
            }
        }

        // Stop a track by ID
        function stopTrack(id) {
            const track = playlist.find(t => t.id === id);
            if (track && currentPlayingId === id) {
                track.audio.pause();
                currentPlayingId = null;
                renderPlaylist();
            }
        }

        // Stop the currently playing track
        function stopCurrentTrack() {
            if (currentPlayingId) {
                const currentTrack = playlist.find(t => t.id === currentPlayingId);
                if (currentTrack) {
                    currentTrack.audio.pause();
                }
                currentPlayingId = null;
                renderPlaylist();
            }
        }

        // Handle space key
        function handleSpaceKey(e) {
            // Allow space key to function even if an input is focused, except when focus is on URI or Memo textbox
            if (document.activeElement.tagName.toLowerCase() === 'input' && (document.activeElement.type === 'text')) {
                return;
            }
            e.preventDefault();
            if (currentPlayingId) {
                stopCurrentTrack();
            } else {
                let trackToPlay = null;
                if (lastPlayedId) {
                    const lastTrack = playlist.find(t => t.id === lastPlayedId);
                    if (lastTrack) {
                        trackToPlay = lastTrack;
                    }
                }
                if (!trackToPlay && playlist.length > 0) {
                    trackToPlay = playlist[0];
                }
                if (trackToPlay) {
                    playTrack(trackToPlay.id);
                }
            }
        }

        // Handle number keys for playing tracks 1-10
        function handleNumberKey(e) {
            if (!/^\d$/.test(e.key)) return;
            const num = parseInt(e.key);
            if (!isNaN(num) && num >= 0 && num <= 9) {
                e.preventDefault();
                const index = num === 0 ? 9 : num - 1;
                if (index < playlist.length) {
                    playTrack(playlist[index].id);
                }
            }
        }

        // Update URL with current playlist
        function updateURL() {
            const params = new URLSearchParams();
            params.set('playlist', encodeURIComponent(JSON.stringify(playlist.map(t => ({
                uri: t.uri,
                start: t.start,
                length: t.length,
                memo: t.memo,
                id: t.id
            })))));
            const newUrl = `${window.location.pathname}?${params.toString()}`;
            window.history.replaceState({}, '', newUrl);
        }

        // Load playlist on page load
        window.addEventListener('load', () => {
            initializePlaylist();
            renderPlaylist();
        });

        // Add Track button event
        document.getElementById('addTrackButton').addEventListener('click', addTrack);

        // Keyboard events
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                handleSpaceKey(e);
            } else if (/^\d$/.test(e.key)) {
                handleNumberKey(e);
            }
        });
