import { state } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';
import * as ui from './ui.js';

// --- UTILITIES & STORAGE ---
function debounce(func, timeout = 1000) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => { func.apply(this, args); }, timeout); };
}

function getMediaParams() {
    const photos = document.getElementById('chk-photos').checked;
    const sounds = document.getElementById('chk-sounds').checked;
    if (photos && !sounds) return '&photos=true';
    if (!photos && sounds) return '&sounds=true';
    return '';
}

function getMonthParams() {
    const checkboxes = document.querySelectorAll('#month-filters input:checked');
    if (checkboxes.length === 12 || checkboxes.length === 0) return '';
    const months = Array.from(checkboxes).map(cb => cb.value).join(',');
    return `&month=${months}`;
}

function savePreferences() {
    const prefs = {
        placeId: state.placeId, lat: state.lat, lng: state.lng,
        placeName: document.getElementById('input-place').value,
        taxonId: state.taxonId, taxonName: document.getElementById('input-taxon').value,
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

        state.placeId = prefs.placeId || null; state.lat = prefs.lat || null;
        state.lng = prefs.lng || null; state.taxonId = prefs.taxonId || null;

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
    () => !!state.placeId, () => state.lat !== null
);
const taxonValidation = ui.setupInlineValidation('input-taxon', 'valid target taxon', 
    () => !!state.taxonId, () => false
);

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        document.querySelectorAll('.autocomplete-list').forEach(list => ui.toggleList(list.id, false));
    }
});

document.getElementById('clear-place').addEventListener('click', () => {
    const input = document.getElementById('input-place');
    input.value = ''; state.placeId = null; state.lat = null; state.lng = null;
    ui.toggleClearButton('input-place', 'clear-place');
    ui.toggleList('list-place', false);
    placeValidation.clearError(); input.focus();
});

document.getElementById('clear-taxon').addEventListener('click', () => {
    const input = document.getElementById('input-taxon');
    input.value = ''; state.taxonId = null;
    ui.toggleClearButton('input-taxon', 'clear-taxon');
    ui.toggleList('list-taxon', false);
    taxonValidation.clearError(); input.focus();
});

document.getElementById('btn-months-all').addEventListener('click', () => document.querySelectorAll('#month-filters input').forEach(cb => cb.checked = true));
document.getElementById('btn-months-none').addEventListener('click', () => document.querySelectorAll('#month-filters input').forEach(cb => cb.checked = false));

// --- AUTOCOMPLETE LOGIC ---
document.getElementById('input-place').addEventListener('input', debounce(async (e) => {
    ui.toggleClearButton('input-place', 'clear-place');
    const query = e.target.value; const list = document.getElementById('list-place');
    list.innerHTML = ''; state.placeId = null;
    if (query.length < 3) return ui.toggleList('list-place', false);

    try {
        const data = await api.fetchPlaces(query);
        if (data.results.length) ui.toggleList('list-place', true);
        data.results.forEach(place => {
            const li = document.createElement('li');
            const displayName = place.display_name || place.name;
            li.textContent = displayName; li.tabIndex = -1; li.setAttribute('role', 'option');
            
            const selectItem = () => {
                state.placeId = place.id; state.lat = null; state.lng = null;
                document.getElementById('input-place').value = displayName;
                ui.toggleList('list-place', false); ui.toggleClearButton('input-place', 'clear-place');
                placeValidation.clearError(); document.getElementById('input-place').focus();
            };
            li.onclick = selectItem;
            li.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); selectItem(); } };
            list.appendChild(li);
        });
    } catch(err) { console.warn("Location search offline"); }
}));

document.getElementById('input-place').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault(); const list = document.getElementById('list-place');
        if (list.classList.contains('show') && list.firstChild) list.firstChild.focus();
    }
});
document.getElementById('list-place').addEventListener('keydown', (e) => ui.handleListKeydown(e, 'list-place'));

