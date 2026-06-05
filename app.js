// --- Constants & Config ---
const STOMP_NAMES = {
    0: "左輕",
    1: "左重",
    2: "右輕",
    3: "右重"
};

// --- Timer State variables ---
let stompActive = false;
let stompPaused = false;
let stompActiveIndex = 0;
let stompSecondsLeft = 10.0;
let stompFocusedIndices = new Set();
let stompMuted = false;

// Audio Configuration (Volume & Speed)
let stompVolume = 1.0;
let stompRate = 1.2;
let preferredVoiceName = null;

// Alarm triggers tracking
let stompSaidWarning = false;
let stompSaidReady = false;

// TTS & Audio variables
let beepAudio = null;
let countdownAudio = null;
let transitionAudio = null;
let voicesList = [];
let selectedVoice = null;

// Timing loop variables
let timerInterval = null;
let lastTickTime = Date.now();

// --- DOM Elements ---
const btnSync = document.getElementById("btn-sync");
const btnPlayPause = document.getElementById("btn-play-pause");
const btnShift = document.getElementById("btn-shift");
const btnMute = document.getElementById("btn-mute");
const btnReset = document.getElementById("btn-reset");
const timerDisplay = document.getElementById("timer-display");
const modeDisplay = document.getElementById("mode-display");
const statusBar = document.getElementById("status-bar");
const voiceSelect = document.getElementById("voice-select");
const volumeSlider = document.getElementById("volume-slider");
const volumeVal = document.getElementById("volume-val");
const rateSlider = document.getElementById("rate-slider");
const rateVal = document.getElementById("rate-val");

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    updateUIState();
    setupEventListeners();
    initVoices();
    
    // Start interval
    lastTickTime = Date.now();
    timerInterval = setInterval(tick, 10);
});

// Generates a short WAV file dynamically in memory and returns a local object URL
function createBeepWavUrl(frequency = 1000, duration = 0.08) {
    const sampleRate = 44100;
    const numSamples = sampleRate * duration;
    const bufferSize = 44 + numSamples;
    const buffer = new Uint8Array(bufferSize);

    // 1. WAV Header (RIFF)
    buffer[0] = 0x52; // 'R'
    buffer[1] = 0x49; // 'I'
    buffer[2] = 0x46; // 'F'
    buffer[3] = 0x46; // 'F'
    
    const fileSize = bufferSize - 8;
    buffer[4] = fileSize & 0xff;
    buffer[5] = (fileSize >> 8) & 0xff;
    buffer[6] = (fileSize >> 16) & 0xff;
    buffer[7] = (fileSize >> 24) & 0xff;

    buffer[8] = 0x57;  // 'W'
    buffer[9] = 0x41;  // 'A'
    buffer[10] = 0x56; // 'V'
    buffer[11] = 0x45; // 'E'

    // 2. fmt Subchunk
    buffer[12] = 0x66; // 'f'
    buffer[13] = 0x6d; // 'm'
    buffer[14] = 0x74; // 't'
    buffer[15] = 0x20; // ' '

    buffer[16] = 16;   // Subchunk1Size
    buffer[17] = 0;
    buffer[18] = 0;
    buffer[19] = 0;

    buffer[20] = 1;    // AudioFormat (PCM)
    buffer[21] = 0;
    buffer[22] = 1;    // NumChannels (1 mono)
    buffer[23] = 0;

    buffer[24] = sampleRate & 0xff;
    buffer[25] = (sampleRate >> 8) & 0xff;
    buffer[26] = (sampleRate >> 16) & 0xff;
    buffer[27] = (sampleRate >> 24) & 0xff;

    const byteRate = sampleRate;
    buffer[28] = byteRate & 0xff;
    buffer[29] = (byteRate >> 8) & 0xff;
    buffer[30] = (byteRate >> 16) & 0xff;
    buffer[31] = (byteRate >> 24) & 0xff;

    buffer[32] = 1;    // BlockAlign
    buffer[33] = 0;
    buffer[34] = 8;    // BitsPerSample (8 bits)
    buffer[35] = 0;

    // 3. Subchunk 2 (data)
    buffer[36] = 0x64; // 'd'
    buffer[37] = 0x61; // 'a'
    buffer[38] = 0x74; // 't'
    buffer[39] = 0x61; // 'a'

    buffer[40] = numSamples & 0xff;
    buffer[41] = (numSamples >> 8) & 0xff;
    buffer[42] = (numSamples >> 16) & 0xff;
    buffer[43] = (numSamples >> 24) & 0xff;

    // 4. Sine Wave Samples Generation
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const s = Math.sin(2 * Math.PI * frequency * t);
        
        // Flat envelope: Keep 100% volume for the first 80%, then fade out in the last 20% to prevent popping
        let envelope = 1.0;
        const fadeStart = numSamples * 0.8;
        if (i > fadeStart) {
            envelope = 1.0 - ((i - fadeStart) / (numSamples - fadeStart));
        }
        
        const sampleValue = Math.round(128 + 127 * s * envelope);
        buffer[44 + i] = sampleValue;
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
}

