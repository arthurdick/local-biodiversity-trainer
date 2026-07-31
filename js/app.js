import { store, selectCurrentMedia } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';
import * as observationService from './observationService.js';

// ==========================================================================
// EVENT TARGET LIFECYCLE ROUTER
// ==========================================================================

// 1. Pure Declarative DOM Rendering
store.addEventListener('statechange', (e) => {
    ui.render(e.detail);
});

// 2. Question Navigation & JIT Prefetch Triggers
store.addEventListener('quiz:start', () => {
    observationService.loadObservationForQuestion(store.getState().currentIndex);
});

store.addEventListener('quiz:next', () => {
    observationService.loadObservationForQuestion(store.getState().currentIndex);
});

store.addEventListener('quiz:retry', () => {
    const s = store.getState();
    const q = s.questions[s.currentIndex];
    
    // If we already have a valid observation, just retry loading the media
    if (q.observation && !q.observation.error) {
        checkMediaReadiness();
    } else {
        observationService.loadObservationForQuestion(s.currentIndex);
    }
});

// 3. Observation Data Arrival Reaction
store.addEventListener('observation:loaded', (e) => {
    const { index, error, emptyPool } = e.detail;
    const s = store.getState();
    
    // Ignore if the user navigated away while the fetch was pending
    if (index !== s.currentIndex) return;
    
    if (error) {
        if (emptyPool && s.config.difficulty === 'all') {
            if (s.currentIndex === 0) {
                store.setState(prev => ({
                    ui: {
                        ...prev.ui,
                        activeView: 'setup-view',
                        setupError: "No observations found matching these strict filters. Try adjusting your settings."
                    }
                }));
            } else {
                store.setState(prev => ({
                    questions: prev.questions.slice(0, prev.currentIndex),
                    ui: { ...prev.ui, activeView: 'results-view' }
                }));
            }
        } else {
            store.setState(prev => ({ ui: { ...prev.ui, quizError: { isMissingMedia: false } } }));
        }
    } else {
        const mediaArray = selectCurrentMedia(s);
        if (mediaArray.length === 0) {
            store.setState(prev => ({ ui: { ...prev.ui, quizError: { isMissingMedia: true } } }));
        } else if (mediaArray[0].type === 'sound') {
            store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
            store.dispatchEvent(new CustomEvent('media:ready'));
        } else {
            checkMediaReadiness();
        }
    }
});

// 4. Sequential Prefetch Trigger
store.addEventListener('media:ready', () => {
    const s = store.getState();
    if (s.ui.activeView === 'quiz-view') {
        observationService.loadObservationForQuestion(s.currentIndex + 1);
    }
});

store.addEventListener('media:navigate', () => {
    checkMediaReadiness();
});

// Media Controller Helper
function checkMediaReadiness() {
    const s = store.getState();
    if (s.ui.activeView !== 'quiz-view' || s.ui.isMediaLoaded) return;

    const mediaArray = selectCurrentMedia(s);
    const currentMedia = mediaArray[s.currentMediaIndex];

    if (currentMedia?.type === 'photo') {
        const imgEl = document.getElementById('quiz-image');
        if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && imgEl.dataset.src === currentMedia.mediumUrl) {
            store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
            store.dispatchEvent(new CustomEvent('media:ready'));
        }
    } else if (currentMedia?.type === 'sound') {
        const audioPlayer = document.getElementById('quiz-audio-player');
        if (audioPlayer && audioPlayer.readyState >= 2 && audioPlayer.dataset.src === currentMedia.fileUrl) {
            store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
            store.dispatchEvent(new CustomEvent('media:ready'));
        }
    }
}

