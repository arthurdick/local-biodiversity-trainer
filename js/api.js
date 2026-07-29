const API_BASE = 'https://api.inaturalist.org/v2';

// Valid Creative Commons licenses
const CC_LICENSES = 'cc0,cc-by,cc-by-nc,cc-by-sa,cc-by-nd,cc-by-nc-sa,cc-by-nc-nd';

/**
 * Resolves the user's preferred locale from browser settings.
 */
export const getLocale = () => {
    if (typeof navigator !== 'undefined') {
        if (navigator.languages && navigator.languages.length > 0) {
            return navigator.languages[0];
        }
        if (navigator.language) {
            return navigator.language;
        }
    }
    return 'en';
};

/**
 * Global Request Throttler
 * Ensures requests to the API are spaced by at least `interval` milliseconds,
 * while allowing aborted requests to instantly unblock the queue.
 */
class RequestQueue {
    constructor(interval = 1000) {
        this.queue = [];
        this.isProcessing = false;
        this.interval = interval;
        this.lastRequestTime = 0;
    }

    enqueue(url, options = {}) {
        return new Promise((resolve, reject) => {
            // Check if signal was already aborted before enqueuing
            if (options.signal?.aborted) {
                return reject(new DOMException('Aborted before execution', 'AbortError'));
            }

            const task = { url, options, resolve, reject, cleanup: () => {} };

            // Set up explicit event listener with a cleanup mechanism
            if (options.signal) {
                const abortHandler = () => {
                    const index = this.queue.indexOf(task);
                    if (index > -1) {
                        // Remove from the pending queue if it hasn't started processing
                        this.queue.splice(index, 1);
                        task.cleanup();
                        reject(new DOMException('Aborted before execution', 'AbortError'));
                    }
                };

                task.cleanup = () => {
                    options.signal.removeEventListener('abort', abortHandler);
                };

                options.signal.addEventListener('abort', abortHandler);
            }

            // 1. Add task to the queue
            this.queue.push(task);

            // 2. Start processing if not already running
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            
            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTime;

            // Wait if the interval hasn't passed yet, but make the wait cancelable
            if (timeSinceLast < this.interval) {
                await new Promise(resolve => {
                    let timeoutId;
                    
                    // Function to immediately break the sleep
                    const wakeUp = () => {
                        clearTimeout(timeoutId);
                        if (task.options.signal) {
                            task.options.signal.removeEventListener('abort', wakeUp);
                        }
                        resolve();
                    };

                    // If already aborted, wake up immediately
                    if (task.options.signal?.aborted) {
                        return resolve();
                    }

                    // Listen for abort to interrupt the sleep and unblock the queue
                    if (task.options.signal) {
                        task.options.signal.addEventListener('abort', wakeUp);
                    }
                    
                    timeoutId = setTimeout(wakeUp, this.interval - timeSinceLast);
                });
            }

            // Double check if aborted right before fetching
            if (task.options.signal?.aborted) {
                task.cleanup();
                task.reject(new DOMException('Aborted', 'AbortError'));
                continue; // Skip fetch and immediately proceed to the next queued item
            }

            this.lastRequestTime = Date.now();

            try {
                const response = await fetch(task.url, task.options);
                task.resolve(response);
            } catch (error) {
                task.reject(error);
            } finally {
                // Guaranteed listener removal regardless of fetch success or failure
                task.cleanup();
            }
        }

        this.isProcessing = false;
    }
}

// Instantiate the throttler with a 1000ms limit
const apiQueue = new RequestQueue(1000);

/**
 * Appends URL query parameters for media requirements.
 */
const appendMediaParams = (params, wantsPhotos, wantsSounds) => {
    if (wantsPhotos && !wantsSounds) {
        params.set('photos', 'true');
    } else if (!wantsPhotos && wantsSounds) {
        params.set('sounds', 'true');
    }
    
    // Ensure both observation data and associated media strictly use open licenses
    params.set('license', CC_LICENSES);
    
    if (wantsPhotos) {
        params.set('photo_license', CC_LICENSES);
    }
    if (wantsSounds) {
        params.set('sound_license', CC_LICENSES);
    }
};

/**
 * Appends URL query parameters for seasonality filtering.
 */
const appendMonthParams = (params, months) => {
    if (months && months.length > 0 && months.length < 12) {
        params.set('month', months.join(','));
    }
};

const appendEstablishmentParams = (params, status) => {
    if (status === 'native') params.set('native', 'true');
    if (status === 'introduced') params.set('introduced', 'true');
    if (status === 'endemic') params.set('endemic', 'true');
};

export const fetchPlaces = async (query, signal, locale = getLocale()) => {
    const params = new URLSearchParams({
        q: query,
        order_by: 'area',
        geo: 'true',      // Ensures the place has a valid geometry for observation fetching
        fields: '(id:!t,name:!t,display_name:!t)',
        locale: locale
    });

    const res = await apiQueue.enqueue(`${API_BASE}/places?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch places');
    return res.json();
};

export const fetchTaxaAutocomplete = async (query, signal, locale = getLocale()) => {
    const params = new URLSearchParams({
        q: query,
        fields: '(id:!t,name:!t,preferred_common_name:!t)',
        locale: locale
    });

    const res = await apiQueue.enqueue(`${API_BASE}/taxa/autocomplete?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch taxa');
    return res.json();
};

export const fetchSpeciesPool = async ({ difficulty, wantsPhotos, wantsSounds, months, placeId, lat, lng, radius, taxonId, establishmentStatus, page = 1, perPage = null, locale = getLocale() }, signal) => {
    // If perPage is explicitly passed, use it; otherwise fallback to difficulty string mapping
    const limit = perPage !== null ? String(perPage) : String(difficulty);
    
    const params = new URLSearchParams({
        quality_grade: 'research',
        captive: 'false',
        hrank: 'species',
        per_page: limit,
        page: String(page),
        fields: '(count:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,iconic_taxon_name:!t,ancestor_ids:!t))',
        locale: locale
    });

    appendMediaParams(params, wantsPhotos, wantsSounds);
    appendMonthParams(params, months);
    appendEstablishmentParams(params, establishmentStatus);

    if (placeId) {
        params.set('place_id', String(placeId));
    } else if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
        params.set('radius', String(radius || 10));
    }

    if (taxonId) {
        params.set('taxon_id', String(taxonId));
    }

    const res = await apiQueue.enqueue(`${API_BASE}/observations/species_counts?${params}`, { signal });
    if (!res.ok) {
        const err = new Error('Failed to fetch species pool');
        err.status = res.status;
        throw err;
    }
    return res.json();
};

export const fetchObservation = async ({ wantsPhotos, wantsSounds, months, placeId, lat, lng, radius, difficulty, taxonId, establishmentStatus, withoutTaxonIds = [], notObsIds = [], locale = getLocale() }, signal) => {
    const params = new URLSearchParams({
        quality_grade: 'research',
        captive: 'false',
        per_page: '1',
        order_by: 'random',
        fields: '(id:!t,uuid:!t,description:!t,observed_on:!t,place_guess:!t,location:!t,geoprivacy:!t,taxon_geoprivacy:!t,license_code:!t,user:(login:!t,name:!t),taxon:(id:!t,name:!t,preferred_common_name:!t,iconic_taxon_name:!t,ancestor_ids:!t),photos:(url:!t,attribution:!t,license_code:!t),sounds:(file_url:!t,attribution:!t,license_code:!t))',
        locale: locale
    });

    appendMediaParams(params, wantsPhotos, wantsSounds);
    appendMonthParams(params, months);
    appendEstablishmentParams(params, establishmentStatus);

    if (placeId) {
        params.set('place_id', String(placeId));
    } else if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
        params.set('radius', String(radius || 10));
    }