// Generates a single WAV file containing three beeps spaced 1.0 second apart
function createCountdownWavUrl() {
    const sampleRate = 44100;
    const duration = 2.2; // 3 beeps: at 0.0s, 1.0s, 2.0s. Total duration 2.2s.
    const numSamples = sampleRate * duration;
    const bufferSize = 44 + numSamples;
    const buffer = new Uint8Array(bufferSize);

    // 1. WAV Header (RIFF)
    buffer[0] = 0x52; // 'R'
    buffer[1] = 0x49; // 'I'
    buffer[2] = 0x46; // 'F'
    buffer[3] = 0x46; // 'F'
    
    const fileSize = bufferSize - 8;
    buffer[4] = fileSize & 0xff;
    buffer[5] = (fileSize >> 8) & 0xff;
    buffer[6] = (fileSize >> 16) & 0xff;
    buffer[7] = (fileSize >> 24) & 0xff;

    buffer[8] = 0x57;  // 'W'
    buffer[9] = 0x41;  // 'A'
    buffer[10] = 0x56; // 'V'
    buffer[11] = 0x45; // 'E'

    // 2. fmt Subchunk
    buffer[12] = 0x66; // 'f'
    buffer[13] = 0x6d; // 'm'
    buffer[14] = 0x74; // 't'
    buffer[15] = 0x20; // ' '

    buffer[16] = 16;   // Subchunk1Size
    buffer[17] = 0;
    buffer[18] = 0;
    buffer[19] = 0;

    buffer[20] = 1;    // AudioFormat (PCM)
    buffer[21] = 0;
    buffer[22] = 1;    // NumChannels (1 mono)
    buffer[23] = 0;

    buffer[24] = sampleRate & 0xff;
    buffer[25] = (sampleRate >> 8) & 0xff;
    buffer[26] = (sampleRate >> 16) & 0xff;
    buffer[27] = (sampleRate >> 24) & 0xff;

    const byteRate = sampleRate;
    buffer[28] = byteRate & 0xff;
    buffer[29] = (byteRate >> 8) & 0xff;
    buffer[30] = (byteRate >> 16) & 0xff;
    buffer[31] = (byteRate >> 24) & 0xff;

    buffer[32] = 1;    // BlockAlign
    buffer[33] = 0;
    buffer[34] = 8;    // BitsPerSample (8 bits)
    buffer[35] = 0;

    // 3. Subchunk 2 (data)
    buffer[36] = 0x64; // 'd'
    buffer[37] = 0x61; // 'a'
    buffer[38] = 0x74; // 't'
    buffer[39] = 0x61; // 'a'

    buffer[40] = numSamples & 0xff;
    buffer[41] = (numSamples >> 8) & 0xff;
    buffer[42] = (numSamples >> 16) & 0xff;
    buffer[43] = (numSamples >> 24) & 0xff;

    // 4. Generate Samples (silence center value 128)
    buffer.fill(128, 44);

    const frequency = 2000;
    const beepDuration = 0.12;
    const beepSamples = sampleRate * beepDuration;

    // Place 3 beeps at 0.0s, 1.0s, and 2.0s
    const startOffsets = [0.0, 1.0, 2.0];

    for (let startOffset of startOffsets) {
        const startIndex = Math.round(startOffset * sampleRate);
        for (let i = 0; i < beepSamples; i++) {
            const sampleIdx = startIndex + i;
            if (sampleIdx >= numSamples) break;

            const t = i / sampleRate;
            const s = Math.sin(2 * Math.PI * frequency * t);
            
            // Fade out in the last 20% to prevent popping
            let envelope = 1.0;
            const fadeStart = beepSamples * 0.8;
            if (i > fadeStart) {
                envelope = 1.0 - ((i - fadeStart) / (beepSamples - fadeStart));
            }
            
            const sampleValue = Math.round(128 + 127 * s * envelope);
            buffer[44 + sampleIdx] = sampleValue;
        }
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
}

function initAudioElements() {
    if (!beepAudio) {
        // Standard beep: 2000Hz (more piercing) and 0.12 seconds (longer and louder)
        const beepUrl = createBeepWavUrl(2000, 0.12);
        beepAudio = new Audio(beepUrl);
    }
    if (!countdownAudio) {
        // 3-second countdown WAV containing 3 beeps spaced 1.0s apart
        const countdownUrl = createCountdownWavUrl();
        countdownAudio = new Audio(countdownUrl);
    }
    if (!transitionAudio) {
        // Transition tink: 2800Hz (high-pitched bell) and 0.16 seconds
        const transUrl = createBeepWavUrl(2800, 0.16);
        transitionAudio = new Audio(transUrl);
    }
}

function initAudio() {
    initAudioElements();
    
    // Play audio elements silently to unlock browser restrictions on iOS
    try {
        if (beepAudio) {
            beepAudio.volume = 0.001;
            beepAudio.play().then(() => {
                beepAudio.pause();
                beepAudio.currentTime = 0;
            }).catch(e => console.warn("Beep audio unlock skipped:", e));
        }
        if (countdownAudio) {
            countdownAudio.volume = 0.001;
            countdownAudio.play().then(() => {
                countdownAudio.pause();
                countdownAudio.currentTime = 0;
            }).catch(e => console.warn("Countdown audio unlock skipped:", e));
        }
        if (transitionAudio) {
            transitionAudio.volume = 0.001;
            transitionAudio.play().then(() => {
                transitionAudio.pause();
                transitionAudio.currentTime = 0;
            }).catch(e => console.warn("Transition audio unlock skipped:", e));
        }
    } catch (e) {
        console.warn("Audio unlock warning:", e);
    }
    
    // Trigger a silent utterance to unlock iOS Speech Synthesis
    try {
        const silentUtterance = new SpeechSynthesisUtterance("");
        window.speechSynthesis.speak(silentUtterance);
    } catch (e) {
        console.error("iOS speech synthesis unlock failed:", e);
    }

    // Refresh voices list upon user interaction (crucial for iOS Safari lazy loading)
    initVoices();
}

function playBeep(isTransition = false) {
    if (stompMuted) return;
    initAudioElements();
    
    const audio = isTransition ? transitionAudio : beepAudio;
    if (audio) {
        try {
            audio.volume = stompVolume;
            audio.currentTime = 0;
            audio.play().catch(e => {
                console.warn("Audio play blocked in tick:", e);
            });
        } catch (e) {
            console.warn("Audio play error:", e);
        }
    }
}

function playCountdown() {
    if (stompMuted) return;
    initAudioElements();
    if (countdownAudio) {
        try {
            countdownAudio.volume = stompVolume;
            countdownAudio.currentTime = 0;
            countdownAudio.play().catch(e => {
                console.warn("Countdown play blocked in tick:", e);
            });
        } catch (e) {
            console.warn("Countdown play error:", e);
        }
    }
}

function stopCountdown() {
    if (countdownAudio) {
        try {
            countdownAudio.pause();
            countdownAudio.currentTime = 0;
        } catch (e) {
            console.warn("Countdown stop error:", e);
        }
    }
}

function playTransitionSound() {
    playBeep(true);
}

// --- Text To Speech (Web Speech API) ---
function initVoices() {
    if (!window.speechSynthesis) {
        voiceSelect.innerHTML = "<option>不支援語音功能</option>";
        return;
    }

    const loadVoicesList = () => {
        voicesList = window.speechSynthesis.getVoices();
        
        // Filter Chinese voices and prioritize TW/HK Traditional Chinese
        let chineseVoices = voicesList.filter(v => v.lang.toLowerCase().includes("zh"));
        let twVoices = chineseVoices.filter(v => v.lang.toLowerCase().includes("tw") || v.lang.toLowerCase().includes("hant"));
        let hkVoices = chineseVoices.filter(v => v.lang.toLowerCase().includes("hk"));
        let otherCnVoices = chineseVoices.filter(v => !twVoices.includes(v) && !hkVoices.includes(v));
        
        let sortedVoices = [...twVoices, ...hkVoices, ...otherCnVoices];
        
        voiceSelect.innerHTML = "";
        
        // Add default system voice option
        const defaultOption = document.createElement("option");
        defaultOption.value = "default";
        defaultOption.textContent = "系統預設語音 (Default)";
        voiceSelect.appendChild(defaultOption);

        sortedVoices.forEach(voice => {
            const option = document.createElement("option");
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (voice.name === preferredVoiceName) {
                option.selected = true;
                selectedVoice = voice;
            }
            voiceSelect.appendChild(option);
        });

        if (preferredVoiceName === "default" || !selectedVoice) {
            voiceSelect.value = "default";
            selectedVoice = null;
        }
    };

    loadVoicesList();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoicesList;
    }

    // Fallback: If voices array is initially empty (common on mobile), force redraw option after a short delay
    setTimeout(() => {
        if (voicesList.length === 0) {
            loadVoicesList();
        }
    }, 200);
}