// --- NAVIGATION PROTECTION ---
window.addEventListener('beforeunload', (e) => {
    const s = store.getState();
    if (s.ui.activeView === 'quiz-view') {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

// --- STORAGE ---
function debounce(func, timeout = 250) {
    let timer;
    const debounced = function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
    debounced.cancel = () => {
        clearTimeout(timer);
    };
    return debounced;
}

function sanitizePreferences(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const sanitized = {};

    if (['search', 'coords'].includes(raw.locMode)) sanitized.locMode = raw.locMode;
    if (typeof raw.placeName === 'string') sanitized.placeName = raw.placeName;
    if (raw.placeId === null || typeof raw.placeId === 'number') sanitized.placeId = raw.placeId;

    if (raw.lat !== null && raw.lat !== undefined) {
        const lat = parseFloat(raw.lat);
        if (!isNaN(lat) && lat >= -90 && lat <= 90) sanitized.lat = lat;
    }

    if (raw.lng !== null && raw.lng !== undefined) {
        const lng = parseFloat(raw.lng);
        if (!isNaN(lng) && lng >= -180 && lng <= 180) sanitized.lng = lng;
    }

    if (raw.radius !== undefined) {
        const radius = parseFloat(raw.radius);
        if (!isNaN(radius) && radius >= 1 && radius <= 100) sanitized.radius = radius;
    }

    if (typeof raw.taxonName === 'string') sanitized.taxonName = raw.taxonName;
    if (raw.taxonId === null || typeof raw.taxonId === 'number') sanitized.taxonId = raw.taxonId;

    if (typeof raw.showIconicTaxonBadge === 'boolean') sanitized.showIconicTaxonBadge = raw.showIconicTaxonBadge;
    if (typeof raw.preventDuplicates === 'boolean') sanitized.preventDuplicates = raw.preventDuplicates;
    if (typeof raw.isRarityMode === 'boolean') sanitized.isRarityMode = raw.isRarityMode;

    if (typeof raw.wantsPhotos === 'boolean') sanitized.wantsPhotos = raw.wantsPhotos;
    if (typeof raw.wantsSounds === 'boolean') sanitized.wantsSounds = raw.wantsSounds;

    if (sanitized.wantsPhotos === false && sanitized.wantsSounds === false) {
        sanitized.wantsPhotos = true;
    }

    const validMonths = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    if (Array.isArray(raw.months)) {
        const filtered = raw.months.map(String).filter(m => validMonths.has(m));
        if (filtered.length > 0) sanitized.months = filtered;
    }

    const validDifficulties = ['15', '50', '125', '500', 'all'];
    if (validDifficulties.includes(String(raw.difficulty))) sanitized.difficulty = String(raw.difficulty);

    const validQuestions = ['5', '10', '20', '50', 5, 10, 20, 50];
    if (validQuestions.includes(raw.questionLimit)) sanitized.questionLimit = String(raw.questionLimit);

    const validWeighting = ['linear', 'log'];
    if (validWeighting.includes(raw.weightingMethod)) sanitized.weightingMethod = raw.weightingMethod;

    const validEstablishment = ['any', 'native', 'introduced', 'endemic'];
    if (validEstablishment.includes(raw.establishmentStatus)) sanitized.establishmentStatus = raw.establishmentStatus;

    return sanitized;
}

function savePreferences() {
    try {
        const currentForm = store.getState().form;
        localStorage.setItem('bio_trainer_prefs', JSON.stringify(currentForm));
    } catch (e) {
        console.warn("Unable to save preferences:", e);
    }
}

function loadPreferences() {
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (!saved) return;

        const sanitized = sanitizePreferences(JSON.parse(saved));
        if (Object.keys(sanitized).length > 0) {
            store.setState(prev => ({ form: { ...prev.form, ...sanitized } }));
        }
    } catch (e) {
        console.warn("Could not load preferences:", e);
    }
}

// --- DECLARATIVE FORM TWO-WAY BINDING ---
['lat', 'lng', 'radius', 'difficulty', 'questionLimit', 'answerInput', 'rankInput', 'weightingMethod', 'establishmentStatus'].forEach(prop => {
    let elId = `input-${prop.replace('Input', '')}`;
    if (prop === 'questionLimit') elId = 'input-questions';
    if (prop === 'weightingMethod') elId = 'input-weighting';
    if (prop === 'establishmentStatus') elId = 'input-establishment';

    const el = document.getElementById(elId);
    if (el) el.addEventListener('input', (e) => {
        const updates = { [prop]: e.target.value };
        const uiUpdates = {};

        if (prop === 'answerInput' || prop === 'rankInput') uiUpdates.answerError = null;

        store.setState(prev => ({
            form: { ...prev.form, ...updates },
            ui: { ...prev.ui, ...uiUpdates }
        }));
    });
});

['wantsPhotos', 'wantsSounds', 'preventDuplicates', 'isRarityMode', 'showIconicTaxonBadge'].forEach(prop => {
    const elId = prop === 'preventDuplicates' ? 'chk-unique' :
                 prop === 'isRarityMode' ? 'chk-rarity' :
                 prop === 'showIconicTaxonBadge' ? 'chk-badge' :
                 `chk-${prop.replace('wants', '').toLowerCase()}`;

    const el = document.getElementById(elId);
    if (el) el.addEventListener('change', (e) => store.setState(prev => ({ form: { ...prev.form, [prop]: e.target.checked } })));
});

const selectMonths = document.getElementById('input-months');
if (selectMonths) {
    selectMonths.addEventListener('change', () => {
        const selectedMonths = Array.from(selectMonths.selectedOptions).map(opt => opt.value);
        store.setState(prev => ({ form: { ...prev.form, months: selectedMonths } }));
    });
}

const seasonalPresets = {
    all: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    clear: [],
    spring: ['3', '4', '5'],
    summer: ['6', '7', '8'],
    autumn: ['9', '10', '11'],
    winter: ['12', '1', '2']
};

document.querySelectorAll('.btn-quick-select').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const presetKey = e.target.dataset.months;
        if (seasonalPresets[presetKey]) {
            store.setState(prev => ({ form: { ...prev.form, months: seasonalPresets[presetKey] } }));
        }
    });
});

