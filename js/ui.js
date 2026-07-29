import { selectCurrentMedia, selectCurrentMeta } from './state.js';
import { filterSignificantFragments } from './stopwords.js';

let currentView = null;
let lastFocusedQuestionIndex = -1;

const autocompleteConfigs = [
    {
        type: 'place',
        inputId: 'input-place',
        listId: 'list-place',
        clearBtnId: 'clear-place',
        nameKey: 'placeName',
        errorKey: 'placeError',
        resultsKey: 'placeResults',
        showKey: 'showPlaceList',
        activeIdxKey: 'activePlaceIdx',
        formatDisplay: (item) => item.display_name || item.name
    },
    {
        type: 'taxon',
        inputId: 'input-taxon',
        listId: 'list-taxon',
        clearBtnId: 'clear-taxon',
        nameKey: 'taxonName',
        errorKey: 'taxonError',
        resultsKey: 'taxonResults',
        showKey: 'showTaxonList',
        activeIdxKey: 'activeTaxonIdx',
        formatDisplay: (item) => item.preferred_common_name ? `${item.preferred_common_name} (${item.name})` : item.name
    }
];

/**
 * Redacts the taxon's scientific name, common names, and significant fragments
 * from field note strings while protecting generic stop-words from over-redaction.
 */
function redactSpoilers(text, taxon) {
    if (!text || !taxon) return text;

    const scientificTerms = new Set();
    const commonTerms = new Set();

    // 1. Add Full Scientific Name & Genus/Epithet parts
    if (taxon.name) {
        scientificTerms.add(taxon.name);
        
        const nameParts = taxon.name.split(/[\s-]+/);
        nameParts.forEach(part => {
            if (part.length > 2) scientificTerms.add(part);
        });
    }

    // 2. Add Full Preferred Common Name
    if (taxon.preferred_common_name) {
        commonTerms.add(taxon.preferred_common_name);
        
        // 3. Extract & filter fragments using the stop-word dictionary
        const fragments = taxon.preferred_common_name.split(/[\s-]+/);
        const significantFragments = filterSignificantFragments(fragments, 3);
        
        significantFragments.forEach(fragment => {
            commonTerms.add(fragment);
        });
    }

    // 4. Pluralize ONLY significant common terms (e.g., "Falcon" -> "Falcons")
    const termsToRedact = new Set([...scientificTerms, ...commonTerms]);
    
    commonTerms.forEach(term => {
        termsToRedact.add(term + 's');
        termsToRedact.add(term + 'es');
        
        if (term.toLowerCase().endsWith('y')) {
            termsToRedact.add(term.slice(0, -1) + 'ies');
        }
    });

    // 5. Sort descending by length so full phrases match before single words
    const sortedTerms = Array.from(termsToRedact)
        .sort((a, b) => b.length - a.length)
        .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (sortedTerms.length === 0) return text;

    // 6. Global, case-insensitive redaction using word boundaries
    const regex = new RegExp(`\\b(${sortedTerms.join('|')})\\b`, 'gi');
    return text.replace(regex, '[REDACTED]');
}

export const formatPoints = (points) => Number((points / 10).toFixed(1));

// Helper to safely pause and reset audio playback
function stopAudio() {
    const audioPlayer = document.getElementById('quiz-audio-player');
    if (audioPlayer && !audioPlayer.paused) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
    }
}

// Safe text input sync (prevents cursor jumping)
export function syncInput(id, value) {
    const el = document.getElementById(id);
    if (el && el.value !== String(value)) el.value = value;
}

export function syncCheckbox(id, checked) {
    const el = document.getElementById(id);
    const isChecked = !!checked;
    if (el && el.checked !== isChecked) el.checked = isChecked;
}

/**
 * The single declarative rendering pipeline. 
 * Maps the entire state tree to the DOM visually using safe DOM construction.
 */
