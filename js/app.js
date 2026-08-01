import { store, selectCurrentMedia, saveInitialDailyScore, getDailyScores } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';
import * as observationService from './observationService.js';
import { parseUrlParams, copyResultToClipboard, copyShareLinkToClipboard, buildShareableUrl } from './urlService.js';

// ==========================================================================
// EVENT TARGET LIFECYCLE ROUTER
// ==========================================================================

store.addEventListener('statechange', (e) => {
    ui.render(e.detail);
    syncUrlWithState(e.detail);
});

store.addEventListener('quiz:start', () => {
    observationService.loadObservationForQuestion(store.getState().currentIndex);
});

store.addEventListener('quiz:next', () => {
    observationService.loadObservationForQuestion(store.getState().currentIndex);
});

store.addEventListener('quiz:retry', () => {
    const s = store.getState();
    const q = s.questions[s.currentIndex];
    
    if (q.observation && !q.observation.error) {
        checkMediaReadiness();
    } else {
        store.updateQuestion(s.currentIndex, { observation: null });
        observationService.loadObservationForQuestion(s.currentIndex);
    }
});

store.addEventListener('observation:loaded', (e) => {
    const { index, error, emptyPool } = e.detail;
    const s = store.getState();
    
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
                finishQuizSession();
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

store.addEventListener('observation:loaded', async (e) => {
    const { index, error } = e.detail;
    const s = store.getState();

    if (!error && s.config.isMultipleChoice) {
        const q = s.questions[index];
        const targetTaxon = q?.observation?.taxon || q?.taxon;

        if (targetTaxon && !q.mcOptions) {
            let apiSimilarResults = [];

            try {
                const similarData = await api.fetchSimilarTaxa(targetTaxon.id);
                apiSimilarResults = similarData?.results || [];
            } catch (err) {
                console.warn('Could not fetch similar species API, falling back to regional pool:', err);
            }

            const options = engine.generateMultipleChoiceOptions(
                targetTaxon,
                s.regionalPool,
                apiSimilarResults
            );

            store.updateQuestion(index, { mcOptions: options });
        }
    }
});

store.addEventListener('media:ready', () => {
    const s = store.getState();
    if (s.ui.activeView === 'quiz-view') {
        observationService.loadObservationForQuestion(s.currentIndex + 1);
    }
});

store.addEventListener('media:navigate', () => {
    checkMediaReadiness();
});

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

function syncUrlWithState(state) {
    // Only update address bar while on the setup screen
    if (state.ui.activeView !== 'setup-view') return;

    const cleanBase = window.location.protocol + "//" + window.location.host + window.location.pathname;

    // Do not wipe URL search parameters if the session was loaded via a deep link / URL challenge
    if (state.ui.isUrlChallenge) return;

    if (state.form.isDailyMode) {
        const activeDailyUrl = buildShareableUrl(state.form, 'daily');
        if (window.location.href !== activeDailyUrl) {
            window.history.replaceState(null, '', activeDailyUrl);
        }
    } else if (window.location.search) {
        // Clear query parameters in standard Custom Mode
        window.history.replaceState(null, '', cleanBase);
    }
}

const setupForm = document.getElementById('setup-form');
if (setupForm) {
    ['input', 'change', 'click'].forEach(eventType => {
        setupForm.addEventListener(eventType, (e) => {
            // Ignore main form submission triggers
            if (e.target.id === 'btn-start' || e.target.id === 'btn-trigger-daily') return;

            // Delegated check: Reset URL challenge mode on first user edit
            if (store.getState().ui.isUrlChallenge) {
                store.setState(prev => ({
                    ui: { ...prev.ui, isUrlChallenge: false }
                }));
            }
        });
    });
}

function finishQuizSession() {
    const s = store.getState();
    
    if (s.config.isDailyMode) {
        const locKey = engine.buildLocationSeedKey(s.config);
        saveInitialDailyScore(locKey, s.score, s.questions.length);
    }

    store.setState(prev => ({
        ui: { ...prev.ui, activeView: 'results-view' }
    }));
}

window.addEventListener('beforeunload', (e) => {
    const s = store.getState();
    if (s.ui.activeView === 'quiz-view') {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

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
        if (!isNaN(lat) && lat >= -90 && lat <= 90) sanitized.lat = Number(lat.toFixed(3));
    }

    if (raw.lng !== null && raw.lng !== undefined) {
        const lng = parseFloat(raw.lng);
        if (!isNaN(lng) && lng >= -180 && lng <= 180) sanitized.lng = Number(lng.toFixed(3));
    }

    if (raw.radius !== undefined) {
        const radius = parseFloat(raw.radius);
        if (!isNaN(radius) && radius >= 1 && radius <= 100) sanitized.radius = radius;
    }

    if (typeof raw.taxonName === 'string') sanitized.taxonName = raw.taxonName;
    if (raw.taxonId === null || typeof raw.taxonId === 'number') sanitized.taxonId = raw.taxonId;

    if (typeof raw.userLogin === 'string') sanitized.userLogin = raw.userLogin;
    if (raw.userId === null || typeof raw.userId === 'number') sanitized.userId = raw.userId;
    
    const validLifeList = ['off', 'observed', 'unobserved'];
    if (validLifeList.includes(raw.lifeListMode)) sanitized.lifeListMode = raw.lifeListMode;

    if (typeof raw.showIconicTaxonBadge === 'boolean') sanitized.showIconicTaxonBadge = raw.showIconicTaxonBadge;
    if (typeof raw.preventDuplicates === 'boolean') sanitized.preventDuplicates = raw.preventDuplicates;
    if (typeof raw.isRarityMode === 'boolean') sanitized.isRarityMode = raw.isRarityMode;
    if (typeof raw.isMultipleChoice === 'boolean') sanitized.isMultipleChoice = raw.isMultipleChoice;

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

    const parsedQuestions = parseInt(raw.questionLimit, 10);
    if ([5, 10, 20, 50].includes(parsedQuestions)) {
        sanitized.questionLimit = parsedQuestions;
    }

    const validWeighting = ['linear', 'log'];
    if (validWeighting.includes(raw.weightingMethod)) sanitized.weightingMethod = raw.weightingMethod;

    const validEstablishment = ['any', 'native', 'introduced', 'endemic'];
    if (validEstablishment.includes(raw.establishmentStatus)) sanitized.establishmentStatus = raw.establishmentStatus;
    
    return sanitized;
}

function savePreferences() {
    try {
        const currentForm = store.getState().form;
        if (currentForm.isDailyMode || store.getState().ui.isUrlChallenge) {
            return;
        }
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

const debouncedSavePreferences = debounce(savePreferences, 300);

// Subscribe URL syncing and preference persistence to store updates
store.addEventListener('statechange', (e) => {
    ui.render(e.detail);
    syncUrlWithState(e.detail);

    // Auto-save user preferences when editing settings on the setup screen
    if (e.detail.ui.activeView === 'setup-view') {
        debouncedSavePreferences();
    }
});

['lat', 'lng', 'radius', 'difficulty', 'questionLimit', 'answerInput', 'rankInput', 'weightingMethod', 'establishmentStatus', 'lifeListMode'].forEach(prop => {
    let elId = `input-${prop.replace('Input', '')}`;
    if (prop === 'questionLimit') elId = 'input-questions';
    if (prop === 'weightingMethod') elId = 'input-weighting';
    if (prop === 'establishmentStatus') elId = 'input-establishment';
    if (prop === 'lifeListMode') elId = 'input-lifelist';

    const el = document.getElementById(elId);
    if (el) el.addEventListener('input', (e) => {
        let val = e.target.value;

        if (prop === 'questionLimit') {
            val = parseInt(val, 10);
        } else if (prop === 'radius') {
            val = parseFloat(val);
        } else if (prop === 'lat' || prop === 'lng') {
            val = val === '' ? null : parseFloat(val);
        }

        const updates = { [prop]: val };
        const uiUpdates = {};

        if (prop === 'answerInput' || prop === 'rankInput') uiUpdates.answerError = null;

        store.setState(prev => ({
            form: { ...prev.form, ...updates },
            ui: { ...prev.ui, ...uiUpdates }
        }));
    });
});

['wantsPhotos', 'wantsSounds', 'preventDuplicates', 'isRarityMode', 'showIconicTaxonBadge', 'isMultipleChoice'].forEach(prop => {
    const elId = prop === 'preventDuplicates' ? 'chk-unique' :
                 prop === 'isRarityMode' ? 'chk-rarity' :
                 prop === 'showIconicTaxonBadge' ? 'chk-badge' :
                 prop === 'isMultipleChoice' ? 'chk-mc' :
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
        if (store.getState().form.isDailyMode) return;
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

function setupAutocomplete(config) {
    const {
        inputId, listId, clearBtnId, fetchDataFn,
        stateKeys: { id, name, error, results },
        formatDisplay, validateOnBlur, errorMsg
    } = config;

    let abortController = null;
    const inputEl = document.getElementById(inputId);
    const clearBtn = document.getElementById(clearBtnId);

    const isItemMatch = (item, query) => {
        if (!item || typeof query !== 'string') return false;
        const normQuery = query.trim().toLowerCase();
        if (!normQuery) return false;

        const candidateFields = [
            formatDisplay(item),
            item.display_name,
            item.name,
            item.preferred_common_name,
            item.matched_term,
            item.login
        ];

        return candidateFields.some(candidate =>
            typeof candidate === 'string' && candidate.trim().toLowerCase() === normQuery
        );
    };

    const performSearch = debounce(async (query) => {
        if (inputEl.value.trim() !== query.trim() || query.length < 3) {
            store.setState(prev => ({ ui: { ...prev.ui, [results]: [] } }));
            return;
        }

        abortController = new AbortController();

        try {
            const data = await fetchDataFn(query, abortController.signal);
            if (inputEl.value.trim() === query.trim()) {
                store.setState(prev => ({
                    ui: { ...prev.ui, [results]: data.results, [error]: null }
                }));
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn(`${inputId} search offline:`, err);
                const errorMessage = err.status === 429
                    ? "⏳ Too many requests. Please wait a moment before typing."
                    : "⚠️ Network error: Unable to load suggestions. Check your connection.";
                
                store.setState(prev => ({
                    ui: { ...prev.ui, [error]: errorMessage, [results]: [] }
                }));
            }
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

        const selectedItem = currentResults.find(item => isItemMatch(item, query));

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

setupAutocomplete({
    inputId: 'input-username', listId: 'list-username', clearBtnId: 'clear-username',
    fetchDataFn: api.fetchUsersAutocomplete,
    stateKeys: { id: 'userId', name: 'userLogin', error: 'userError', results: 'userResults' },
    formatDisplay: ui.formatUserDisplay,
    validateOnBlur: (s) => true,
    errorMsg: "⚠️ Please enter a valid iNaturalist username."
});

document.getElementById('btn-gps').addEventListener('click', () => {
    store.setState(prev => ({ ui: { ...prev.ui, isLocatingGps: true } }));
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            // Round to 3 decimal places immediately on capture
            const lat = Number(pos.coords.latitude.toFixed(3));
            const lng = Number(pos.coords.longitude.toFixed(3));

            store.setState(prev => ({
                form: { ...prev.form, lat, lng, placeId: null, placeName: '' },
                ui: { ...prev.ui, isLocatingGps: false }
            }));
        },
        () => store.setState(prev => ({ ui: { ...prev.ui, isLocatingGps: false, setupError: 'Could not get location' } }))
    );
});

function exitDailyMode() {
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

    let savedPrefs = {};
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (saved) savedPrefs = JSON.parse(saved);
    } catch (e) {
        console.warn('Could not read saved preferences on exit:', e);
    }

    store.setState(prev => ({
        form: {
            ...prev.form,
            ...savedPrefs,
            isDailyMode: false,
            dailySeedDate: null
        },
        ui: {
            ...prev.ui,
            isUrlChallenge: false,
            setupError: null
        }
    }));
}

document.getElementById('btn-trigger-daily')?.addEventListener('click', () => {
    const isDaily = store.getState().form.isDailyMode;
    if (isDaily) {
        exitDailyMode();
    } else {
        store.setState(prev => ({
            form: engine.applyDailyEnforcements(prev.form),
            ui: { ...prev.ui, isUrlChallenge: false }
        }));
    }
});

document.getElementById('btn-exit-daily')?.addEventListener('click', () => {
    exitDailyMode();
});

// --- GAME BOOTSTRAPPING ---
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = store.getState();
    let hasError = false;
    let placeError = null, setupError = null, taxonError = null, userError = null;

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
    if (s.form.lifeListMode !== 'off' && (!s.form.userLogin || !s.form.userLogin.trim())) { userError = "⚠️ Please enter an iNaturalist username to use Life List filtering."; hasError = true; }
    if (!s.form.wantsPhotos && !s.form.wantsSounds) { setupError = "Please select at least one media type (Photos or Sounds)."; hasError = true; }
    if (s.form.months.length === 0) { setupError = "Please select at least one month for seasonality."; hasError = true; }

    if (hasError) {
        store.setState(prev => ({ ui: { ...prev.ui, placeError, setupError, taxonError, userError } })); return;
    }

    // Cancel pending debounced save and persist preferences immediately
    debouncedSavePreferences.cancel();
    savePreferences();
    observationService.clearCache();

    // Determine if this Daily Challenge run is a Replay!
    let isReplay = false;
    if (s.form.isDailyMode) {
        const locKey = engine.buildLocationSeedKey(s.form);
        const dailyScores = getDailyScores();
        if (dailyScores.scores[locKey]) {
            isReplay = true;
        }
    }

    store.setState(prev => ({
        config: { ...prev.form, expertTotalSpecies: 0, isReplay },
        ui: { ...prev.ui, isLoadingQuizPool: true, setupError: null, placeError: null, taxonError: null, userError: null }
    }));

    const updatedState = store.getState();
    const isExpert = updatedState.config.difficulty === 'all';
    const isDaily = !!updatedState.config.isDailyMode;

    try {
        let pool = [];
        let expertCount = 0;
        let regionalResults = [];

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
                establishmentStatus: updatedState.config.establishmentStatus,
                lifeListMode: updatedState.config.lifeListMode,
                userLogin: updatedState.config.userLogin,
                userId: updatedState.config.userId,
                isDailyMode: isDaily,
                dailySeedDate: updatedState.config.dailySeedDate
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
                difficulty: updatedState.config.difficulty,
                wantsPhotos: updatedState.config.wantsPhotos,
                wantsSounds: updatedState.config.wantsSounds,
                months: updatedState.config.months,
                placeId: updatedState.form.placeId,
                lat: updatedState.form.lat,
                lng: updatedState.form.lng,
                radius: updatedState.form.radius,
                taxonId: updatedState.form.taxonId,
                establishmentStatus: updatedState.config.establishmentStatus,
                lifeListMode: updatedState.config.lifeListMode,
                userLogin: updatedState.config.userLogin,
                userId: updatedState.config.userId,
                isDailyMode: isDaily,
                dailySeedDate: updatedState.config.dailySeedDate
            });
            if (!data.results || data.results.length === 0) {
                store.setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No research-grade observations found." } }));
                return;
            }

            regionalResults = data.results;

            let poolRng = Math.random;
            if (isDaily) {
                const seedKey = engine.buildLocationSeedKey(updatedState.config);
                const seedInt = engine.hashString(seedKey);
                poolRng = engine.createPRNG(seedInt);
            }

            pool = engine.generateWeightedPool(
                data.results, 
                updatedState.config.questionLimit, 
                updatedState.config.preventDuplicates, 
                updatedState.config.isRarityMode, 
                updatedState.config.weightingMethod,
                poolRng
            );
        }

        if (pool.length === 0) {
            store.setState(prev => ({ ui: { ...prev.ui, isLoadingQuizPool: false, setupError: "No observations found matching these strict filters." } }));
            return;
        }

        store.setState(prev => ({
            config: { ...prev.config, expertTotalSpecies: expertCount },
            regionalPool: regionalResults,
            questions: pool, currentIndex: 0, score: 0, currentMediaIndex: 0,
            form: { ...prev.form, answerInput: '', rankInput: 'species' },
            ui: { ...prev.ui, isLoadingQuizPool: false, activeView: 'quiz-view', quizError: null, isCheckingAnswer: false, isHintVisible: false, isMediaLoaded: false }
        }));
        
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

// License Modal Bindings
document.getElementById('btn-license-modal').addEventListener('click', async () => {
    const currentState = store.getState();

    store.setState(prev => ({
        ui: {
            ...prev.ui,
            isLicenseModalOpen: true,
            isLoadingLicense: !prev.ui.licenseText,
            licenseError: null
        }
    }));

    if (!currentState.ui.licenseText) {
        try {
            const text = await api.fetchLicense();
            store.setState(prev => ({
                ui: {
                    ...prev.ui,
                    licenseText: text,
                    isLoadingLicense: false
                }
            }));
        } catch (err) {
            console.warn('Failed to fetch LICENSE file:', err);
            store.setState(prev => ({
                ui: {
                    ...prev.ui,
                    isLoadingLicense: false,
                    licenseError: '⚠️ Unable to load license text.'
                }
            }));
        }
    }
});

document.getElementById('btn-close-license-modal').addEventListener('click', () => {
    store.setState(prev => ({ ui: { ...prev.ui, isLicenseModalOpen: false } }));
});

document.getElementById('license-modal').addEventListener('close', () => {
    if (store.getState().ui.isLicenseModalOpen) {
        store.setState(prev => ({ ui: { ...prev.ui, isLicenseModalOpen: false } }));
    }
});

document.getElementById('license-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        store.setState(prev => ({ ui: { ...prev.ui, isLicenseModalOpen: false } }));
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
    
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.focus();
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
    
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.focus();
});

document.getElementById('mc-options-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-mc-option');
    if (!btn || btn.disabled) return;

    const s = store.getState();
    const q = s.questions[s.currentIndex];
    if (q.isAnswered) return;

    const chosenId = parseInt(btn.dataset.taxonId, 10);
    const isCorrect = btn.dataset.isCorrect === 'true';
    
    const cleanDisplayName = btn.dataset.displayName || btn.textContent.replace(/^\d+\.\s*/, '');
    
    const pointsEarned = isCorrect ? 10 : 0;
    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(s));

    store.updateQuestion(s.currentIndex, {
        isAnswered: true,
        userAnswer: btn.textContent,
        userAnswerId: chosenId,
        guessedRank: 'species',
        isCorrect,
        pointsEarned,
        thumbnailUrl: mediaInfo.url,
        mediaAttribution: mediaInfo.attribution,
        matchedNameDisplay: cleanDisplayName,
        isSkipped: false
    });

    if (isCorrect) store.setState(prev => ({ score: prev.score + pointsEarned }));

    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.focus();
});

window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    
    const targetTag = e.target?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) || e.target?.isContentEditable) {
        return;
    }
    
    const s = store.getState();
    if (s.ui.activeView !== 'quiz-view' || !s.config.isMultipleChoice) return;

    const q = s.questions[s.currentIndex];
    if (!q || q.isAnswered || s.ui.isCheckingAnswer) return;

    if (['1', '2', '3', '4'].includes(e.key)) {
        const optionIndex = parseInt(e.key, 10) - 1;
        const container = document.getElementById('mc-options-container');
        const buttons = container?.querySelectorAll('.btn-mc-option');

        if (buttons && buttons[optionIndex] && !buttons[optionIndex].disabled) {
            buttons[optionIndex].click();
        }
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    const s = store.getState();
    const nextIdx = s.currentIndex + 1;
    if (nextIdx >= s.questions.length) {
        finishQuizSession();
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
    if (audioPlayer) { audioPlayer.removeAttribute('src'); delete audioPlayer.dataset.src; audioPlayer.load(); }
    
    store.setState(prev => ({ ui: { ...prev.ui, quizError: null, isMediaLoaded: false } }));
    store.dispatchEvent(new CustomEvent('media:retry'));
});

