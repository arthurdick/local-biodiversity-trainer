import { getState, setState, updateQuestion, resetState, subscribe, subscribeSelector, selectCurrentMedia } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';
import * as observationService from './observationService.js';

// ==========================================================================
// DECOUPLED STATE SUBSCRIBERS
// ==========================================================================

// 1. Pure Declarative DOM Rendering
// Fires on state updates to sync the UI without triggering side-effects
subscribe((newState) => {
    ui.render(newState);
});

// 2. Question Navigation & JIT Prefetch Trigger
// Triggers observation fetching ONLY when entering a quiz or advancing questions
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
// Reacts strictly when new observation data lands on the current active question
subscribeSelector(
    (s) => s.questions[s.currentIndex]?.observation,
    (obs, prevObs, newState) => {
        if (!obs || obs === prevObs) return;

        if (obs.error) {
            if (obs.emptyPool && newState.config.difficulty === 'all') {
                setState({ 
                    questions: newState.questions.slice(0, newState.currentIndex),
                    ui: { ...newState.ui, activeView: 'results-view' }
                });
            } else {
                setState({ ui: { ...newState.ui, quizError: { isMissingMedia: false } } });
            }
        } else {
            const mediaArray = selectCurrentMedia(newState);
            if (mediaArray.length === 0) {
                setState({ ui: { ...newState.ui, quizError: { isMissingMedia: true } } });
            } else if (mediaArray[0].type === 'sound') {
                setState({ ui: { ...newState.ui, isMediaLoaded: true } });
            }
        }
    }
);

// 4. Cached Media Readiness Controller
// Checks image element `.complete` or audio `.readyState` for pre-cached assets
subscribeSelector(
    (s) => ({
        activeView: s.ui.activeView,
        isMediaLoaded: s.ui.isMediaLoaded,
        currentIndex: s.currentIndex,
        mediaIndex: s.currentMediaIndex
    }),
    ({ activeView, isMediaLoaded, mediaIndex }, _, newState) => {
        if (activeView !== 'quiz-view' || isMediaLoaded) return;

        const mediaArray = selectCurrentMedia(newState);
        const currentMedia = mediaArray[mediaIndex];

        if (currentMedia?.type === 'photo') {
            const imgEl = document.getElementById('quiz-image');
            if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && imgEl.dataset.src === currentMedia.mediumUrl) {
                setState({ ui: { ...newState.ui, isMediaLoaded: true } });
            }
        } else if (currentMedia?.type === 'sound') {
            const audioPlayer = document.getElementById('quiz-audio-player');
            if (audioPlayer && audioPlayer.readyState >= 2 && audioPlayer.dataset.src === currentMedia.fileUrl) {
                setState({ ui: { ...newState.ui, isMediaLoaded: true } });
            }
        }
    },
    (a, b) => a.activeView === b.activeView &&
              a.isMediaLoaded === b.isMediaLoaded &&
              a.currentIndex === b.currentIndex &&
              a.mediaIndex === b.mediaIndex
);

// 5. Sequential Prefetch Trigger
// Ensures the next observation is prefetched only after the current media finishes loading (cached or network)
subscribeSelector(
    (s) => s.ui.isMediaLoaded,
    (isLoaded, prevLoaded, newState) => {
        if (isLoaded && !prevLoaded && newState.ui.activeView === 'quiz-view') {
            observationService.loadObservationForQuestion(newState.currentIndex + 1);
        }
    }
);

// --- STORAGE ---
function debounce(func, timeout = 250) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => { func.apply(this, args); }, timeout); };
}

function savePreferences() {
    localStorage.setItem('bio_trainer_prefs', JSON.stringify(getState().form));
}

function loadPreferences() {
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (saved) setState({ form: { ...getState().form, ...JSON.parse(saved) } });
    } catch (e) {
        console.warn("Could not load preferences");
    }
}

// --- DECLARATIVE FORM TWO-WAY BINDING ---
['lat', 'lng', 'radius', 'difficulty', 'questionLimit', 'answerInput', 'rankInput'].forEach(prop => {
    const elId = prop === 'questionLimit' ? 'input-questions' : `input-${prop.replace('Input', '')}`;
    
    const el = document.getElementById(elId);
    if (el) el.addEventListener('input', (e) => {
        const updates = { [prop]: e.target.value };
        setState({ form: { ...getState().form, ...updates } });
    });
});

