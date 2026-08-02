// ==========================================================================
// 1. Initial State Slices
// ==========================================================================

const initialFormState = {
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
};

const initialConfigState = {
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
    dailySeedDate: null,
    isReplay: false
};

const initialUIState = {
    activeView: 'setup-view',
    isLocatingGps: false,
    isLoadingQuizPool: false,
    setupError: null,
    placeError: null,
    taxonError: null,
    userError: null,
    isUrlChallenge: false,
    placeResults: [],
    showPlaceList: false,
    activePlaceIdx: -1,
    taxonResults: [],
    showTaxonList: false,
    activeTaxonIdx: -1,
    userResults: [],
    showUserList: false,
    activeUserIdx: -1,
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
};

const initialGameState = {
    regionalPool: [],
    questions: [],
    currentIndex: 0,
    score: 0,
    currentMediaIndex: 0
};

// ==========================================================================
// 2. Core Store Logic
// ==========================================================================

function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.keys(obj).forEach(prop => {
        if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
            deepFreeze(obj[prop]);
        }
    });
    return Object.freeze(obj);
}

class SubStore {
    #state;
    constructor(initial) {
        this.#state = deepFreeze(structuredClone(initial));
    }
    
    getState() { 
        return this.#state; 
    }
    
    setState(updater) {
        const updates = updater(this.#state);
        this.#state = deepFreeze({ ...this.#state, ...updates });
    }
}

class RootStore extends EventTarget {
    #stores;

    constructor() {
        super();
        this.#stores = {
            form: new SubStore(initialFormState),
            config: new SubStore(initialConfigState),
            ui: new SubStore(initialUIState),
            game: new SubStore(initialGameState)
        };
    }

    // Fully namespaced state tree
    getState() {
        return {
            form: this.#stores.form.getState(),
            config: this.#stores.config.getState(),
            ui: this.#stores.ui.getState(),
            game: this.#stores.game.getState()
        };
    }

    setState(updater) {
        const prevState = this.getState();
        const updates = updater(prevState);
        
        let hasChanged = false;

        if (updates.form !== undefined) {
            this.#stores.form.setState(() => updates.form);
            hasChanged = true;
        }
        if (updates.config !== undefined) {
            this.#stores.config.setState(() => updates.config);
            hasChanged = true;
        }
        if (updates.ui !== undefined) {
            this.#stores.ui.setState(() => updates.ui);
            hasChanged = true;
        }
        if (updates.game !== undefined) {
            this.#stores.game.setState(() => updates.game);
            hasChanged = true;
        }

        if (hasChanged) {
            this.dispatchEvent(new CustomEvent('statechange', { detail: this.getState() }));
        }
    }

    updateQuestion(index, updates) {
        const gamePrev = this.#stores.game.getState();
        if (index < 0 || index >= gamePrev.questions.length) return;
        
        const newQuestions = [...gamePrev.questions];
        newQuestions[index] = deepFreeze({ ...newQuestions[index], ...updates });
        
        this.#stores.game.setState(() => ({ questions: newQuestions }));
        this.dispatchEvent(new CustomEvent('statechange', { detail: this.getState() }));
    }
}

export const store = new RootStore();

// ==========================================================================
// 3. Daily Scores Persistence Helpers
// ==========================================================================

export function getDailyScores() {
    try {
        const raw = localStorage.getItem('bio_trainer_daily_scores');
        if (!raw) return { scores: {} };

        const data = JSON.parse(raw);

        if (!data || typeof data !== 'object' || typeof data.scores !== 'object' || data.scores === null) {
            localStorage.removeItem('bio_trainer_daily_scores');
            return { scores: {} };
        }

        const scores = data.scores;
        const now = Date.now();
        const retentionPeriod = 7 * 24 * 60 * 60 * 1000;
        let isModified = false;

        Object.keys(scores).forEach(key => {
            const entry = scores[key];

            if (!entry || typeof entry !== 'object') {
                delete scores[key];
                isModified = true;
                return;
            }

            const timestamp = Date.parse(entry.completedAt);
            if (Number.isNaN(timestamp) || (now - timestamp > retentionPeriod)) {
                delete scores[key];
                isModified = true;
            }
        });

        if (isModified) {
            localStorage.setItem('bio_trainer_daily_scores', JSON.stringify({ scores }));
        }

        return { scores };
    } catch (e) {
        console.warn('Could not read daily scores, clearing invalid storage entry:', e);
        try {
            localStorage.removeItem('bio_trainer_daily_scores');
        } catch (_) {}
        return { scores: {} };
    }
}

export function saveInitialDailyScore(locationKey, scoreVal, totalQuestions) {
    try {
        const currentRecord = getDailyScores();
        
        if (!currentRecord.scores[locationKey]) {
            const formattedScore = `${Number((scoreVal / 10).toFixed(1))} / ${totalQuestions}`;
            currentRecord.scores[locationKey] = {
                initialScore: scoreVal,
                formattedScore,
                completedAt: new Date().toISOString()
            };

            localStorage.setItem('bio_trainer_daily_scores', JSON.stringify({
                scores: currentRecord.scores
            }));
        }
    } catch (e) {
        console.warn('Could not save daily score:', e);
    }
}

// ==========================================================================
// 4. Selectors
// ==========================================================================

export function selectCurrentMedia(currentState) {
    const q = currentState.game.questions[currentState.game.currentIndex];
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
    const obs = currentState.game.questions[currentState.game.currentIndex]?.observation;
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
