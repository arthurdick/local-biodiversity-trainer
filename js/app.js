import { getState, setState, updateQuestion, resetState } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';

// --- RUNTIME CACHE ---
const pendingFetches = new Map();

// --- STATE SELECTORS (Derived Data) ---
function selectCurrentMedia(currentState) {
    const q = currentState.questions[currentState.currentIndex];
    const obs = q?.observation;
    if (!obs || obs.error) return [];
    
    const media = [];
    if (currentState.config.wantsPhotos && obs.photos) {
        obs.photos.forEach(p => media.push({
            type: 'photo',
            mediumUrl: p.url.replace('square', 'medium'),
            originalUrl: p.url.replace('square', 'original'),
            attribution: p.attribution
        }));
    }
    
    if (currentState.config.wantsSounds && obs.sounds) {
        obs.sounds.forEach(s => media.push({
            type: 'sound',
            fileUrl: s.file_url,
            attribution: s.attribution
        }));
    }
    return media;
}

function selectCurrentMeta(currentState) {
    const obs = currentState.questions[currentState.currentIndex]?.observation;
    if (!obs || obs.error) return null;
    return {
        date: obs.observed_on,
        locationText: obs.place_guess,
        coordinates: obs.location
    };
}

// --- UTILITIES & STORAGE ---
function debounce(func, timeout = 1000) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => { func.apply(this, args); }, timeout); };
}

function getMediaParams(config) {
    if (config.wantsPhotos && !config.wantsSounds) return '&photos=true';
    if (!config.wantsPhotos && config.wantsSounds) return '&sounds=true';
    return '';
}

function getMonthParams(config) {
    if (config.months.length === 12 || config.months.length === 0) return '';
    return `&month=${config.months.join(',')}`;
}

/**
 * Calculates a dynamic network timeout based on the user's connection speed.
 */
function getDynamicNetworkTimeout(defaultTimeout = 10000) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return defaultTimeout;

    switch (connection.effectiveType) {
        case 'slow-2g':
        case '2g':
            return 30000; // 30 seconds for very slow connections
        case '3g':
            return 20000; // 20 seconds for 3G
        case '4g':
        default:
            return defaultTimeout;
    }
}

function savePreferences() {
    const s = getState();
    const prefs = {
        placeId: s.placeId, lat: s.lat, lng: s.lng,
        placeName: document.getElementById('input-place').value,
        taxonId: s.taxonId, taxonName: s.taxonName,
        difficulty: document.getElementById('input-difficulty').value,
        questions: document.getElementById('input-questions').value,
        chkPhotos: document.getElementById('chk-photos').checked,
        chkSounds: document.getElementById('chk-sounds').checked,
        chkUnique: document.getElementById('chk-unique').checked,
        months: Array.from(document.querySelectorAll('#month-filters input:checked')).map(cb => cb.value)
    };
    localStorage.setItem('bio_trainer_prefs', JSON.stringify(prefs));
}

function loadPreferences() {
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (!saved) return;
        const prefs = JSON.parse(saved);

        setState({
            placeId: prefs.placeId || null,
            lat: prefs.lat || null,
            lng: prefs.lng || null,
            taxonId: prefs.taxonId || null,
            taxonName: prefs.taxonName || null
        });

        if (prefs.placeName) document.getElementById('input-place').value = prefs.placeName;
        if (prefs.taxonName) document.getElementById('input-taxon').value = prefs.taxonName;
        if (prefs.difficulty) document.getElementById('input-difficulty').value = prefs.difficulty;
        if (prefs.questions) document.getElementById('input-questions').value = prefs.questions;
        if (prefs.chkPhotos !== undefined) document.getElementById('chk-photos').checked = prefs.chkPhotos;
        if (prefs.chkSounds !== undefined) document.getElementById('chk-sounds').checked = prefs.chkSounds;
        if (prefs.chkUnique !== undefined) document.getElementById('chk-unique').checked = prefs.chkUnique;
        if (prefs.months) {
            document.querySelectorAll('#month-filters input').forEach(cb => {
                cb.checked = prefs.months.includes(cb.value);
            });
        }
    } catch (e) { console.warn("Could not load saved preferences", e); }
    ui.toggleClearButton('input-place', 'clear-place');
    ui.toggleClearButton('input-taxon', 'clear-taxon');
}

