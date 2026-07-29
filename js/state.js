const initialState = {
    // 1. Single Source of Truth for Form Inputs
    form: {
        locMode: 'search',
        placeId: null,
        placeName: '',
        lat: null,
        lng: null,
        radius: 10,
        taxonId: null,
        taxonName: '',
        wantsPhotos: true,
        wantsSounds: false,
        months: ['1','2','3','4','5','6','7','8','9','10','11','12'],
        difficulty: '50',
        questionLimit: 10,
        showIconicTaxonBadge: true,
        preventDuplicates: true,
        isRarityMode: false,
        weightingMethod: 'linear',
        establishmentStatus: 'any',
        answerInput: '',
        rankInput: 'species'
    },

    // 2. Snapshot of configuration when the game starts
    config: {
        wantsPhotos: true,
        wantsSounds: false,
        months: [],
        difficulty: '50',
        showIconicTaxonBadge: true,
        preventDuplicates: true,
        isRarityMode: false,
        expertTotalSpecies: 0,
        questionLimit: 10,
        weightingMethod: 'linear',
        establishmentStatus: 'any'
    },

    // 3. Centralized UI & View Flags
    ui: {
        activeView: 'setup-view', // 'setup-view', 'quiz-view', 'results-view'

        // Setup state
        isLocatingGps: false,
        isLoadingQuizPool: false,
        setupError: null,
        placeError: null,
        taxonError: null,

        // Autocomplete search result pools
        placeResults: [],
        taxonResults: [],

        // Quiz state
        quizError: null,
        answerError: null,
        isCheckingAnswer: false,
        isHintVisible: false,
        isMediaLoaded: false,

        // Modal state
        zoomMediaUrl: null,
        isZoomedIn: false
    },

    // 4. Core Game Data
    questions: [],
    currentIndex: 0,
    score: 0,
    currentMediaIndex: 0
};

const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function deepFreeze(obj) {
    if (!isDevelopment) return obj;
    Object.keys(obj).forEach(prop => {
        if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
            deepFreeze(obj[prop]);
        }
    });
    return Object.freeze(obj);
}

let state = deepFreeze(structuredClone(initialState));
const listeners = new Set();

export const getState = () => state;

// Enforce functional state updates to prevent race conditions
export const setState = (updater) => {
    if (typeof updater !== 'function') {
        throw new Error('setState strictly requires an updater function (e.g., prevState => newState) to prevent race conditions.');
    }
    state = deepFreeze({ ...state, ...updater(state) });
    listeners.forEach(listener => listener(state));
};

export const updateQuestion = (index, updates) => {
    setState(prevState => {
        const newQuestions = [...prevState.questions];
        newQuestions[index] = deepFreeze({ ...newQuestions[index], ...updates });
        return { questions: newQuestions };
    });
};

export const resetState = () => {
    state = deepFreeze(structuredClone(initialState));
    listeners.forEach(listener => listener(state));
};

export const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/**
 * Subscribes a listener to a specific state slice using a selector.
 * The callback only fires when the selected value changes.
 */
export const subscribeSelector = (selector, callback, isEqual = (a, b) => a === b) => {
    let currentSelected = selector(state);

    return subscribe((newState) => {
        const nextSelected = selector(newState);
        if (!isEqual(currentSelected, nextSelected)) {
            const prevSelected = currentSelected;
            currentSelected = nextSelected;
            callback(nextSelected, prevSelected, newState);
        }
    });
};

// --- SELECTORS ---
export function selectCurrentMedia(currentState) {
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

export function selectCurrentMeta(currentState) {
    const obs = currentState.questions[currentState.currentIndex]?.observation;
    if (!obs || obs.error) return null;
    return {
        date: obs.observed_on,
        locationText: obs.place_guess,
        coordinates: obs.location,
        observer: obs.user?.name || obs.user?.login || 'Unknown Observer',
        license: obs.license_code ? obs.license_code.toUpperCase() : 'All Rights Reserved',
        isObscured: obs.geoprivacy === 'obscured' || obs.taxon_geoprivacy === 'obscured' || obs.geoprivacy === 'private' || obs.taxon_geoprivacy === 'private'
    };
}