document.querySelectorAll('input[name="loc-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        store.setState(prev => ({
            form: { ...prev.form, locMode: e.target.value, lat: null, lng: null, placeId: null, placeName: '' },
            ui: { ...prev.ui, setupError: null, placeError: null }
        }));
    });
});

// --- AUTOCOMPLETE LOGIC ---
function setupAutocomplete(config) {
    const {
        inputId, listId, clearBtnId, fetchDataFn,
        stateKeys: { id, name, error, results },
        formatDisplay, validateOnBlur, errorMsg
    } = config;

    let abortController = null;
    const inputEl = document.getElementById(inputId);
    const clearBtn = document.getElementById(clearBtnId);

    const performSearch = debounce(async (query) => {
        if (inputEl.value.trim() !== query.trim() || query.length < 3) {
            store.setState(prev => ({ ui: { ...prev.ui, [results]: [] } }));
            return;
        }

        abortController = new AbortController();

        try {
            const data = await fetchDataFn(query, abortController.signal);
            if (inputEl.value.trim() === query.trim()) {
                store.setState(prev => ({ ui: { ...prev.ui, [results]: data.results } }));
            }
        } catch (err) {
            if (err.name !== 'AbortError') console.warn(`${inputId} search offline`);
        }
    }, 250);

    inputEl.addEventListener('input', (e) => {
        const query = e.target.value;
        const currentResults = store.getState().ui[results];

        performSearch.cancel();
        if (abortController) {
            abortController.abort();
            abortController = null;
        }

        const selectedItem = currentResults.find(item => formatDisplay(item) === query);

        store.setState(prev => ({
            form: { ...prev.form, [id]: selectedItem ? selectedItem.id : null, [name]: query },
            ui: { ...prev.ui, [error]: null }
        }));

        if (!selectedItem) performSearch(query);
    });

    inputEl.addEventListener('focus', () => {
        store.setState(prev => ({ ui: { ...prev.ui, [error]: null } }));
    });

    inputEl.addEventListener('blur', () => {
        const s = store.getState();
        const isValid = validateOnBlur ? validateOnBlur(s) : !!s.form[id];
        if ((s.form[name] || '').trim() !== '' && !isValid) {
            store.setState(prev => ({ ui: { ...prev.ui, [error]: errorMsg } }));
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            performSearch.cancel();
            if (abortController) {
                abortController.abort();
                abortController = null;
            }

            store.setState(prev => ({
                form: { ...prev.form, [id]: null, [name]: '' },
                ui: { ...prev.ui, [results]: [], [error]: null }
            }));
            inputEl.focus();
        });
    }
}

setupAutocomplete({
    inputId: 'input-place', listId: 'list-place', clearBtnId: 'clear-place',
    fetchDataFn: api.fetchPlaces,
    stateKeys: { id: 'placeId', name: 'placeName', error: 'placeError', results: 'placeResults' },
    formatDisplay: ui.formatPlaceDisplay,
    validateOnBlur: (s) => s.form.locMode === 'search' ? !!s.form.placeId : (s.form.lat !== null && s.form.lng !== null),
    errorMsg: "⚠️ Please select a location from the suggestions list."
});