// --- SETUP & VALIDATION ---
const placeValidation = ui.setupInlineValidation('input-place', 'location', 
    () => !!getState().placeId, () => getState().lat !== null
);
const taxonValidation = ui.setupInlineValidation('input-taxon', 'valid target taxon', 
    () => !!getState().taxonId, () => false
);

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        document.querySelectorAll('.autocomplete-list').forEach(list => ui.toggleList(list.id, false));
    }
});

document.getElementById('btn-months-all').addEventListener('click', () => document.querySelectorAll('#month-filters input').forEach(cb => cb.checked = true));
document.getElementById('btn-months-none').addEventListener('click', () => document.querySelectorAll('#month-filters input').forEach(cb => cb.checked = false));

// --- AUTOCOMPLETE LOGIC ---
function setupAutocomplete(config) {
    let abortController = null;
    const inputEl = document.getElementById(config.inputId);
    const clearBtnEl = document.getElementById(config.clearBtnId);

    // Input event for fetching
    inputEl.addEventListener('input', debounce(async (e) => {
        ui.toggleClearButton(config.inputId, config.clearBtnId);
        const query = e.target.value;
        const listEl = document.getElementById(config.listId);
        
        // Safer and faster than innerHTML = ''
        listEl.replaceChildren();
        
        setState(config.onClearState());
        e.target.removeAttribute('aria-activedescendant');
        
        if (query.length < 3) return ui.toggleList(config.listId, false);

        if (abortController) abortController.abort();
        abortController = new AbortController();

        try {
            const data = await config.fetchData(query, abortController.signal);
            if (data.results.length) ui.toggleList(config.listId, true);
            
            data.results.forEach((item, index) => {
                const li = document.createElement('li');
                li.id = `opt-${config.inputId.replace('input-', '')}-${index}`;
                li.textContent = config.renderText(item);
                li.tabIndex = -1;
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                
                li.addEventListener('mouseenter', () => {
                    const list = li.parentElement;
                    
                    list.querySelectorAll('li').forEach(el => {
                        el.classList.remove('active');
                        el.setAttribute('aria-selected', 'false');
                    });
                    
                    li.classList.add('active');
                    li.setAttribute('aria-selected', 'true');
                    
                    inputEl.setAttribute('aria-activedescendant', li.id);
                    list.dataset.activeIndex = index;
                });
                
                const selectItem = () => {
                    setState(config.onSelectState(item));
                    inputEl.value = li.textContent;
                    ui.toggleList(config.listId, false);
                    ui.toggleClearButton(config.inputId, config.clearBtnId);
                    config.validationObj.clearError();
                    inputEl.focus();
                };
                
                li.onclick = selectItem;
                li.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); selectItem(); } };
                listEl.appendChild(li);
            });
        } catch(err) {
            if (err.name === 'AbortError') return;
            console.warn(`${config.inputId} search offline`);
        }
    }));

    // Keyboard navigation
    inputEl.addEventListener('keydown', (e) => ui.handleAutocompleteKeydown(e, config.listId));

    // Clear button functionality
    clearBtnEl.addEventListener('click', () => {
        inputEl.value = '';
        setState(config.onClearState());
        ui.toggleClearButton(config.inputId, config.clearBtnId);
        ui.toggleList(config.listId, false);
        config.validationObj.clearError();
        inputEl.focus();
    });
}

// Initialize Autocompletes
setupAutocomplete({
    inputId: 'input-place',
    listId: 'list-place',
    clearBtnId: 'clear-place',
    fetchData: api.fetchPlaces,
    renderText: (place) => place.display_name || place.name,
    onClearState: () => ({ placeId: null, lat: null, lng: null }),
    onSelectState: (place) => ({ placeId: place.id, lat: null, lng: null }),
    validationObj: placeValidation
});

