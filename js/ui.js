import { selectCurrentMedia, selectCurrentMeta, getDailyScores } from './state.js';
import { filterSignificantFragments, isStopWord } from './stopwords.js';
import { buildLocationSeedKey } from './quizEngine.js';
import { generateResultShareText } from './urlService.js';

let currentView = null;

// Changed to `let` so the WeakMap can be reinitialized on session resets
let domCache = new WeakMap();

/**
 * Resets the DOM cache to release all retained UI signatures and scalar state.
 */
export function clearDOMCache() {
    domCache = new WeakMap();
}

let announceTimeout = null;

function announce(message, isAssertive = false) {
    if (!message) return;

    if (announceTimeout) clearTimeout(announceTimeout);

    announceTimeout = setTimeout(() => {
        const targetId = isAssertive ? 'a11y-assertive' : 'a11y-polite';
        const announcer = document.getElementById(targetId);
        
        if (announcer) {
            if (announcer.textContent === message) {
                announcer.textContent = message + '\u00A0';
            } else {
                announcer.textContent = message;
            }
        }
        
        const otherId = isAssertive ? 'a11y-polite' : 'a11y-assertive';
        const otherAnnouncer = document.getElementById(otherId);
        if (otherAnnouncer) otherAnnouncer.textContent = '';
        
    }, 250);
}

export function formatPlaceDisplay(item) {
    if (!item) return '';
    const displayName = item.display_name || item.name || '';
    return displayName;
}

export function formatTaxonDisplay(item) {
    if (!item) return '';
    const main = item.preferred_common_name
        ? `${item.preferred_common_name} (${item.name})`
        : item.name;
    return main;
}

export function formatUserDisplay(item) {
    if (!item) return '';
    const login = item.login || item.matched_term || '';
    if (item.name && item.name.toLowerCase() !== login.toLowerCase()) {
        return `${login} (${item.name})`;
    }
    return login;
}

const autocompleteConfigs = [
    {
        inputId: 'input-place',
        listId: 'list-place',
        clearBtnId: 'clear-place',
        nameKey: 'placeName',
        errorKey: 'placeError',
        resultsKey: 'placeResults',
        showListKey: 'showPlaceList',
        activeIdxKey: 'activePlaceIdx',
        type: 'place',
        formatDisplay: formatPlaceDisplay
    },
    {
        inputId: 'input-taxon',
        listId: 'list-taxon',
        clearBtnId: 'clear-taxon',
        nameKey: 'taxonName',
        errorKey: 'taxonError',
        resultsKey: 'taxonResults',
        showListKey: 'showTaxonList',
        activeIdxKey: 'activeTaxonIdx',
        type: 'taxon',
        formatDisplay: formatTaxonDisplay
    },
    {
        inputId: 'input-username',
        listId: 'list-username',
        clearBtnId: 'clear-username',
        nameKey: 'userLogin',
        errorKey: 'userError',
        resultsKey: 'userResults',
        showListKey: 'showUserList',
        activeIdxKey: 'activeUserIdx',
        type: 'user',
        formatDisplay: formatUserDisplay
    }
];