document.getElementById('input-taxon').addEventListener('input', debounce(async (e) => {
    ui.toggleClearButton('input-taxon', 'clear-taxon');
    const query = e.target.value; const list = document.getElementById('list-taxon');
    list.innerHTML = ''; state.taxonId = null; 
    if (query.length < 3) return ui.toggleList('list-taxon', false);

    try {
        const data = await api.fetchTaxaAutocomplete(query);
        if (data.results.length) ui.toggleList('list-taxon', true);
        data.results.forEach(taxon => {
            const li = document.createElement('li');
            const common = taxon.preferred_common_name ? `${taxon.preferred_common_name} ` : '';
            li.textContent = `${common}(${taxon.name})`; li.tabIndex = -1; li.setAttribute('role', 'option');
            
            const selectItem = () => {
                state.taxonId = taxon.id;
                document.getElementById('input-taxon').value = li.textContent;
                ui.toggleList('list-taxon', false); ui.toggleClearButton('input-taxon', 'clear-taxon');
                taxonValidation.clearError(); document.getElementById('input-taxon').focus();
            };
            li.onclick = selectItem;
            li.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); selectItem(); } };
            list.appendChild(li);
        });
    } catch(err) { console.warn("Taxon search offline"); }
}));

document.getElementById('input-taxon').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault(); const list = document.getElementById('list-taxon');
        if (list.classList.contains('show') && list.firstChild) list.firstChild.focus();
    }
});
document.getElementById('list-taxon').addEventListener('keydown', (e) => ui.handleListKeydown(e, 'list-taxon'));

document.getElementById('btn-gps').addEventListener('click', () => {
    const btn = document.getElementById('btn-gps');
    const originalText = btn.textContent;
    btn.textContent = "⏳ Locating..."; btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            state.lat = pos.coords.latitude; state.lng = pos.coords.longitude; state.placeId = null;
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

    if (!state.placeId && !state.lat) { placeValidation.showError("⚠️ Please search and select a location, or use GPS."); hasError = true; }
    if (document.getElementById('input-taxon').value.trim() !== '' && !state.taxonId) {
        taxonValidation.showError("⚠️ Please select a valid target taxon from the list, or clear this field."); hasError = true;
    }
    if (hasError) return;

    if (!document.getElementById('chk-photos').checked && !document.getElementById('chk-sounds').checked) {
        ui.showGeneralError("Please select at least one media type (Photos or Sounds)."); return;
    }
    if (document.querySelectorAll('#month-filters input:checked').length === 0) {
        ui.showGeneralError("Please select at least one month for seasonality."); return;
    }

    savePreferences();
    const btn = document.getElementById('btn-start');
    btn.disabled = true; btn.textContent = "Analyzing Regional Ecology...";

    const difficulty = document.getElementById('input-difficulty').value;
    const questionLimit = parseInt(document.getElementById('input-questions').value);
    const preventDuplicates = document.getElementById('chk-unique').checked;

    if (difficulty === 'all') {
        state.questions = Array.from({ length: questionLimit }, () => ({ taxon: null, observation: null }));
        state.currentIndex = 0; state.score = 0;
        
        loadObservationForQuestion(0);
        ui.showView('quiz-view');
        renderQuizQuestion();
        
        btn.disabled = false; btn.textContent = "Load Quiz Pool";
        return;
    }

    let poolUrl = `https://api.inaturalist.org/v2/observations/species_counts?quality_grade=research&captive=false&per_page=${difficulty}${getMediaParams()}${getMonthParams()}`;
    if (state.placeId) poolUrl += `&place_id=${state.placeId}`;
    else poolUrl += `&lat=${state.lat}&lng=${state.lng}&radius=10`;
    if (state.taxonId) poolUrl += `&taxon_id=${state.taxonId}`;
    poolUrl += `&fields=${encodeURIComponent('(count:!t,taxon:(id:!t,name:!t,preferred_common_name:!t))')}`;

    try {
        const data = await api.fetchSpeciesPool(poolUrl);
        if (!data.results || data.results.length === 0) {
            btn.disabled = false; btn.textContent = "Load Quiz Pool";
            ui.showGeneralError("No research-grade observations found for these settings. Try a broader location, taxon, or month range.");
            return;
        }

        state.questions = engine.generateWeightedPool(data.results, questionLimit, preventDuplicates);
        state.currentIndex = 0; state.score = 0;
        
        loadObservationForQuestion(0);
        ui.showView('quiz-view');
        renderQuizQuestion();
    } catch (error) {
        ui.showGeneralError("Error loading species data. Please check your internet connection.");
    } finally {
        btn.disabled = false; btn.textContent = "Load Quiz Pool";
    }
});