setupAutocomplete({
    inputId: 'input-taxon',
    listId: 'list-taxon',
    clearBtnId: 'clear-taxon',
    fetchData: api.fetchTaxaAutocomplete,
    renderText: (taxon) => {
        const common = taxon.preferred_common_name ? `${taxon.preferred_common_name} ` : '';
        return `${common}(${taxon.name})`;
    },
    onClearState: () => ({ taxonId: null, taxonName: null }),
    onSelectState: (taxon) => ({ taxonId: taxon.id, taxonName: taxon.preferred_common_name || taxon.name }),
    validationObj: taxonValidation
});

document.getElementById('btn-gps').addEventListener('click', () => {
    const btn = document.getElementById('btn-gps');
    const originalText = btn.textContent;
    btn.textContent = "⏳ Locating..."; btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            setState({ lat: pos.coords.latitude, lng: pos.coords.longitude, placeId: null });
            document.getElementById('input-place').value = `📍 GPS Coordinates Captured`;
            ui.toggleClearButton('input-place', 'clear-place'); placeValidation.clearError();
            btn.textContent = originalText; btn.disabled = false;
        },
        () => {
            btn.textContent = "❌ Could not get location";
            setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 5000);
        }
    );
});

// --- GAME BOOTSTRAPPING ---
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.clearGeneralError();
    let hasError = false;
    
    const s = getState();

    if (!s.placeId && !s.lat) { placeValidation.showError("⚠️ Please search and select a location, or use GPS."); hasError = true; }
    if (document.getElementById('input-taxon').value.trim() !== '' && !s.taxonId) {
        taxonValidation.showError("⚠️ Please select a valid target taxon from the list, or clear this field."); hasError = true;
    }
    if (hasError) return;

    const wantsPhotos = document.getElementById('chk-photos').checked;
    const wantsSounds = document.getElementById('chk-sounds').checked;
    const months = Array.from(document.querySelectorAll('#month-filters input:checked')).map(cb => cb.value);

    if (!wantsPhotos && !wantsSounds) {
        ui.showGeneralError("Please select at least one media type (Photos or Sounds)."); return;
    }
    if (months.length === 0) {
        ui.showGeneralError("Please select at least one month for seasonality."); return;
    }

    const difficulty = document.getElementById('input-difficulty').value;
    const questionLimit = parseInt(document.getElementById('input-questions').value);
    const preventDuplicates = document.getElementById('chk-unique').checked;

    // Snapshot user preferences directly into state config
    setState({
        config: { wantsPhotos, wantsSounds, months, difficulty, preventDuplicates }
    });

    savePreferences();
    const btn = document.getElementById('btn-start');
    btn.disabled = true; btn.textContent = "Analyzing Regional Ecology...";

    const updatedState = getState();

    if (difficulty === 'all') {
        setState({
            questions: Array.from({ length: questionLimit }, () => ({ taxon: null, observation: null })),
            currentIndex: 0,
            score: 0
        });
        
        loadObservationForQuestion(0);
        ui.showView('quiz-view');
        renderQuizQuestion();
        
        btn.disabled = false; btn.textContent = "Load Quiz Pool";
        return;
    }

    let poolUrl = `https://api.inaturalist.org/v2/observations/species_counts?quality_grade=research&captive=false&per_page=${difficulty}${getMediaParams(updatedState.config)}${getMonthParams(updatedState.config)}`;
    if (updatedState.placeId) poolUrl += `&place_id=${updatedState.placeId}`;
    else poolUrl += `&lat=${updatedState.lat}&lng=${updatedState.lng}&radius=10`;
    if (updatedState.taxonId) poolUrl += `&taxon_id=${updatedState.taxonId}`;
    poolUrl += `&fields=${encodeURIComponent('(count:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,ancestor_ids:!t))')}`;

    try {
        const data = await api.fetchSpeciesPool(poolUrl);
        if (!data.results || data.results.length === 0) {
            btn.disabled = false; btn.textContent = "Load Quiz Pool";
            ui.showGeneralError("No research-grade observations found for these settings. Try a broader location, taxon, or month range.");
            return;
        }

        setState({
            questions: engine.generateWeightedPool(data.results, questionLimit, preventDuplicates),
            currentIndex: 0,
            score: 0
        });
        
        loadObservationForQuestion(0);
        ui.showView('quiz-view');
        renderQuizQuestion();
    } catch (error) {
        ui.showGeneralError("Error loading species data. Please check your internet connection.");
    } finally {
        btn.disabled = false; btn.textContent = "Load Quiz Pool";
    }
});