['wantsPhotos', 'wantsSounds', 'preventDuplicates', 'isRarityMode'].forEach(prop => {
    const elId = prop === 'preventDuplicates' ? 'chk-unique' : 
                 prop === 'isRarityMode' ? 'chk-rarity' : `chk-${prop.replace('wants', '').toLowerCase()}`;
                 
    const el = document.getElementById(elId);
    if (el) el.addEventListener('change', (e) => setState({ form: { ...getState().form, [prop]: e.target.checked } }));
});

document.getElementById('month-filters').addEventListener('change', () => {
    const months = Array.from(document.querySelectorAll('#month-filters input:checked')).map(cb => cb.value);
    setState({ form: { ...getState().form, months } });
});

document.getElementById('btn-months-all').addEventListener('click', () => {
    setState({ form: { ...getState().form, months: ['1','2','3','4','5','6','7','8','9','10','11','12'] } });
});

document.getElementById('btn-months-none').addEventListener('click', () => {
    setState({ form: { ...getState().form, months: [] } });
});

document.querySelectorAll('input[name="loc-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        setState({ 
            form: { ...getState().form, locMode: e.target.value, lat: null, lng: null, placeId: null, placeName: '' },
            ui: { ...getState().ui, setupError: null, placeError: null } 
        });
    });
});

// --- AUTOCOMPLETE LOGIC ---
function setupAutocomplete(config) {
    const {
        inputId, listId, clearBtnId, fetchDataFn,
        stateKeys: { id, name, error, results, showList, activeIdx },
        formatDisplay, validateOnBlur, errorMsg
    } = config;

    let abortController = null;
    const inputEl = document.getElementById(inputId);
    const listEl = document.getElementById(listId);
    const clearBtn = document.getElementById(clearBtnId);

    // 1. Input Event (Debounced Fetch)
    inputEl.addEventListener('input', debounce(async (e) => {
        const query = e.target.value;
        setState({ 
            form: { ...getState().form, [id]: null, [name]: query },
            ui: { ...getState().ui, [activeIdx]: -1, [error]: null }
        });
        
        if (query.length < 3) {
            setState({ ui: { ...getState().ui, [showList]: false } });
            return;
        }

        if (abortController) abortController.abort();
        abortController = new AbortController();

        try {
            const data = await fetchDataFn(query, abortController.signal);
            setState({ ui: { ...getState().ui, [results]: data.results, [showList]: data.results.length > 0 } });
        } catch(err) {
            if (err.name !== 'AbortError') console.warn(`${inputId} search offline`);
        }
    }));

    // 2. Focus Event (Re-open & Clear Error)
    inputEl.addEventListener('focus', (e) => {
        const s = getState();
        const hasNoSelection = !s.form[id];
        const shouldShow = hasNoSelection && e.target.value.length >= 3 && s.ui[results].length > 0;
        setState({ ui: { ...s.ui, [error]: null, [showList]: shouldShow } });
    });

    // 3. Blur Event (Validation)
    inputEl.addEventListener('blur', () => {
        setTimeout(() => {
            const s = getState();
            // Use custom validation if provided, otherwise default to checking if the ID exists
            const isValid = validateOnBlur ? validateOnBlur(s) : !!s.form[id];
            
            if ((s.form[name] || '').trim() !== '' && !isValid) {
                setState({ ui: { ...s.ui, [error]: errorMsg, [showList]: false } });
            } else if (s.ui[showList]) {
                setState({ ui: { ...s.ui, [showList]: false } });
            }
        }, 200);
    });

    // 4. Keyboard Navigation
    inputEl.addEventListener('keydown', (e) => {
        const s = getState();
        if (!s.ui[showList]) return;
        
        listEl.classList.add('using-keyboard');
        
        let newIdx = s.ui[activeIdx];
        const total = s.ui[results].length;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            newIdx = (newIdx < total - 1) ? newIdx + 1 : 0;
            setState({ ui: { ...s.ui, [activeIdx]: newIdx } });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            newIdx = (newIdx > 0) ? newIdx - 1 : total - 1;
            setState({ ui: { ...s.ui, [activeIdx]: newIdx } });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (newIdx >= 0 && newIdx < total) {
                const item = s.ui[results][newIdx];
                setState({ 
                    form: { ...s.form, [id]: item.id, [name]: formatDisplay(item) },
                    ui: { ...s.ui, [showList]: false, [error]: null }
                });
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setState({ ui: { ...s.ui, [showList]: false } });
        }
    });

    // 5. Mouse Intent Tracking
    listEl.addEventListener('mousemove', (e) => e.currentTarget.classList.remove('using-keyboard'));

    // 6. Click Delegation
    listEl.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li) {
            const idx = parseInt(li.id.split('-').pop(), 10);
            const item = getState().ui[results][idx];
            setState({ 
                form: { ...getState().form, [id]: item.id, [name]: formatDisplay(item) },
                ui: { ...getState().ui, [showList]: false, [error]: null }
            });
            inputEl.focus();
        }
    });

    // 7. Clear Button Action
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            setState({
                form: { ...getState().form, [id]: null, [name]: '' },
                ui: { ...getState().ui, [showList]: false, [error]: null }
            });
            inputEl.focus();
        });
    }
}