// --- JIT PREFETCH WITH TIMEOUT ---
async function loadObservationForQuestion(index) {
    if (index >= state.questions.length || state.questions[index].observation !== null) return;

    let resolver;
    state.questions[index].observation = new Promise(r => resolver = r);

    if (!navigator.onLine) { resolver({ error: true }); return; }

    const q = state.questions[index];
    const difficulty = document.getElementById('input-difficulty').value;
    
    let url = `https://api.inaturalist.org/v2/observations?quality_grade=research&captive=false&per_page=1&order_by=random${getMediaParams()}${getMonthParams()}`;
    if (state.placeId) url += `&place_id=${state.placeId}`;
    else url += `&lat=${state.lat}&lng=${state.lng}&radius=10`;

    if (difficulty === 'all') {
        url += `&rank=species,subspecies`;
        if (state.taxonId) url += `&taxon_id=${state.taxonId}`;
        if (document.getElementById('chk-unique').checked) {
            const seenIds = state.questions.map(quest => quest.taxon?.id).filter(id => id !== undefined);
            if (seenIds.length > 0) url += `&without_taxon_id=${seenIds.join(',')}`;
        }
    } else {
        url += `&taxon_id=${q.taxon.id}`;
    }
    
    url += `&fields=${encodeURIComponent('(observed_on:!t,place_guess:!t,location:!t,taxon:(id:!t,name:!t,preferred_common_name:!t),photos:(url:!t,attribution:!t),sounds:(file_url:!t,attribution:!t))')}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const data = await api.fetchObservation(url, controller.signal);
        clearTimeout(timeoutId);

        if (data.results && data.results.length > 0) {
            const obs = data.results[0];
            if (difficulty === 'all') state.questions[index].taxon = obs.taxon;
            state.questions[index].observation = obs;
            resolver(obs);
            
            if (obs.photos && obs.photos.length > 0) {
                const preload = new Image();
                preload.src = obs.photos[0].url.replace('square', 'medium');
            }
        } else { resolver({ error: true }); }
    } catch(e) { resolver({ error: true }); }
}

// --- MEDIA NAVIGATION ---
document.getElementById('btn-prev-media').addEventListener('click', () => {
    if (state.currentMediaIndex > 0) { state.currentMediaIndex--; ui.updateMediaDisplay(state.currentMediaArray, state.currentMediaIndex); }
});
document.getElementById('btn-next-media').addEventListener('click', () => {
    if (state.currentMediaIndex < state.currentMediaArray.length - 1) { state.currentMediaIndex++; ui.updateMediaDisplay(state.currentMediaArray, state.currentMediaIndex); }
});

// --- GAME LOOP ---
async function renderQuizQuestion() {
    state.isQuestionLoaded = false;
    state.currentMediaArray = [];
    state.currentMediaIndex = 0;

    ui.resetQuizUI(state.currentIndex, state.questions.length, state.score);

    const q = state.questions[state.currentIndex];
    if (!q.observation) loadObservationForQuestion(state.currentIndex);
    
    let obsData = q.observation;
    if (obsData instanceof Promise) obsData = await obsData;

    if (obsData.error) { handleFetchErrorFallback(q); return; }

    const hasPhotos = obsData.photos && obsData.photos.length > 0;
    const hasSounds = obsData.sounds && obsData.sounds.length > 0;
    
    if (!hasPhotos && !hasSounds) { handleFetchErrorFallback(q, true); return; }

    state.currentMeta = { date: obsData.observed_on, locationText: obsData.place_guess, coordinates: obsData.location };

    const wantsPhotos = document.getElementById('chk-photos').checked;
    const wantsSounds = document.getElementById('chk-sounds').checked;
    
    if (hasPhotos && wantsPhotos) {
        obsData.photos.forEach(p => state.currentMediaArray.push({
            type: 'photo', mediumUrl: p.url.replace('square', 'medium'),
            originalUrl: p.url.replace('square', 'original'), attribution: p.attribution
        }));
    }
    
    if (hasSounds && wantsSounds) {
        obsData.sounds.forEach(s => state.currentMediaArray.push({
            type: 'sound', fileUrl: s.file_url, attribution: s.attribution
        }));
    }

    if (state.currentMediaArray.length === 0) { handleFetchErrorFallback(q, true); return; }

    state.currentMediaIndex = 0;
    ui.updateMediaDisplay(state.currentMediaArray, state.currentMediaIndex);

    if (state.currentMediaArray[0].type === 'sound') triggerQuestionReady();
}

function handleFetchErrorFallback(q, isMediaMissing = false) {
    let taxonName = "Random Species";
    if (q.taxon) taxonName = q.taxon.preferred_common_name || q.taxon.name;
    else if (state.taxonId) taxonName = document.getElementById('input-taxon').value || "Target Taxon";
    
    ui.renderFetchError(taxonName, isMediaMissing);
    state.isQuestionLoaded = true;
    loadObservationForQuestion(state.currentIndex + 1);
}

function triggerQuestionReady() {
    document.getElementById('quiz-loading').style.display = 'none';
    document.getElementById('quiz-attribution').style.display = 'block';
    
    ui.renderQuestionMeta(state.currentMeta);
    
    if (!state.isQuestionLoaded) {
        state.isQuestionLoaded = true;
        document.getElementById('input-answer').disabled = false; 
        document.getElementById('input-answer').focus();
        document.getElementById('btn-submit').style.display = 'block';
        loadObservationForQuestion(state.currentIndex + 1);
    }
}

document.getElementById('quiz-image').onload = (e) => {
    if (state.currentMediaArray[state.currentMediaIndex]?.type === 'photo') {
        document.getElementById('btn-zoom-image').style.display = 'flex';
        e.target.style.display = 'block';
        triggerQuestionReady();
    }
};

document.getElementById('quiz-image').onerror = () => {
    if (state.currentMediaArray[state.currentMediaIndex]?.type === 'photo') {
        document.getElementById('media-controls').style.display = 'none';
        ui.renderFetchError("", false);
        state.isQuestionLoaded = true;
        loadObservationForQuestion(state.currentIndex + 1);
    }
};

document.getElementById('quiz-audio-player').onerror = () => {
    if (state.currentMediaArray[state.currentMediaIndex]?.type === 'sound') {
        document.getElementById('media-controls').style.display = 'none';
        ui.renderFetchError("", false);
        state.isQuestionLoaded = true;
        loadObservationForQuestion(state.currentIndex + 1);
    }
};

// --- ANSWER LOGIC ---
document.getElementById('btn-submit').addEventListener('click', async () => {
    const inputStr = document.getElementById('input-answer').value.trim();
    if (!inputStr) return;

    const q = state.questions[state.currentIndex];
    const taxon = q.taxon;
    const btnSubmit = document.getElementById('btn-submit');
    document.getElementById('input-answer').disabled = true;
    btnSubmit.disabled = true; btnSubmit.textContent = "Checking...";

    let { isCorrect, matchedNameDisplay, normalizedInput } = engine.checkExactMatch(inputStr, taxon);

    if (!isCorrect && navigator.onLine) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const searchData = await api.checkTaxonSearch(inputStr, controller.signal);
            clearTimeout(timeoutId);
            
            if (searchData.results && searchData.results.length > 0) {
                for (const result of searchData.results) {
                    const isTargetOrDescendant = result.id === taxon.id || (result.ancestor_ids && result.ancestor_ids.includes(taxon.id));
                    const validNames = [engine.normalize(result.name), engine.normalize(result.preferred_common_name), engine.normalize(result.matched_term)];
                    
                    if (isTargetOrDescendant && validNames.includes(normalizedInput)) {
                        isCorrect = true;
                        matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                        break;
                    }
                }
            }
        } catch (error) { console.warn("API check failed. Relying on local strict match."); }
    }
    
    q.userAnswer = inputStr;
    q.isCorrect = isCorrect;
    q.thumbnailUrl = engine.getQuestionThumbnail(q, state.currentMediaArray);
    
    if (isCorrect) state.score++;

    const primaryCommonNorm = taxon.preferred_common_name ? engine.normalize(taxon.preferred_common_name) : "";
    const sciNorm = engine.normalize(taxon.name);
    const matchedNorm = engine.normalize(matchedNameDisplay);

    ui.renderFeedback(isCorrect, taxon, matchedNameDisplay, matchedNorm, primaryCommonNorm, sciNorm, state.score);
});

document.getElementById('input-answer').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.target.disabled) document.getElementById('btn-submit').click();
});

document.getElementById('btn-next').addEventListener('click', (e) => {
    e.target.textContent = "Next Observation ➔";
    const currentQ = state.questions[state.currentIndex];
    if (currentQ.isCorrect === undefined) {
        currentQ.isCorrect = false;
        currentQ.userAnswer = "(Skipped)";
        currentQ.thumbnailUrl = engine.getQuestionThumbnail(currentQ, state.currentMediaArray);
    }
    state.currentIndex++;
    if (state.currentIndex >= state.questions.length) ui.renderResultsView(state.questions, state.score);
    else renderQuizQuestion();
});

document.getElementById('btn-restart').addEventListener('click', () => {
    state.questions = [];
    ui.showView('setup-view');
});

loadPreferences();
