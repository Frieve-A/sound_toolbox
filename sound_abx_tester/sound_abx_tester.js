// Helper: encode/decode

const soundABXConfig = window.soundABXConfig || {};
const soundABXText = {
  sampleRate: sampleRate => `Audio device sample rate: ${sampleRate} Hz`,
  dropAudioFile: "Please drop an audio file.",
  invalidConfig: "Invalid configuration. Please check your inputs.",
  progress: (current, total) => `Test ${current} / ${total}`,
  abprefListening: btn => "You are currently listening to " + btn,
  abxListening: btn => "You are currently listening to " + btn,
  audioPlaybackError: "Error playing audio",
  anonymous: "Anonymous",
  abprefResultTitle: (name, percent) => `${name} scored ${percent}% on A/B Preference Test!`,
  abxResultTitle: (name, percent) => `${name} scored ${percent}% on ABX Test!`,
  correctAnswers: (correct, total) => `Correct answers: ${correct} / ${total}`,
  totalTime: (minutes, seconds) => `Total time to complete the test: ${minutes}:${seconds.toString().padStart(2, "0")}`,
  significantPValue: pValue => `p-value = ${pValue.toFixed(4)} (p < 0.05) → Significant difference`,
  significantConclusion: name => `We can say that ${name} was able to discern the difference.`,
  notSignificantPValue: pValue => `p-value = ${pValue.toFixed(4)} (p > 0.05) → No significant difference`,
  notSignificantConclusion: name => `We cannot say that ${name} was able to discern the difference.`,
  copySuccess: "The result has been copied to your clipboard!",
  copyFailure: "Failed to copy result.",
  ...(soundABXConfig.text || {})
};

function toBase64(str) {
  return btoa(
    encodeURIComponent(str).replace(
      /%([0-9A-F]{2})/g,
      (m, p) => String.fromCharCode(parseInt(p, 16))
    )
  );
}

function fromBase64(str) {
  return decodeURIComponent(
    Array.prototype.map.call(atob(str), c =>
      "%" + c.charCodeAt(0).toString(16).padStart(2, "0")
    ).join("")
  );
}

// Audio
let currentlyPlayingButtonId = null;

// Audio
let audioContext = null;
let audioSource = null;

// Local variable for name typed in the config
let localName = "";

// Only store name in context after finishing the test
let context = {
  name: "", // remains empty until finishTest
  uriHigh: "",
  uriLow: "",
  testCount: 20,
  testType: "",
  correctCount: 0,
  totalCount: 0,
  startTime: 0,
  endTime: 0,
  timeSpent: 0,
  restoredFromURI: false
};

function initAudioContext() {
  // AudioContextがなければ初期化
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Display sample rate
    const sampleRateText = soundABXText.sampleRate(audioContext.sampleRate);
    const abprefSampleRate = document.getElementById("abprefSampleRate");
    const abxSampleRate = document.getElementById("abxSampleRate");
    
    if (abprefSampleRate) {
      abprefSampleRate.textContent = sampleRateText;
    }
    
    if (abxSampleRate) {
      abxSampleRate.textContent = sampleRateText;
    }
  }
}

function stopAudio() {
  // Stop audio source if exists
  if (audioSource) {
    audioSource.stop();
    audioSource = null;
  }
  currentlyPlayingButtonId = null;
}

function updateProgressBar(barId, current, total) {
  const percent = (current / total) * 100;
  const bar = document.getElementById(barId);
  if (bar) bar.style.width = percent + "%";
}

function showScreen(id) {
  const screens = ["config-screen", "abpref-screen", "abx-screen"];
  for (let s of screens) {
    document.getElementById(s).classList.add("hidden");
  }
  document.getElementById(id).classList.remove("hidden");
}

// Config references
const userNameInput = document.getElementById("userName");
const uriHighInput = document.getElementById("uriHigh");
const uriLowInput = document.getElementById("uriLow");
const testCountInput = document.getElementById("testCountInput");
const testCountRange = document.getElementById("testCountRange");
const configError = document.getElementById("configError");
const testResultArea = document.getElementById("testResultArea");
const browseHighBtn = document.getElementById("browseHigh");
const browseLowBtn = document.getElementById("browseLow");
const fileHighInput = document.getElementById("fileHigh");
const fileLowInput = document.getElementById("fileLow");

// Store blob URLs to revoke them when needed
let blobUrlHigh = null;
let blobUrlLow = null;

// File selection handlers
browseHighBtn.addEventListener("click", () => {
  fileHighInput.click();
});

browseLowBtn.addEventListener("click", () => {
  fileLowInput.click();
});

fileHighInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    handleFileSelect(file, uriHighInput, "high");
  }
});

fileLowInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    handleFileSelect(file, uriLowInput, "low");
  }
});