function speak(text) {
    if (stompMuted || !window.speechSynthesis) return;
    try {
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.volume = stompVolume; // Apply volume setting
        utterance.rate = stompRate;     // Apply speech rate setting
        
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn("Speech synthesis failed:", e);
    }
}

// --- Listeners & Controls ---
function setupEventListeners() {
    const addQuickListener = (btn, action) => {
        btn.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            initAudio();
            action(e);
        });
        // Prevent default click behavior to avoid double trigger
        btn.addEventListener("click", (e) => {
            e.preventDefault();
        });
    };

    // Buttons interaction
    addQuickListener(btnSync, () => triggerSync());
    addQuickListener(btnPlayPause, () => togglePause());
    addQuickListener(btnShift, () => triggerShift());
    addQuickListener(btnMute, () => toggleMute());
    addQuickListener(btnReset, () => resetFocus());

    // Double click or tap on timer display to reset back to standby
    timerDisplay.addEventListener("dblclick", () => {
        deactivateTimer();
    });
    
    let lastTap = 0;
    timerDisplay.addEventListener("touchend", (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 300 && tapLength > 0) {
            deactivateTimer();
            e.preventDefault();
        }
        lastTap = currentTime;
    });

    // Corner stomp buttons focus toggle
    document.querySelectorAll(".stomp-btn").forEach(btn => {
        addQuickListener(btn, () => {
            const index = parseInt(btn.getAttribute("data-index"));
            toggleFocus(index);
        });
    });

    // Select Voice
    voiceSelect.addEventListener("change", (e) => {
        preferredVoiceName = e.target.value;
        selectedVoice = voicesList.find(v => v.name === preferredVoiceName);
        saveSettings();
        speak("語音設定已更新");
    });

    // Volume Slider
    volumeSlider.addEventListener("input", (e) => {
        stompVolume = parseFloat(e.target.value);
        volumeVal.textContent = `${Math.round(stompVolume * 100)}%`;
        saveSettings();
    });

    // Rate Slider
    rateSlider.addEventListener("input", (e) => {
        stompRate = parseFloat(e.target.value);
        rateVal.textContent = `${stompRate.toFixed(1)}x`;
        saveSettings();
    });

    // Keyboard Fallbacks for Desktop users (Space: Sync, Enter: Shift/Calibrate)
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            e.preventDefault();
            initAudio();
            triggerSync();
        } else if (e.code === "Enter" || e.code === "NumpadEnter") {
            e.preventDefault();
            initAudio();
            triggerShift();
        }
    });
}

