import { getState, setState, updateQuestion, resetState, subscribe, subscribeSelector, selectCurrentMedia } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';
import * as observationService from './observationService.js';

// ==========================================================================
// DECOUPLED STATE SUBSCRIBERS
// ==========================================================================

// 1. Pure Declarative DOM Rendering
subscribe((newState) => {
    ui.render(newState);
});

// 2. Question Navigation & JIT Prefetch Trigger
subscribeSelector(
    (s) => ({ activeView: s.ui.activeView, index: s.currentIndex }),
    ({ activeView, index }, prev) => {
        const isNewQuiz = prev.activeView !== 'quiz-view' && activeView === 'quiz-view';
        const isNextQuestion = index !== prev.index;

        if (activeView === 'quiz-view' && (isNewQuiz || isNextQuestion)) {
            observationService.loadObservationForQuestion(index);
        }
    },
    (a, b) => a.activeView === b.activeView && a.index === b.index
);

// 3. Observation Data Arrival Reaction
subscribeSelector(
    (s) => s.questions[s.currentIndex]?.observation,
    (obs, prevObs, newState) => {
        if (!obs || obs === prevObs) return;

        if (obs.error) {
            if (obs.emptyPool && newState.config.difficulty === 'all') {
                if (newState.currentIndex === 0) {
                    setState(prev => ({
                        ui: {
                            ...prev.ui,
                            activeView: 'setup-view',
                            setupError: "No observations found matching these strict filters. Try adjusting your settings."
                        }
                    }));
                } else {
                    setState(prev => ({
                        questions: prev.questions.slice(0, prev.currentIndex),
                        ui: { ...prev.ui, activeView: 'results-view' }
                    }));
                }
            } else {
                setState(prev => ({ ui: { ...prev.ui, quizError: { isMissingMedia: false } } }));
            }
        } else {
            const mediaArray = selectCurrentMedia(newState);
            if (mediaArray.length === 0) {
                setState(prev => ({ ui: { ...prev.ui, quizError: { isMissingMedia: true } } }));
            } else if (mediaArray[0].type === 'sound') {
                setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
            }
        }
    }
);

// 4. Cached Media Readiness Controller
subscribeSelector(
    (s) => ({
        activeView: s.ui.activeView,
        isMediaLoaded: s.ui.isMediaLoaded,
        currentIndex: s.currentIndex,
        mediaIndex: s.currentMediaIndex,
        obs: s.questions[s.currentIndex]?.observation
    }),
    ({ activeView, isMediaLoaded, mediaIndex }, _, newState) => {
        if (activeView !== 'quiz-view' || isMediaLoaded) return;

        const mediaArray = selectCurrentMedia(newState);
        const currentMedia = mediaArray[mediaIndex];

        if (currentMedia?.type === 'photo') {
            const imgEl = document.getElementById('quiz-image');
            if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && imgEl.dataset.src === currentMedia.mediumUrl) {
                setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
            }
        } else if (currentMedia?.type === 'sound') {
            const audioPlayer = document.getElementById('quiz-audio-player');
            if (audioPlayer && audioPlayer.readyState >= 2 && audioPlayer.dataset.src === currentMedia.fileUrl) {
                setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
            }
        }
    },
    (a, b) => a.activeView === b.activeView &&
              a.isMediaLoaded === b.isMediaLoaded &&
              a.currentIndex === b.currentIndex &&
              a.mediaIndex === b.mediaIndex &&
              a.obs === b.obs
);

// 5. Sequential Prefetch Trigger
subscribeSelector(
    (s) => ({
        isLoaded: s.ui.isMediaLoaded,
        index: s.currentIndex
    }),
    ({ isLoaded, index }, prev, newState) => {
        if (isLoaded && newState.ui.activeView === 'quiz-view') {
            observationService.loadObservationForQuestion(index + 1);
        }
    },
    (a, b) => a.isLoaded === b.isLoaded && a.index === b.index
);

