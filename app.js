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

// Timing loop variables
let timerInterval = null;
let lastTickTime = Date.now();
let wakeLock = null;
let stompBeeped = new Set();
let stompSaidWarning = false;

// --- DOM Elements ---
const btnSync = document.getElementById("btn-sync");
const btnPlayPause = document.getElementById("btn-play-pause");
const btnShift = document.getElementById("btn-shift");
const btnReset = document.getElementById("btn-reset");
const timerDisplay = document.getElementById("timer-display");
const modeDisplay = document.getElementById("mode-display");
const statusBar = document.getElementById("status-bar");

// --- Web Audio & Speech Synthesis API for Stomp Alerts ---
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.resume();
    }
}

function playBeep(frequency = 1000, duration = 0.1) {
    initAudio();
    if (!audioCtx) return;
    
    try {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Failed to play beep:", e);
    }
}

function playDoubleBeep(frequency = 1000, duration = 0.08, gap = 0.08) {
    playBeep(frequency, duration);
    setTimeout(() => {
        playBeep(frequency, duration);
    }, (duration + gap) * 1000);
}

function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel(); // 清理串流佇列防堵阻塞
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-TW';
        utterance.rate = 1.1; // 稍微加速，保持節奏
        utterance.volume = 1.0;
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn("SpeechSynthesis speak failed:", e);
    }
}

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    updateUIState();
    setupEventListeners();
    
    // Start high-precision 10ms interval
    lastTickTime = Date.now();
    timerInterval = setInterval(tick, 10);
});

// --- Listeners & Controls ---
function setupEventListeners() {
    // Buttons interaction
    btnSync.addEventListener("click", () => {
        initAudio();
        triggerSync();
    });

    btnPlayPause.addEventListener("click", () => {
        initAudio();
        togglePause();
    });

    btnShift.addEventListener("click", () => {
        initAudio();
        triggerShift();
    });

    btnReset.addEventListener("click", () => {
        initAudio();
        resetFocus();
    });

    // Double click or tap on timer display to reset back to standby
    timerDisplay.addEventListener("dblclick", () => {
        initAudio();
        deactivateTimer();
    });
    
    let lastTap = 0;
    timerDisplay.addEventListener("touchend", (e) => {
        initAudio();
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
        btn.addEventListener("click", () => {
            initAudio();
            const index = parseInt(btn.getAttribute("data-index"));
            toggleFocus(index);
        });
    });

    // Re-acquire Wake Lock when page becomes visible
    document.addEventListener('visibilitychange', async () => {
        if (stompActive && !stompPaused && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });
}

// --- Persistence (Focus Settings Only) ---
function saveSettings() {
    // We only save the focused stomp indices so they persist on page refresh
    const focusedArray = Array.from(stompFocusedIndices);
    localStorage.setItem("stompFocusedIndices", JSON.stringify(focusedArray));
}

function loadSettings() {
    try {
        const savedFocused = localStorage.getItem("stompFocusedIndices");
        if (savedFocused !== null) {
            const focusedArray = JSON.parse(savedFocused);
            stompFocusedIndices = new Set(focusedArray);
        }
    } catch (e) {
        console.warn("Failed to load stompFocusedIndices:", e);
    }
}

// --- Screen Wake Lock API ---
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock is active');
        } catch (err) {
            console.warn(`Screen Wake Lock failed: ${err.message}`);
        }
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
        console.log('Screen Wake Lock released');
    }
}

// --- State Machine Updates ---
function triggerSync() {
    stompSecondsLeft = 10.0;
    stompActive = true;
    stompPaused = false;
    stompBeeped.clear();
    stompSaidWarning = false;
    
    updateUIState();
    statusBar.textContent = "👣 腳踩計時已鎖定同步";
    requestWakeLock();
}

// Manually advance stomp cycle index
function triggerShift() {
    stompActiveIndex = (stompActiveIndex + 1) % 4;
    stompActive = true;
    stompPaused = false;
    stompBeeped.clear();
    stompSaidWarning = false;
    
    updateUIState();
    statusBar.textContent = "👣 腳踩招式已切換校正";
    requestWakeLock();
}

function deactivateTimer() {
    stompActive = false;
    stompPaused = false;
    stompSecondsLeft = 10.0;
    stompBeeped.clear();
    stompSaidWarning = false;
    updateUIState();
    statusBar.textContent = "— 龍王待機中 —";
    releaseWakeLock();
}

function togglePause() {
    if (!stompActive) return;
    stompPaused = !stompPaused;
    updateUIState();
    if (stompPaused) {
        releaseWakeLock();
    } else {
        requestWakeLock();
    }
}

function toggleFocus(index) {
    if (stompFocusedIndices.has(index)) {
        stompFocusedIndices.delete(index);
    } else {
        stompFocusedIndices.add(index);
    }

    stompActive = true;
    stompBeeped.clear();
    stompSaidWarning = false;
    updateUIState();
    saveSettings();
    requestWakeLock();

    if (stompFocusedIndices.size > 0) {
        const names = Array.from(stompFocusedIndices).sort().map(i => STOMP_NAMES[i]).join("/");
        statusBar.textContent = `👣 專注於 ${names}`;
    } else {
        statusBar.textContent = "👣 回到輪播模式";
    }
}

function resetFocus() {
    stompFocusedIndices.clear();
    stompBeeped.clear();
    stompSaidWarning = false;
    updateUIState();
    saveSettings();
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
        btnSync.textContent = "⚡ 對齊計時 (Sync)";
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
        
        // 0s double beep: 僅在專注模式，且下一個來臨的招式是專注的招式時播放
        const upcomingIdx = (stompActiveIndex + 1) % 4;
        if (stompFocusedIndices.size > 0 && stompFocusedIndices.has(upcomingIdx)) {
            playDoubleBeep(1000, 0.08, 0.08);
        }

        stompActiveIndex = upcomingIdx;
        stompBeeped.clear();
        stompSaidWarning = false;
        updateUIState();
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
    }

    // 8s 語音與 3, 2, 1 beep: 僅在專注模式，且下一個來臨的招式是專注的招式時播放
    const nextStompIndex = (stompActiveIndex + 1) % 4;
    if (stompFocusedIndices.size > 0 && stompFocusedIndices.has(nextStompIndex)) {
        // 8 秒語音警告
        if (countdown <= 8.0 && !stompSaidWarning) {
            stompSaidWarning = true;
            speak(`下一個${STOMP_NAMES[nextStompIndex]}`);
        }

        // 3, 2, 1 beep
        for (let thr of [3, 2, 1]) {
            if (countdown <= thr && !stompBeeped.has(thr)) {
                stompBeeped.add(thr);
                playBeep(1000, 0.1);
            }
        }
    }

    if (countdown < 10.0) {
        timerDisplay.textContent = `${countdown.toFixed(1)}s`;
    } else {
        timerDisplay.textContent = `${Math.floor(countdown)}s`;
    }
}
