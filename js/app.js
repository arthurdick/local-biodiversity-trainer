import { getState, setState, updateQuestion, resetState } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';
import * as observationService from './observationService.js';

// --- STATE SELECTORS (Derived Data) ---
function selectCurrentMedia(currentState) {
    const q = currentState.questions[currentState.currentIndex];
    const obs = q?.observation;
    if (!obs || obs.error) return [];
    
    const media = [];
    if (currentState.config.wantsPhotos && obs.photos) {
        obs.photos.forEach(p => {
            if (p.license_code) {
                media.push({
                    type: 'photo',
                    mediumUrl: p.url.replace('square', 'medium'),
                    originalUrl: p.url.replace('square', 'original'),
                    attribution: p.attribution,
                    license: p.license_code.toUpperCase()
                });
            }
        });
    }
    
    if (currentState.config.wantsSounds && obs.sounds) {
        obs.sounds.forEach(s => {
            if (s.license_code) {
                media.push({
                    type: 'sound',
                    fileUrl: s.file_url,
                    attribution: s.attribution,
                    license: s.license_code.toUpperCase()
                });
            }
        });
    }
    return media;
}

function selectCurrentMeta(currentState) {
    const obs = currentState.questions[currentState.currentIndex]?.observation;
    if (!obs || obs.error) return null;
    
    const formattedLicense = obs.license_code
        ? obs.license_code.toUpperCase()
        : 'All Rights Reserved';

    return {
        date: obs.observed_on,
        locationText: obs.place_guess,
        coordinates: obs.location,
        observer: obs.user?.name || obs.user?.login || 'Unknown Observer',
        license: formattedLicense
    };
}

// --- UTILITIES & STORAGE ---
function debounce(func, timeout = 250) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => { func.apply(this, args); }, timeout); };
}

function savePreferences() {
    const s = getState();
    
    const locModeInput = document.querySelector('input[name="loc-mode"]:checked');
    const locMode = locModeInput ? locModeInput.value : 'search';

    const prefs = {
        locMode: locMode,
        placeId: s.placeId,
        lat: s.lat,
        lng: s.lng,
        radius: parseInt(document.getElementById('input-radius').value) || 10,
        manualLat: document.getElementById('input-lat').value,
        manualLng: document.getElementById('input-lng').value,
        placeName: document.getElementById('input-place').value,
        taxonId: s.taxonId,
        taxonName: s.taxonName,
        difficulty: document.getElementById('input-difficulty').value,
        questions: document.getElementById('input-questions').value,
        chkPhotos: document.getElementById('chk-photos').checked,
        chkSounds: document.getElementById('chk-sounds').checked,
        chkUnique: document.getElementById('chk-unique').checked,
        chkRarity: document.getElementById('chk-rarity').checked,
        months: Array.from(document.querySelectorAll('#month-filters input:checked')).map(cb => cb.value)
    };
    
    try {
        localStorage.setItem('bio_trainer_prefs', JSON.stringify(prefs));
    } catch (e) {
        console.warn("Could not save preferences to local storage:", e);
    }
}