function handleFileSelect(file, inputElement, type) {
  // Revoke previous blob URL if exists
  if (type === "high" && blobUrlHigh) {
    URL.revokeObjectURL(blobUrlHigh);
    blobUrlHigh = null;
  } else if (type === "low" && blobUrlLow) {
    URL.revokeObjectURL(blobUrlLow);
    blobUrlLow = null;
  }

  // Create new blob URL
  const blobUrl = URL.createObjectURL(file);
  if (type === "high") {
    blobUrlHigh = blobUrl;
  } else {
    blobUrlLow = blobUrl;
  }

  inputElement.value = blobUrl;
  handleConfigChange();
}

// Drag and drop handlers
function setupDragAndDrop(inputElement, fileInput, type) {
  inputElement.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputElement.classList.add("drag-over");
  });

  inputElement.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputElement.classList.remove("drag-over");
  });

  inputElement.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputElement.classList.remove("drag-over");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("audio/")) {
        handleFileSelect(file, inputElement, type);
      } else {
        configError.textContent = soundABXText.dropAudioFile;
        configError.classList.remove("hidden");
        setTimeout(() => {
          configError.classList.add("hidden");
        }, 3000);
      }
    }
  });
}

setupDragAndDrop(uriHighInput, fileHighInput, "high");
setupDragAndDrop(uriLowInput, fileLowInput, "low");

function hideResultAreaForConfigChange() {
  if (!testResultArea.classList.contains("hidden")) {
    testResultArea.classList.add("hidden");
    if (soundABXConfig.resetResultsOnConfigChange) {
      resetResults(); // Preserve the existing English-page behavior.
    }
  }
}

userNameInput.addEventListener("input", () => {
  localName = userNameInput.value; // store typed name locally only
  // Do not put name into context => context.name = "";
  hideResultAreaForConfigChange();
  updateURI(); // updates URI without name or results
});

uriHighInput.addEventListener("input", handleConfigChange);
uriLowInput.addEventListener("input", handleConfigChange);

testCountInput.addEventListener("input", () => {
  testCountRange.value = testCountInput.value;
  handleConfigChange();
});
testCountRange.addEventListener("input", () => {
  testCountInput.value = testCountRange.value;
  handleConfigChange();
});

function handleConfigChange() {
  // localName does not go in context yet
  context.uriHigh = uriHighInput.value.trim();
  context.uriLow = uriLowInput.value.trim();
  context.testCount = parseInt(testCountInput.value, 10) || 1;

  hideResultAreaForConfigChange();
  updateURI(); // updates URI without name or results
}

document.getElementById("startABPrefBtn").addEventListener("click", () => {
  startTest("ABPREF");
});
document.getElementById("startABXBtn").addEventListener("click", () => {
  startTest("ABX");
});

function startTest(type) {
  const h = uriHighInput.value.trim();
  const l = uriLowInput.value.trim();
  const tc = parseInt(testCountInput.value, 10);

  configError.classList.add("hidden");
  configError.textContent = "";

  if (!h || !l || isNaN(tc) || tc < 1) {
    configError.textContent = soundABXText.invalidConfig;
    configError.classList.remove("hidden");
    return;
  }

  // name is not stored in context yet. localName may have changed.
  context.name = "";
  context.uriHigh = h;
  context.uriLow = l;
  context.testCount = tc;
  context.testType = type;
  context.correctCount = 0;
  context.totalCount = 0;
  context.startTime = Date.now();
  context.endTime = 0;
  context.timeSpent = 0;
  context.restoredFromURI = false;

  updateURI();

  if (type === "ABPREF") {
    showScreen("abpref-screen");
    updateABPrefUI();
  } else {
    showScreen("abx-screen");
    updateABXUI();
  }
}

// A/B Preference
let abprefCurrentHigherIsA = false;
const abprefListA = document.getElementById("abprefListA");
const abprefListB = document.getElementById("abprefListB");
const abprefVoteA = document.getElementById("abprefVoteA");
const abprefVoteB = document.getElementById("abprefVoteB");
const abprefCurrentlyListening = document.getElementById("abprefCurrentlyListening");

function updateABPrefUI() {
  if (context.totalCount >= context.testCount) {
    finishTest();
    return;
  }
  const current = context.totalCount + 1;
  document.getElementById("abprefProgress").textContent =
    soundABXText.progress(current, context.testCount);
  updateProgressBar("abprefProgressBar", context.totalCount, context.testCount);
  abprefCurrentlyListening.textContent = "";
  currentlyPlayingButtonId = null;
  abprefCurrentHigherIsA = Math.random() < 0.5;
}

abprefListA.addEventListener("click", () => {
  handleABPrefPlayStop("A");
});
abprefListB.addEventListener("click", () => {
  handleABPrefPlayStop("B");
});