// --- JIT PREFETCH WITH CACHE ---
async function loadObservationForQuestion(index) {
    const s = getState();
    if (index >= s.questions.length) return;
    
    // Check state first
    if (s.questions[index].observation) return s.questions[index].observation;
    
    // Check runtime cache for pending fetch
    if (pendingFetches.has(index)) return pendingFetches.get(index);

    if (!navigator.onLine) {
        const errorData = { error: true };
        updateQuestion(index, { observation: errorData });
        return errorData;
    }

    const fetchPromise = (async () => {
        const q = getState().questions[index]; // Fetch fresh copy
        const currentConfig = getState().config;
        
        let url = `https://api.inaturalist.org/v2/observations?quality_grade=research&captive=false&per_page=1&order_by=random${getMediaParams(currentConfig)}${getMonthParams(currentConfig)}`;
        if (s.placeId) url += `&place_id=${s.placeId}`;
        else url += `&lat=${s.lat}&lng=${s.lng}&radius=10`;

        if (currentConfig.difficulty === 'all') {
            url += `&rank=species,subspecies`;
            if (s.taxonId) url += `&taxon_id=${s.taxonId}`;
            if (currentConfig.preventDuplicates) {
                const seenIds = getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined);
                if (seenIds.length > 0) url += `&without_taxon_id=${seenIds.join(',')}`;
            }
        } else {
            url += `&taxon_id=${q.taxon.id}`;
        }
        
        url += `&fields=${encodeURIComponent('(observed_on:!t,place_guess:!t,location:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,ancestor_ids:!t),photos:(url:!t,attribution:!t),sounds:(file_url:!t,attribution:!t))')}`;

        try {
            const controller = new AbortController();
            const timeoutMs = getDynamicNetworkTimeout();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const data = await api.fetchObservation(url, controller.signal);
            clearTimeout(timeoutId);

            if (data.results && data.results.length > 0) {
                const obs = data.results[0];
                const updates = { observation: obs };
                if (currentConfig.difficulty === 'all') updates.taxon = obs.taxon;
                
                updateQuestion(index, updates);
                
                if (obs.photos && obs.photos.length > 0) {
                    const preload = new Image();
                    preload.src = obs.photos[0].url.replace('square', 'medium');
                }
                return obs;
            } else {
                const emptyData = { error: true, emptyPool: true };
                updateQuestion(index, { observation: emptyData });
                return emptyData;
            }
        } catch(e) {
            const errorData = { error: true };
            updateQuestion(index, { observation: errorData });
            return errorData;
        } finally {
            pendingFetches.delete(index);
        }
    })();

    pendingFetches.set(index, fetchPromise);
    return fetchPromise;
}

// --- MEDIA NAVIGATION ---
document.getElementById('btn-prev-media').addEventListener('click', () => {
    const s = getState();
    if (s.currentMediaIndex > 0) {
        setState({ currentMediaIndex: s.currentMediaIndex - 1 });
        const updatedState = getState();
        ui.updateMediaDisplay(selectCurrentMedia(updatedState), updatedState.currentMediaIndex);
    }
});
document.getElementById('btn-next-media').addEventListener('click', () => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    if (s.currentMediaIndex < mediaArray.length - 1) {
        setState({ currentMediaIndex: s.currentMediaIndex + 1 });
        const updatedState = getState();
        ui.updateMediaDisplay(selectCurrentMedia(updatedState), updatedState.currentMediaIndex);
    }
});