// Register active dropdown UI keys to easily clear them globally
const activeDropdownKeys = ['showPlaceList', 'showTaxonList'];

setupAutocomplete({
    inputId: 'input-place',
    listId: 'list-place',
    clearBtnId: 'clear-place',
    fetchDataFn: api.fetchPlaces,
    stateKeys: {
        id: 'placeId', name: 'placeName', error: 'placeError',
        results: 'placeResults', showList: 'showPlaceList', activeIdx: 'activePlaceIdx'
    },
    formatDisplay: (item) => item.display_name || item.name,
    validateOnBlur: (s) => s.form.locMode === 'search' ? !!s.form.placeId : (s.form.lat !== null && s.form.lng !== null),
    errorMsg: "⚠️ Please select a location from the dropdown list."
});

setupAutocomplete({
    inputId: 'input-taxon',
    listId: 'list-taxon',
    clearBtnId: 'clear-taxon',
    fetchDataFn: api.fetchTaxaAutocomplete,
    stateKeys: {
        id: 'taxonId', name: 'taxonName', error: 'taxonError',
        results: 'taxonResults', showList: 'showTaxonList', activeIdx: 'activeTaxonIdx'
    },
    formatDisplay: (item) => item.preferred_common_name ? `${item.preferred_common_name} (${item.name})` : item.name,
    validateOnBlur: (s) => !!s.form.taxonId,
    errorMsg: "⚠️ Please select a valid target taxon from the list."
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        const s = getState();
        const updates = {};
        let shouldUpdate = false;
        
        activeDropdownKeys.forEach(key => {
            if (s.ui[key]) {
                updates[key] = false;
                shouldUpdate = true;
            }
        });
        
        if (shouldUpdate) setState({ ui: { ...s.ui, ...updates } });
    }
});