// --- Persistence ---
function saveSettings() {
    localStorage.setItem("stompMuted", stompMuted);
    localStorage.setItem("stompVolume", stompVolume);
    localStorage.setItem("stompRate", stompRate);
    localStorage.setItem("preferredVoiceName", preferredVoiceName || "");
}

function loadSettings() {
    stompMuted = localStorage.getItem("stompMuted") === "true";
    
    const savedVol = localStorage.getItem("stompVolume");
    if (savedVol !== null) {
        stompVolume = parseFloat(savedVol);
        volumeSlider.value = stompVolume;
        volumeVal.textContent = `${Math.round(stompVolume * 100)}%`;
    }
    
    const savedRate = localStorage.getItem("stompRate");
    if (savedRate !== null) {
        stompRate = parseFloat(savedRate);
        rateSlider.value = stompRate;
        rateVal.textContent = `${stompRate.toFixed(1)}x`;
    }

    preferredVoiceName = localStorage.getItem("preferredVoiceName") || null;
    
    if (stompMuted) {
        btnMute.classList.add("muted");
        btnMute.textContent = "🔇";
    } else {
        btnMute.classList.remove("muted");
        btnMute.textContent = "🔊";
    }
}

// --- State Machine Updates ---
function triggerSync() {
    stopCountdown();
    stompSecondsLeft = 10.0;
    stompActive = true;
    stompPaused = false;
    stompSaidWarning = false;
    stompSaidReady = false;
    stompBeeped.clear();
    
    updateUIState();
    playBeep();
    statusBar.textContent = "👣 腳踩計時已鎖定同步";
}