    if (difficulty === 'all') {
        params.set('rank', 'species,subspecies');
        if (taxonId) params.set('taxon_id', String(taxonId));
        if (withoutTaxonIds && withoutTaxonIds.length > 0) {
            params.set('without_taxon_id', withoutTaxonIds.join(','));
        }
    } else if (taxonId) {
        params.set('taxon_id', String(taxonId));
    }

    if (notObsIds && notObsIds.length > 0) {
        params.set('not_id', notObsIds.join(','));
    }

    const res = await apiQueue.enqueue(`${API_BASE}/observations?${params}`, { cache: 'no-store', signal });
    if (!res.ok) {
        const err = new Error('Failed to fetch observation');
        err.status = res.status;
        throw err;
    }
    return res.json();
};

export const checkTaxonSearch = async (inputStr, guessedRank, signal, locale = getLocale()) => {
    const rankQuery = guessedRank === 'species' ? 'species,subspecies,variety,form' : guessedRank;
    const params = new URLSearchParams({
        q: inputStr,
        rank: rankQuery,
        is_active: 'true',
        per_page: '50',
        fields: '(id:!t,name:!t,preferred_common_name:!t,matched_term:!t,ancestor_ids:!t,rank:!t)',
        locale: locale
    });

    const res = await apiQueue.enqueue(`${API_BASE}/taxa?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch search validation');
    return res.json();
};