// --- GAME LOOP ---
async function renderQuizQuestion() {
    setState({ isQuestionLoaded: false, currentMediaIndex: 0 });
    
    let s = getState();
    ui.resetQuizUI(s.currentIndex, s.questions.length, s.score);

    const q = s.questions[s.currentIndex];
    
    // Will pull from cache if running or resolve directly
    const obsData = await loadObservationForQuestion(s.currentIndex);

    s = getState(); // refresh after await

    if (obsData.error) { 
        if (obsData.emptyPool && s.config.difficulty === 'all' && s.config.preventDuplicates) {
            setState({ questions: s.questions.slice(0, s.currentIndex) });
            s = getState();
            ui.renderResultsView(s.questions, s.score);
            return;
        }
        handleFetchErrorFallback(q); 
        return; 
    }

    const currentMediaArray = selectCurrentMedia(s);
    
    if (currentMediaArray.length === 0) { handleFetchErrorFallback(q, true); return; }

    ui.updateMediaDisplay(currentMediaArray, s.currentMediaIndex);

    if (currentMediaArray[0].type === 'sound') triggerQuestionReady();
}

function handleFetchErrorFallback(q, isMediaMissing = false) {
    let taxonName = "Random Species";
    if (q.taxon) taxonName = q.taxon.preferred_common_name || q.taxon.name;
    else if (getState().taxonName) taxonName = getState().taxonName;
    
    ui.renderFetchError(taxonName, isMediaMissing);
    setState({ isQuestionLoaded: true });
    loadObservationForQuestion(getState().currentIndex + 1);
}

function triggerQuestionReady() {
    document.getElementById('input-rank').disabled = false;
    
    document.getElementById('quiz-loading').style.display = 'none';
    document.getElementById('quiz-attribution').style.display = 'block';
    
    const s = getState();
    ui.renderQuestionMeta(selectCurrentMeta(s));
    
    if (!s.isQuestionLoaded) {
        setState({ isQuestionLoaded: true });
        document.getElementById('input-answer').disabled = false; 
        document.getElementById('input-answer').focus();
        document.getElementById('btn-submit').style.display = 'block';
        loadObservationForQuestion(s.currentIndex + 1);
    }
}

document.getElementById('quiz-image').onload = (e) => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    if (mediaArray[s.currentMediaIndex]?.type === 'photo') {
        document.getElementById('btn-zoom-image').style.display = 'flex';
        e.target.style.display = 'block';
        triggerQuestionReady();
    }
};

document.getElementById('quiz-image').onerror = () => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    if (mediaArray[s.currentMediaIndex]?.type === 'photo') {
        document.getElementById('media-controls').style.display = 'none';
        ui.renderFetchError("", false);
        setState({ isQuestionLoaded: true });
        loadObservationForQuestion(s.currentIndex + 1);
    }
};

document.getElementById('quiz-audio-player').onerror = () => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    if (mediaArray[s.currentMediaIndex]?.type === 'sound') {
        document.getElementById('media-controls').style.display = 'none';
        ui.renderFetchError("", false);
        setState({ isQuestionLoaded: true });
        loadObservationForQuestion(s.currentIndex + 1);
    }
};