export function render(state) {
    // 1. View Routing
    const isNewView = currentView !== state.ui.activeView;
    
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === state.ui.activeView));
    
    if (isNewView) {
        currentView = state.ui.activeView;
        
        // Derives 'setup-heading' from 'setup-view', etc.
        const headingId = currentView.replace('-view', '-heading');
        const headingEl = document.getElementById(headingId);
        
        if (headingEl) {
            headingEl.focus();
        }
    }

    // Stop audio if navigating away from the quiz view
    if (state.ui.activeView !== 'quiz-view') {
        stopAudio();
    }

    // 2. Setup View
    if (state.ui.activeView === 'setup-view') {
        lastFocusedQuestionIndex = -1;
        
        syncInput('input-place', state.form.placeName || '');
        syncInput('input-taxon', state.form.taxonName || '');
        syncInput('input-lat', state.form.lat ?? '');
        syncInput('input-lng', state.form.lng ?? '');
        syncInput('input-radius', state.form.radius);
        
        syncCheckbox('mode-search', state.form.locMode === 'search');
        syncCheckbox('mode-coords', state.form.locMode === 'coords');
        document.getElementById('section-search').classList.toggle('active', state.form.locMode === 'search');
        document.getElementById('section-coords').classList.toggle('active', state.form.locMode === 'coords');

        syncCheckbox('chk-photos', state.form.wantsPhotos);
        syncCheckbox('chk-sounds', state.form.wantsSounds);
        syncCheckbox('chk-badge', state.form.showIconicTaxonBadge);
        syncCheckbox('chk-unique', state.form.preventDuplicates);
        syncCheckbox('chk-rarity', state.form.isRarityMode);

        document.querySelectorAll('#month-filters input').forEach(cb => {
            const shouldBeChecked = state.form.months.includes(cb.value);
            if (cb.checked !== shouldBeChecked) cb.checked = shouldBeChecked;
        });
        
        syncInput('input-difficulty', state.form.difficulty);
        syncInput('input-questions', state.form.questionLimit);
        syncInput('input-weighting', state.form.weightingMethod);
        syncInput('input-establishment', state.form.establishmentStatus);

        const btnStart = document.getElementById('btn-start');
        btnStart.disabled = state.ui.isLoadingQuizPool;
        btnStart.textContent = state.ui.isLoadingQuizPool ? "Analyzing Regional Ecology..." : "Load Quiz Pool";

        const btnGps = document.getElementById('btn-gps');
        btnGps.disabled = state.ui.isLocatingGps;
        btnGps.textContent = state.ui.isLocatingGps ? "⏳ Locating..." : "📍 Use My Exact Location (GPS)";
        
        // Dynamic Autocomplete Rendering
        autocompleteConfigs.forEach(config => {
            const clearBtn = document.getElementById(config.clearBtnId);
            if (clearBtn) {
                clearBtn.style.display = state.form[config.nameKey] ? 'block' : 'none';
            }
            
            renderInputError(config.inputId, state.ui[config.errorKey]);
            
            renderAutocomplete(
                config,
                state.ui[config.resultsKey],
                state.ui[config.showKey],
                state.ui[config.activeIdxKey]
            );
        });

        renderError('form-error-message', state.ui.setupError);
    }

    // 3. Quiz View
    if (state.ui.activeView === 'quiz-view') {
        const q = state.questions[state.currentIndex];
        const isAnswered = q?.isAnswered;
        
        const hasObservation = !!q?.observation;
        const hasError = !!state.ui.quizError || !!q?.observation?.error;
        
        const isReadyForMedia = hasObservation && !hasError;
        
        document.getElementById('quiz-counter').textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
        document.getElementById('quiz-score').textContent = `Score: ${formatPoints(state.score)}`;

        // Loading Overlay
        const loadingEl = document.getElementById('quiz-loading');
        if (!hasObservation && !hasError) {
            loadingEl.style.display = 'block';
            loadingEl.textContent = 'Fetching random observation...';
        } else if (hasObservation && !hasError && !state.ui.isMediaLoaded) {
            loadingEl.style.display = 'block';
            loadingEl.textContent = 'Loading media...';
        } else {
            loadingEl.style.display = 'none';
        }

        const errDiv = document.getElementById('quiz-error');
        if (hasError) {
            errDiv.style.display = 'block';
            
            // Only build the error nodes if the container is empty
            if (!errDiv.hasChildNodes()) {
                const isMissing = state.ui.isMissingMedia || state.ui.quizError?.isMissingMedia;
                const isRateLimited = q?.observation?.isRateLimited || state.ui.quizError?.isRateLimited;
                
                let mainTextContent = '❌ Failed to load observation data.';
                let hintTextContent = 'Please check your internet connection or filters.';

                if (isRateLimited) {
                    mainTextContent = '⏳ Too Many Requests (Rate Limited).';
                    hintTextContent = 'You have hit the iNaturalist API limits. Please wait a minute before retrying.';
                } else if (isMissing) {
                    mainTextContent = '❌ Observation missing media data.';
                    hintTextContent = 'This occasionally happens in the iNaturalist database.';
                }
                
                const mainText = document.createTextNode(mainTextContent);
                const hint = document.createElement('span');
                hint.className = 'error-hint';
                hint.textContent = hintTextContent;
                
                errDiv.replaceChildren(mainText, document.createElement('br'), document.createElement('br'), hint);
            }
        } else {
            errDiv.style.display = 'none';
            // Clean up when the error clears
            if (errDiv.hasChildNodes()) {
                errDiv.replaceChildren();
            }
        }

        renderQuizMedia(state, isReadyForMedia);
        renderQuizMeta(state, isReadyForMedia);

        // Forms & Buttons
        syncInput('input-answer', state.form.answerInput);
        syncInput('input-rank', state.form.rankInput);

        const inputDisabled = isAnswered || !isReadyForMedia || state.ui.isCheckingAnswer;
        const answerInput = document.getElementById('input-answer');
        const rankInput = document.getElementById('input-rank');
        
        if (answerInput) answerInput.disabled = inputDisabled;
        if (rankInput) rankInput.disabled = inputDisabled;
        
        if (isReadyForMedia && !isAnswered && !state.ui.isCheckingAnswer) {
            if (lastFocusedQuestionIndex !== state.currentIndex) {
                lastFocusedQuestionIndex = state.currentIndex;
                if (answerInput) answerInput.focus();
            }
        }
        
        const btnSubmit = document.getElementById('btn-submit');
        btnSubmit.style.display = (!isAnswered && isReadyForMedia) ? 'block' : 'none';
        btnSubmit.disabled = state.ui.isCheckingAnswer;
        btnSubmit.textContent = state.ui.isCheckingAnswer ? "Checking..." : "Check Answer";

        const btnSkip = document.getElementById('btn-skip');
        btnSkip.style.display = (!isAnswered && isReadyForMedia) ? 'block' : 'none';
        btnSkip.disabled = state.ui.isCheckingAnswer || (state.form.answerInput || '').trim().length > 0;
        
        document.getElementById('clear-answer').style.display = (!isAnswered && !state.ui.isCheckingAnswer && isReadyForMedia && (state.form.answerInput || '').length > 0) ? 'block' : 'none';

        const btnNext = document.getElementById('btn-next');
        btnNext.style.display = isAnswered ? 'block' : 'none';
        if (isAnswered) {
            const isLastQuestion = state.currentIndex === state.questions.length - 1;
            btnNext.textContent = isLastQuestion ? 'View Results ➔' : 'Next Observation ➔';
        }

        document.getElementById('btn-retry').style.display = hasError ? 'block' : 'none';
        document.getElementById('btn-skip-end').style.display = hasError ? 'block' : 'none';

        // Feedback Template Rendering
        const feedback = document.getElementById('feedback');
        if (isAnswered) {
            feedback.style.display = 'block';
            feedback.className = q.isCorrect ? 'correct' : 'incorrect';
            
            // Only rebuild the DOM if we moved to a new question
            if (feedback._lastQuestionIndex !== state.currentIndex) {
                buildFeedbackDom(q, feedback);
                feedback._lastQuestionIndex = state.currentIndex;
            }
        } else {
            feedback.style.display = 'none';
            if (feedback.hasChildNodes()) {
                feedback.replaceChildren();
            }
            feedback._lastQuestionIndex = -1;
        }
    }

    // 4. Results View
    if (state.ui.activeView === 'results-view') {
        document.getElementById('final-score').textContent = `${formatPoints(state.score)} / ${state.questions.length}`;
        const container = document.getElementById('review-container');
        if (!container.hasChildNodes()) { 
            buildResultsDom(state.questions, container);
        }
    } else {
        document.getElementById('review-container').replaceChildren();
    }

    // 5. Zoom Modal
    const modal = document.getElementById('zoom-modal');
    const zoomImg = document.getElementById('zoom-modal-img');
    if (state.ui.zoomMediaUrl) {
        if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
        if (zoomImg.dataset.src !== state.ui.zoomMediaUrl) {
            zoomImg.src = state.ui.zoomMediaUrl;
            zoomImg.dataset.src = state.ui.zoomMediaUrl;
            zoomImg.style.display = 'inline-block';
        }
        zoomImg.className = state.ui.isZoomedIn ? 'zoomed-in' : '';
    } else {
        if (modal.open && typeof modal.close === 'function') modal.close();
        if (zoomImg.dataset.src) {
            zoomImg.removeAttribute('src');
            delete zoomImg.dataset.src;
            zoomImg.style.display = 'none';
        }
    }
}

