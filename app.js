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

// Configurable Settings (saved to localStorage)
let stompSyncKey = null;         // e.g. "KeyS"
let stompSyncKeyChar = null;     // e.g. "S"
let stompShiftKey = null;        // e.g. "KeyD"
let stompShiftKeyChar = null;    // e.g. "D"
let preferredVoiceName = null;

// Alarm triggers tracking
let stompSaidWarning = false;
let stompSaidReady = false;
let stompBeeped = new Set();

// TTS & Audio variables
let audioContext = null;
let voicesList = [];
let selectedVoice = null;

// Hotkey binding state
let bindingTarget = null; // "sync" or "shift"

// Timing loop variables
let timerInterval = null;
let lastTickTime = Date.now();

// --- DOM Elements ---
const btnSync = document.getElementById("btn-sync");
const btnPlayPause = document.getElementById("btn-play-pause");
const btnMute = document.getElementById("btn-mute");
const btnReset = document.getElementById("btn-reset");
const timerDisplay = document.getElementById("timer-display");
const modeDisplay = document.getElementById("mode-display");
const statusBar = document.getElementById("status-bar");
const syncKeyBtn = document.getElementById("sync-key-btn");
const shiftKeyBtn = document.getElementById("shift-key-btn");
const voiceSelect = document.getElementById("voice-select");

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    updateUIState();
    setupEventListeners();
    initVoices();
    
    // Start interval but it will just return in tick() unless active
    lastTickTime = Date.now();
    timerInterval = setInterval(tick, 50);
});

// --- Sound Synthesizer (Web Audio API) ---
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
    
    // Trigger a silent utterance to unlock iOS Speech Synthesis
    try {
        const silentUtterance = new SpeechSynthesisUtterance("");
        window.speechSynthesis.speak(silentUtterance);
    } catch (e) {
        console.error("iOS speech synthesis unlock failed:", e);
    }
}

function playBeep(frequency = 1000, duration = 0.08) {
    if (stompMuted || !audioContext) return;
    try {
        if (audioContext.state === "suspended") {
            audioContext.resume();
        }
        
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
        
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.start();
        osc.stop(audioContext.currentTime + duration);
    } catch (e) {
        console.warn("Audio playback failed:", e);
    }
}

function playTransitionSound() {
    // High pitch pleasant "Tink" sound
    playBeep(2000, 0.15);
}

// --- Text To Speech (Web Speech API) ---
function initVoices() {
    if (!window.speechSynthesis) {
        voiceSelect.innerHTML = "<option>不支援語音功能</option>";
        return;
    }

    const loadVoicesList = () => {
        voicesList = window.speechSynthesis.getVoices();
        
        // Filter Chinese voices (zh) and prioritize Taiwanese/HK Traditional Chinese (zh-TW, zh-HK)
        let chineseVoices = voicesList.filter(v => v.lang.toLowerCase().includes("zh"));
        let twVoices = chineseVoices.filter(v => v.lang.toLowerCase().includes("tw") || v.lang.toLowerCase().includes("hant"));
        let hkVoices = chineseVoices.filter(v => v.lang.toLowerCase().includes("hk"));
        let otherCnVoices = chineseVoices.filter(v => !twVoices.includes(v) && !hkVoices.includes(v));
        
        // Order: TW -> HK -> CN -> Others
        let sortedVoices = [...twVoices, ...hkVoices, ...otherCnVoices];
        if (sortedVoices.length === 0) {
            sortedVoices = voicesList; // Fallback to all if no Chinese
        }
        
        voiceSelect.innerHTML = "";
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

        // Set default selected if not set/found
        if (!selectedVoice && sortedVoices.length > 0) {
            selectedVoice = sortedVoices[0];
            voiceSelect.value = selectedVoice.name;
        }
    };

    loadVoicesList();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoicesList;
    }
}

function speak(text) {
    if (stompMuted || !window.speechSynthesis) return;
    try {
        // Cancel ongoing speak to prevent delayed alerts
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05; // Slightly faster to be snappy
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn("Speech synthesis failed:", e);
    }
}