document.getElementById('btn-skip-end').addEventListener('click', () => {
    observationService.clearCache();
    finishQuizSession();
    store.setState(prev => ({
        questions: prev.questions.slice(0, prev.currentIndex)
    }));
});

document.getElementById('btn-restart').addEventListener('click', () => {
    observationService.clearCache();
    store.setState(prev => ({
        currentIndex: 0,
        score: 0,
        currentMediaIndex: 0,
        regionalPool: [],
        questions: [],
        form: {
            ...prev.form,
            answerInput: '',
            rankInput: 'species'
        },
        ui: {
            ...prev.ui,
            activeView: 'setup-view',
            quizError: null,
            answerError: null,
            isCheckingAnswer: false,
            isHintVisible: false,
            isMediaLoaded: false
        }
    }));
});

// --- SOCIAL SHARE HANDLERS ---
document.getElementById('btn-share-results')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalText = btn.textContent;

    const success = await copyResultToClipboard(store.getState());

    btn.textContent = success ? "✅ Score Card Copied!" : "❌ Could Not Copy";
    setTimeout(() => {
        btn.textContent = originalText;
    }, 2500);
});

document.getElementById('btn-share-link')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalText = btn.textContent;
    const s = store.getState();
    const mode = s.form.isDailyMode ? 'daily' : 'custom';

    const success = await copyShareLinkToClipboard(s.config, mode);

    btn.textContent = success ? "✅ Link Copied!" : "❌ Could Not Copy";
    setTimeout(() => {
        btn.textContent = originalText;
    }, 2500);
});

