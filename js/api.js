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
 * Calculates a dynamic network timeout based on the user's connection speed.
 */
export const getDynamicNetworkTimeout = (defaultTimeout = 10000) => {
    if (typeof navigator !== 'undefined') {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection) {
            switch (connection.effectiveType) {
                case 'slow-2g':
                case '2g':
                    return 30000; // 30 seconds for very slow connections
                case '3g':
                    return 20000; // 20 seconds for 3G
                case '4g':
                default:
                    return defaultTimeout;
            }
        }
    }
    return defaultTimeout;
};

/**
 * Global Request Throttler
 * Ensures requests to the API are spaced by at least `interval` milliseconds,
 * using modern AbortSignal compositions and conditional HTTP 429 backoff retries.
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
            if (options.signal?.aborted) {
                return reject(new DOMException('Aborted before execution', 'AbortError'));
            }

            const task = { url, options, resolve, reject, cleanup: () => {} };

            if (options.signal) {
                const abortHandler = () => {
                    const index = this.queue.indexOf(task);
                    if (index > -1) {
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

            this.queue.push(task);
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift();
                task.cleanup();

                if (task.options.signal?.aborted) {
                    task.reject(new DOMException('Aborted before execution', 'AbortError'));
                    continue;
                }

                const now = Date.now();
                const timeSinceLast = now - this.lastRequestTime;

                if (timeSinceLast < this.interval) {
                    await new Promise(resolve => {
                        let timeoutId;
                        const wakeUp = () => {
                            clearTimeout(timeoutId);
                            if (task.options.signal) {
                                task.options.signal.removeEventListener('abort', wakeUp);
                            }
                            resolve();
                        };

                        if (task.options.signal) {
                            task.options.signal.addEventListener('abort', wakeUp);
                        }

                        timeoutId = setTimeout(wakeUp, this.interval - timeSinceLast);
                    });
                }

                if (task.options.signal?.aborted) {
                    task.reject(new DOMException('Aborted during delay', 'AbortError'));
                    continue;
                }

                this.lastRequestTime = Date.now();

                try {
                    const timeoutSignal = AbortSignal.timeout(getDynamicNetworkTimeout());
                    const combinedSignal = task.options.signal
                        ? AbortSignal.any([task.options.signal, timeoutSignal])
                        : timeoutSignal;

                    let response = await fetch(task.url, {
                        ...task.options,
                        signal: combinedSignal
                    });

                    // Conditional retry for HTTP 429 strictly when Retry-After is explicitly specified
                    const retryAfterHeader = response.headers.get('Retry-After');
                    if (response.status === 429 && retryAfterHeader && !task.options.signal?.aborted) {
                        const backoffMs = parseInt(retryAfterHeader, 10) * 1000;
                        if (!isNaN(backoffMs) && backoffMs > 0) {
                            console.warn(`HTTP 429 rate limit encountered. Retrying in ${backoffMs}ms...`);
                            await new Promise(r => setTimeout(r, backoffMs));

                            if (!task.options.signal?.aborted) {
                                const retryTimeoutSignal = AbortSignal.timeout(getDynamicNetworkTimeout());
                                const retryCombinedSignal = task.options.signal
                                    ? AbortSignal.any([task.options.signal, retryTimeoutSignal])
                                    : retryTimeoutSignal;

                                response = await fetch(task.url, {
                                    ...task.options,
                                    signal: retryCombinedSignal
                                });
                            }
                        }
                    }

                    task.resolve(response);
                } catch (error) {
                    task.reject(error);
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }
}

// Instantiate the throttler with a 1000ms limit
const apiQueue = new RequestQueue(1000);

/**
 * Unified execution helper for building API requests and handling HTTP errors.
 */
async function request(endpoint, paramsObj, options = {}) {
    const { signal, cache, ...fetchOpts } = options;
    const params = paramsObj instanceof URLSearchParams ? paramsObj : new URLSearchParams(paramsObj);

    const res = await apiQueue.enqueue(`${API_BASE}${endpoint}?${params}`, { signal, cache, ...fetchOpts });

    if (!res.ok) {
        const error = new Error(`Failed to fetch ${endpoint}`);
        error.status = res.status;
        error.endpoint = endpoint;
        throw error;
    }

    return res.json();
}

/**
 * Appends URL query parameters for media requirements.
 */
const appendMediaParams = (params, wantsPhotos, wantsSounds) => {
    if (wantsPhotos && !wantsSounds) {
        params.set('photos', 'true');
    } else if (!wantsPhotos && wantsSounds) {
        params.set('sounds', 'true');
    }
    
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
        geo: 'true',
        fields: '(id:!t,name:!t,display_name:!t,matched_term:!t)',
        locale: locale
    });

    return request('/places', params, { signal });
};

export const fetchTaxaAutocomplete = async (query, signal, locale = getLocale()) => {
    const params = new URLSearchParams({
        q: query,
        fields: '(id:!t,name:!t,preferred_common_name:!t,matched_term:!t)',
        locale: locale
    });

    return request('/taxa/autocomplete', params, { signal });
};

export const fetchSpeciesPool = async ({ difficulty, wantsPhotos, wantsSounds, months, placeId, lat, lng, radius, taxonId, establishmentStatus, page = 1, perPage = null, locale = getLocale() }, signal) => {
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

    return request('/observations/species_counts', params, { signal });
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

    return request('/observations', params, { cache: 'no-store', signal });
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

    return request('/taxa', params, { signal });
};