function loadPreferences() {
    try {
        const saved = localStorage.getItem('bio_trainer_prefs');
        if (!saved) return;
        const prefs = JSON.parse(saved);

        if (typeof prefs !== 'object' || prefs === null) return;

        setState({
            locMode: ['search', 'coords'].includes(prefs.locMode) ? prefs.locMode : 'search',
            placeId: (typeof prefs.placeId === 'number' || typeof prefs.placeId === 'string') ? prefs.placeId : null,
            lat: typeof prefs.lat === 'number' ? prefs.lat : null,
            lng: typeof prefs.lng === 'number' ? prefs.lng : null,
            radius: typeof prefs.radius === 'number' ? prefs.radius : 10,
            taxonId: (typeof prefs.taxonId === 'number' || typeof prefs.taxonId === 'string') ? prefs.taxonId : null,
            taxonName: typeof prefs.taxonName === 'string' ? prefs.taxonName : null
        });

        if (prefs.locMode === 'coords') {
            document.getElementById('mode-coords').checked = true;
            document.getElementById('section-search').classList.remove('active');
            document.getElementById('section-coords').classList.add('active');
        }

        if (prefs.radius) document.getElementById('input-radius').value = prefs.radius;
        if (prefs.manualLat !== undefined) document.getElementById('input-lat').value = prefs.manualLat;
        if (prefs.manualLng !== undefined) document.getElementById('input-lng').value = prefs.manualLng;

        if (typeof prefs.placeName === 'string') document.getElementById('input-place').value = prefs.placeName;
        if (typeof prefs.taxonName === 'string') document.getElementById('input-taxon').value = prefs.taxonName;
        
        const validDifficulties = ['15', '50', '125', '500', 'all'];
        if (typeof prefs.difficulty === 'string' && validDifficulties.includes(prefs.difficulty)) {
            document.getElementById('input-difficulty').value = prefs.difficulty;
        }
        
        const validQuestions = ['5', '10', '20', '50'];
        if (validQuestions.includes(String(prefs.questions))) {
            document.getElementById('input-questions').value = String(prefs.questions);
        }

        if (typeof prefs.chkPhotos === 'boolean') document.getElementById('chk-photos').checked = prefs.chkPhotos;
        if (typeof prefs.chkSounds === 'boolean') document.getElementById('chk-sounds').checked = prefs.chkSounds;
        if (typeof prefs.chkUnique === 'boolean') document.getElementById('chk-unique').checked = prefs.chkUnique;
        if (typeof prefs.chkRarity === 'boolean') document.getElementById('chk-rarity').checked = prefs.chkRarity;
        
        if (Array.isArray(prefs.months)) {
            document.querySelectorAll('#month-filters input').forEach(cb => {
                cb.checked = prefs.months.includes(cb.value);
            });
        }
    } catch (e) {
        console.warn("Could not load saved preferences", e);
    }
    
    ui.toggleClearButton('input-place', 'clear-place');
    ui.toggleClearButton('input-taxon', 'clear-taxon');
}

// --- SETUP & VALIDATION ---
const placeValidation = ui.setupInlineValidation('input-place', 'location', 
    () => {
        const s = getState();
        return s.locMode === 'search' ? !!s.placeId : true;
    },
    () => {
        const s = getState();
        return s.locMode === 'search' ? (s.lat !== null && s.lng !== null) : true;
    }
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

// --- LOCATION MODE TOGGLE ---
const radios = document.querySelectorAll('input[name="loc-mode"]');
const sectionSearch = document.getElementById('section-search');
const sectionCoords = document.getElementById('section-coords');
const inputPlace = document.getElementById('input-place');

radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        ui.clearGeneralError();
        placeValidation.clearError();
        
        const newMode = e.target.value;
        
        setState({ locMode: newMode });
        
        if (newMode === 'search') {
            sectionSearch.classList.add('active');
            sectionCoords.classList.remove('active');
            document.getElementById('input-lat').value = '';
            document.getElementById('input-lng').value = '';
            setState({ lat: null, lng: null });
        } else {
            sectionCoords.classList.add('active');
            sectionSearch.classList.remove('active');
            inputPlace.value = '';
            ui.toggleClearButton('input-place', 'clear-place');
            setState({ placeId: null });
        }
    });
});