// --- ANSWER LOGIC ---
document.getElementById('btn-submit').addEventListener('click', async () => {
    const inputStr = document.getElementById('input-answer').value.trim();
    const guessedRank = document.getElementById('input-rank').value;
    if (!inputStr) return;

    let s = getState();
    const q = s.questions[s.currentIndex];
    const taxon = q.taxon;
    const btnSubmit = document.getElementById('btn-submit');
    
    document.getElementById('input-answer').disabled = true;
    document.getElementById('input-rank').disabled = true;
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Checking...";

    let { isCorrect, matchedNameDisplay, normalizedInput } = engine.checkExactMatch(inputStr, taxon);
    let pointsEarned = 0;

    // Force API check for higher ranks to verify against taxon ancestors
    if (guessedRank !== 'species') {
        isCorrect = false;
    } else if (isCorrect) {
        pointsEarned = engine.getPointsForRank('species');
    }

    if (!isCorrect && navigator.onLine) {
        try {
            const controller = new AbortController();
            const timeoutMs = getDynamicNetworkTimeout();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const searchData = await api.checkTaxonSearch(inputStr, controller.signal);
            clearTimeout(timeoutId);
            
            if (searchData.results && searchData.results.length > 0) {
                for (const result of searchData.results) {
                    const isExactMatch = result.id === taxon.id;
                    const isGuessChildOfTarget = result.ancestor_ids && result.ancestor_ids.includes(taxon.id);
                    // Crucial: check if the user's guessed taxon is a valid ancestor of our target
                    const isGuessParentOfTarget = taxon.ancestor_ids && taxon.ancestor_ids.includes(result.id);
                    
                    const validNames = [engine.normalize(result.name), engine.normalize(result.preferred_common_name), engine.normalize(result.matched_term)];
                    
                    if (validNames.includes(normalizedInput)) {
                        if (guessedRank === 'species' && (isExactMatch || isGuessChildOfTarget || (isGuessParentOfTarget && result.rank === 'species'))) {
                            isCorrect = true;
                            pointsEarned = engine.getPointsForRank('species');
                            matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                            break;
                        } else if (guessedRank !== 'species' && isGuessParentOfTarget && result.rank === guessedRank) {
                            isCorrect = true;
                            pointsEarned = engine.getPointsForRank(guessedRank);
                            matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                            break;
                        }
                    }
                }
            }
        } catch (error) { console.warn("API check failed. Relying on local strict match."); }
    }

    // Offline / Local Genus Fallback
    if (!isCorrect && guessedRank === 'genus' && taxon.name) {
        const actualGenus = engine.normalize(taxon.name.split(' ')[0]);
        if (normalizedInput === actualGenus) {
            isCorrect = true;
            pointsEarned = engine.getPointsForRank('genus');
            matchedNameDisplay = taxon.name.split(' ')[0];
        }
    }
    
    updateQuestion(s.currentIndex, {
        userAnswer: `${inputStr} (${guessedRank})`,
        isCorrect: isCorrect,
        pointsEarned: pointsEarned, // Storing for missed question review later
        thumbnailUrl: engine.getQuestionThumbnail(q, selectCurrentMedia(s))
    });
    
    // Use parse float/toFixed to prevent ugly floating point math errors in JS
    if (isCorrect) setState({ score: parseFloat((s.score + pointsEarned).toFixed(1)) });

    const updatedScore = getState().score;
    const primaryCommonNorm = taxon.preferred_common_name ? engine.normalize(taxon.preferred_common_name) : "";
    const sciNorm = engine.normalize(taxon.name);
    const matchedNorm = engine.normalize(matchedNameDisplay);

    ui.renderFeedback(isCorrect, taxon, matchedNameDisplay, matchedNorm, primaryCommonNorm, sciNorm, updatedScore, pointsEarned, guessedRank);
});

document.getElementById('input-answer').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.target.disabled) document.getElementById('btn-submit').click();
});

document.getElementById('btn-next').addEventListener('click', (e) => {
    let s = getState();
    if (s.currentIndex >= s.questions.length) return;

    e.target.textContent = "Next Observation ➔";
    const currentQ = s.questions[s.currentIndex];
    
    if (currentQ.isCorrect === undefined) {
        updateQuestion(s.currentIndex, {
            isCorrect: false,
            userAnswer: "(Skipped)",
            thumbnailUrl: engine.getQuestionThumbnail(currentQ, selectCurrentMedia(s))
        });
    }
    
    s = getState();
    setState({ currentIndex: s.currentIndex + 1 });
    s = getState();
    
    if (s.currentIndex >= s.questions.length) ui.renderResultsView(s.questions, s.score);
    else renderQuizQuestion();
});

document.getElementById('btn-restart').addEventListener('click', () => {
    resetState();
    loadPreferences();
    ui.showView('setup-view');
});

loadPreferences();
