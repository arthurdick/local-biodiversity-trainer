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
        input.removeAttribute('aria-activedescendant'); // Clear active descendant
        list.querySelectorAll('li').forEach(li => li.classList.remove('active')); // Clear active visuals
    }
}

export function handleAutocompleteKeydown(e, listId) {
    const list = document.getElementById(listId);
    const inputId = listId.replace('list', 'input');
    const input = document.getElementById(inputId);
    
    if (!list.classList.contains('show')) return;
    
    const items = Array.from(list.querySelectorAll('li'));
    if (items.length === 0) return;

    let currentIndex = items.findIndex(item => item.classList.contains('active'));

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        let nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        updateActiveItem(items, nextIndex, input);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        let prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        updateActiveItem(items, prevIndex, input);
    } else if (e.key === 'Enter' && currentIndex !== -1) {
        e.preventDefault();
        items[currentIndex].click();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleList(listId, false);
    }
}

function updateActiveItem(items, activeIndex, input) {
    // Clear previous active states
    items.forEach(item => item.classList.remove('active'));
    
    // Set new active state and update ARIA
    const activeItem = items[activeIndex];
    activeItem.classList.add('active');
    input.setAttribute('aria-activedescendant', activeItem.id);
    activeItem.scrollIntoView({ block: 'nearest' });
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
        input.style.borderColor = 'var(--error)';
        input.style.borderWidth = '2px';
    }

    function clearError() {
        errorEl.style.display = 'none';
        input.style.borderColor = 'var(--border)';
        input.style.borderWidth = '1px';
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

export function updateMediaDisplay(currentMediaArray, currentMediaIndex) {
    if (currentMediaArray.length === 0) return;
    
    const media = currentMediaArray[currentMediaIndex];
    const imgElement = document.getElementById('quiz-image');
    const zoomBtn = document.getElementById('btn-zoom-image');
    const audioContainer = document.getElementById('quiz-audio-container');
    const audioPlayer = document.getElementById('quiz-audio-player');
    
    audioPlayer.pause();
    
    if (media.type === 'photo') {
        imgElement.src = media.mediumUrl;
        zoomBtn.onclick = () => window.open(media.originalUrl, '_blank');
        document.getElementById('quiz-attribution').textContent = `Photo: ${media.attribution}`;
        
        audioContainer.style.display = 'none';
        if (imgElement.complete) {
            zoomBtn.style.display = 'flex';
            imgElement.style.display = 'block';
        }
    } else if (media.type === 'sound') {
        zoomBtn.style.display = 'none';
        imgElement.style.display = 'none';
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
    document.getElementById('quiz-counter').textContent = `Question ${currentIndex + 1} of ${totalQuestions}`;
    document.getElementById('quiz-score').textContent = `Score: ${score}`;
    
    document.getElementById('btn-zoom-image').style.display = 'none';
    document.getElementById('quiz-image').style.display = 'none';
    document.getElementById('quiz-image').alt = "Observation photo";
    
    document.getElementById('quiz-audio-container').style.display = 'none';
    document.getElementById('media-controls').style.display = 'none';
    document.getElementById('quiz-meta').style.display = 'none';
    document.getElementById('quiz-attribution').style.display = 'none';
    document.getElementById('quiz-error').style.display = 'none';
    document.getElementById('quiz-loading').style.display = 'block';
    
    const audioPlayer = document.getElementById('quiz-audio-player');
    audioPlayer.pause();
    audioPlayer.src = "";
    document.getElementById('quiz-image').removeAttribute('src');
    
    const input = document.getElementById('input-answer');
    input.value = ""; 
    input.disabled = true;
    document.getElementById('btn-submit').style.display = 'none';
    document.getElementById('btn-next').style.display = 'none';
    document.getElementById('feedback').style.display = 'none';
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
        span.style.color = '#aaa';
        span.style.fontWeight = 'normal';
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
        span.style.color = '#aaa';
        span.style.fontWeight = 'normal';
        span.textContent = 'Please check your internet connection or filters.';
        errorDiv.appendChild(span);
    }
    
    errorDiv.style.display = 'block';
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
    
    if (currentMeta.coordinates) {
        locLink.href = `https://www.google.com/maps/search/?api=1&query=${currentMeta.coordinates}`;
        locLink.style.pointerEvents = 'auto';
    } else if (currentMeta.locationText) {
        locLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentMeta.locationText)}`;
        locLink.style.pointerEvents = 'auto';
    } else {
        locLink.href = "#";
        locLink.style.pointerEvents = 'none';
    }
    
    document.getElementById('quiz-meta').style.display = 'inline-block';
}

export function renderFeedback(isCorrect, taxon, matchedNameDisplay, matchedNorm, primaryCommonNorm, sciNorm, score) {
    const feedback = document.getElementById('feedback');
    const primaryDisplayName = taxon.preferred_common_name ? `${taxon.preferred_common_name} (${taxon.name})` : taxon.name;
    
    const imgElement = document.getElementById('quiz-image');
    if (imgElement && imgElement.src) {
        imgElement.alt = `Observation of ${primaryDisplayName}`;
    }

    feedback.innerHTML = '';
    const linksDiv = document.createElement('div');
    linksDiv.className = 'feedback-links';
    linksDiv.textContent = '📖 Learn more: ';

    const inatLink = document.createElement('a');
    inatLink.href = `https://www.inaturalist.org/taxa/${encodeURIComponent(taxon.id)}`;
    inatLink.target = '_blank';
    inatLink.rel = 'noopener';
    inatLink.textContent = 'iNaturalist ↗';
    linksDiv.appendChild(inatLink);

    const sep = document.createElement('span');
    sep.style.margin = '0 4px';
    sep.style.opacity = '0.5';
    sep.textContent = '•';
    linksDiv.appendChild(sep);

    const wikiLink = document.createElement('a');
    wikiLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(taxon.name)}`;
    wikiLink.target = '_blank';
    wikiLink.rel = 'noopener';
    wikiLink.textContent = 'Wikipedia ↗';
    linksDiv.appendChild(wikiLink);

    if (isCorrect) {
        feedback.className = 'correct';
        feedback.textContent = '✅ Correct! ';
        
        const strong = document.createElement('strong');
        if (matchedNorm && matchedNorm !== primaryCommonNorm && matchedNorm !== sciNorm) {
            const displayAlias = matchedNameDisplay.replace(/\b\w/g, c => c.toUpperCase());
            strong.textContent = displayAlias;
            feedback.appendChild(strong);
            feedback.appendChild(document.createElement('br'));
            
            const span = document.createElement('span');
            span.style.fontSize = '0.9em';
            span.style.fontWeight = 'normal';
            span.textContent = `(Recorded broadly as: ${primaryDisplayName})`;
            feedback.appendChild(span);
        } else {
            strong.textContent = primaryDisplayName;
            feedback.appendChild(strong);
        }
    } else {
        feedback.className = 'incorrect';
        feedback.textContent = '❌ Not quite.';
        feedback.appendChild(document.createElement('br'));
        feedback.appendChild(document.createTextNode('Answer: '));
        
        const strong = document.createElement('strong');
        strong.textContent = primaryDisplayName;
        feedback.appendChild(strong);
    }
    
    feedback.appendChild(linksDiv);
    document.getElementById('quiz-score').textContent = `Score: ${score}`;
    feedback.style.display = 'block';
    
    const btnSubmit = document.getElementById('btn-submit');
    btnSubmit.style.display = 'none';
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Check Answer";
    
    const btnNext = document.getElementById('btn-next');
    btnNext.textContent = "Next Observation ➔";
    btnNext.style.display = 'block';
    btnNext.focus();
}

export function renderResultsView(questions, score) {
    document.getElementById('final-score').textContent = `${score} / ${questions.length}`;
    const reviewContainer = document.getElementById('review-container');
    reviewContainer.innerHTML = '';
    
    const missedQuestions = questions.filter(q => !q.isCorrect);

    if (missedQuestions.length === 0) {
        const perfectDiv = document.createElement('div');
        perfectDiv.style.textAlign = 'center';
        perfectDiv.style.padding = '20px';
        perfectDiv.style.background = '#e8f5e9';
        perfectDiv.style.color = 'var(--success)';
        perfectDiv.style.borderRadius = 'var(--radius)';
        perfectDiv.style.marginBottom = '20px';
        perfectDiv.style.fontWeight = 'bold';
        perfectDiv.textContent = '🎉 Perfect score! You identified every species correctly!';
        reviewContainer.appendChild(perfectDiv);
    } else {
        const titleDiv = document.createElement('div');
        titleDiv.className = 'missed-title';
        titleDiv.textContent = `Review Missed Species (${missedQuestions.length})`;
        reviewContainer.appendChild(titleDiv);
        
        const gridDiv = document.createElement('div');
        gridDiv.className = 'missed-grid';

        missedQuestions.forEach(q => {
            const taxon = q.taxon;
            const primaryCommon = taxon.preferred_common_name || '';
            const sciName = taxon.name;
            const imgUrl = q.thumbnailUrl || '';
            const userGuess = q.userAnswer || '(Skipped)';
            const isAudioObservation = q.observation && q.observation.sounds && q.observation.sounds.length > 0;

            const card = document.createElement('div');
            card.className = 'missed-card';

            if (imgUrl) {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.alt = primaryCommon || sciName;
                card.appendChild(img);
            } else {
                const mediaPlaceholder = document.createElement('div');
                mediaPlaceholder.style.height = '130px';
                mediaPlaceholder.style.background = '#333';
                mediaPlaceholder.style.display = 'flex';
                mediaPlaceholder.style.alignItems = 'center';
                mediaPlaceholder.style.justifyContent = 'center';
                mediaPlaceholder.style.color = '#888';
                mediaPlaceholder.textContent = isAudioObservation ? '🔊 Audio Observation' : '⚠️ Skipped / No Image';
                card.appendChild(mediaPlaceholder);
            }
            
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
            guessDiv.textContent = 'Your answer: ';
            const guessStrong = document.createElement('strong');
            guessStrong.textContent = userGuess;
            guessDiv.appendChild(guessStrong);
            infoDiv.appendChild(guessDiv);
            cardBody.appendChild(infoDiv);
            
            const linksDiv = document.createElement('div');
            linksDiv.className = 'missed-card-links';
            
            const inatLink = document.createElement('a');
            inatLink.href = `https://www.inaturalist.org/taxa/${encodeURIComponent(taxon.id)}`;
            inatLink.target = '_blank';
            inatLink.rel = 'noopener';
            inatLink.textContent = 'iNaturalist ↗';
            linksDiv.appendChild(inatLink);
            
            const wikiLink = document.createElement('a');
            wikiLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(sciName)}`;
            wikiLink.target = '_blank';
            wikiLink.rel = 'noopener';
            wikiLink.textContent = 'Wikipedia ↗';
            linksDiv.appendChild(wikiLink);
            
            cardBody.appendChild(linksDiv);
            card.appendChild(cardBody);
            gridDiv.appendChild(card);
        });
        reviewContainer.appendChild(gridDiv);
    }
    showView('results-view');
}