setupAutocomplete({
    inputId: 'input-taxon', listId: 'list-taxon', clearBtnId: 'clear-taxon',
    fetchDataFn: api.fetchTaxaAutocomplete,
    stateKeys: { id: 'taxonId', name: 'taxonName', error: 'taxonError', results: 'taxonResults' },
    formatDisplay: ui.formatTaxonDisplay,
    validateOnBlur: (s) => !!s.form.taxonId,
    errorMsg: "⚠️ Please select a valid target taxon from the suggestions list."
});

document.getElementById('btn-gps').addEventListener('click', () => {
    store.setState(prev => ({ ui: { ...prev.ui, isLocatingGps: true } }));
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            store.setState(prev => ({
                form: { ...prev.form, lat: pos.coords.latitude, lng: pos.coords.longitude, placeId: null, placeName: '' },
                ui: { ...prev.ui, isLocatingGps: false }
            }));
        },
        () => store.setState(prev => ({ ui: { ...prev.ui, isLocatingGps: false, setupError: 'Could not get location' } }))
    );
});

// --- GAME BOOTSTRAPPING ---
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = store.getState();
    let hasError = false;
    let placeError = null, setupError = null, taxonError = null;

    if (s.form.locMode === 'search' && !s.form.placeId) {
        placeError = "⚠️ Please search and select a location."; hasError = true;
    }
    if (s.form.locMode === 'coords') {
        const lat = parseFloat(s.form.lat);
        const lng = parseFloat(s.form.lng);
        const radius = parseFloat(s.form.radius);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            setupError = "Please enter valid latitude and longitude coordinates, or use GPS.";
            hasError = true;
        } else if (isNaN(radius) || radius < 1 || radius > 100) {
            setupError = "Radius must be between 1 and 100 km.";
            hasError = true;
        }
    }

    if ((s.form.taxonName || '').trim() !== '' && !s.form.taxonId) { taxonError = "⚠️ Please select a valid target taxon from the list, or clear this field."; hasError = true; }
    if (!s.form.wantsPhotos && !s.form.wantsSounds) { setupError = "Please select at least one media type (Photos or Sounds)."; hasError = true; }
    if (s.form.months.length === 0) { setupError = "Please select at least one month for seasonality."; hasError = true; }

    if (hasError) {
        store.setState(prev => ({ ui: { ...prev.ui, placeError, setupError, taxonError } })); return;
    }

    savePreferences();
    observationService.clearCache();

    store.setState(prev => ({
        config: { ...prev.form, questionLimit: parseInt(prev.form.questionLimit, 10), expertTotalSpecies: 0 },
        ui: { ...prev.ui, isLoadingQuizPool: true, setupError: null, placeError: null, taxonError: null }
    }));

    const updatedState = store.getState();
    const isExpert = updatedState.config.difficulty === 'all';

    try {
        let pool = [];
        let expertCount = 0;

        if (isExpert) {
            const preFlightData = await api.fetchSpeciesPool({
                perPage: 1,
                wantsPhotos: updatedState.config.wantsPhotos,
                wantsSounds: updatedState.config.wantsSounds,
                months: updatedState.config.months,
                placeId: updatedState.form.placeId,
                lat: updatedState.form.lat,
                lng: updatedState.form.lng,
                radius: updatedState.form.radius,
                taxonId: updatedState.form.taxonId,
                establishmentStatus: updatedState.config.establishmentStatus
            });
            expertCount = preFlightData.total_results || 0;

            if (expertCount === 0) {
                store.setState(prev => ({
                    ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No observations found matching these strict filters." }
                }));
                return;
            }

            const size = updatedState.config.preventDuplicates && updatedState.config.isRarityMode ? Math.min(updatedState.config.questionLimit, expertCount) : updatedState.config.questionLimit;
            pool = Array.from({ length: size }, () => ({ taxon: null, observation: null }));
            
        } else {
            const data = await api.fetchSpeciesPool({
                difficulty: updatedState.config.difficulty, wantsPhotos: updatedState.config.wantsPhotos, wantsSounds: updatedState.config.wantsSounds, months: updatedState.config.months, placeId: updatedState.form.placeId, lat: updatedState.form.lat, lng: updatedState.form.lng, radius: updatedState.form.radius, taxonId: updatedState.form.taxonId, establishmentStatus: updatedState.config.establishmentStatus
            });
            if (!data.results || data.results.length === 0) {
                store.setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No research-grade observations found." } }));
                return;
            }
            pool = engine.generateWeightedPool(
                data.results, updatedState.config.questionLimit, updatedState.config.preventDuplicates, updatedState.config.isRarityMode, updatedState.config.weightingMethod
            );
        }

        if (pool.length === 0) {
            store.setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No observations found matching these strict filters." } }));
            return;
        }

        store.setState(prev => ({
            config: { ...prev.config, expertTotalSpecies: expertCount },
            questions: pool, currentIndex: 0, score: 0, currentMediaIndex: 0,
            form: { ...prev.form, answerInput: '', rankInput: 'species' },
            ui: { ...prev.ui, isLoadingQuizPool: false, activeView: 'quiz-view', quizError: null, isCheckingAnswer: false, isHintVisible: false, isMediaLoaded: false }
        }));
        
        // Dispatch explicit start event to kick off JIT network calls
        store.dispatchEvent(new CustomEvent('quiz:start'));
        
    } catch (error) {
        const setupError = error.status === 429 ? "⏳ Rate limit exceeded." : "Error loading species data.";
        store.setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError } }));
    }
});