// --- Keybind Config & Global Listeners ---
function setupEventListeners() {
    // Buttons interaction
    btnSync.addEventListener("click", () => {
        initAudio();
        triggerSync();
    });
    
    // Double click or tap on timer display to reset back to standby
    timerDisplay.addEventListener("dblclick", () => {
        deactivateTimer();
    });
    
    // Double tap for touch devices
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

    btnPlayPause.addEventListener("click", () => {
        initAudio();
        togglePause();
    });

    btnMute.addEventListener("click", () => {
        initAudio();
        toggleMute();
    });

    btnReset.addEventListener("click", () => {
        initAudio();
        resetFocus();
    });

    // Corner stomp buttons focus toggle
    document.querySelectorAll(".stomp-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            initAudio();
            const index = parseInt(btn.getAttribute("data-index"));
            toggleFocus(index);
        });
    });

    // Settings bind buttons
    syncKeyBtn.addEventListener("click", () => {
        startBinding("sync");
    });

    shiftKeyBtn.addEventListener("click", () => {
        startBinding("shift");
    });

    voiceSelect.addEventListener("change", (e) => {
        preferredVoiceName = e.target.value;
        selectedVoice = voicesList.find(v => v.name === preferredVoiceName);
        saveSettings();
        // Speak test
        speak("語音設定已更新");
    });

    // Keyboard Hotkey Listener (only works when browser tab is active/focused)
    window.addEventListener("keydown", (e) => {
        // 1. If currently binding a key
        if (bindingTarget) {
            e.preventDefault();
            if (e.key === "Escape") {
                cancelBinding();
                return;
            }
            bindKey(bindingTarget, e.code, e.key);
            return;
        }

        // 2. Normal hotkey triggers
        if (stompSyncKey && e.code === stompSyncKey) {
            e.preventDefault();
            initAudio();
            triggerSync();
        } else if (stompShiftKey && e.code === stompShiftKey) {
            e.preventDefault();
            initAudio();
            triggerShift();
        }
    });
}

function startBinding(target) {
    bindingTarget = target;
    if (target === "sync") {
        syncKeyBtn.textContent = "[ 偵測中 ]";
        syncKeyBtn.classList.add("binding");
    } else {
        shiftKeyBtn.textContent = "[ 偵測中 ]";
        shiftKeyBtn.classList.add("binding");
    }
}

function cancelBinding() {
    syncKeyBtn.classList.remove("binding");
    shiftKeyBtn.classList.remove("binding");
    syncKeyBtn.textContent = stompSyncKeyChar ? stompSyncKeyChar.toUpperCase() : "未設定";
    shiftKeyBtn.textContent = stompShiftKeyChar ? stompShiftKeyChar.toUpperCase() : "未設定";
    bindingTarget = null;
}

// Maps standard code back to English characters to prevent Chinese IME bugs
const PHYSICAL_KEY_MAP = {
    "Space": "Space", "Enter": "Enter", "NumpadEnter": "Enter", "Backspace": "Backspace", "Tab": "Tab", "Escape": "Esc",
    "ArrowLeft": "Left", "ArrowRight": "Right", "ArrowDown": "Down", "ArrowUp": "Up",
    "KeyA": "A", "KeyB": "B", "KeyC": "C", "KeyD": "D", "KeyE": "E", "KeyF": "F", "KeyG": "G", "KeyH": "H", "KeyI": "I", "KeyJ": "J", "KeyK": "K", "KeyL": "L", "KeyM": "M", "KeyN": "N", "KeyO": "O", "KeyP": "P", "KeyQ": "Q", "KeyR": "R", "KeyS": "S", "KeyT": "T", "KeyU": "U", "KeyV": "V", "KeyW": "W", "KeyX": "X", "KeyY": "Y", "KeyZ": "Z",
    "Digit0": "0", "Digit1": "1", "Digit2": "2", "Digit3": "3", "Digit4": "4", "Digit5": "5", "Digit6": "6", "Digit7": "7", "Digit8": "8", "Digit9": "9"
};

function bindKey(target, code, fallbackKey) {
    let keyChar = PHYSICAL_KEY_MAP[code];
    if (!keyChar) {
        // Fallback for special keys not in the dictionary, filter to Latin if possible
        keyChar = fallbackKey.length === 1 ? fallbackKey.toUpperCase() : code;
    }
    
    if (target === "sync") {
        if (stompShiftKey === code) {
            stompShiftKey = null;
            stompShiftKeyChar = null;
        }
        stompSyncKey = code;
        stompSyncKeyChar = keyChar;
    } else {
        if (stompSyncKey === code) {
            stompSyncKey = null;
            stompSyncKeyChar = null;
        }
        stompShiftKey = code;
        stompShiftKeyChar = keyChar;
    }

    saveSettings();
    cancelBinding();
}

// --- Persistence ---
function saveSettings() {
    localStorage.setItem("stompSyncKey", stompSyncKey || "");
    localStorage.setItem("stompSyncKeyChar", stompSyncKeyChar || "");
    localStorage.setItem("stompShiftKey", stompShiftKey || "");
    localStorage.setItem("stompShiftKeyChar", stompShiftKeyChar || "");
    localStorage.setItem("stompMuted", stompMuted);
    localStorage.setItem("preferredVoiceName", preferredVoiceName || "");
}

