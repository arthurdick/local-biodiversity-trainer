/**
 * Helper to cleanly format points and scores.
 * Prevents floating-point inaccuracies while keeping integer scores clean.
 */
const formatPoints = (points) => Number((points / 10).toFixed(1));

export function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const view = document.getElementById(viewId);
    view.classList.add('active');
    
    const focusTarget = view.querySelector('[tabindex="-1"]');
    if (focusTarget) focusTarget.focus();
}

export function toggleList(listId, show) {
    const list = document.getElementById(listId);
    const inputId = listId.replace('list', 'input');
    const input = document.getElementById(inputId);
    
    if (show) {
        list.classList.add('show');
        input.setAttribute('aria-expanded', 'true');
    } else {
        list.classList.remove('show');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        list.querySelectorAll('li').forEach(li => {
            li.classList.remove('active');
            li.setAttribute('aria-selected', 'false');
        });
        list.dataset.activeIndex = '-1';
    }
}

export function handleAutocompleteKeydown(e, listId) {
    if (e.key === 'Enter') {
        e.preventDefault();
    }

    const list = document.getElementById(listId);
    const inputId = listId.replace('list', 'input');
    const input = document.getElementById(inputId);
    
    if (!list.classList.contains('show')) return;
    
    const items = Array.from(list.querySelectorAll('li'));
    if (items.length === 0) return;

    let currentIndex = parseInt(list.dataset.activeIndex ?? '-1', 10);
    if (currentIndex === -1) {
        currentIndex = items.findIndex(item => item.classList.contains('active'));
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        let nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        updateActiveItem(items, nextIndex, input, list);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        let prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        updateActiveItem(items, prevIndex, input, list);
    } else if (e.key === 'Enter' && currentIndex !== -1) {
        items[currentIndex].click();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleList(listId, false);
    }
}

function updateActiveItem(items, activeIndex, input, list) {
    items.forEach(item => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
    });
    
    const activeItem = items[activeIndex];
    activeItem.classList.add('active');
    activeItem.setAttribute('aria-selected', 'true');
    
    input.setAttribute('aria-activedescendant', activeItem.id);
    activeItem.scrollIntoView({ block: 'nearest' });
    list.dataset.activeIndex = activeIndex;
}

export function toggleClearButton(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    btn.style.display = input.value.length > 0 ? 'block' : 'none';
}

export function showGeneralError(msg) {
    const errEl = document.getElementById('form-error-message');
    errEl.textContent = `⚠️ ${msg}`;
    errEl.style.display = 'block';
}

export function clearGeneralError() {
    document.getElementById('form-error-message').style.display = 'none';
}

export function setupInlineValidation(inputId, entityName, validationCheckFn, hasGpsCheckFn) {
    const input = document.getElementById(inputId);
    const wrapper = input.closest('.form-group');
    
    const errorEl = document.createElement('div');
    errorEl.className = 'inline-error';
    wrapper.appendChild(errorEl);

    function showError(message) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        input.classList.add('input-error');
    }

    function clearError() {
        errorEl.style.display = 'none';
        input.classList.remove('input-error');
    }

    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (input.value.trim() !== '' && !validationCheckFn() && !hasGpsCheckFn()) {
                showError(`⚠️ Please select a ${entityName} from the dropdown list.`);
            }
        }, 200);
    });

    input.addEventListener('input', clearError);

    input.addEventListener('focus', () => {
        if (input.value.trim() !== '' && !validationCheckFn() && !hasGpsCheckFn()) {
            const listId = inputId.replace('input', 'list');
            const list = document.getElementById(listId);
            if (list && list.children.length > 0) toggleList(listId, true);
            else input.dispatchEvent(new Event('input'));
        }
    });
    
    return { clearError, showError };
}

