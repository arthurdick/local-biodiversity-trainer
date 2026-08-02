export function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const urlConfig = {};

    const rawMode = params.get('mode');
    if (['daily', 'custom'].includes(rawMode)) {
        urlConfig.quizMode = rawMode;
    }

    if (params.has('place')) {
        const placeId = parseInt(params.get('place'), 10);
        if (!isNaN(placeId) && placeId > 0) {
            urlConfig.locMode = 'search';
            urlConfig.placeId = placeId;
            urlConfig.placeName = '';
        }
    } else if (params.has('lat') && params.has('lng')) {
        const lat = parseFloat(params.get('lat'));
        const lng = parseFloat(params.get('lng'));
        const rad = parseFloat(params.get('rad') || '10');

        if (!isNaN(lat) && lat >= -90 && lat <= 90 && !isNaN(lng) && lng >= -180 && lng <= 180) {
            urlConfig.locMode = 'coords';
            urlConfig.lat = Number(lat.toFixed(3));
            urlConfig.lng = Number(lng.toFixed(3));
            urlConfig.radius = (!isNaN(rad) && rad >= 1 && rad <= 100) ? rad : 10;
        }
    }

    if (params.has('taxon')) {
        const taxonId = parseInt(params.get('taxon'), 10);
        if (!isNaN(taxonId) && taxonId > 0) {
            urlConfig.taxonId = taxonId;
            urlConfig.taxonName = '';
        }
    }

    if (params.has('photos')) {
        urlConfig.wantsPhotos = params.get('photos') !== '0';
    }
    if (params.has('sounds')) {
        urlConfig.wantsSounds = params.get('sounds') === '1';
    }

    if (params.has('q')) {
        const qCount = parseInt(params.get('q'), 10);
        if ([5, 10, 20, 50].includes(qCount)) {
            urlConfig.questionLimit = qCount;
        }
    }

    if (params.has('mc')) {
        urlConfig.isMultipleChoice = params.get('mc') === '1';
    }

    if (params.has('diff')) {
        const diff = params.get('diff');
        if (['15', '50', '125', '500', 'all'].includes(diff)) {
            urlConfig.difficulty = diff;
        }
    }

    if (params.has('date')) {
        const rawDate = params.get('date');
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            urlConfig.dailySeedDate = rawDate;
        }
    }

    return urlConfig;
}

export function buildShareableUrl(formState, mode = 'custom') {
    const baseUrl = window.location.protocol + '//' + window.location.host + window.location.pathname;

    if (mode === 'custom') {
        return baseUrl;
    }

    const url = new URL(baseUrl);
    url.searchParams.set('mode', 'daily');

    if (formState.locMode === 'search' && formState.placeId) {
        url.searchParams.set('place', String(formState.placeId));
    } else if (formState.locMode === 'coords' && formState.lat !== null && formState.lng !== null) {
        url.searchParams.set('lat', Number(formState.lat).toFixed(3));
        url.searchParams.set('lng', Number(formState.lng).toFixed(3));
        if (formState.radius && formState.radius !== 10) {
            url.searchParams.set('rad', String(formState.radius));
        }
    }

    if (formState.taxonId) {
        url.searchParams.set('taxon', String(formState.taxonId));
    }

    if (formState.wantsPhotos === false) {
        url.searchParams.set('photos', '0');
    }
    if (formState.wantsSounds === true) {
        url.searchParams.set('sounds', '1');
    }

    if (formState.dailySeedDate) {
        const todayUTC = new Date().toISOString().split('T')[0];
        if (formState.dailySeedDate !== todayUTC) {
            url.searchParams.set('date', formState.dailySeedDate);
        }
    }

    return url.toString();
}

export async function copyShareLinkToClipboard(formState, mode = 'custom') {
    const shareUrl = buildShareableUrl(formState, mode);
    return copyToClipboard(shareUrl);
}

export function generateResultShareText(state) {
    const { game, form, config } = state;
    const { questions, score } = game;
    const total = questions.length;
    const isDaily = !!config.isDailyMode || !!form.isDailyMode;
    const isReplay = !!config.isReplay;

    const dateStr = form.dailySeedDate || config.dailySeedDate || new Date().toISOString().split('T')[0];
    const header = isDaily 
        ? `Local Bio Daily 📅 (${dateStr})`
        : `Local Biodiversity Trainer 🌿`;

    let locationLine = '';
    if (form.locMode === 'search' && form.placeName) {
        locationLine = `📍 ${form.placeName}`;
    } else if (form.locMode === 'coords' && form.lat !== null && form.lng !== null) {
        locationLine = `📍 Coordinates (${Number(form.lat).toFixed(3)}, ${Number(form.lng).toFixed(3)})`;
    }

    const formattedScore = Number((score / 10).toFixed(1));
    let scoreLine = `Score: ${formattedScore} / ${total}`;
    if (isDaily && isReplay) {
        scoreLine += ` (Replay)`;
    }

    const emojis = questions.map(q => {
        if (q.isSkipped) return '⬜';
        if (q.isCorrect) {
            return q.pointsEarned === 10 ? '🟩' : '🟨';
        }
        return '🟥';
    });

    const chunkSize = 10;
    const emojiRows = [];
    for (let i = 0; i < emojis.length; i += chunkSize) {
        emojiRows.push(emojis.slice(i, i + chunkSize).join(''));
    }
    const emojiBlock = emojiRows.join('\n');

    const mode = isDaily ? 'daily' : 'custom';
    const shareUrl = buildShareableUrl(config, mode);

    return [
        header,
        locationLine,
        scoreLine,
        emojiBlock,
        shareUrl
    ].filter(Boolean).join('\n');
}

export async function copyResultToClipboard(state) {
    const resultText = generateResultShareText(state);
    return copyToClipboard(resultText);
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        }
    } catch (err) {
        console.warn('Clipboard write failed:', err);
        return false;
    }
}