function handleABPrefPlayStop(btn) {
  if (currentlyPlayingButtonId === btn) {
    stopAudio();
    abprefCurrentlyListening.textContent = "";
    currentlyPlayingButtonId = null;
  } else {
    stopAudio();
    initAudioContext();
    
    const fileUrl = btn === "A" 
      ? (abprefCurrentHigherIsA ? context.uriHigh : context.uriLow)
      : (abprefCurrentHigherIsA ? context.uriLow : context.uriHigh);
    
    fetch(fileUrl)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        audioSource = audioContext.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.connect(audioContext.destination);
        audioSource.start();
        abprefCurrentlyListening.textContent = soundABXText.abprefListening(btn);
        currentlyPlayingButtonId = btn;
      })
      .catch(e => {
        console.error('Error loading audio file:', e);
        abprefCurrentlyListening.textContent = soundABXText.audioPlaybackError;
      });
  }
}

abprefVoteA.addEventListener("click", () => {
  const correct = abprefCurrentHigherIsA;
  context.correctCount += correct ? 1 : 0;
  context.totalCount++;
  stopAudio();
  updateABPrefUI();
});
abprefVoteB.addEventListener("click", () => {
  const correct = !abprefCurrentHigherIsA;
  context.correctCount += correct ? 1 : 0;
  context.totalCount++;
  stopAudio();
  updateABPrefUI();
});

// ABX
let abxAIsHigh = false;
let abxXisA = false;

const abxListA = document.getElementById("abxListA");
const abxListB = document.getElementById("abxListB");
const abxListX = document.getElementById("abxListX");
const abxVoteA = document.getElementById("abxVoteA");
const abxVoteB = document.getElementById("abxVoteB");
const abxCurrentlyListening = document.getElementById("abxCurrentlyListening");

function updateABXUI() {
  if (context.totalCount >= context.testCount) {
    finishTest();
    return;
  }
  const current = context.totalCount + 1;
  document.getElementById("abxProgress").textContent =
    soundABXText.progress(current, context.testCount);
  updateProgressBar("abxProgressBar", context.totalCount, context.testCount);
  abxCurrentlyListening.textContent = "";
  currentlyPlayingButtonId = null;
  abxAIsHigh = Math.random() < 0.5;
  abxXisA = Math.random() < 0.5;
  
  // Initialize audio context if needed to display sample rate
  if (!audioContext) {
    initAudioContext();
  }
}

abxListA.addEventListener("click", () => {
  handleABXPlayStop("A");
});
abxListB.addEventListener("click", () => {
  handleABXPlayStop("B");
});
abxListX.addEventListener("click", () => {
  handleABXPlayStop("X");
});

abxVoteA.addEventListener("click", () => {
  const correct = abxXisA;
  context.correctCount += correct ? 1 : 0;
  context.totalCount++;
  stopAudio();
  updateABXUI();
});
abxVoteB.addEventListener("click", () => {
  const correct = !abxXisA;
  context.correctCount += correct ? 1 : 0;
  context.totalCount++;
  stopAudio();
  updateABXUI();
});

function handleABXPlayStop(btn) {
  if (currentlyPlayingButtonId === btn) {
    stopAudio();
    abxCurrentlyListening.textContent = "";
    currentlyPlayingButtonId = null;
  } else {
    stopAudio();
    initAudioContext();
    
    let fileUrl;
    if (btn === "A") {
      fileUrl = abxAIsHigh ? context.uriHigh : context.uriLow;
      abxCurrentlyListening.textContent = soundABXText.abxListening("A");
    } else if (btn === "B") {
      fileUrl = abxAIsHigh ? context.uriLow : context.uriHigh;
      abxCurrentlyListening.textContent = soundABXText.abxListening("B");
    } else {
      if (abxXisA) {
        fileUrl = abxAIsHigh ? context.uriHigh : context.uriLow;
      } else {
        fileUrl = abxAIsHigh ? context.uriLow : context.uriHigh;
      }
      abxCurrentlyListening.textContent = soundABXText.abxListening("X");
    }
    
    fetch(fileUrl)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        audioSource = audioContext.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.connect(audioContext.destination);
        audioSource.start();
        currentlyPlayingButtonId = btn;
      })
      .catch(e => {
        console.error('Error loading audio file:', e);
        abxCurrentlyListening.textContent = soundABXText.audioPlaybackError;
      });
  }
}

function finishTest() {
  context.endTime = Date.now();
  context.timeSpent = context.endTime - context.startTime;
  stopAudio();

  // Now we copy localName into context.name for the final results + URI
  context.name = localName || soundABXText.anonymous;

  showScreen("config-screen");
  displayResult();
}

