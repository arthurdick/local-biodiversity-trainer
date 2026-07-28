const initialState = {
    // 1. Setup & Configuration Snapshot
    locMode: 'search',
    placeId: null,
    lat: null,
    lng: null,
    radius: 10,
    taxonId: null,
    taxonName: null,
    config: {
        wantsPhotos: true,
        wantsSounds: false,
        months: [],
        difficulty: '50',
        preventDuplicates: true,
        isRarityMode: false,
        expertTotalSpecies: 0
    },
    
    // 2. Core Game Data
    questions: [],
    
    // 3. Current Run Progress
    currentIndex: 0,
    score: 0,
    currentMediaIndex: 0,
    isQuestionLoaded: false
};

// Detect local development based on the hostname
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/**
 * Helper utility to deeply freeze objects.
 * Guarantees nested structures are immutable, but only runs during development.
 */
function deepFreeze(obj) {
    // Bypass freezing entirely in production to prevent main-thread blocking
    if (!isDevelopment) return obj;

    Object.keys(obj).forEach(prop => {
        if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
            deepFreeze(obj[prop]);
        }
    });
    return Object.freeze(obj);
}

// Initialize state
let state = deepFreeze(structuredClone(initialState));
const listeners = new Set();

export const getState = () => state;

export const setState = (updates) => {
    state = deepFreeze({ ...state, ...updates });
    listeners.forEach(listener => listener(state));
};

export const updateQuestion = (index, updates) => {
    const newQuestions = [...state.questions];
    newQuestions[index] = deepFreeze({ ...newQuestions[index], ...updates });
    setState({ questions: newQuestions });
};

export const resetState = () => {
    state = deepFreeze(structuredClone(initialState));
    listeners.forEach(listener => listener(state));
};

export const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