// --- NAVIGATION PROTECTION ---
window.addEventListener('beforeunload', (e) => {
    const s = getState();
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

function savePreferences() {
    localStorage.setItem('bio_trainer_prefs', JSON.stringify(getState().form));
}

function loadPreferences() {
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (saved) setState(prev => ({ form: { ...prev.form, ...JSON.parse(saved) } }));
    } catch (e) {
        console.warn("Could not load preferences");
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

        if (prop === 'answerInput' || prop === 'rankInput') {
            uiUpdates.answerError = null;
        }

        setState(prev => ({
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
    if (el) el.addEventListener('change', (e) => setState(prev => ({ form: { ...prev.form, [prop]: e.target.checked } })));
});

const selectMonths = document.getElementById('input-months');
if (selectMonths) {
    selectMonths.addEventListener('change', () => {
        const selectedMonths = Array.from(selectMonths.selectedOptions).map(opt => opt.value);
        setState(prev => ({ form: { ...prev.form, months: selectedMonths } }));
    });
}

document.querySelectorAll('input[name="loc-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        setState(prev => ({
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

    // Debounced search trigger (250ms delay)
    const performSearch = debounce(async (query) => {
        // Defensive Check: Ensure the live input still matches the query
        if (inputEl.value.trim() !== query.trim() || query.length < 3) {
            setState(prev => ({ ui: { ...prev.ui, [results]: [] } }));
            return;
        }

        // Instantiate AbortController right before fetch execution
        abortController = new AbortController();

        try {
            const data = await fetchDataFn(query, abortController.signal);
            
            // Double-check input match after fetch resolves before updating state
            if (inputEl.value.trim() === query.trim()) {
                setState(prev => ({ ui: { ...prev.ui, [results]: data.results } }));
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn(`${inputId} search offline`);
            }
        }
    }, 250);

    inputEl.addEventListener('input', (e) => {
        const query = e.target.value;
        const currentResults = getState().ui[results];

        // 1. Kill any pending debounced timer AND active in-flight request
        performSearch.cancel();
        if (abortController) {
            abortController.abort();
            abortController = null;
        }

        const selectedItem = currentResults.find(item => formatDisplay(item) === query);

        // 2. Update form state immediately for instant input responsiveness
        setState(prev => ({
            form: {
                ...prev.form,
                [id]: selectedItem ? selectedItem.id : null,
                [name]: query
            },
            ui: { ...prev.ui, [error]: null }
        }));

        // 3. Queue search if query is not an explicit selection match
        if (!selectedItem) {
            performSearch(query);
        }
    });

    inputEl.addEventListener('focus', () => {
        setState(prev => ({ ui: { ...prev.ui, [error]: null } }));
    });

    inputEl.addEventListener('blur', () => {
        const s = getState();
        const isValid = validateOnBlur ? validateOnBlur(s) : !!s.form[id];

        if ((s.form[name] || '').trim() !== '' && !isValid) {
            setState(prev => ({ ui: { ...prev.ui, [error]: errorMsg } }));
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            // 1. Cancel pending debounced timer
            performSearch.cancel();

            // 2. Abort any active in-flight fetch request
            if (abortController) {
                abortController.abort();
                abortController = null;
            }

            // 3. Reset form and results state
            setState(prev => ({
                form: { ...prev.form, [id]: null, [name]: '' },
                ui: { ...prev.ui, [results]: [], [error]: null }
            }));
            inputEl.focus();
        });
    }
}

setupAutocomplete({
    inputId: 'input-place',
    listId: 'list-place',
    clearBtnId: 'clear-place',
    fetchDataFn: api.fetchPlaces,
    stateKeys: {
        id: 'placeId', name: 'placeName', error: 'placeError', results: 'placeResults'
    },
    formatDisplay: ui.formatPlaceDisplay,
    validateOnBlur: (s) => s.form.locMode === 'search' ? !!s.form.placeId : (s.form.lat !== null && s.form.lng !== null),
    errorMsg: "⚠️ Please select a location from the suggestions list."
});

setupAutocomplete({
    inputId: 'input-taxon',
    listId: 'list-taxon',
    clearBtnId: 'clear-taxon',
    fetchDataFn: api.fetchTaxaAutocomplete,
    stateKeys: {
        id: 'taxonId', name: 'taxonName', error: 'taxonError', results: 'taxonResults'
    },
    formatDisplay: ui.formatTaxonDisplay,
    validateOnBlur: (s) => !!s.form.taxonId,
    errorMsg: "⚠️ Please select a valid target taxon from the suggestions list."
});

document.getElementById('btn-gps').addEventListener('click', () => {
    setState(prev => ({ ui: { ...prev.ui, isLocatingGps: true } }));
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            setState(prev => ({
                form: { ...prev.form, lat: pos.coords.latitude, lng: pos.coords.longitude, placeId: null, placeName: '' },
                ui: { ...prev.ui, isLocatingGps: false }
            }));
        },
        () => setState(prev => ({ ui: { ...prev.ui, isLocatingGps: false, setupError: 'Could not get location' } }))
    );
});

// --- GAME BOOTSTRAPPING ---
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = getState();
    let hasError = false;
    let placeError = null, setupError = null, taxonError = null;

    if (s.form.locMode === 'search' && !s.form.placeId) {
        placeError = "⚠️ Please search and select a location."; hasError = true;
    }
    if (s.form.locMode === 'coords') {
        const lat = parseFloat(s.form.lat);
        const lng = parseFloat(s.form.lng);
        const radius = parseFloat(s.form.radius);

        if (isNaN(lat) || isNaN(lng)) {
            setupError = "Please enter valid latitude and longitude coordinates, or use GPS.";
            hasError = true;
        } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            setupError = "Latitude must be between -90 and 90, and Longitude between -180 and 180.";
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
        setState(prev => ({ ui: { ...prev.ui, placeError, setupError, taxonError } })); return;
    }

    savePreferences();
    observationService.clearCache();

    setState(prev => ({
        config: { ...prev.form, questionLimit: parseInt(prev.form.questionLimit, 10), expertTotalSpecies: 0 },
        ui: { ...prev.ui, isLoadingQuizPool: true, setupError: null, placeError: null, taxonError: null }
    }));

    const updatedState = getState();
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
                setState(prev => ({
                    ui: {
                        ...prev.ui,
                        isLoadingQuizPool: false,
                        setupError: "No observations found matching these strict filters. Try adjusting your settings."
                    }
                }));
                return;
            }

            if (updatedState.config.isRarityMode) {
                const size = updatedState.config.preventDuplicates ? Math.min(updatedState.config.questionLimit, expertCount) : updatedState.config.questionLimit;
                pool = Array.from({ length: size }, () => ({ taxon: null, observation: null }));
            } else {
                pool = Array.from({ length: updatedState.config.questionLimit }, () => ({ taxon: null, observation: null }));
            }
        } else {
            const data = await api.fetchSpeciesPool({
                difficulty: updatedState.config.difficulty, wantsPhotos: updatedState.config.wantsPhotos, wantsSounds: updatedState.config.wantsSounds, months: updatedState.config.months, placeId: updatedState.form.placeId, lat: updatedState.form.lat, lng: updatedState.form.lng, radius: updatedState.form.radius, taxonId: updatedState.form.taxonId, establishmentStatus: updatedState.config.establishmentStatus
            });
            if (!data.results || data.results.length === 0) {
                setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No research-grade observations found. Try a broader search." } }));
                return;
            }
            pool = engine.generateWeightedPool(
                data.results,
                updatedState.config.questionLimit,
                updatedState.config.preventDuplicates,
                updatedState.config.isRarityMode,
                updatedState.config.weightingMethod
            );
        }

        if (pool.length === 0) {
            setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No observations found matching these strict filters. Try adjusting your settings." } }));
            return;
        }

        setState(prev => ({
            config: { ...prev.config, expertTotalSpecies: expertCount },
            questions: pool,
            currentIndex: 0, score: 0, currentMediaIndex: 0,
            form: { ...prev.form, answerInput: '', rankInput: 'species' },
            ui: { ...prev.ui, isLoadingQuizPool: false, activeView: 'quiz-view', quizError: null, isCheckingAnswer: false, isHintVisible: false, isMediaLoaded: false }
        }));
    } catch (error) {
        const isRateLimit = error.status === 429;
        const setupError = isRateLimit
            ? "⏳ Rate limit exceeded. Please wait a minute before starting a new quiz."
            : "Error loading species data. Please check your internet connection.";

        setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError } }));
    }
});