function displayResult() {
  const testResultArea = document.getElementById("testResultArea");
  testResultArea.classList.remove("hidden");

  const title = document.getElementById("testResultTitle");
  const ans = document.getElementById("testResultAnswers");
  const ttime = document.getElementById("testResultTime");
  const pv = document.getElementById("testResultPvalue");
  const conc = document.getElementById("testResultConclusion");
  const shareBtn = document.getElementById("shareResultsBtn");
  const shareExp = document.getElementById("shareExplanation");

  const percent = context.totalCount === 0
    ? 0
    : ((context.correctCount / context.totalCount) * 100).toFixed(2);

  if (context.testType === "ABPREF") {
    title.textContent = soundABXText.abprefResultTitle(context.name, percent);
  } else {
    title.textContent = soundABXText.abxResultTitle(context.name, percent);
  }

  ans.textContent = soundABXText.correctAnswers(context.correctCount, context.totalCount);

  const ms = context.timeSpent;
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 1000 / 60);
  ttime.textContent = soundABXText.totalTime(m, s);

  const pVal = computeBinomialPvalue(context.correctCount, context.totalCount);
  if (pVal < 0.05) {
    pv.textContent = soundABXText.significantPValue(pVal);
    conc.textContent = soundABXText.significantConclusion(context.name);
  } else {
    pv.textContent = soundABXText.notSignificantPValue(pVal);
    conc.textContent = soundABXText.notSignificantConclusion(context.name);
  }

  updateURI(); // Now the URI includes name

  if (context.restoredFromURI) {
    shareBtn.classList.add("hidden");
    shareExp.classList.add("hidden");
  } else {
    shareBtn.classList.remove("hidden");
    shareExp.classList.remove("hidden");
  }
}

// Binomial stats
function computeBinomialPvalue(k, n) {
  if (n === 0) return 1;
  let p = 0;
  for (let i = k; i <= n; i++) {
    p += binomialCoeff(n, i) * Math.pow(0.5, n);
  }
  return p;
}

let factorialCache = {};
function factorial(x) {
  if (factorialCache[x]) return factorialCache[x];
  if (x < 2) {
    factorialCache[x] = 1;
    return 1;
  }
  let r = 1;
  for (let i = 2; i <= x; i++) {
    r *= i;
  }
  factorialCache[x] = r;
  return r;
}

function binomialCoeff(n, k) {
  return factorial(n) / (factorial(k) * factorial(n - k));
}

function updateURI() {
  // Name is not in context unless test is finished
  const data = {
    n: context.name,
    uH: context.uriHigh,
    uL: context.uriLow,
    tT: context.testType,
    cC: context.correctCount,
    tC: context.totalCount,
    tc: context.testCount,
    ts: context.timeSpent
  };
  const json = JSON.stringify(data);
  let b64 = toBase64(json);
  b64 = b64.replaceAll("=", "-").replaceAll("/", "_").replaceAll("+", ".");
  const base = window.location.origin + window.location.pathname;
  const newUrl = `${base}?data=${b64}`;
  window.history.replaceState({}, "", newUrl);
}

// Restore from URI
(function initFromURI() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("data");
  if (!encoded) return;

  try {
    const replaced = encoded
      .replaceAll("-", "=")
      .replaceAll("_", "/")
      .replaceAll(".", "+");
    const decodedStr = fromBase64(replaced);
    const obj = JSON.parse(decodedStr);

    // We do NOT fill userNameInput => always blank
    // If test is completed, we can show the name in results
    // If partial test, we ignore the stored name
    context.name = obj.n || "";
    context.uriHigh = obj.uH || "";
    context.uriLow = obj.uL || "";
    context.testType = obj.tT || "";
    context.correctCount = obj.cC || 0;
    context.totalCount = obj.tC || 0;
    context.testCount = obj.tc || 20;
    context.timeSpent = obj.ts || 0;
    context.restoredFromURI = true;

    uriHighInput.value = context.uriHigh;
    uriLowInput.value = context.uriLow;
    testCountInput.value = context.testCount;
    testCountRange.value =
      context.testCount >= 5 && context.testCount <= 50
        ? context.testCount
        : 20;

    // userNameInput always blank
    userNameInput.value = "";

    // If the test was completed, we show results
    if (context.totalCount > 0 && context.totalCount === context.testCount) {
      displayResult();
    }
  } catch (e) {
    // do nothing on decode error
  }
})();

// Share
document.getElementById("shareResultsBtn").addEventListener("click", () => {
  const url = window.location.href;
  const title = document.getElementById("testResultTitle");
  navigator.clipboard.writeText(title.textContent + "\n(On Frieve Sound #ABXTester)\n" + url).then(() => {
    alert(soundABXText.copySuccess);
  }).catch(() => {
    alert(soundABXText.copyFailure);
  });
});