// --- SUB-RENDERERS ---

function renderAutocomplete(config, results, show, activeIdx) {
    const { listId, inputId, type, formatDisplay } = config;
    const list = document.getElementById(listId);
    const input = document.getElementById(inputId);
    
    // Hide and clear if needed
    if (!show || results.length === 0) {
        if (list.childNodes.length > 0) list.replaceChildren();
        list.classList.remove('show');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        list._lastResults = null; // Clear cache
        return;
    }

    // 1. Content Rendering: Only rebuild DOM if the underlying data reference changed
    if (list._lastResults !== results) {
        const fragment = document.createDocumentFragment();
        
        results.forEach((item, i) => {
            const li = document.createElement('li');
            li.id = `opt-${type}-${i}`;
            li.setAttribute('role', 'option');
            li.textContent = formatDisplay(item);
            fragment.appendChild(li);
        });
        
        list.replaceChildren(fragment);
        list._lastResults = results; // Cache the immutable reference
    }

    // 2. State Rendering: Always update visibility and active indices
    list.classList.add('show');
    input.setAttribute('aria-expanded', 'true');
    
    // Reset previously active items
    const prevActive = list.querySelector('.active');
    if (prevActive) {
        prevActive.classList.remove('active');
        prevActive.setAttribute('aria-selected', 'false');
    }

    // Apply new active item
    if (activeIdx >= 0) {
        input.setAttribute('aria-activedescendant', `opt-${type}-${activeIdx}`);
        const activeLi = document.getElementById(`opt-${type}-${activeIdx}`);
        if (activeLi) {
            activeLi.classList.add('active');
            activeLi.setAttribute('aria-selected', 'true');
            activeLi.scrollIntoView({ block: 'nearest' });
        }
    } else {
        input.removeAttribute('aria-activedescendant');
    }
}

