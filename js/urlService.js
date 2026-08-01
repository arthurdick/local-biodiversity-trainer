/**
 * js/urlService.js
 * Bi-directional URL parameter parsing, sanitization, share link generation, and score card formatting.
 */

/**
 * Parses and sanitizes URL query parameters from window.location.search.
 * @returns {Object} Clean configuration patch derived from URL parameters.
 */
export function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const urlConfig = {};

    // 1. Quiz Mode
    const rawMode = params.get('mode');
    if (['daily', 'custom'].includes(rawMode)) {
        urlConfig.quizMode = rawMode;
    }

    // 2. Location Mode & Coordinates vs. Place
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
            urlConfig.lat = lat;
            urlConfig.lng = lng;
            urlConfig.radius = (!isNaN(rad) && rad >= 1 && rad <= 100) ? rad : 10;
        }
    }

    // 3. Target Taxon Filter
    if (params.has('taxon')) {
        const taxonId = parseInt(params.get('taxon'), 10);
        if (!isNaN(taxonId) && taxonId > 0) {
            urlConfig.taxonId = taxonId;
            urlConfig.taxonName = '';
        }
    }

    // 4. Media Options
    if (params.has('photos')) {
        urlConfig.wantsPhotos = params.get('photos') !== '0';
    }
    if (params.has('sounds')) {
        urlConfig.wantsSounds = params.get('sounds') === '1';
    }

    // 5. Gameplay Rules
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

    // 6. Daily Date Override
    if (params.has('date')) {
        const rawDate = params.get('date');
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            urlConfig.dailySeedDate = rawDate;
        }
    }

    return urlConfig;
}

/**
 * Builds a clean, canonical share URL string based on active form state.
 * @param {Object} formState - The current state.form or state.config object.
 * @param {'daily'|'custom'} [mode='custom'] - The mode to encode into the link.
 * @returns {string} Full shareable URL.
 */
export function buildShareableUrl(formState, mode = 'custom') {
    const baseUrl = window.location.protocol + '//' + window.location.host + window.location.pathname;

    // Custom Mode shares link directly to the base application root
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

    // Encode Media Options in Daily Mode
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

/**
 * Copies a generated share link to the user's clipboard.
 * @param {Object} formState - Active form configuration.
 * @param {'daily'|'custom'} mode - Mode to encode.
 * @returns {Promise<boolean>} Resolves to true on success, false on failure.
 */
export async function copyShareLinkToClipboard(formState, mode = 'custom') {
    const shareUrl = buildShareableUrl(formState, mode);
    return copyToClipboard(shareUrl);
}

/**
 * Generates a Wordle-style formatted text block representing quiz performance.
 * @param {Object} state - Full application state tree.
 * @returns {string} Formatted shareable result text block.
 */
export function generateResultShareText(state) {
    const { questions, score, form, config } = state;
    const total = questions.length;
    const isDaily = !!config.isDailyMode || !!form.isDailyMode;
    const isReplay = !!config.isReplay;

    // 1. Title Header
    const dateStr = form.dailySeedDate || config.dailySeedDate || new Date().toISOString().split('T')[0];
    const header = isDaily 
        ? `Local Bio Daily 📅 (${dateStr})`
        : `Local Biodiversity Trainer 🌿`;

    // 2. Location Line
    let locationLine = '';
    if (form.locMode === 'search' && form.placeName) {
        locationLine = `📍 ${form.placeName}`;
    } else if (form.locMode === 'coords' && form.lat !== null && form.lng !== null) {
        locationLine = `📍 Coordinates (${Number(form.lat).toFixed(2)}, ${Number(form.lng).toFixed(2)})`;
    }

    // 3. Score Line
    const formattedScore = Number((score / 10).toFixed(1));
    let scoreLine = `Score: ${formattedScore} / ${total}`;
    if (isDaily && isReplay) {
        scoreLine += ` (Replay)`;
    }

    // 4. Emoji Row Generation (Chunked in rows of 10)
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

    // 5. Challenge Link
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

/**
 * Copies the Wordle-style result text block to the user's clipboard.
 * @param {Object} state - Full application state tree.
 * @returns {Promise<boolean>}
 */
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