// --- AUTOCOMPLETE LOGIC ---
function setupAutocomplete(config) {
    let abortController = null;
    const inputEl = document.getElementById(config.inputId);
    const clearBtnEl = document.getElementById(config.clearBtnId);

    inputEl.addEventListener('input', debounce(async (e) => {
        ui.toggleClearButton(config.inputId, config.clearBtnId);
        const query = e.target.value;
        const listEl = document.getElementById(config.listId);
        
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

    inputEl.addEventListener('keydown', (e) => ui.handleAutocompleteKeydown(e, config.listId));

    clearBtnEl.addEventListener('click', () => {
        inputEl.value = '';
        setState(config.onClearState());
        ui.toggleClearButton(config.inputId, config.clearBtnId);
        ui.toggleList(config.listId, false);
        config.validationObj.clearError();
        inputEl.focus();
    });
}

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
    onSelectState: (taxon) => {
        const common = taxon.preferred_common_name ? `${taxon.preferred_common_name} ` : '';
        return { taxonId: taxon.id, taxonName: `${common}(${taxon.name})` };
    },
    validationObj: taxonValidation
});

document.getElementById('btn-gps').addEventListener('click', () => {
    const btn = document.getElementById('btn-gps');
    const originalText = btn.textContent;
    btn.textContent = "⏳ Locating..."; btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            document.getElementById('input-lat').value = lat;
            document.getElementById('input-lng').value = lng;
            setState({ lat, lng, placeId: null });
            
            btn.textContent = originalText; btn.disabled = false;
        },
        () => {
            btn.textContent = "❌ Could not get location";
            setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 5000);
        }
    );
});

// --- CUSTOM COORDINATE STATE BINDING ---
document.getElementById('input-lat').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    setState({ lat: isNaN(val) ? null : val });
});

document.getElementById('input-lng').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    setState({ lng: isNaN(val) ? null : val });
});

document.getElementById('input-radius').addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    setState({ radius: isNaN(val) || val < 1 ? 10 : val });
});