function triggerShift() {
    stopCountdown();
    stompActiveIndex = (stompActiveIndex + 1) % 4;
    stompActive = true;
    stompPaused = false;
    stompSaidWarning = false;
    stompSaidReady = false;
    stompBeeped.clear();
    
    updateUIState();
    playBeep();
    statusBar.textContent = "👣 腳踩招式已切換校正";
}

function deactivateTimer() {
    stopCountdown();
    stompActive = false;
    stompPaused = false;
    stompSecondsLeft = 10.0;
    stompSaidWarning = false;
    stompSaidReady = false;
    stompBeeped.clear();
    updateUIState();
    statusBar.textContent = "— 龍王待機中 —";
}

function togglePause() {
    if (!stompActive) return;
    stompPaused = !stompPaused;
    if (stompPaused) {
        stopCountdown();
    }
    updateUIState();
}

function toggleMute() {
    stompMuted = !stompMuted;
    saveSettings();
    if (stompMuted) {
        btnMute.classList.add("muted");
        btnMute.textContent = "🔇";
        stopCountdown();
    } else {
        btnMute.classList.remove("muted");
        btnMute.textContent = "🔊";
    }
}

function toggleFocus(index) {
    if (stompFocusedIndices.has(index)) {
        stompFocusedIndices.delete(index);
    } else {
        stompFocusedIndices.add(index);
    }

    stompActive = true;
    stompSaidWarning = false;
    stompSaidReady = false;
    stompBeeped.clear();
    stopCountdown();
    updateUIState();

    if (stompFocusedIndices.size > 0) {
        const names = Array.from(stompFocusedIndices).sort().map(i => STOMP_NAMES[i]).join("/");
        statusBar.textContent = `👣 專注於 ${names}`;
    } else {
        statusBar.textContent = "👣 回到輪播模式";
    }
}

function resetFocus() {
    stompFocusedIndices.clear();
    stompSaidWarning = false;
    stompSaidReady = false;
    stompBeeped.clear();
    stopCountdown();
    updateUIState();
    statusBar.textContent = "👣 回到輪播模式";
}