function renderError(id, msg) {
    const el = document.getElementById(id);
    if (msg) {
        el.textContent = `⚠️ ${msg}`;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function renderInputError(id, msg) {
    const input = document.getElementById(id);
    let errEl = document.getElementById(`${id}-error`);
    
    if (!errEl && input) { 
        errEl = document.createElement('div');
        errEl.className = 'inline-error';
        errEl.id = `${id}-error`;
        input.closest('.form-group').appendChild(errEl);
    }
    
    if (input && errEl) {
        if (msg) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
            input.classList.add('input-error');
        } else {
            errEl.style.display = 'none';
            input.classList.remove('input-error');
        }
    }
}

function renderQuizMedia(state, isReadyForMedia) {
    const mediaArray = selectCurrentMedia(state);
    const media = mediaArray[state.currentMediaIndex];
    
    const imgEl = document.getElementById('quiz-image');
    const zoomBtn = document.getElementById('btn-zoom-image');
    const audioContainer = document.getElementById('quiz-audio-container');
    const audioPlayer = document.getElementById('quiz-audio-player');
    const controls = document.getElementById('media-controls');
    const attrEl = document.getElementById('quiz-attribution');

    if (media && isReadyForMedia) {
        if (media.type === 'photo') {
            stopAudio();
            if (audioPlayer.dataset.src) {
                audioPlayer.removeAttribute('src');
                delete audioPlayer.dataset.src;
            }
            audioContainer.style.display = 'none';
            zoomBtn.style.display = 'flex';
            imgEl.style.display = 'block';
            imgEl.style.opacity = state.ui.isMediaLoaded ? '1' : '0';
            
            if (imgEl.dataset.src !== media.mediumUrl) {
                imgEl.dataset.src = media.mediumUrl;
                imgEl.src = media.mediumUrl;
            }
        } else if (media.type === 'sound') {
            if (imgEl.dataset.src) {
                imgEl.removeAttribute('src');
                delete imgEl.dataset.src;
            }
            zoomBtn.style.display = 'none';
            imgEl.style.display = 'none';
            audioContainer.style.display = 'flex';
            audioContainer.style.opacity = state.ui.isMediaLoaded ? '1' : '0.5';
            
            if (audioPlayer.dataset.src !== media.fileUrl) {
                stopAudio();
                audioPlayer.dataset.src = media.fileUrl;
                audioPlayer.src = media.fileUrl;
            }
        }
        
        attrEl.style.display = 'block';
        attrEl.textContent = media.type === 'photo' 
            ? `Photo: ${media.attribution}` 
            : `Sound: ${media.attribution || 'iNaturalist Contributor'}`;
            
        if (mediaArray.length > 1) {
            controls.style.display = 'flex';
            document.getElementById('media-counter').textContent = `${state.currentMediaIndex + 1} / ${mediaArray.length}`;
            
            const prevBtn = document.getElementById('btn-prev-media');
            const nextBtn = document.getElementById('btn-next-media');
            const isNextDisabled = state.currentMediaIndex === mediaArray.length - 1;
            const isPrevDisabled = state.currentMediaIndex === 0;

            // If the button being clicked is about to be disabled, shift focus to the sibling button
            if (isNextDisabled && document.activeElement === nextBtn) {
                prevBtn.focus();
            } else if (isPrevDisabled && document.activeElement === prevBtn) {
                nextBtn.focus();
            }

            prevBtn.disabled = isPrevDisabled;
            nextBtn.disabled = isNextDisabled;
        } else {
            controls.style.display = 'none';
        }
    } else {
        stopAudio();
        if (imgEl.dataset.src) {
            imgEl.removeAttribute('src');
            delete imgEl.dataset.src;
        }
        if (audioPlayer.dataset.src) {
            audioPlayer.removeAttribute('src');
            delete audioPlayer.dataset.src;
        }
        zoomBtn.style.display = 'none';
        imgEl.style.display = 'none';
        audioContainer.style.display = 'none';
        controls.style.display = 'none';
        attrEl.style.display = 'none';
    }
}

function renderQuizMeta(state, isReadyForMedia) {
    const q = state.questions[state.currentIndex];
    const taxon = q?.observation?.taxon || q?.taxon;
    const meta = selectCurrentMeta(state);

    // Target Badge
    const badge = document.getElementById('quiz-target-badge');
    if (state.config.showIconicTaxonBadge && taxon && taxon.iconic_taxon_name) {
        badge.textContent = `🎯 Target: ${taxon.iconic_taxon_name}`;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }

    // Observation Meta
    document.getElementById('quiz-meta').style.display = (isReadyForMedia && meta) ? 'flex' : 'none';
    if (meta) {
        document.getElementById('meta-date').textContent = `📅 ${new Date(meta.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
        const locLink = document.getElementById('meta-location');
        
        if (meta.isObscured) {
            locLink.textContent = `📍 ${meta.locationText || 'Unknown Location'} (Obscured)`;
            locLink.title = "Exact coordinates are obscured.";
        } else {
            locLink.textContent = `📍 ${meta.locationText || 'Unknown Location'}`;
            locLink.removeAttribute('title');
        }

        // Adjust routing: If obscured, skip GPS mapping and force a text-based search
        if (meta.coordinates && !meta.isObscured) {
            locLink.href = `https://www.google.com/maps/search/?api=1&query=${meta.coordinates}`;
            locLink.className = 'enabled-link';
        } else if (meta.locationText) {
            locLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.locationText)}`;
            locLink.className = 'enabled-link';
        } else {
            locLink.href = "#";
            locLink.className = 'disabled-link';
        }
        
        document.getElementById('meta-observer').textContent = `👤 ${meta.observer} (${meta.license})`;
    }

    // Field Notes Hint
    let desc = q?.observation?.description?.trim();
    const hintBtn = document.getElementById('btn-toggle-hint');
    const hintContent = document.getElementById('quiz-hint-content');
    
    if (isReadyForMedia && desc) {
        desc = redactSpoilers(desc, taxon);
        
        hintBtn.style.display = 'inline-block';
        hintBtn.textContent = state.ui.isHintVisible ? '🙈 Hide Field Notes' : '💡 Show Field Notes (Hint)';
        hintBtn.setAttribute('aria-expanded', String(state.ui.isHintVisible));
        
        hintContent.style.display = state.ui.isHintVisible ? 'block' : 'none';
        if (hintContent.textContent !== desc) hintContent.textContent = desc; // Strictly textContent for sanitization
    } else {
        hintBtn.style.display = 'none';
        hintContent.style.display = 'none';
    }
}

// --- PURE DOM ELEMENT GENERATORS ---

function buildFeedbackDom(q, feedbackEl) {
    feedbackEl.replaceChildren(); // Safely clear container
    const taxon = q.observation?.taxon || q.taxon || { name: 'Unknown Species', id: '' };
    const primaryDisplayName = taxon.preferred_common_name ? `${taxon.preferred_common_name} (${taxon.name})` : taxon.name;

    if (q.isCorrect) {
        const pointsLabel = `(+${formatPoints(q.pointsEarned)} pts)`;
        const titleText = q.guessedRank === 'species' 
            ? `✅ Correct! ${pointsLabel} ` 
            : `✅ Partial Credit! You correctly identified the ${q.guessedRank}. ${pointsLabel} `;
        
        feedbackEl.appendChild(document.createTextNode(titleText));
        feedbackEl.appendChild(document.createElement('br'));

        const strong = document.createElement('strong');
        if (q.matchedNameDisplay && q.matchedNameDisplay.toLowerCase() !== (taxon.preferred_common_name || '').toLowerCase() && q.matchedNameDisplay.toLowerCase() !== taxon.name.toLowerCase()) {
            strong.textContent = q.matchedNameDisplay.replace(/\b\w/g, c => c.toUpperCase());
            feedbackEl.appendChild(strong);
            feedbackEl.appendChild(document.createElement('br'));

            const note = document.createElement('span');
            note.className = 'feedback-alias-note';
            note.textContent = `(Community Taxon: ${primaryDisplayName})`;
            feedbackEl.appendChild(note);
        } else {
            strong.textContent = primaryDisplayName;
            feedbackEl.appendChild(strong);
        }
    } else {
        const titleText = q.isSkipped ? '⏭️ Question skipped.' : '❌ Not quite.';
        feedbackEl.appendChild(document.createTextNode(titleText));
        feedbackEl.appendChild(document.createElement('br'));
        feedbackEl.appendChild(document.createTextNode('Answer: '));
        
        const strong = document.createElement('strong');
        strong.textContent = primaryDisplayName;
        feedbackEl.appendChild(strong);
    }

    const linksDiv = document.createElement('div');
    linksDiv.className = 'feedback-links';
    linksDiv.textContent = '📖 Learn more: ';

    if (taxon.id) {
        const inatLink = document.createElement('a');
        inatLink.href = `https://www.inaturalist.org/taxa/${taxon.id}`;
        inatLink.target = '_blank';
        inatLink.rel = 'noopener';
        inatLink.textContent = 'iNaturalist ↗';
        linksDiv.appendChild(inatLink);
    }
    
    if (taxon.id && q.observation?.id) {
        const sep = document.createElement('span');
        sep.className = 'feedback-separator';
        sep.textContent = '•';
        linksDiv.appendChild(document.createTextNode(' '));
        linksDiv.appendChild(sep);
        linksDiv.appendChild(document.createTextNode(' '));
    }
    
    if (q.observation?.id) {
        const obsLink = document.createElement('a');
        obsLink.href = `https://www.inaturalist.org/observations/${q.observation.id}`;
        obsLink.target = '_blank';
        obsLink.rel = 'noopener';
        obsLink.textContent = 'Observation ↗';
        linksDiv.appendChild(obsLink);
    }
    
    feedbackEl.appendChild(linksDiv);
}