// --- GAME BOOTSTRAPPING ---
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.clearGeneralError();
    let hasError = false;
    
    let s = getState();

    if (s.locMode === 'search') {
        if (!s.placeId) {
            placeValidation.showError("⚠️ Please search and select a location.");
            hasError = true;
        }
    } else {
        const manualLat = parseFloat(document.getElementById('input-lat').value);
        const manualLng = parseFloat(document.getElementById('input-lng').value);
        const radius = parseInt(document.getElementById('input-radius').value, 10) || 10;
        
        if (isNaN(manualLat) || isNaN(manualLng)) {
            ui.showGeneralError("Please enter valid latitude and longitude coordinates, or use GPS.");
            hasError = true;
        } else if (manualLat < -90 || manualLat > 90 || manualLng < -180 || manualLng > 180) {
            ui.showGeneralError("Latitude must be between -90 and 90, and Longitude between -180 and 180.");
            hasError = true;
        } else {
            setState({ lat: manualLat, lng: manualLng, placeId: null, radius: radius });
        }
    }

    s = getState();

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
    const isRarityMode = document.getElementById('chk-rarity').checked;

    setState({
        config: { wantsPhotos, wantsSounds, months, difficulty, preventDuplicates, isRarityMode, expertTotalSpecies: 0 }
    });

    savePreferences();
    const btn = document.getElementById('btn-start');
    btn.disabled = true; btn.textContent = "Analyzing Regional Ecology...";

    const updatedState = getState();

    if (difficulty === 'all') {
        if (isRarityMode) {
            try {
                const preFlightData = await api.fetchSpeciesPool({
                    perPage: 1,
                    wantsPhotos: updatedState.config.wantsPhotos,
                    wantsSounds: updatedState.config.wantsSounds,
                    months: updatedState.config.months,
                    placeId: updatedState.placeId,
                    lat: updatedState.lat,
                    lng: updatedState.lng,
                    radius: updatedState.radius,
                    taxonId: updatedState.taxonId
                });

                const totalSpecies = preFlightData.total_results || 0;
                
                const actualQuestionCount = updatedState.config.preventDuplicates && totalSpecies > 0
                    ? Math.min(questionLimit, totalSpecies)
                    : questionLimit;
                
                setState({
                    config: { ...updatedState.config, expertTotalSpecies: totalSpecies },
                    questions: Array.from({ length: actualQuestionCount }, () => ({ taxon: null, observation: null })),
                    currentIndex: 0,
                    score: 0
                });
                
                observationService.loadObservationForQuestion(0);
                ui.showView('quiz-view');
                renderQuizQuestion();
            } catch (error) {
                ui.showGeneralError("Error loading rare species data. Please check your internet connection.");
            } finally {
                btn.disabled = false; btn.textContent = "Load Quiz Pool";
            }
            return;
        } else {
            setState({
                questions: Array.from({ length: questionLimit }, () => ({ taxon: null, observation: null })),
                currentIndex: 0,
                score: 0
            });
            
            observationService.loadObservationForQuestion(0);
            ui.showView('quiz-view');
            renderQuizQuestion();
            
            btn.disabled = false; btn.textContent = "Load Quiz Pool";
            return;
        }
    }

    try {
        const data = await api.fetchSpeciesPool({
            difficulty,
            wantsPhotos: updatedState.config.wantsPhotos,
            wantsSounds: updatedState.config.wantsSounds,
            months: updatedState.config.months,
            placeId: updatedState.placeId,
            lat: updatedState.lat,
            lng: updatedState.lng,
            radius: updatedState.radius,
            taxonId: updatedState.taxonId
        });

        if (!data.results || data.results.length === 0) {
            btn.disabled = false; btn.textContent = "Load Quiz Pool";
            ui.showGeneralError("No research-grade observations found for these settings. Try a broader location, taxon, or month range.");
            return;
        }

        setState({
            questions: engine.generateWeightedPool(data.results, questionLimit, preventDuplicates, updatedState.config.isRarityMode),
            currentIndex: 0,
            score: 0
        });
        
        observationService.loadObservationForQuestion(0);
        ui.showView('quiz-view');
        renderQuizQuestion();
    } catch (error) {
        ui.showGeneralError("Error loading species data. Please check your internet connection.");
    } finally {
        btn.disabled = false; btn.textContent = "Load Quiz Pool";
    }
});

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
    const targetIndex = getState().currentIndex;
    
    setState({ isQuestionLoaded: false, currentMediaIndex: 0 });
    
    let s = getState();
    ui.resetQuizUI(targetIndex, s.questions.length, s.score);

    const q = s.questions[targetIndex];
    
    const obsData = await observationService.loadObservationForQuestion(targetIndex);

    s = getState();

    if (s.currentIndex !== targetIndex) return;

    if (obsData.error) { 
        if (obsData.emptyPool && s.config.difficulty === 'all') {
            setState({ questions: s.questions.slice(0, targetIndex) });
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
    ui.renderFetchError(isMediaMissing);
    setState({ isQuestionLoaded: true });
}

function triggerQuestionReady() {
    document.getElementById('input-rank').disabled = false;
    
    document.getElementById('quiz-loading').style.display = 'none';
    document.getElementById('quiz-attribution').style.display = 'block';
    
    const s = getState();
    const currentObs = s.questions[s.currentIndex]?.observation;
    
    ui.renderQuestionMeta(selectCurrentMeta(s));
    ui.renderTargetBadge(s.questions[s.currentIndex].taxon);
    ui.renderFieldNotes(currentObs?.description);
    
    if (!s.isQuestionLoaded) {
        setState({ isQuestionLoaded: true });
        document.getElementById('input-answer').disabled = false; 
        document.getElementById('input-answer').focus();
        document.getElementById('btn-submit').style.display = 'block';
        
        // Ensure skip is visible and enabled for the new question
        const btnSkip = document.getElementById('btn-skip');
        btnSkip.style.display = 'block';
        btnSkip.disabled = false; 

        // Sync the clear button state (will hide it since input is empty)
        ui.toggleClearButton('input-answer', 'clear-answer');
        
        observationService.loadObservationForQuestion(s.currentIndex + 1);
    }
}

document.getElementById('quiz-image').onload = (e) => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    const currentMedia = mediaArray[s.currentMediaIndex];
    if (currentMedia?.type === 'photo' && e.target.src === new URL(currentMedia.mediumUrl, window.location.href).href) {
        document.getElementById('btn-zoom-image').style.display = 'flex';
        e.target.style.display = 'block';
        triggerQuestionReady();
    }
};

