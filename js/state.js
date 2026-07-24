const initialState = {
    // 1. Setup & Configuration Snapshot
    placeId: null,
    lat: null,
    lng: null,
    taxonId: null,
    taxonName: null,
    config: {
        wantsPhotos: true,
        wantsSounds: true,
        months: [],
        difficulty: '50',
        preventDuplicates: true
    },
    
    // 2. Core Game Data
    questions: [],
    
    // 3. Current Run Progress
    currentIndex: 0,
    score: 0,
    currentMediaIndex: 0,
    isQuestionLoaded: false
};

/**
 * Helper utility to deeply freeze objects.
 * Guarantees nested structures (like config and questions) are immutable.
 */
function deepFreeze(obj) {
    Object.keys(obj).forEach(prop => {
        if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
            deepFreeze(obj[prop]);
        }
    });
    return Object.freeze(obj);
}

// Deep freeze the initial state to prevent any accidental mutations right from the start
let state = deepFreeze(structuredClone(initialState));
const listeners = new Set();

/**
 * Retrieves the current state.
 * Returns the frozen state directly, eliminating the previous structuredClone performance penalty on every read.
 */
export const getState = () => state;

/**
 * Updates top-level state properties and triggers listeners.
 * Enforces strict immutability by deep freezing the merged state.
 */
export const setState = (updates) => {
    // Spread the old state and updates, then recursively freeze the new object tree
    state = deepFreeze({ ...state, ...updates });
    
    // Pass the strictly frozen state to listeners
    listeners.forEach(listener => listener(state));
};

/**
 * Safely updates a specific question object within the questions array.
 */
export const updateQuestion = (index, updates) => {
    // Shallow copy the array
    const newQuestions = [...state.questions];
    
    // Spread and deep freeze the specific question being updated
    newQuestions[index] = deepFreeze({ ...newQuestions[index], ...updates });
    
    // Pass the new array to setState (which will also freeze the array itself)
    setState({ questions: newQuestions });
};

/**
 * Resets the state back to its initial configuration.
 */
export const resetState = () => {
    state = deepFreeze(structuredClone(initialState));
    listeners.forEach(listener => listener(state));
};

/**
 * Subscribes to state changes.
 */
export const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