function buildResultsDom(questions, container) {
    container.replaceChildren(); // Safely clear container
    const questionsToReview = questions.filter(q => q.pointsEarned !== 10);

    if (questionsToReview.length === 0) {
        const perfectDiv = document.createElement('div');
        perfectDiv.className = 'perfect-score-banner';
        perfectDiv.textContent = '🎉 Perfect score! You identified every species correctly!';
        container.appendChild(perfectDiv);
        return;
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'missed-title';
    titleDiv.textContent = `Review Missed & Partial Credit Species (${questionsToReview.length})`;
    container.appendChild(titleDiv);

    const gridDiv = document.createElement('div');
    gridDiv.className = 'missed-grid';

    questionsToReview.forEach(q => {
        const taxon = q.observation?.taxon || q.taxon || { name: 'Data Unavailable', id: '' };
        const primaryCommon = taxon.preferred_common_name || 'Fetch Failed';
        const sciName = taxon.name;
        const imgUrl = q.thumbnailUrl || '';
        const userGuess = q.userAnswer || '(Skipped)';
        const isAudio = q.observation && q.observation.sounds && q.observation.sounds.length > 0;

        const card = document.createElement('div');
        card.className = 'missed-card';

        const mediaWrapper = document.createElement('div');
        mediaWrapper.className = 'missed-card-media';

        if (imgUrl) {
            const img = document.createElement('img');
            img.src = imgUrl;
            img.alt = primaryCommon || sciName;
            mediaWrapper.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'media-placeholder';
            placeholder.textContent = isAudio ? '🔊 Audio Observation' : '⚠️ Skipped / No Image';
            mediaWrapper.appendChild(placeholder);
        }

        if (q.mediaAttribution) {
            const attr = document.createElement('div');
            attr.className = 'missed-card-attribution';
            attr.title = q.mediaAttribution;
            attr.textContent = q.mediaAttribution;
            mediaWrapper.appendChild(attr);
        }
        card.appendChild(mediaWrapper);

        const cardBody = document.createElement('div');
        cardBody.className = 'missed-card-body';

        const infoDiv = document.createElement('div');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'missed-card-name';
        nameDiv.textContent = primaryCommon || sciName;
        infoDiv.appendChild(nameDiv);

        if (primaryCommon) {
            const sciDiv = document.createElement('div');
            sciDiv.className = 'missed-card-sci';
            sciDiv.textContent = sciName;
            infoDiv.appendChild(sciDiv);
        }

        const guessDiv = document.createElement('div');
        guessDiv.className = 'missed-card-guess';
        if (q.isCorrect && q.pointsEarned < 10) guessDiv.classList.add('partial-credit');
        
        const guessLabel = document.createTextNode((q.isCorrect && q.pointsEarned < 10) ? 'Partial Credit: ' : 'Your answer: ');
        const strongGuess = document.createElement('strong');
        strongGuess.textContent = userGuess;
        
        guessDiv.appendChild(guessLabel);
        guessDiv.appendChild(strongGuess);
        infoDiv.appendChild(guessDiv);

        cardBody.appendChild(infoDiv);

        const linksDiv = document.createElement('div');
        linksDiv.className = 'missed-card-links';
        
        if (taxon.id) {
            const inatLink = document.createElement('a');
            inatLink.href = `https://www.inaturalist.org/taxa/${taxon.id}`;
            inatLink.target = '_blank';
            inatLink.rel = 'noopener';
            inatLink.textContent = 'iNaturalist ↗';
            linksDiv.appendChild(inatLink);
        }
        
        if (q.observation?.id) {
            const obsLink = document.createElement('a');
            obsLink.href = `https://www.inaturalist.org/observations/${q.observation.id}`;
            obsLink.target = '_blank';
            obsLink.rel = 'noopener';
            obsLink.textContent = 'Observation ↗';
            linksDiv.appendChild(obsLink);
        }
        
        cardBody.appendChild(linksDiv);
        card.appendChild(cardBody);
        gridDiv.appendChild(card);
    });
    
    container.appendChild(gridDiv);
}