// --- QUIZ ACTIONS & MEDIA CAPTURE ---

document.getElementById('quiz-image').onload = (e) => {
    const s = getState();
    const media = selectCurrentMedia(s)[s.currentMediaIndex];
    if (media && e.target.dataset.src === media.mediumUrl) {
        setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
    }
};

document.getElementById('quiz-image').onerror = () => setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true, quizError: { isMissingMedia: false } } }));
document.getElementById('quiz-audio-player').onerror = () => setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true, quizError: { isMissingMedia: false } } }));
document.getElementById('quiz-audio-player').oncanplay = (e) => {
    const s = getState();
    const media = selectCurrentMedia(s)[s.currentMediaIndex];
    if (media && media.type === 'sound' && e.target.dataset.src === media.fileUrl) {
        setState(prev => ({ ui: { ...prev.ui, isMediaLoaded: true } }));
    }
};

document.getElementById('btn-prev-media').addEventListener('click', () => {
    if (getState().currentMediaIndex > 0) setState(prev => ({ currentMediaIndex: prev.currentMediaIndex - 1, ui: { ...prev.ui, isMediaLoaded: false } }));
});
document.getElementById('btn-next-media').addEventListener('click', () => {
    const s = getState();
    if (s.currentMediaIndex < selectCurrentMedia(s).length - 1) setState(prev => ({ currentMediaIndex: prev.currentMediaIndex + 1, ui: { ...prev.ui, isMediaLoaded: false } }));
});
document.getElementById('btn-toggle-hint').addEventListener('click', () => setState(prev => ({ ui: { ...prev.ui, isHintVisible: !prev.ui.isHintVisible } })));