export function renderTargetBadge(taxon) {
    const badge = document.getElementById('quiz-target-badge');
    if (taxon && taxon.iconic_taxon_name) {
        badge.textContent = `🎯 Target: ${taxon.iconic_taxon_name}`;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

export function updateMediaDisplay(currentMediaArray, currentMediaIndex) {
    if (currentMediaArray.length === 0) return;
    
    const media = currentMediaArray[currentMediaIndex];
    const imgElement = document.getElementById('quiz-image');
    const zoomBtn = document.getElementById('btn-zoom-image');
    const audioContainer = document.getElementById('quiz-audio-container');
    const audioPlayer = document.getElementById('quiz-audio-player');
    
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
    
    if (media.type === 'photo') {
        zoomBtn.style.display = 'flex';
        imgElement.style.display = 'none';
        imgElement.removeAttribute('src');
        
        imgElement.src = media.mediumUrl;
        zoomBtn.onclick = () => {
            const modal = document.getElementById('zoom-modal');
            const zoomImg = document.getElementById('zoom-modal-img');
            zoomImg.style.display = 'none';
            zoomImg.removeAttribute('src');
            zoomImg.src = media.originalUrl;
            if (zoomImg.complete && zoomImg.naturalWidth !== 0) {
                zoomImg.style.display = 'inline-block';
            }
            modal.showModal();
        };
        document.getElementById('quiz-attribution').textContent = `Photo: ${media.attribution}`;
        
        audioContainer.style.display = 'none';
        const absoluteMediumUrl = new URL(media.mediumUrl, window.location.href).href;
        if (imgElement.complete && imgElement.naturalWidth !== 0 && imgElement.src === absoluteMediumUrl) {
            zoomBtn.style.display = 'flex';
            imgElement.style.display = 'block';
        }
    } else if (media.type === 'sound') {
        zoomBtn.style.display = 'none';
        imgElement.style.display = 'none';
        imgElement.removeAttribute('src');
        audioContainer.style.display = 'flex';
        audioPlayer.src = media.fileUrl;
        document.getElementById('quiz-attribution').textContent = `Sound: ${media.attribution || 'iNaturalist Contributor'}`;
    }
    
    document.getElementById('media-counter').textContent = `${currentMediaIndex + 1} / ${currentMediaArray.length}`;
    
    if (currentMediaArray.length > 1) {
        document.getElementById('media-controls').style.display = 'flex';
        document.getElementById('btn-prev-media').disabled = currentMediaIndex === 0;
        document.getElementById('btn-next-media').disabled = currentMediaIndex === currentMediaArray.length - 1;
    } else {
        document.getElementById('media-controls').style.display = 'none';
    }
}

export function resetQuizUI(currentIndex, totalQuestions, score) {
    document.getElementById('input-rank').value = 'species';
    document.getElementById('input-rank').disabled = true;
    
    document.getElementById('quiz-counter').textContent = `Question ${currentIndex + 1} of ${totalQuestions}`;
    document.getElementById('quiz-score').textContent = `Score: ${formatPoints(score)}`;
    
    document.getElementById('btn-zoom-image').style.display = 'none';
    document.getElementById('quiz-image').style.display = 'none';
    document.getElementById('quiz-image').alt = "Observation photo";
    
    document.getElementById('quiz-audio-container').style.display = 'none';
    document.getElementById('media-controls').style.display = 'none';
    document.getElementById('quiz-meta').style.display = 'none';
    document.getElementById('quiz-attribution').style.display = 'none';
    document.getElementById('quiz-error').style.display = 'none';
    document.getElementById('quiz-loading').style.display = 'block';
    
    const badge = document.getElementById('quiz-target-badge');
    if (badge) badge.style.display = 'none';
    
    const audioPlayer = document.getElementById('quiz-audio-player');
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
    
    document.getElementById('quiz-image').removeAttribute('src');

    const zoomImg = document.getElementById('zoom-modal-img');
    if (zoomImg) {
        zoomImg.style.display = 'none';
        zoomImg.removeAttribute('src');
    }
    
    const hintBtn = document.getElementById('btn-toggle-hint');
    const hintContent = document.getElementById('quiz-hint-content');
    if (hintBtn && hintContent) {
        hintBtn.style.display = 'none';
        hintBtn.textContent = '💡 Show Field Notes (Hint)';
        hintBtn.setAttribute('aria-expanded', 'false');
        hintContent.style.display = 'none';
        hintContent.textContent = '';
    }
    
    const input = document.getElementById('input-answer');
    input.value = ""; 
    input.disabled = true;
    document.getElementById('btn-submit').style.display = 'none';
    document.getElementById('btn-skip').style.display = 'none';
    document.getElementById('btn-next').style.display = 'none';
    document.getElementById('feedback').style.display = 'none';
}

/**
 * Renders the optional field notes/description hint button if observations contain observer notes.
 */
export function renderFieldNotes(description) {
    const hintBtn = document.getElementById('btn-toggle-hint');
    const hintContent = document.getElementById('quiz-hint-content');
    
    if (!hintBtn || !hintContent) return;

    const trimmedDesc = description ? description.trim() : '';

    if (trimmedDesc.length > 0) {
        // Sanitize raw HTML tags while preserving line breaks
        hintContent.textContent = trimmedDesc;
        hintBtn.style.display = 'inline-block';
        hintBtn.textContent = '💡 Show Field Notes (Hint)';
        hintBtn.setAttribute('aria-expanded', 'false');
        hintContent.style.display = 'none';
    } else {
        hintBtn.style.display = 'none';
        hintContent.style.display = 'none';
    }
}

export function renderFetchError(taxonName, isMediaMissing) {
    document.getElementById('quiz-loading').style.display = 'none';
    const errorDiv = document.getElementById('quiz-error');
    errorDiv.innerHTML = '';
    
    if (isMediaMissing) {
        errorDiv.textContent = '❌ Observation missing media data.';
        errorDiv.appendChild(document.createElement('br'));
        errorDiv.appendChild(document.createElement('br'));
        const span = document.createElement('span');
        span.className = 'error-hint';
        span.textContent = 'This occasionally happens in the iNaturalist database.';
        errorDiv.appendChild(span);
    } else {
        errorDiv.textContent = '❌ Failed to load observation for ';
        const strong = document.createElement('strong');
        strong.textContent = taxonName;
        errorDiv.appendChild(strong);
        errorDiv.appendChild(document.createElement('br'));
        errorDiv.appendChild(document.createElement('br'));
        const span = document.createElement('span');
        span.className = 'error-hint';
        span.textContent = 'Please check your internet connection or filters.';
        errorDiv.appendChild(span);
    }
    
    errorDiv.style.display = 'block';
    document.getElementById('btn-submit').style.display = 'none';
    document.getElementById('btn-skip').style.display = 'none';
    const btnNext = document.getElementById('btn-next');
    btnNext.style.display = 'block';
    btnNext.textContent = "Skip to Next ➔";
    btnNext.focus();
}

export function renderQuestionMeta(currentMeta) {
    if (!currentMeta) return;
    const dateStr = currentMeta.date 
        ? new Date(currentMeta.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) 
        : 'Unknown Date';
    
    document.getElementById('meta-date').textContent = `📅 ${dateStr}`;
    
    const locLink = document.getElementById('meta-location');
    const locText = currentMeta.locationText || 'Unknown Location';
    locLink.textContent = `📍 ${locText}`;
    
    locLink.classList.remove('disabled-link', 'enabled-link');
    
    if (currentMeta.coordinates) {
        locLink.href = `https://www.google.com/maps/search/?api=1&query=${currentMeta.coordinates}`;
        locLink.classList.add('enabled-link');
    } else if (currentMeta.locationText) {
        locLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentMeta.locationText)}`;
        locLink.classList.add('enabled-link');
    } else {
        locLink.href = "#";
        locLink.classList.add('disabled-link');
    }
    
    const observerEl = document.getElementById('meta-observer');
    if (observerEl) {
        observerEl.textContent = `👤 ${currentMeta.observer} (${currentMeta.license})`;
    }
    
    document.getElementById('quiz-meta').style.display = 'flex';
}

export function renderFeedback(isCorrect, taxon, matchedNameDisplay, matchedNorm, primaryCommonNorm, sciNorm, score, pointsEarned, guessedRank, isSkipped = false, observationId = null) {
    const feedback = document.getElementById('feedback');
    const safeTaxon = taxon || { name: 'Unknown Species', id: '' };
    const primaryDisplayName = safeTaxon.preferred_common_name ? `${safeTaxon.preferred_common_name} (${safeTaxon.name})` : safeTaxon.name;
    
    const imgElement = document.getElementById('quiz-image');
    if (imgElement && imgElement.src) {
        imgElement.alt = `Observation of ${primaryDisplayName}`;
    }

    feedback.innerHTML = '';
    const linksDiv = document.createElement('div');
    linksDiv.className = 'feedback-links';
    linksDiv.textContent = '📖 Learn more: ';

    if (safeTaxon.id) {
        const inatLink = document.createElement('a');
        inatLink.href = `https://www.inaturalist.org/taxa/${encodeURIComponent(safeTaxon.id)}`;
        inatLink.target = '_blank';
        inatLink.rel = 'noopener';
        inatLink.textContent = 'iNaturalist ↗';
        linksDiv.appendChild(inatLink);

        if (observationId) {
            const sep = document.createElement('span');
            sep.className = 'feedback-separator';
            sep.textContent = '•';
            linksDiv.appendChild(sep);
        }
    }

    if (observationId) {
        const obsLink = document.createElement('a');
        obsLink.href = `https://www.inaturalist.org/observations/${encodeURIComponent(observationId)}`;
        obsLink.target = '_blank';
        obsLink.rel = 'noopener';
        obsLink.textContent = 'Observation ↗';
        linksDiv.appendChild(obsLink);
    }

    if (isCorrect) {
        feedback.className = 'correct';
        
        if (guessedRank === 'species') {
             feedback.textContent = `✅ Correct! (+${formatPoints(pointsEarned)} pts) `;
        } else {
             feedback.textContent = `✅ Partial Credit! You correctly identified the ${guessedRank}. (+${formatPoints(pointsEarned)} pts) `;
        }
        
        const strong = document.createElement('strong');
        if (matchedNorm && matchedNorm !== primaryCommonNorm && matchedNorm !== sciNorm) {
            const displayAlias = matchedNameDisplay.replace(/\b\w/g, c => c.toUpperCase());
            strong.textContent = displayAlias;
            feedback.appendChild(strong);
            feedback.appendChild(document.createElement('br'));
            
            const span = document.createElement('span');
            span.className = 'feedback-alias-note';
            span.textContent = `(Recorded broadly as: ${primaryDisplayName})`;
            feedback.appendChild(span);
        } else {
            strong.textContent = primaryDisplayName;
            feedback.appendChild(strong);
        }
    } else {
        feedback.className = 'incorrect';
        if (isSkipped) {
            feedback.textContent = '⏭️ Question skipped.';
        } else {
            feedback.textContent = '❌ Not quite.';
        }
        feedback.appendChild(document.createElement('br'));
        feedback.appendChild(document.createTextNode('Answer: '));
        
        const strong = document.createElement('strong');
        strong.textContent = primaryDisplayName;
        feedback.appendChild(strong);
    }
    
    feedback.appendChild(linksDiv);
    document.getElementById('quiz-score').textContent = `Score: ${formatPoints(score)}`;
    feedback.style.display = 'block';
    
    const btnSubmit = document.getElementById('btn-submit');
    btnSubmit.style.display = 'none';
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Check Answer";

    document.getElementById('btn-skip').style.display = 'none';
    
    const btnNext = document.getElementById('btn-next');
    btnNext.textContent = "Next Observation ➔";
    btnNext.style.display = 'block';
    btnNext.focus();
}