function loadSettings() {
    stompSyncKey = localStorage.getItem("stompSyncKey") || null;
    stompSyncKeyChar = localStorage.getItem("stompSyncKeyChar") || null;
    stompShiftKey = localStorage.getItem("stompShiftKey") || null;
    stompShiftKeyChar = localStorage.getItem("stompShiftKeyChar") || null;
    stompMuted = localStorage.getItem("stompMuted") === "true";
    preferredVoiceName = localStorage.getItem("preferredVoiceName") || null;

    syncKeyBtn.textContent = stompSyncKeyChar ? stompSyncKeyChar.toUpperCase() : "未設定";
    shiftKeyBtn.textContent = stompShiftKeyChar ? stompShiftKeyChar.toUpperCase() : "未設定";
    
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
    updateUIState();
}

function toggleMute() {
    stompMuted = !stompMuted;
    saveSettings();
    if (stompMuted) {
        btnMute.classList.add("muted");
        btnMute.textContent = "🔇";
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
    updateUIState();
    statusBar.textContent = "👣 回到輪播模式";
}

// --- UI Rendering ---
function updateUIState() {
    // 1. Stomp Corner Buttons Disable state
    const stompBtns = document.querySelectorAll(".stomp-btn");
    stompBtns.forEach(btn => {
        btn.disabled = !stompActive;
        const index = parseInt(btn.getAttribute("data-index"));
        
        // Remove old style classes
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

    // 2. Play/Pause button appearance
    btnPlayPause.textContent = stompPaused ? "▶" : "⏸";
    if (!stompActive) {
        btnPlayPause.disabled = true;
        btnPlayPause.style.opacity = 0.35;
    } else {
        btnPlayPause.disabled = false;
        btnPlayPause.style.opacity = 1;
    }

    // 3. Center Reset Button active state
    if (stompFocusedIndices.size > 0 && stompActive) {
        btnReset.classList.add("active");
    } else {
        btnReset.classList.remove("active");
    }

    // 4. SVG active arrow animation classes
    for (let i = 0; i < 4; i++) {
        const arrow = document.getElementById(`arrow-${i}`);
        if (stompActive && stompActiveIndex === i) {
            arrow.classList.add("active");
        } else {
            arrow.classList.remove("active");
        }
    }

    // 5. Sync Button appearance
    if (stompActive && !stompPaused) {
        btnSync.textContent = "⚡ 已鎖定計時中";
        btnSync.classList.add("active-sync");
    } else {
        btnSync.textContent = "▶ 點擊解鎖音效 & 對齊計時";
        btnSync.classList.remove("active-sync");
    }

    // 6. Timer display color classes
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

    // 7. Mode string text
    modeDisplay.classList.remove("focused");
    if (!stompActive) {
        modeDisplay.textContent = "待機中 (請點擊對齊開始)";
    } else if (stompPaused) {
        modeDisplay.textContent = "已暫停";
    } else if (stompFocusedIndices.size === 0) {
        modeDisplay.textContent = "輪播模式";
    } else {
        modeDisplay.classList.add("focused");
        
        // Find which focused stomp is closest
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

    // Handle transition to next stomp state
    if (stompSecondsLeft <= 0.0) {
        stompSecondsLeft = 10.0;
        stompActiveIndex = (stompActiveIndex + 1) % 4;
        stompSaidWarning = false;
        stompSaidReady = false;
        stompBeeped.clear();
        updateUIState();
        playTransitionSound();
    }

    // Determine value to display (closest countdown to focused index)
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

        // Audio Alarm 1: 5-second warning ("準備") and beeps for next focused stomp
        const nextStompIndex = (stompActiveIndex + 1) % 4;
        if (stompFocusedIndices.has(nextStompIndex)) {
            if (stompSecondsLeft <= 5.0 && !stompSaidWarning) {
                stompSaidWarning = true;
                speak(`${STOMP_NAMES[nextStompIndex]}準備`);
            }
            for (let thr of [3, 2, 1]) {
                if (stompSecondsLeft <= thr && !stompBeeped.has(thr)) {
                    stompBeeped.add(thr);
                    playBeep(1000, 0.08);
                }
            }
        }

        // Audio Alarm 2: Start alert ("注意") on transitioning into a focused stomp
        if (stompFocusedIndices.has(stompActiveIndex)) {
            if (stompSecondsLeft > 9.8 && !stompSaidReady) {
                stompSaidReady = true;
                speak(`注意${STOMP_NAMES[stompActiveIndex]}`);
                playTransitionSound();
            }
        }
    }

    // Display countdown formatted to 1 decimal place (if < 10s)
    if (countdown < 10.0) {
        timerDisplay.textContent = `${countdown.toFixed(1)}s`;
    } else {
        timerDisplay.textContent = `${Math.floor(countdown)}s`;
    }
}