document.getElementById('btn-gps').addEventListener('click', () => {
    setState({ ui: { ...getState().ui, isLocatingGps: true } });
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            setState({
                form: { ...getState().form, lat: pos.coords.latitude, lng: pos.coords.longitude, placeId: null, placeName: '' },
                ui: { ...getState().ui, isLocatingGps: false }
            });
        },
        () => setState({ ui: { ...getState().ui, isLocatingGps: false, setupError: 'Could not get location' } })
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
        const lat = parseFloat(s.form.lat); const lng = parseFloat(s.form.lng);
        if (isNaN(lat) || isNaN(lng)) { setupError = "Please enter valid latitude and longitude coordinates, or use GPS."; hasError = true; } 
        else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { setupError = "Latitude must be between -90 and 90, and Longitude between -180 and 180."; hasError = true; }
    }
    
    if ((s.form.taxonName || '').trim() !== '' && !s.form.taxonId) { taxonError = "⚠️ Please select a valid target taxon from the list, or clear this field."; hasError = true; }
    if (!s.form.wantsPhotos && !s.form.wantsSounds) { setupError = "Please select at least one media type (Photos or Sounds)."; hasError = true; }
    if (s.form.months.length === 0) { setupError = "Please select at least one month for seasonality."; hasError = true; }

    if (hasError) {
        setState({ ui: { ...s.ui, placeError, setupError, taxonError } }); return;
    }

    savePreferences();
    
    observationService.clearCache();
    
    setState({ 
        config: { ...s.form, questionLimit: parseInt(s.form.questionLimit, 10), expertTotalSpecies: 0 },
        ui: { ...s.ui, isLoadingQuizPool: true, setupError: null, placeError: null, taxonError: null } 
    });

    const updatedState = getState();
    const isExpert = updatedState.config.difficulty === 'all';

    try {
        let pool = [];
        let expertCount = 0;
        
        if (isExpert && updatedState.config.isRarityMode) {
            const preFlightData = await api.fetchSpeciesPool({
                perPage: 1, wantsPhotos: updatedState.config.wantsPhotos, wantsSounds: updatedState.config.wantsSounds, months: updatedState.config.months, placeId: updatedState.form.placeId, lat: updatedState.form.lat, lng: updatedState.form.lng, radius: updatedState.form.radius, taxonId: updatedState.form.taxonId
            });
            expertCount = preFlightData.total_results || 0;
            
            if (expertCount === 0) {
                setState({ ui: { ...getState().ui, isLoadingQuizPool: false, setupError: "No observations found matching these strict filters. Try adjusting your settings." } });
                return;
            }

            const size = updatedState.config.preventDuplicates ? Math.min(updatedState.config.questionLimit, expertCount) : updatedState.config.questionLimit;
            pool = Array.from({ length: size }, () => ({ taxon: null, observation: null }));
        } else if (isExpert) {
            pool = Array.from({ length: updatedState.config.questionLimit }, () => ({ taxon: null, observation: null }));
        } else {
            const data = await api.fetchSpeciesPool({
                difficulty: updatedState.config.difficulty, wantsPhotos: updatedState.config.wantsPhotos, wantsSounds: updatedState.config.wantsSounds, months: updatedState.config.months, placeId: updatedState.form.placeId, lat: updatedState.form.lat, lng: updatedState.form.lng, radius: updatedState.form.radius, taxonId: updatedState.form.taxonId
            });
            if (!data.results || data.results.length === 0) {
                setState({ ui: { ...getState().ui, isLoadingQuizPool: false, setupError: "No research-grade observations found. Try a broader search." } });
                return;
            }
            pool = engine.generateWeightedPool(data.results, updatedState.config.questionLimit, updatedState.config.preventDuplicates, updatedState.config.isRarityMode);
        }
        
        if (pool.length === 0) {
            setState({ ui: { ...getState().ui, isLoadingQuizPool: false, setupError: "No observations found matching these strict filters. Try adjusting your settings." } });
            return;
        }

        setState({
            config: { ...updatedState.config, expertTotalSpecies: expertCount },
            questions: pool,
            currentIndex: 0, score: 0, currentMediaIndex: 0,
            form: { ...updatedState.form, answerInput: '', rankInput: 'species' },
            ui: { ...updatedState.ui, isLoadingQuizPool: false, activeView: 'quiz-view', quizError: null, isCheckingAnswer: false, isHintVisible: false, isMediaLoaded: false }
        });
    } catch (error) {
        setState({ ui: { ...getState().ui, isLoadingQuizPool: false, setupError: "Error loading species data. Please check your internet connection." } });
    }
});

// --- QUIZ ACTIONS & MEDIA CAPTURE ---

// Track successful media loading
document.getElementById('quiz-image').onload = (e) => {
    const s = getState();
    const media = selectCurrentMedia(s)[s.currentMediaIndex];
    if (media && e.target.dataset.src === media.mediumUrl) {
        setState({ ui: { ...s.ui, isMediaLoaded: true } });
    }
};

document.getElementById('quiz-image').onerror = () => setState({ ui: { ...getState().ui, isMediaLoaded: true, quizError: { isMissingMedia: false } } });
document.getElementById('quiz-audio-player').onerror = () => setState({ ui: { ...getState().ui, isMediaLoaded: true, quizError: { isMissingMedia: false } } });
document.getElementById('quiz-audio-player').oncanplay = () => {
    const s = getState();
    const media = selectCurrentMedia(s)[s.currentMediaIndex];
    if (media && media.type === 'sound') {
        setState({ ui: { ...s.ui, isMediaLoaded: true } });
    }
};

document.getElementById('btn-prev-media').addEventListener('click', () => {
    if (getState().currentMediaIndex > 0) setState({ currentMediaIndex: getState().currentMediaIndex - 1, ui: { ...getState().ui, isMediaLoaded: false } });
});
document.getElementById('btn-next-media').addEventListener('click', () => {
    const s = getState();
    if (s.currentMediaIndex < selectCurrentMedia(s).length - 1) setState({ currentMediaIndex: s.currentMediaIndex + 1, ui: { ...s.ui, isMediaLoaded: false } });
});
document.getElementById('btn-toggle-hint').addEventListener('click', () => setState({ ui: { ...getState().ui, isHintVisible: !getState().ui.isHintVisible } }));

