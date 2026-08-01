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
        userLogin: '',
        userId: null,
        lifeListMode: 'off',
        wantsPhotos: true,
        wantsSounds: false,
        months: ['1','2','3','4','5','6','7','8','9','10','11','12'],
        difficulty: '50',
        questionLimit: 10,
        showIconicTaxonBadge: true,
        preventDuplicates: true,
        isRarityMode: false,
        isMultipleChoice: false,
        weightingMethod: 'linear',
        establishmentStatus: 'any',
        answerInput: '',
        rankInput: 'species',
        isDailyMode: false,
        dailySeedDate: null
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
        isMultipleChoice: false,
        expertTotalSpecies: 0,
        questionLimit: 10,
        weightingMethod: 'linear',
        establishmentStatus: 'any',
        userLogin: '',
        userId: null,
        lifeListMode: 'off',
        isDailyMode: false,
        dailySeedDate: null
    },

    // 3. Centralized UI & View Flags
    ui: {
        activeView: 'setup-view',

        isLocatingGps: false,
        isLoadingQuizPool: false,
        setupError: null,
        placeError: null,
        taxonError: null,
        userError: null,
        isUrlChallenge: false,

        placeResults: [],
        taxonResults: [],
        userResults: [],

        quizError: null,
        answerError: null,
        isCheckingAnswer: false,
        isHintVisible: false,
        isMediaLoaded: false,

        zoomMediaUrl: null,
        isZoomedIn: false,

        isLicenseModalOpen: false,
        licenseText: null,
        isLoadingLicense: false,
        licenseError: null
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

class Store extends EventTarget {
    #state;
    
    constructor(initial) {
        super();
        this.initialState = initial;
        this.#state = deepFreeze(structuredClone(initial));
    }

    getState() { 
        return this.#state; 
    }

    setState(updater) {
        if (typeof updater !== 'function') {
            throw new Error('setState strictly requires an updater function.');
        }

        this.#state = deepFreeze({ ...this.#state, ...updater(this.#state) });
        this.dispatchEvent(new CustomEvent('statechange', { detail: this.#state }));
    }

    updateQuestion(index, updates) {
        this.setState(prevState => {
            if (index < 0 || index >= prevState.questions.length) return prevState;
            const newQuestions = [...prevState.questions];
            newQuestions[index] = deepFreeze({ ...newQuestions[index], ...updates });
            return { questions: newQuestions };
        });
    }

    resetState() {
        this.#state = deepFreeze(structuredClone(this.initialState));
        this.dispatchEvent(new CustomEvent('statechange', { detail: this.#state }));
    }
}

// Export Singleton Store
export const store = new Store(initialState);

// --- DAILY SCORES PERSISTENCE HELPERS ---
export function getDailyScores() {
    try {
        const raw = localStorage.getItem('bio_trainer_daily_scores');
        if (!raw) return { date: null, scores: {} };
        const data = JSON.parse(raw);
        const todayUTC = new Date().toISOString().split('T')[0];
        if (data.date !== todayUTC) {
            localStorage.removeItem('bio_trainer_daily_scores');
            return { date: todayUTC, scores: {} };
        }
        return data;
    } catch (e) {
        return { date: null, scores: {} };
    }
}

export function saveInitialDailyScore(locationKey, scoreVal, totalQuestions) {
    try {
        const todayUTC = new Date().toISOString().split('T')[0];
        const currentRecord = getDailyScores();
        
        if (!currentRecord.scores[locationKey]) {
            const formattedScore = `${Number((scoreVal / 10).toFixed(1))} / ${totalQuestions}`;
            currentRecord.date = todayUTC;
            currentRecord.scores[locationKey] = {
                initialScore: scoreVal,
                formattedScore,
                completedAt: new Date().toISOString()
            };
            localStorage.setItem('bio_trainer_daily_scores', JSON.stringify(currentRecord));
        }
    } catch (e) {
        console.warn('Could not save daily score:', e);
    }
}

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
