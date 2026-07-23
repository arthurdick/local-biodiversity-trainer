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

let state = structuredClone(initialState);
const listeners = new Set();

/**
 * Retrieves a deep copy of the current state.
 */
export const getState = () => structuredClone(state);

/**
 * Updates top-level state properties and triggers listeners.
 */
export const setState = (updates) => {
    state = { ...state, ...updates };
    
    // Pass a deep copy to listeners to prevent accidental mutation downstream
    const stateSnapshot = structuredClone(state);
    listeners.forEach(listener => listener(stateSnapshot));
};

/**
 * Safely updates a specific question object within the questions array.
 */
export const updateQuestion = (index, updates) => {
    const newQuestions = [...state.questions];
    newQuestions[index] = { ...newQuestions[index], ...updates };
    setState({ questions: newQuestions });
};

/**
 * Resets the state back to its initial configuration.
 */
export const resetState = () => {
    state = structuredClone(initialState);
    
    const stateSnapshot = structuredClone(state);
    listeners.forEach(listener => listener(stateSnapshot));
};

/**
 * Subscribes to state changes.
 */
export const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