// Modal Bindings
document.getElementById('btn-zoom-image').addEventListener('click', () => {
    const media = selectCurrentMedia(getState())[getState().currentMediaIndex];
    setState({ ui: { ...getState().ui, zoomMediaUrl: media.originalUrl, isZoomedIn: false } });
});
document.getElementById('zoom-modal').addEventListener('close', () => {
    if (getState().ui.zoomMediaUrl) {
        setState({ ui: { ...getState().ui, zoomMediaUrl: null } });
    }
});
document.getElementById('btn-close-modal').addEventListener('click', () => setState({ ui: { ...getState().ui, zoomMediaUrl: null } }));
document.getElementById('zoom-modal-img').addEventListener('click', (e) => {
    const s = getState();
    const willZoomIn = !s.ui.isZoomedIn;
    const zoomImg = document.getElementById('zoom-modal-img');
    
    // Capture the bounding rect BEFORE modifying state and forcing a re-render
    const rect = zoomImg.getBoundingClientRect();
    
    setState({ ui: { ...s.ui, isZoomedIn: willZoomIn } });
    
    if (willZoomIn) {
        const zoomScroll = document.getElementById('zoom-modal-scroll');
        
        requestAnimationFrame(() => {
            const targetX = zoomImg.offsetLeft + (zoomImg.offsetWidth * ((e.clientX - rect.left) / rect.width));
            const targetY = zoomImg.offsetTop + (zoomImg.offsetHeight * ((e.clientY - rect.top) / rect.height));
            zoomScroll.scrollLeft = targetX - (zoomScroll.clientWidth / 2);
            zoomScroll.scrollTop = targetY - (zoomScroll.clientHeight / 2);
        });
    }
});

// Answer Loop
document.getElementById('clear-answer').addEventListener('click', () => {
    setState({ form: { ...getState().form, answerInput: '' } });
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
    e.preventDefault(); // Prevent the page from actually reloading
    
    const s = getState();
    const q = s.questions[s.currentIndex];
    
    // DEFENSIVE GUARD: Prevent double-submits if already checking or already answered
    if (s.ui.isCheckingAnswer || q.isAnswered) return; 

    const inputStr = (s.form.answerInput || '').trim();
    if (!inputStr) return;

    setState({ ui: { ...s.ui, isCheckingAnswer: true } });

    const { isCorrect, pointsEarned, matchedNameDisplay } = await engine.evaluateAnswer(
        inputStr, s.form.rankInput, q.observation?.taxon || q.taxon, observationService.getDynamicNetworkTimeout
    );
    
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
    
    if (isCorrect) setState({ score: getState().score + pointsEarned });
    setState({ ui: { ...getState().ui, isCheckingAnswer: false } });
});

// Advancing State
document.getElementById('btn-next').addEventListener('click', () => {
    const s = getState();
    const nextIdx = s.currentIndex + 1;
    if (nextIdx >= s.questions.length) {
        setState({ ui: { ...s.ui, activeView: 'results-view' } });
    } else {
        setState({ 
            currentIndex: nextIdx, currentMediaIndex: 0,
            form: { ...s.form, answerInput: '', rankInput: 'species' },
            ui: { ...s.ui, isMediaLoaded: false, isCheckingAnswer: false, quizError: null, isHintVisible: false }
        });
    }
});

document.getElementById('btn-retry').addEventListener('click', () => {
    updateQuestion(getState().currentIndex, { observation: null });
    setState({ ui: { ...getState().ui, quizError: null, isMediaLoaded: false } });
    observationService.loadObservationForQuestion(getState().currentIndex);
});

document.getElementById('btn-skip-end').addEventListener('click', () => {
    setState({ 
        questions: getState().questions.slice(0, getState().currentIndex),
        ui: { ...getState().ui, activeView: 'results-view' }
    });
});

document.getElementById('btn-restart').addEventListener('click', () => {
    observationService.clearCache();
    resetState();
    loadPreferences();
});

// Boot
loadPreferences();
// Manually fire render to paint initial state DOM
ui.render(getState());