// --- QUIZ ACTIONS & MEDIA CAPTURE ---

document.getElementById('quiz-image').onload = (e) => {
    const s = store.getState();
    const media = selectCurrentMedia(s)[s.currentMediaIndex];
    if (media && e.target.dataset.src === media.mediumUrl) {
        store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
        store.dispatchEvent(new CustomEvent('media:ready'));
    }
};

document.getElementById('quiz-image').onerror = () => store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true, quizError: { isMissingMedia: false } } }));
document.getElementById('quiz-audio-player').onerror = () => store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true, quizError: { isMissingMedia: false } } }));

document.getElementById('quiz-audio-player').oncanplay = (e) => {
    const s = store.getState();
    const media = selectCurrentMedia(s)[s.currentMediaIndex];
    if (media && media.type === 'sound' && e.target.dataset.src === media.fileUrl) {
        store.setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
        store.dispatchEvent(new CustomEvent('media:ready'));
    }
};

document.getElementById('btn-prev-media').addEventListener('click', () => {
    if (store.getState().currentMediaIndex > 0) {
        store.setState(prev => ({ currentMediaIndex: prev.currentMediaIndex - 1, ui: { ...prev.ui, isMediaLoaded: false } }));
        store.dispatchEvent(new CustomEvent('media:navigate'));
    }
});

document.getElementById('btn-next-media').addEventListener('click', () => {
    const s = store.getState();
    if (s.currentMediaIndex < selectCurrentMedia(s).length - 1) {
        store.setState(prev => ({ currentMediaIndex: prev.currentMediaIndex + 1, ui: { ...prev.ui, isMediaLoaded: false } }));
        store.dispatchEvent(new CustomEvent('media:navigate'));
    }
});

document.getElementById('btn-toggle-hint').addEventListener('click', () => store.setState(prev => ({ ui: { ...prev.ui, isHintVisible: !prev.ui.isHintVisible } })));

// Modal Bindings
document.getElementById('btn-zoom-image').addEventListener('click', () => {
    const media = selectCurrentMedia(store.getState())[store.getState().currentMediaIndex];
    store.setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: media.originalUrl, isZoomedIn: false } }));
});
document.getElementById('zoom-modal-img').addEventListener('load', (e) => {
    const loader = document.getElementById('zoom-loading');
    if (loader) loader.style.display = 'none';
    e.target.style.display = 'inline-block';
});
document.getElementById('zoom-modal-img').addEventListener('error', () => {
    const loader = document.getElementById('zoom-loading');
    if (loader) {
        loader.textContent = '❌ Failed to load image.';
        loader.style.animation = 'none';
    }
});
document.getElementById('zoom-modal').addEventListener('close', () => {
    if (store.getState().ui.zoomMediaUrl) store.setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: null } }));
});
document.getElementById('zoom-modal-scroll').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) store.setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: null } }));
});
document.getElementById('btn-close-modal').addEventListener('click', () => store.setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: null } })));

document.getElementById('btn-zoom-modal-toggle').addEventListener('click', (e) => {
    const s = store.getState();
    const willZoomIn = !s.ui.isZoomedIn;
    const zoomImg = document.getElementById('zoom-modal-img');
    const zoomScroll = document.getElementById('zoom-modal-scroll');

    const rect = zoomImg.getBoundingClientRect();
    const clickXPercent = e.clientX ? (e.clientX - rect.left) / rect.width : 0.5;
    const clickYPercent = e.clientY ? (e.clientY - rect.top) / rect.height : 0.5;

    store.setState(prev => ({ ui: { ...prev.ui, isZoomedIn: willZoomIn } }));

    if (willZoomIn) {
        requestAnimationFrame(() => {
            const targetX = zoomImg.offsetWidth * clickXPercent;
            const targetY = zoomImg.offsetHeight * clickYPercent;

            zoomScroll.scrollLeft = targetX - (zoomScroll.clientWidth / 2);
            zoomScroll.scrollTop = targetY - (zoomScroll.clientHeight / 2);
        });
    }
});