// --- UI Rendering ---
function updateUIState() {
    const stompBtns = document.querySelectorAll(".stomp-btn");
    stompBtns.forEach(btn => {
        btn.disabled = !stompActive;
        const index = parseInt(btn.getAttribute("data-index"));
        btn.classList.remove("focused", "upcoming");
        
        if (stompActive) {
            if (stompFocusedIndices.has(index)) {
                btn.classList.add("focused");
            } else {
                const upcomingIdx = (stompActiveIndex + 1) % 4;
                if (index === upcomingIdx) {
                    btn.classList.add("upcoming");
                }
            }
        }
    });

    btnPlayPause.textContent = stompPaused ? "▶" : "⏸";
    if (!stompActive) {
        btnPlayPause.disabled = true;
        btnPlayPause.style.opacity = 0.35;
        btnShift.disabled = true;
        btnShift.style.opacity = 0.35;
    } else {
        btnPlayPause.disabled = false;
        btnPlayPause.style.opacity = 1;
        btnShift.disabled = false;
        btnShift.style.opacity = 1;
    }

    if (stompFocusedIndices.size > 0 && stompActive) {
        btnReset.classList.add("active");
    } else {
        btnReset.classList.remove("active");
    }

    for (let i = 0; i < 4; i++) {
        const arrow = document.getElementById(`arrow-${i}`);
        if (stompActive && stompActiveIndex === i) {
            arrow.classList.add("active");
        } else {
            arrow.classList.remove("active");
        }
    }

    if (stompActive && !stompPaused) {
        btnSync.textContent = "⚡ 已鎖定計時中";
        btnSync.classList.add("active-sync");
    } else {
        btnSync.textContent = "▶ 點擊解鎖音效 & 對齊計時";
        btnSync.classList.remove("active-sync");
    }

    timerDisplay.classList.remove("active-rotating", "active-focused", "paused");
    if (!stompActive) {
        timerDisplay.textContent = "10.0s";
    } else if (stompPaused) {
        timerDisplay.classList.add("paused");
    } else if (stompFocusedIndices.size === 0) {
        timerDisplay.classList.add("active-rotating");
    } else {
        timerDisplay.classList.add("active-focused");
    }

    modeDisplay.classList.remove("focused");
    if (!stompActive) {
        modeDisplay.textContent = "待機中 (請點擊對齊開始)";
    } else if (stompPaused) {
        modeDisplay.textContent = "已暫停";
    } else if (stompFocusedIndices.size === 0) {
        modeDisplay.textContent = "輪播模式";
    } else {
        modeDisplay.classList.add("focused");
        
        let minVal = 999.0;
        let earliestIdx = null;
        stompFocusedIndices.forEach(idx => {
            let val;
            if (idx === stompActiveIndex) {
                val = stompSecondsLeft + 30.0;
            } else {
                const steps = (idx - stompActiveIndex - 1 + 4) % 4;
                val = stompSecondsLeft + steps * 10.0;
            }
            if (val < minVal) {
                minVal = val;
                earliestIdx = idx;
            }
        });
        
        if (earliestIdx !== null) {
            modeDisplay.textContent = `專注: ${STOMP_NAMES[earliestIdx]}`;
        }
    }
}

// --- The Core Clock Tick ---
function tick() {
    if (!stompActive || stompPaused) {
        lastTickTime = Date.now();
        return;
    }

    const now = Date.now();
    const dt = (now - lastTickTime) / 1000;
    lastTickTime = now;

    stompSecondsLeft -= dt;

    if (stompSecondsLeft <= 0.0) {
        // Prevent clock drift: preserve the overshoot remainder to keep absolute time sync
        stompSecondsLeft = 10.0 + stompSecondsLeft;
        stompActiveIndex = (stompActiveIndex + 1) % 4;
        stompSaidWarning = false;
        stompSaidReady = false;
        stompBeeped.clear();
        updateUIState();
        playTransitionSound();
    }

    let countdown = stompSecondsLeft;
    if (stompFocusedIndices.size > 0) {
        let minVal = 999.0;
        stompFocusedIndices.forEach(idx => {
            let val;
            if (idx === stompActiveIndex) {
                val = stompSecondsLeft + 30.0;
            } else {
                const steps = (idx - stompActiveIndex - 1 + 4) % 4;
                val = stompSecondsLeft + steps * 10.0;
            }
            if (val < minVal) {
                minVal = val;
            }
        });
        countdown = minVal;

        const nextStompIndex = (stompActiveIndex + 1) % 4;
        if (stompFocusedIndices.has(nextStompIndex)) {
            if (stompSecondsLeft <= 6.0 && !stompSaidWarning) {
                stompSaidWarning = true;
                speak(`${STOMP_NAMES[nextStompIndex]}準備`);
            }
            if (stompSecondsLeft <= 3.0 && !stompBeeped.has(3)) {
                stompBeeped.add(3);
                playCountdown();
            }
        }
        // '注意' voice alert has been removed, transition beep sound is kept automatically in stomp transition handler.
    }

    if (countdown < 10.0) {
        timerDisplay.textContent = `${countdown.toFixed(1)}s`;
    } else {
        timerDisplay.textContent = `${Math.floor(countdown)}s`;
    }
}