document.getElementById('quiz-image').onerror = (e) => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    const currentMedia = mediaArray[s.currentMediaIndex];
    if (currentMedia?.type === 'photo' && e.target.src === new URL(currentMedia.mediumUrl, window.location.href).href) {
        document.getElementById('media-controls').style.display = 'none';
        ui.renderFetchError(false);
        setState({ isQuestionLoaded: true });
    }
};

document.getElementById('quiz-audio-player').onerror = () => {
    const s = getState();
    const mediaArray = selectCurrentMedia(s);
    if (mediaArray[s.currentMediaIndex]?.type === 'sound') {
        document.getElementById('media-controls').style.display = 'none';
        ui.renderFetchError(false);
        setState({ isQuestionLoaded: true });
    }
};

document.getElementById('btn-toggle-hint').addEventListener('click', () => {
    const hintBtn = document.getElementById('btn-toggle-hint');
    const hintContent = document.getElementById('quiz-hint-content');
    
    const isHidden = hintContent.style.display === 'none';
    if (isHidden) {
        hintContent.style.display = 'block';
        hintBtn.textContent = '🙈 Hide Field Notes';
        hintBtn.setAttribute('aria-expanded', 'true');
    } else {
        hintContent.style.display = 'none';
        hintBtn.textContent = '💡 Show Field Notes (Hint)';
        hintBtn.setAttribute('aria-expanded', 'false');
    }
});

// --- MODAL LOGIC ---
const zoomModal = document.getElementById('zoom-modal');
const zoomImg = document.getElementById('zoom-modal-img');
const zoomScroll = document.getElementById('zoom-modal-scroll');

zoomImg.onload = () => {
    zoomImg.style.display = 'inline-block';
};

zoomImg.onerror = () => {
    zoomImg.style.display = 'none';
};

const closeModal = () => {
    zoomModal.close();
};

zoomModal.addEventListener('close', () => {
    zoomImg.classList.remove('zoomed-in');
    zoomImg.style.display = 'none';
    zoomImg.removeAttribute('src');
});

document.getElementById('btn-close-modal').addEventListener('click', closeModal);

zoomScroll.addEventListener('click', (e) => {
    if (e.target === zoomScroll) closeModal();
});

zoomImg.addEventListener('click', (e) => {
    const rect = zoomImg.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;

    const isZoomed = zoomImg.classList.toggle('zoomed-in');
    
    if (isZoomed) {
        requestAnimationFrame(() => {
            const targetX = zoomImg.offsetLeft + (zoomImg.offsetWidth * xRatio);
            const targetY = zoomImg.offsetTop + (zoomImg.offsetHeight * yRatio);

            zoomScroll.scrollLeft = targetX - (zoomScroll.clientWidth / 2);
            zoomScroll.scrollTop = targetY - (zoomScroll.clientHeight / 2);
        });
    }
});

// --- ANSWER LOGIC ---
const inputAnswer = document.getElementById('input-answer');
const btnSkip = document.getElementById('btn-skip');
const btnClearAnswer = document.getElementById('clear-answer');

// Toggle skip button and clear button based on input presence
inputAnswer.addEventListener('input', (e) => {
    const hasText = e.target.value.trim().length > 0;
    ui.toggleClearButton('input-answer', 'clear-answer');
    
    // Disable skip button natively if text is present (screen-reader accessible)
    btnSkip.disabled = hasText;
});

// Handle clearing the answer accessibly
btnClearAnswer.addEventListener('click', () => {
    inputAnswer.value = '';
    ui.toggleClearButton('input-answer', 'clear-answer');
    btnSkip.disabled = false;
    
    inputAnswer.focus(); 
});