// Answer Loop
document.getElementById('clear-answer').addEventListener('click', () => {
    store.setState(prev => ({ form: { ...prev.form, answerInput: '' } }));
    document.getElementById('input-answer').focus();
});

document.getElementById('btn-skip').addEventListener('click', () => {
    let s = store.getState();
    const q = s.questions[s.currentIndex];
    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(s));

    store.updateQuestion(s.currentIndex, {
        isAnswered: true, userAnswer: "(Skipped)", isCorrect: false, pointsEarned: 0, thumbnailUrl: mediaInfo.url, mediaAttribution: mediaInfo.attribution, isSkipped: true
    });
});

document.getElementById('answer-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const s = store.getState();
    const q = s.questions[s.currentIndex];

    if (s.ui.isCheckingAnswer || q.isAnswered) return;

    const inputStr = (s.form.answerInput || '').trim();
    if (!inputStr) return;

    store.setState(prev => ({ ui: { ...prev.ui, isCheckingAnswer: true, answerError: null } }));

    const { isCorrect, pointsEarned, matchedNameDisplay, networkError } = await engine.evaluateAnswer(
        inputStr, s.form.rankInput, q.observation?.taxon || q.taxon
    );

    if (networkError) {
        store.setState(prev => ({
            ui: {
                ...prev.ui,
                isCheckingAnswer: false,
                answerError: "⚠️ Offline: Unable to verify your answer with the database. Check your connection to try again, or skip."
            }
        }));
        return;
    }

    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(store.getState()));

    store.updateQuestion(s.currentIndex, {
        isAnswered: true,
        userAnswer: `${inputStr} (${s.form.rankInput})`,
        guessedRank: s.form.rankInput,
        isCorrect,
        pointsEarned,
        thumbnailUrl: mediaInfo.url,
        mediaAttribution: mediaInfo.attribution,
        matchedNameDisplay,
        isSkipped: false
    });

    if (isCorrect) store.setState(prev => ({ score: prev.score + pointsEarned }));
    store.setState(prev => ({ ui: { ...prev.ui, isCheckingAnswer: false } }));
});

// Advancing State
document.getElementById('btn-next').addEventListener('click', () => {
    const s = store.getState();
    const nextIdx = s.currentIndex + 1;
    if (nextIdx >= s.questions.length) {
        store.setState(prev => ({ ui: { ...prev.ui, activeView: 'results-view' } }));
    } else {
        store.setState(prev => ({
            currentIndex: nextIdx, currentMediaIndex: 0,
            form: { ...prev.form, answerInput: '', rankInput: 'species' },
            ui: { ...prev.ui, isMediaLoaded: false, isCheckingAnswer: false, quizError: null, isHintVisible: false }
        }));
        
        const quizCounter = document.getElementById('quiz-counter');
        if (quizCounter) quizCounter.focus();
        
        store.dispatchEvent(new CustomEvent('quiz:next'));
    }
});

document.getElementById('btn-retry').addEventListener('click', () => {
    const imgEl = document.getElementById('quiz-image');
    const audioPlayer = document.getElementById('quiz-audio-player');
    
    if (imgEl) { imgEl.removeAttribute('src'); delete imgEl.dataset.src; }
    if (audioPlayer) { audioPlayer.removeAttribute('src'); delete audioPlayer.dataset.src; }
    
    store.setState(prev => ({ ui: { ...prev.ui, quizError: null, isMediaLoaded: false } }));
    store.dispatchEvent(new CustomEvent('quiz:retry'));
});

document.getElementById('btn-skip-end').addEventListener('click', () => {
    observationService.clearCache();
    store.setState(prev => ({
        questions: prev.questions.slice(0, prev.currentIndex),
        ui: { ...prev.ui, activeView: 'results-view' }
    }));
});

document.getElementById('btn-restart').addEventListener('click', () => {
    observationService.clearCache();
    store.resetState();
    loadPreferences();
});

// Boot
loadPreferences();
ui.render(store.getState());