function redactSpoilers(text, taxon) {
    if (!text || !taxon) return text;

    const normalizeTypography = (str) => {
        if (!str) return '';
        return str
            .normalize('NFC')
            .replace(/[’‘´`]/g, "'")
            .replace(/[—–]/g, "-");
    };
    
    let safeText = normalizeTypography(text);

    const scientificTerms = new Set();
    const commonTerms = new Set();

    if (taxon.name) {
        const safeSciName = normalizeTypography(taxon.name);
        scientificTerms.add(safeSciName);
        
        const nameParts = safeSciName.split(/[\s-]+/);
        nameParts.forEach(part => {
            if (part.length > 2) scientificTerms.add(part);
        });
    }

    if (taxon.preferred_common_name) {
        const safeCommonName = normalizeTypography(taxon.preferred_common_name);
        commonTerms.add(safeCommonName);

        if (safeCommonName.includes('-')) {
            commonTerms.add(safeCommonName.replace(/-/g, ' '));
        }

        const words = safeCommonName.split(/\s+/);

        words.forEach(word => {
            if (word.includes("'")) {
                commonTerms.add(word);
                const noApostrophe = word.replace(/'/g, '');
                if (noApostrophe.length >= 3) commonTerms.add(noApostrophe);

                const baseName = word.replace(/'s?$/i, '');
                if (baseName.length >= 3 && !isStopWord(baseName)) {
                    commonTerms.add(baseName);
                }
            }

            if (word.includes('-')) {
                commonTerms.add(word);
                commonTerms.add(word.replace(/-/g, ' '));

                const subParts = word.split('-');
                const significantSubParts = filterSignificantFragments(subParts, 3);
                significantSubParts.forEach(sub => commonTerms.add(sub));
            }

            if (!word.includes("'") && !word.includes('-')) {
                const clean = word.toLowerCase().replace(/[^\w]/g, '');
                if (clean.length >= 3 && !isStopWord(clean)) {
                    commonTerms.add(word);
                }
            }
        });
    }

    const termsToRedact = new Set([...scientificTerms, ...commonTerms]);
    
    commonTerms.forEach(term => {
        termsToRedact.add(term + 's');
        termsToRedact.add(term + 'es');
        
        if (term.toLowerCase().endsWith('y')) {
            termsToRedact.add(term.slice(0, -1) + 'ies');
        }
    });

    const sortedTerms = Array.from(termsToRedact)
        .filter(term => term && term.trim().length > 0)
        .sort((a, b) => b.length - a.length)
        .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (sortedTerms.length === 0) return safeText;

    const regex = new RegExp(`(?<=\\P{L}|^)(?:${sortedTerms.join('|')})(?=\\P{L}|$)`, 'giu');
    return safeText.replace(regex, '[REDACTED]');
}

const formatPoints = (points) => Number((points / 10).toFixed(1));

function stopAudio() {
    const audioPlayer = document.getElementById('quiz-audio-player');
    if (audioPlayer && !audioPlayer.paused) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
    }
}

function syncInput(id, value) {
    const el = document.getElementById(id);
    if (el && el.value !== String(value)) el.value = value;
}

function syncCheckbox(id, checked) {
    const el = document.getElementById(id);
    const isChecked = !!checked;
    if (el && el.checked !== isChecked) el.checked = isChecked;
}

export function render(state) {
    const isNewView = currentView !== state.ui.activeView;
    
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === state.ui.activeView));
    
    if (isNewView) {
        currentView = state.ui.activeView;
        
        const headingId = currentView.replace('-view', '-heading');
        const headingEl = document.getElementById(headingId);
        
        if (headingEl) {
            headingEl.focus();
        }
    }

    if (state.ui.activeView !== 'quiz-view') {
        stopAudio();
    }

    // 2. Setup View
    if (state.ui.activeView === 'setup-view') {
        const isDaily = !!state.form.isDailyMode;

        const bannerEl = document.getElementById('daily-challenge-banner');
        if (bannerEl) {
            bannerEl.style.display = isDaily ? 'flex' : 'none';
            if (isDaily) {
                const bannerDateEl = document.getElementById('daily-banner-date');
                if (bannerDateEl) {
                    const dateParts = (state.form.dailySeedDate || '').split('-');
                    if (dateParts.length === 3) {
                        const formattedDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]))
                            .toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
                        bannerDateEl.textContent = formattedDate;
                    }
                }

                const badgeEl = document.getElementById('daily-completion-badge');
                if (badgeEl) {
                    const locKey = buildLocationSeedKey(state.form);
                    const dailyScores = getDailyScores();
                    const existingRecord = dailyScores.scores[locKey];

                    if (existingRecord) {
                        badgeEl.textContent = `⭐ Today's Score: ${existingRecord.formattedScore}`;
                        badgeEl.style.display = 'inline-block';
                    } else {
                        badgeEl.style.display = 'none';
                    }
                }
            }
        }

        // Toggle Launcher Button Text & Active Styling
        const btnDailyTrigger = document.getElementById('btn-trigger-daily');
        if (btnDailyTrigger) {
            if (isDaily) {
                btnDailyTrigger.textContent = "📅 Exit Daily Mode";
                btnDailyTrigger.classList.add('btn-daily-active');
            } else {
                btnDailyTrigger.textContent = "📅 Daily Mode";
                btnDailyTrigger.classList.remove('btn-daily-active');
            }
        }

        syncInput('input-place', state.form.placeName || '');
        syncInput('input-taxon', state.form.taxonName || '');
        syncInput('input-username', state.form.userLogin || '');
        syncInput('input-lifelist', state.form.lifeListMode || 'off');
        syncInput('input-lat', state.form.lat ?? '');
        syncInput('input-lng', state.form.lng ?? '');
        syncInput('input-radius', state.form.radius);

        const groupUsername = document.getElementById('group-username');
        if (groupUsername) {
            groupUsername.style.display = (state.form.lifeListMode && state.form.lifeListMode !== 'off') ? 'block' : 'none';
        }
        
        syncCheckbox('mode-search', state.form.locMode === 'search');
        syncCheckbox('mode-coords', state.form.locMode === 'coords');
        document.getElementById('section-search').classList.toggle('active', state.form.locMode === 'search');
        document.getElementById('section-coords').classList.toggle('active', state.form.locMode === 'coords');

        syncCheckbox('chk-photos', state.form.wantsPhotos);
        syncCheckbox('chk-sounds', state.form.wantsSounds);
        syncCheckbox('chk-badge', state.form.showIconicTaxonBadge);
        syncCheckbox('chk-unique', state.form.preventDuplicates);
        syncCheckbox('chk-rarity', state.form.isRarityMode);
        syncCheckbox('chk-mc', state.form.isMultipleChoice);

        const selectMonths = document.getElementById('input-months');
        if (selectMonths) {
            const monthCache = domCache.get(selectMonths);
            if (monthCache?.lastMonths !== state.form.months) {
                domCache.set(selectMonths, { lastMonths: state.form.months });
                Array.from(selectMonths.options).forEach(opt => {
                    const shouldBeSelected = state.form.months.includes(opt.value);
                    if (opt.selected !== shouldBeSelected) opt.selected = shouldBeSelected;
                });
            }
        }
        
        syncInput('input-difficulty', state.form.difficulty);
        syncInput('input-questions', state.form.questionLimit);
        syncInput('input-weighting', state.form.weightingMethod);
        syncInput('input-establishment', state.form.establishmentStatus);

        const lockedInputs = [
            { id: 'input-questions', lockedVal: 10 },
            { id: 'input-difficulty', lockedVal: '125' },
            { id: 'input-lifelist', lockedVal: 'off' },
            { id: 'input-weighting', lockedVal: 'linear' },
            { id: 'input-establishment', lockedVal: 'any' },
            { id: 'chk-unique', lockedVal: true },
            { id: 'chk-rarity', lockedVal: false },
            { id: 'chk-mc', lockedVal: false },
            { id: 'chk-badge', lockedVal: true }
        ];

        lockedInputs.forEach(({ id, lockedVal }) => {
            const inputEl = document.getElementById(id);
            if (!inputEl) return;

            if (isDaily) {
                inputEl.disabled = true;
                inputEl.classList.add('input-locked');
                inputEl.setAttribute('title', 'Locked in Daily Challenge Mode');

                if (inputEl.type === 'checkbox') {
                    inputEl.checked = lockedVal;
                } else {
                    inputEl.value = String(lockedVal);
                }
            } else {
                inputEl.disabled = false;
                inputEl.classList.remove('input-locked');
                inputEl.removeAttribute('title');
            }
        });

        if (selectMonths) {
            selectMonths.disabled = isDaily;
            if (isDaily) selectMonths.classList.add('input-locked');
            else selectMonths.classList.remove('input-locked');
        }
        
        document.querySelectorAll('.btn-quick-select').forEach(btn => {
            btn.disabled = isDaily;
            if (isDaily) {
                btn.classList.add('input-locked');
            } else {
                btn.classList.remove('input-locked');
            }
        });

        const btnStart = document.getElementById('btn-start');
        btnStart.disabled = state.ui.isLoadingQuizPool;
        btnStart.textContent = state.ui.isLoadingQuizPool ? "Analyzing Regional Ecology..." : (isDaily ? "Start Daily Challenge" : "Load Quiz Pool");

        const btnGps = document.getElementById('btn-gps');
        btnGps.disabled = state.ui.isLocatingGps;
        btnGps.textContent = state.ui.isLocatingGps ? "⏳ Locating..." : "📍 Use My Exact Location (GPS)";
        
        autocompleteConfigs.forEach(config => {
            const clearBtn = document.getElementById(config.clearBtnId);
            if (clearBtn) {
                clearBtn.style.display = state.form[config.nameKey] ? 'block' : 'none';
            }
            
            renderInputError(config.inputId, state.ui[config.errorKey]);
            renderAutocomplete(config, state.ui[config.resultsKey], state.ui[config.showListKey], state.ui[config.activeIdxKey]);
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

        let currentPhase = '';
        if (state.ui.answerError) {
            currentPhase = `Error: ${state.ui.answerError}`;
        } else if (hasError) {
            currentPhase = 'Error loading observation data. Please check your connection or retry.';
        } else if (!hasObservation) {
            currentPhase = `Question ${state.currentIndex + 1}. Fetching observation.`;
        } else if (!state.ui.isMediaLoaded) {
            currentPhase = 'Loading media.';
        } else if (isReadyForMedia && !isAnswered && !state.ui.isCheckingAnswer) {
            currentPhase = `Question ${state.currentIndex + 1} ready. Media loaded.`;
        } else if (state.ui.isCheckingAnswer) {
            currentPhase = 'Checking answer...';
        } else if (isAnswered) {
            currentPhase = q.isSkipped ? 'Question skipped.' : (q.isCorrect ? 'Correct!' : 'Incorrect.');
        }

        const quizViewEl = document.getElementById('quiz-view');
        const quizCache = domCache.get(quizViewEl) || {};
        
        if (quizCache.lastPhase !== currentPhase && currentPhase !== '') {
            announce(currentPhase, hasError || !!state.ui.answerError);
            domCache.set(quizViewEl, { ...quizCache, lastPhase: currentPhase });
        }

        document.getElementById('quiz-counter').textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
        document.getElementById('quiz-score').textContent = `Score: ${formatPoints(state.score)}`;

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
            
            const isMissing = state.ui.isMissingMedia || state.ui.quizError?.isMissingMedia;
            const isRateLimited = q?.observation?.isRateLimited || state.ui.quizError?.isRateLimited;
            
            const errCache = domCache.get(errDiv) || {};

            if (errCache.isMissing !== isMissing || errCache.isRateLimited !== isRateLimited || !errDiv.hasChildNodes()) {
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
                domCache.set(errDiv, { isMissing, isRateLimited });
            }
        } else {
            errDiv.style.display = 'none';
            if (errDiv.hasChildNodes()) {
                errDiv.replaceChildren();
            }
            domCache.set(errDiv, { isMissing: null, isRateLimited: null });
        }

        renderQuizMedia(state, isReadyForMedia);
        renderQuizMeta(state, isReadyForMedia);

        syncInput('input-answer', state.form.answerInput);
        syncInput('input-rank', state.form.rankInput);

        const inputDisabled = isAnswered || !isReadyForMedia || state.ui.isCheckingAnswer;
        const answerInput = document.getElementById('input-answer');
        const rankInput = document.getElementById('input-rank');
        
        if (answerInput) answerInput.disabled = inputDisabled;
        if (rankInput) rankInput.disabled = inputDisabled;
        
        const isMC = state.config.isMultipleChoice;
        const formEl = document.getElementById('answer-form');
        const mcContainer = document.getElementById('mc-options-container');
        const answerInputsRow = document.querySelector('.answer-inputs-row');
        const btnSubmit = document.getElementById('btn-submit');
        const answerLabel = formEl ? formEl.querySelector('label[for="input-answer"]') : null;

        if (isMC) {
            if (formEl) formEl.style.display = (!isAnswered && isReadyForMedia) ? 'block' : 'none';
            if (answerLabel) answerLabel.style.display = 'none';
            if (answerInputsRow) answerInputsRow.style.display = 'none';
            if (btnSubmit) btnSubmit.style.display = 'none';
            if (mcContainer) {
                mcContainer.style.display = isReadyForMedia ? 'grid' : 'none';
                renderMCOptions(state, mcContainer, q, isAnswered);
            }
        } else {
            if (formEl) formEl.style.display = 'block';
            if (answerLabel) answerLabel.style.display = 'block';
            if (answerInputsRow) answerInputsRow.style.display = 'flex';
            if (mcContainer) mcContainer.style.display = 'none';
            if (btnSubmit) {
                btnSubmit.style.display = (!isAnswered && isReadyForMedia) ? 'block' : 'none';
                btnSubmit.disabled = state.ui.isCheckingAnswer;
                if (state.ui.isCheckingAnswer) {
                    btnSubmit.textContent = "Checking...";
                } else if (state.ui.answerError) {
                    btnSubmit.textContent = "↻ Retry Submission";
                } else {
                    btnSubmit.textContent = "Check Answer";
                }
            }
        }

        let answerErrEl = document.getElementById('answer-error');
        if (!answerErrEl) {
            answerErrEl = document.createElement('div');
            answerErrEl.id = 'answer-error';
            answerErrEl.className = 'inline-error';
            answerErrEl.style.marginBottom = '10px';
            
            const buttonsRow = document.querySelector('.answer-buttons-row');
            if (buttonsRow && buttonsRow.parentNode) buttonsRow.parentNode.insertBefore(answerErrEl, buttonsRow);
        }
        
        if (state.ui.answerError) {
            answerErrEl.textContent = state.ui.answerError;
            answerErrEl.style.display = 'block';
        } else {
            answerErrEl.style.display = 'none';
        }

        const btnSkip = document.getElementById('btn-skip');
        if (btnSkip) {
            btnSkip.style.display = (!isAnswered && isReadyForMedia) ? 'block' : 'none';
            btnSkip.disabled = isMC
                ? state.ui.isCheckingAnswer
                : (state.ui.isCheckingAnswer || (state.form.answerInput || '').trim().length > 0);
        }
        
        document.getElementById('clear-answer').style.display = (!isAnswered && !state.ui.isCheckingAnswer && isReadyForMedia && (state.form.answerInput || '').length > 0) ? 'block' : 'none';

        const btnNext = document.getElementById('btn-next');
        btnNext.style.display = isAnswered ? 'block' : 'none';
        if (isAnswered) {
            const isLastQuestion = state.currentIndex === state.questions.length - 1;
            btnNext.textContent = isLastQuestion ? 'View Results ➔' : 'Next Observation ➔';
        }

        document.getElementById('btn-retry').style.display = hasError ? 'block' : 'none';
        document.getElementById('btn-skip-end').style.display = hasError ? 'block' : 'none';

        const feedback = document.getElementById('feedback');
        const feedbackCache = domCache.get(feedback);

        if (isAnswered) {
            feedback.style.display = 'block';
            feedback.className = q.isCorrect ? 'correct' : 'incorrect';
            
            if (feedbackCache?.lastQuestionIndex !== state.currentIndex) {
                buildFeedbackDom(q, feedback);
                domCache.set(feedback, { ...feedbackCache, lastQuestionIndex: state.currentIndex });
            }
        } else {
            feedback.style.display = 'none';
            if (feedback.hasChildNodes()) {
                feedback.replaceChildren();
            }
            domCache.set(feedback, { ...feedbackCache, lastQuestionIndex: -1 });
        }
    }

    // 4. Results View
    if (state.ui.activeView === 'results-view') {
        const totalQuestions = state.questions.length;
        document.getElementById('final-score').textContent = totalQuestions > 0
            ? `${formatPoints(state.score)} / ${totalQuestions}`
            : 'Session Aborted';

        // Render the Live Score Card Preview block
        const scoreCardEl = document.getElementById('score-card-text');
        if (scoreCardEl && totalQuestions > 0) {
            scoreCardEl.textContent = generateResultShareText(state);
        }

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
    const zoomLoading = document.getElementById('zoom-loading');

    if (state.ui.zoomMediaUrl) {
        if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
        if (zoomImg.dataset.src !== state.ui.zoomMediaUrl) {
            if (zoomLoading) {
                zoomLoading.textContent = 'Loading high-resolution image...';
                zoomLoading.style.animation = '';
                zoomLoading.style.display = 'block';
            }
            zoomImg.style.display = 'none';
            
            zoomImg.src = state.ui.zoomMediaUrl;
            zoomImg.dataset.src = state.ui.zoomMediaUrl;
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

    // 6. License Modal
    const licenseModal = document.getElementById('license-modal');
    const licenseTextEl = document.getElementById('license-text');
    const licenseLoadingEl = document.getElementById('license-loading');
    const licenseErrorEl = document.getElementById('license-error');

    if (licenseModal) {
        if (state.ui.isLicenseModalOpen) {
            if (!licenseModal.open && typeof licenseModal.showModal === 'function') {
                licenseModal.showModal();
            }

            if (state.ui.isLoadingLicense) {
                if (licenseLoadingEl) licenseLoadingEl.style.display = 'block';
                if (licenseErrorEl) licenseErrorEl.style.display = 'none';
                if (licenseTextEl) licenseTextEl.style.display = 'none';
            } else if (state.ui.licenseError) {
                if (licenseLoadingEl) licenseLoadingEl.style.display = 'none';
                if (licenseErrorEl) {
                    licenseErrorEl.textContent = state.ui.licenseError;
                    licenseErrorEl.style.display = 'block';
                }
                if (licenseTextEl) licenseTextEl.style.display = 'none';
            } else if (state.ui.licenseText) {
                if (licenseLoadingEl) licenseLoadingEl.style.display = 'none';
                if (licenseErrorEl) licenseErrorEl.style.display = 'none';
                if (licenseTextEl) {
                    licenseTextEl.textContent = state.ui.licenseText;
                    licenseTextEl.style.display = 'block';
                }
            }
        } else {
            if (licenseModal.open && typeof licenseModal.close === 'function') {
                licenseModal.close();
            }
        }
    }
}

function renderAutocomplete(config, results, show, activeIdx) {
    const { listId, inputId, type, formatDisplay } = config;
    const list = document.getElementById(listId);
    const input = document.getElementById(inputId);
    
    if (!list || !input) return;
    
    // Retrieve cached UI state for this list element
    const cache = domCache.get(list) || {};
    
    // Hide and clear if needed
    if (!show || results.length === 0) {
        if (list.childNodes.length > 0) list.replaceChildren();
        list.classList.remove('show');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        
        // Reset cache reference if it was previously set
        if (cache.lastResults !== null) {
            domCache.set(list, { ...cache, lastResults: null });
        }
        return;
    }

    // 1. Content Rendering: Only rebuild DOM if the underlying data reference changed
    if (cache.lastResults !== results) {
        const fragment = document.createDocumentFragment();
        
        results.forEach((item, i) => {
            const li = document.createElement('li');
            li.id = `opt-${type}-${i}`;
            li.setAttribute('role', 'option');
            li.textContent = formatDisplay(item);
            fragment.appendChild(li);
        });
        
        list.replaceChildren(fragment);
        
        // Persist the array reference inside domCache
        domCache.set(list, { ...cache, lastResults: results });
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
    if (!el) return;

    const cache = domCache.get(el);
    if (cache?.lastMsg === msg) return;
    
    domCache.set(el, { lastMsg: msg });

    if (msg) {
        el.textContent = `⚠️ ${msg}`;
        el.style.display = 'block';
    } else {
        el.textContent = '';
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
        const cache = domCache.get(errEl);
        if (cache?.lastMsg === msg) return;
        
        domCache.set(errEl, { lastMsg: msg });

        if (msg) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
            input.classList.add('input-error');
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', `${id}-error`);
        } else {
            errEl.style.display = 'none';
            input.classList.remove('input-error');
            input.setAttribute('aria-invalid', 'false');
            input.removeAttribute('aria-describedby');
        }
    }
}

function renderQuizMedia(state, isReadyForMedia) {
    const mediaContainer = document.querySelector('.quiz-media-container');
    const mediaArray = selectCurrentMedia(state);
    const media = mediaArray[state.currentMediaIndex];
    
    if (mediaContainer) {
        const mediaCache = domCache.get(mediaContainer);
        // Store scalar primitive key instead of retaining the entire `media` object
        const mediaKey = media ? (media.mediumUrl || media.fileUrl) : null;
        
        const cacheKeyChanged =
            !mediaCache ||
            mediaCache.mediaKey !== mediaKey ||
            mediaCache.isReady !== isReadyForMedia ||
            mediaCache.isLoaded !== state.ui.isMediaLoaded ||
            mediaCache.mediaIndex !== state.currentMediaIndex ||
            mediaCache.mediaCount !== mediaArray.length;

        if (!cacheKeyChanged) return;

        domCache.set(mediaContainer, {
            mediaKey,
            isReady: isReadyForMedia,
            isLoaded: state.ui.isMediaLoaded,
            mediaIndex: state.currentMediaIndex,
            mediaCount: mediaArray.length
        });
    }

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
                audioPlayer.load();
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
        attrEl.replaceChildren();

        const licInfo = getLicenseInfo(media.license);
        const fullAttributionText = `${media.type === 'photo' ? 'Photo: ' : 'Sound: '} ${media.attribution || 'iNaturalist Contributor'}`;

        if (licInfo.url) {
            const licLink = document.createElement('a');
            licLink.href = licInfo.url;
            licLink.target = '_blank';
            licLink.rel = 'noopener';
            licLink.className = 'license-link';
            licLink.textContent = fullAttributionText;
            attrEl.appendChild(licLink);
        } else {
            attrEl.textContent = fullAttributionText;
        }
            
        if (mediaArray.length > 1) {
            controls.style.display = 'flex';
            document.getElementById('media-counter').textContent = `${state.currentMediaIndex + 1} / ${mediaArray.length}`;
            
            const prevBtn = document.getElementById('btn-prev-media');
            const nextBtn = document.getElementById('btn-next-media');
            const isNextDisabled = state.currentMediaIndex === mediaArray.length - 1;
            const isPrevDisabled = state.currentMediaIndex === 0;

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
            audioPlayer.load();
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

    const metaEl = document.getElementById('quiz-meta');
    if (metaEl) {
        const metaCache = domCache.get(metaEl);
        
        // Scalar string signature instead of keeping direct reference to `meta` object
        const metaSignature = meta 
            ? `${meta.date}_${meta.locationText}_${meta.coordinates}_${meta.observer}_${meta.license}_${meta.isObscured}` 
            : null;

        if (metaCache?.metaSignature !== metaSignature || metaCache?.isReady !== isReadyForMedia) {
            domCache.set(metaEl, { metaSignature, isReady: isReadyForMedia });

            metaEl.style.display = (isReadyForMedia && meta) ? 'flex' : 'none';
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
                
                const observerEl = document.getElementById('meta-observer');
                const licInfo = getLicenseInfo(meta.license);
                
                observerEl.replaceChildren();
                
                const observerText = document.createTextNode(`👤 ${meta.observer} `);
                observerEl.appendChild(observerText);
                
                if (licInfo.url) {
                    const licLink = document.createElement('a');
                    licLink.href = licInfo.url;
                    licLink.target = '_blank';
                    licLink.rel = 'noopener';
                    licLink.textContent = `(${licInfo.label})`;
                    observerEl.appendChild(licLink);
                } else {
                    observerEl.appendChild(document.createTextNode(`(${licInfo.label})`));
                }
            }
        }
    }

    const badge = document.getElementById('quiz-target-badge');
    if (badge) {
        const badgeCache = domCache.get(badge);
        const shouldShowBadge = state.config.showIconicTaxonBadge && taxon && taxon.iconic_taxon_name;
        const badgeText = shouldShowBadge ? `🎯 Target: ${taxon.iconic_taxon_name}` : '';

        if (badgeCache?.text !== badgeText) {
            domCache.set(badge, { text: badgeText });
            if (shouldShowBadge) {
                badge.textContent = badgeText;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    const hintContent = document.getElementById('quiz-hint-content');
    const hintBtn = document.getElementById('btn-toggle-hint');
    const rawDesc = q?.observation?.description?.trim();

    if (hintContent && hintBtn) {
        const cache = domCache.get(hintContent) || {};
        const obsId = q?.observation?.id || q?.observation?.uuid || null;
        const taxonId = taxon?.id || null;

        if (
            cache.lastObsId === obsId &&
            cache.lastTaxonId === taxonId &&
            cache.lastIsReady === isReadyForMedia &&
            cache.lastHintVisible === state.ui.isHintVisible &&
            cache.lastIndex === state.currentIndex
        ) {
            return;
        }

        if (isReadyForMedia && rawDesc) {
            let descToDisplay = '';

            if (cache.lastRawDesc === rawDesc && cache.lastTaxonId === taxonId) {
                descToDisplay = cache.lastRedactedDesc;
            } else {
                descToDisplay = redactSpoilers(rawDesc, taxon);
            }
            
            if (cache.lastHintVisible !== undefined && cache.lastHintVisible !== state.ui.isHintVisible) {
                announce(state.ui.isHintVisible ? `Hint revealed: ${descToDisplay}` : 'Hint hidden');
            }

            domCache.set(hintContent, {
                ...cache,
                lastObsId: obsId,
                lastTaxonId: taxonId,
                lastIsReady: isReadyForMedia,
                lastHintVisible: state.ui.isHintVisible,
                lastIndex: state.currentIndex,
                lastRawDesc: rawDesc,
                lastRedactedDesc: descToDisplay
            });

            hintBtn.style.display = 'inline-block';
            hintBtn.textContent = state.ui.isHintVisible ? '🙈 Hide Field Notes' : '💡 Show Field Notes (Hint)';
            hintBtn.setAttribute('aria-expanded', String(state.ui.isHintVisible));
            
            hintContent.style.display = state.ui.isHintVisible ? 'block' : 'none';
            if (hintContent.textContent !== descToDisplay) hintContent.textContent = descToDisplay;
        } else {
            domCache.set(hintContent, {
                ...cache,
                lastObsId: obsId,
                lastTaxonId: taxonId,
                lastIsReady: isReadyForMedia,
                lastHintVisible: state.ui.isHintVisible,
                lastIndex: state.currentIndex
            });

            hintBtn.style.display = 'none';
            hintContent.style.display = 'none';
        }
    }
}

function renderMCOptions(state, container, question, isAnswered) {
    const options = question?.mcOptions || [];
    const cache = domCache.get(container);
    
    // Primitive scalar key signature
    const questionKey = question ? `${state.currentIndex}_${question.observation?.id || ''}` : null;

    if (cache?.lastQuestionKey === questionKey && cache?.isAnswered === isAnswered && cache?.optionsCount === options.length) {
        return;
    }

    domCache.set(container, { lastQuestionKey: questionKey, isAnswered, optionsCount: options.length });
    container.replaceChildren();

    if (options.length === 0) {
        for (let i = 1; i <= 4; i++) {
            const skeletonBtn = document.createElement('button');
            skeletonBtn.type = 'button';
            skeletonBtn.className = 'btn-mc-option';
            skeletonBtn.disabled = true;
            skeletonBtn.style.opacity = '0.5';
            skeletonBtn.textContent = `⏳ Loading option ${i}...`;
            container.appendChild(skeletonBtn);
        }
        return;
    }

    options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-mc-option';
        btn.dataset.taxonId = opt.id;
        btn.dataset.isCorrect = opt.isCorrect;
        btn.dataset.displayName = opt.displayName;
        btn.textContent = `${idx + 1}. ${opt.displayName}`;

        if (isAnswered) {
            btn.disabled = true;
            if (opt.isCorrect) {
                btn.classList.add('opt-correct');
            } else if (question.userAnswerId === opt.id) {
                btn.classList.add('opt-incorrect');
            }
        }

        container.appendChild(btn);
    });
}

function buildFeedbackDom(q, feedbackEl) {
    feedbackEl.replaceChildren();
    const taxon = q.observation?.taxon || q.taxon || { name: 'Unknown Species', id: '' };
    const primaryDisplayName = taxon.preferred_common_name
        ? `${taxon.preferred_common_name} (${taxon.name})`
        : taxon.name;

    if (q.isCorrect) {
        const pointsLabel = `(+${formatPoints(q.pointsEarned)} pts)`;
        const titleText = q.guessedRank === 'species' 
            ? `✅ Correct! ${pointsLabel} ` 
            : `✅ Partial Credit! You correctly identified the ${q.guessedRank}. ${pointsLabel} `;
        
        feedbackEl.appendChild(document.createTextNode(titleText));
        feedbackEl.appendChild(document.createElement('br'));

        const strong = document.createElement('strong');

        const normMatched = (q.matchedNameDisplay || '').trim().toLowerCase();
        const normCommon = (taxon.preferred_common_name || '').trim().toLowerCase();
        const normSci = (taxon.name || '').trim().toLowerCase();
        const normPrimary = primaryDisplayName.trim().toLowerCase();

        const isAliasMatch = normMatched &&
            normMatched !== normCommon &&
            normMatched !== normSci &&
            normMatched !== normPrimary;

        if (isAliasMatch) {
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
    container.replaceChildren();

    if (questions.length === 0) {
        const abortedDiv = document.createElement('div');
        abortedDiv.className = 'perfect-score-banner';
        abortedDiv.style.background = '#fff3cd';
        abortedDiv.style.color = '#856404';
        abortedDiv.style.border = '1px solid #ffeeba';
        abortedDiv.textContent = '⚠️ Quiz session ended before any questions were completed.';
        container.appendChild(abortedDiv);
        return;
    }

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
    gridDiv.scrollTop = 0;
}

export function getLicenseInfo(licenseCode) {
    if (!licenseCode) return { label: 'All Rights Reserved', url: null };

    const code = licenseCode.toLowerCase().trim();

    if (code === 'cc0') {
        return {
            label: 'CC0 1.0 (Public Domain)',
            url: 'https://creativecommons.org/publicdomain/zero/1.0/'
        };
    }

    const licensePath = code.startsWith('cc-') ? code.slice(3) : code;

    return {
        label: `${code.toUpperCase()} 4.0`,
        url: `https://creativecommons.org/licenses/${licensePath}/4.0/`
    };
}