document.getElementById('btn-submit').addEventListener('click', async () => {
    const inputStr = document.getElementById('input-answer').value.trim();
    const guessedRank = document.getElementById('input-rank').value;
    if (!inputStr) return;

    let s = getState();
    const q = s.questions[s.currentIndex];
    const taxon = q.observation?.taxon || q.taxon;
    const btnSubmit = document.getElementById('btn-submit');
    
    document.getElementById('input-answer').disabled = true;
    document.getElementById('input-rank').disabled = true;
    document.getElementById('btn-skip').style.display = 'none';
    document.getElementById('clear-answer').style.display = 'none';
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Checking...";

    const { isCorrect, pointsEarned, matchedNameDisplay } = await engine.evaluateAnswer(
        inputStr,
        guessedRank,
        taxon,
        observationService.getDynamicNetworkTimeout
    );
    
    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(s));
    
    updateQuestion(s.currentIndex, {
        userAnswer: `${inputStr} (${guessedRank})`,
        isCorrect: isCorrect,
        pointsEarned: pointsEarned,
        thumbnailUrl: mediaInfo.url,
        mediaAttribution: mediaInfo.attribution
    });
    
    if (isCorrect) setState({ score: s.score + pointsEarned });

    const updatedScore = getState().score;
    const primaryCommonNorm = taxon.preferred_common_name ? engine.normalize(taxon.preferred_common_name) : "";
    const sciNorm = engine.normalize(taxon.name);
    const matchedNorm = engine.normalize(matchedNameDisplay);

    ui.renderFeedback(isCorrect, taxon, matchedNameDisplay, matchedNorm, primaryCommonNorm, sciNorm, updatedScore, pointsEarned, guessedRank, false, q.observation?.id);
});

// --- SKIP LOGIC ---
document.getElementById('btn-skip').addEventListener('click', () => {
    let s = getState();
    const q = s.questions[s.currentIndex];
    const taxon = q.observation?.taxon || q.taxon;

    document.getElementById('input-answer').disabled = true;
    document.getElementById('input-rank').disabled = true;
    document.getElementById('btn-submit').style.display = 'none';
    document.getElementById('btn-skip').style.display = 'none';
    document.getElementById('clear-answer').style.display = 'none';

    const mediaInfo = engine.getQuestionThumbnail(q, selectCurrentMedia(s));

    updateQuestion(s.currentIndex, {
        userAnswer: "(Skipped)",
        isCorrect: false,
        pointsEarned: 0,
        thumbnailUrl: mediaInfo.url,
        mediaAttribution: mediaInfo.attribution
    });

    ui.renderFeedback(false, taxon, "", "", "", "", s.score, 0, "species", true, q.observation?.id);
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
        const mediaInfo = engine.getQuestionThumbnail(currentQ, selectCurrentMedia(s));
        updateQuestion(s.currentIndex, {
            isCorrect: false,
            userAnswer: "(Skipped)",
            thumbnailUrl: mediaInfo.url,
            mediaAttribution: mediaInfo.attribution
        });
    }
    
    s = getState();
    setState({ currentIndex: s.currentIndex + 1 });
    s = getState();
    
    if (s.currentIndex >= s.questions.length) ui.renderResultsView(s.questions, s.score);
    else renderQuizQuestion();
});

// --- RETRY & END FAILBACK LOGIC ---
document.getElementById('btn-retry').addEventListener('click', () => {
    const s = getState();
    updateQuestion(s.currentIndex, { observation: null });
    renderQuizQuestion();
});

document.getElementById('btn-skip-end').addEventListener('click', () => {
    const s = getState();
    // Truncate unanswered questions up to the current index
    const truncatedQuestions = s.questions.slice(0, s.currentIndex);
    setState({ questions: truncatedQuestions });
    
    ui.renderResultsView(truncatedQuestions, s.score);
});

document.getElementById('btn-restart').addEventListener('click', () => {
    observationService.clearCache();
    resetState();
    loadPreferences();
    ui.showView('setup-view');
});

loadPreferences();