// Modal Bindings
document.getElementById('btn-zoom-image').addEventListener('click', () => {
    const media = selectCurrentMedia(getState())[getState().currentMediaIndex];
    setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: media.originalUrl, isZoomedIn: false } }));
});
document.getElementById('zoom-modal').addEventListener('close', () => {
    if (getState().ui.zoomMediaUrl) {
        setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: null } }));
    }
});
document.getElementById('zoom-modal-scroll').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: null } }));
    }
});
document.getElementById('btn-close-modal').addEventListener('click', () => setState(prev => ({ ui: { ...prev.ui, zoomMediaUrl: null } })));
document.getElementById('btn-zoom-modal-toggle').addEventListener('click', (e) => {
    const s = getState();
    const willZoomIn = !s.ui.isZoomedIn;
    const zoomImg = document.getElementById('zoom-modal-img');
    const zoomScroll = document.getElementById('zoom-modal-scroll');

    const rect = zoomImg.getBoundingClientRect();
    
    // Fallback to center point (0.5) if triggered via keyboard without clientX
    const clickXPercent = e.clientX ? (e.clientX - rect.left) / rect.width : 0.5;
    const clickYPercent = e.clientY ? (e.clientY - rect.top) / rect.height : 0.5;

    setState(prev => ({ ui: { ...prev.ui, isZoomedIn: willZoomIn } }));

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
    setState(prev => ({ form: { ...prev.form, answerInput: '' } }));
    document.getElementById('input-answer').focus();
});

document.getElementById('btn-skip').addEventListener('click', () => {
    let s = getState();
    const q = s.questions[s.currentIndex];
    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(s));

    updateQuestion(s.currentIndex, {
        isAnswered: true, userAnswer: "(Skipped)", isCorrect: false, pointsEarned: 0, thumbnailUrl: mediaInfo.url, mediaAttribution: mediaInfo.attribution, isSkipped: true
    });
});

document.getElementById('answer-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const s = getState();
    const q = s.questions[s.currentIndex];

    if (s.ui.isCheckingAnswer || q.isAnswered) return;

    const inputStr = (s.form.answerInput || '').trim();
    if (!inputStr) return;

    setState(prev => ({ ui: { ...prev.ui, isCheckingAnswer: true, answerError: null } }));

    const { isCorrect, pointsEarned, matchedNameDisplay, networkError } = await engine.evaluateAnswer(
        inputStr, s.form.rankInput, q.observation?.taxon || q.taxon, observationService.getDynamicNetworkTimeout
    );

    if (networkError) {
        setState(prev => ({
            ui: {
                ...prev.ui,
                isCheckingAnswer: false,
                answerError: "⚠️ Offline: Unable to verify your answer with the database. Check your connection to try again, or skip."
            }
        }));
        return;
    }

    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(getState()));

    updateQuestion(s.currentIndex, {
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

    if (isCorrect) setState(prev => ({ score: prev.score + pointsEarned }));
    setState(prev => ({ ui: { ...prev.ui, isCheckingAnswer: false } }));
});

// Advancing State
document.getElementById('btn-next').addEventListener('click', () => {
    const s = getState();
    const nextIdx = s.currentIndex + 1;
    if (nextIdx >= s.questions.length) {
        setState(prev => ({ ui: { ...prev.ui, activeView: 'results-view' } }));
    } else {
        setState(prev => ({
            currentIndex: nextIdx, currentMediaIndex: 0,
            form: { ...prev.form, answerInput: '', rankInput: 'species' },
            ui: { ...prev.ui, isMediaLoaded: false, isCheckingAnswer: false, quizError: null, isHintVisible: false }
        }));
    }
});

document.getElementById('btn-retry').addEventListener('click', () => {
    updateQuestion(getState().currentIndex, { observation: null });
    setState(prev => ({ ui: { ...prev.ui, quizError: null, isMediaLoaded: false } }));
    observationService.loadObservationForQuestion(getState().currentIndex);
});

document.getElementById('btn-skip-end').addEventListener('click', () => {
    observationService.clearCache();
    setState(prev => ({
        questions: prev.questions.slice(0, prev.currentIndex),
        ui: { ...prev.ui, activeView: 'results-view' }
    }));
});

document.getElementById('btn-restart').addEventListener('click', () => {
    observationService.clearCache();
    resetState();
    loadPreferences();
});

// Boot
loadPreferences();
ui.render(getState());