// --- APP BOOTSTRAPPING ---
async function bootApplication() {
    // 1. Parse URL parameters FIRST before any state changes occur
    const urlOverrides = parseUrlParams();
    const hasUrlOverrides = Object.keys(urlOverrides).length > 0;

    // 2. Read saved localStorage preferences without committing to state yet
    let savedPrefs = {};
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (saved) {
            savedPrefs = sanitizePreferences(JSON.parse(saved));
        }
    } catch (e) {
        console.warn("Could not load preferences:", e);
    }

    // 3. Compose initial form state (base -> preferences -> URL overrides)
    let initialForm = {
        ...store.getState().form,
        ...savedPrefs
    };

    if (hasUrlOverrides) {
        initialForm = {
            ...initialForm,
            ...urlOverrides,
            isDailyMode: urlOverrides.quizMode === 'daily'
        };

        if (urlOverrides.quizMode === 'daily') {
            initialForm = engine.applyDailyEnforcements(initialForm);
        }
    }

    // 4. Commit settled state in a SINGLE store update
    store.setState(prev => ({
        form: initialForm,
        ui: {
            ...prev.ui,
            isUrlChallenge: hasUrlOverrides
        }
    }));

    // 5. Asynchronously hydrate place and taxon display names if loaded via ID
    if (hasUrlOverrides) {
        if (urlOverrides.placeId && !store.getState().form.placeName) {
            try {
                const placeData = await api.fetchPlaceById(urlOverrides.placeId);
                if (placeData.results?.[0]) {
                    const placeName = ui.formatPlaceDisplay(placeData.results[0]);
                    store.setState(prev => ({
                        form: { ...prev.form, placeName }
                    }));
                }
            } catch (e) {
                store.setState(prev => ({
                    form: { ...prev.form, placeName: `Location #${urlOverrides.placeId}` }
                }));
            }
        }

        if (urlOverrides.taxonId && !store.getState().form.taxonName) {
            try {
                const taxonData = await api.fetchTaxonById(urlOverrides.taxonId);
                if (taxonData.results?.[0]) {
                    const taxonName = ui.formatTaxonDisplay(taxonData.results[0]);
                    store.setState(prev => ({
                        form: { ...prev.form, taxonName }
                    }));
                }
            } catch (e) {
                store.setState(prev => ({
                    form: { ...prev.form, taxonName: `Taxon #${urlOverrides.taxonId}` }
                }));
            }
        }
    }

    // Render final resolved state and reveal the application
    ui.render(store.getState());
    document.getElementById('app').classList.remove('booting');
}

bootApplication();