export function renderResultsView(questions, score) {
    const audioPlayer = document.getElementById('quiz-audio-player');
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.removeAttribute('src');
        audioPlayer.load();
    }

    document.getElementById('final-score').textContent = `${formatPoints(score)} / ${questions.length}`;
    const reviewContainer = document.getElementById('review-container');
    reviewContainer.innerHTML = '';
    
    const questionsToReview = questions.filter(q => q.pointsEarned !== 10);

    if (questionsToReview.length === 0) {
        const perfectDiv = document.createElement('div');
        perfectDiv.className = 'perfect-score-banner';
        perfectDiv.textContent = '🎉 Perfect score! You identified every species correctly!';
        reviewContainer.appendChild(perfectDiv);
    } else {
        const titleDiv = document.createElement('div');
        titleDiv.className = 'missed-title';
        titleDiv.textContent = `Review Missed & Partial Credit Species (${questionsToReview.length})`;
        reviewContainer.appendChild(titleDiv);
        
        const gridDiv = document.createElement('div');
        gridDiv.className = 'missed-grid';

        questionsToReview.forEach(q => {
            const taxon = q.taxon || { name: 'Data Unavailable', id: '' };
            const primaryCommon = taxon.preferred_common_name || 'Fetch Failed';
            const sciName = taxon.name;
            const imgUrl = q.thumbnailUrl || '';
            const userGuess = q.userAnswer || '(Skipped)';
            const isAudioObservation = q.observation && q.observation.sounds && q.observation.sounds.length > 0;

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
                const mediaPlaceholder = document.createElement('div');
                mediaPlaceholder.className = 'media-placeholder';
                mediaPlaceholder.textContent = isAudioObservation ? '🔊 Audio Observation' : '⚠️ Skipped / No Image';
                mediaWrapper.appendChild(mediaPlaceholder);
            }

            if (q.mediaAttribution) {
                const attrDiv = document.createElement('div');
                attrDiv.className = 'missed-card-attribution';
                attrDiv.textContent = q.mediaAttribution;
                attrDiv.title = q.mediaAttribution;
                mediaWrapper.appendChild(attrDiv);
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
            
            if (q.isCorrect && q.pointsEarned < 10) {
                guessDiv.classList.add('partial-credit');
                guessDiv.textContent = 'Partial Credit: ';
            } else {
                guessDiv.textContent = 'Your answer: ';
            }
            
            const guessStrong = document.createElement('strong');
            guessStrong.textContent = userGuess;
            guessDiv.appendChild(guessStrong);
            infoDiv.appendChild(guessDiv);

            cardBody.appendChild(infoDiv);
            
            const linksDiv = document.createElement('div');
            linksDiv.className = 'missed-card-links';
            
            if (taxon.id) {
                const inatLink = document.createElement('a');
                inatLink.href = `https://www.inaturalist.org/taxa/${encodeURIComponent(taxon.id)}`;
                inatLink.target = '_blank';
                inatLink.rel = 'noopener';
                inatLink.textContent = 'iNaturalist ↗';
                linksDiv.appendChild(inatLink);
            }
            
            if (q.observation && q.observation.id) {
                const obsLink = document.createElement('a');
                obsLink.href = `https://www.inaturalist.org/observations/${encodeURIComponent(q.observation.id)}`;
                obsLink.target = '_blank';
                obsLink.rel = 'noopener';
                obsLink.textContent = 'Observation ↗';
                linksDiv.appendChild(obsLink);
            }
            
            cardBody.appendChild(linksDiv);
            card.appendChild(cardBody);
            gridDiv.appendChild(card);
        });
        reviewContainer.appendChild(gridDiv);
    }
    showView('results-view');
}
