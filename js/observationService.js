import { getState, updateQuestion } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';

// --- RUNTIME CACHE ---
const pendingFetches = new Map();
const activeControllers = new Map();
const preloadedImages = new Map(); // Retains strong references to prevent GC

/**
 * Calculates a dynamic network timeout based on the user's connection speed.
 */
export function getDynamicNetworkTimeout(defaultTimeout = 10000) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return defaultTimeout;

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

export function clearCache() {
    activeControllers.forEach(controller => controller.abort());
    activeControllers.clear();
    pendingFetches.clear();
    preloadedImages.clear();
}

/**
 * Helper to execute a fetch with its own network timeout,
 * while linking to a parent AbortSignal for user cancellation.
 */
async function fetchWithTimeout(fetchFn, parentSignal) {
    const fetchController = new AbortController();

    const onParentAbort = () => fetchController.abort();
    if (parentSignal) {
        if (parentSignal.aborted) {
            fetchController.abort();
        } else {
            parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }
    }

    const timeoutMs = getDynamicNetworkTimeout();
    const timeoutId = setTimeout(() => fetchController.abort(), timeoutMs);

    try {
        return await fetchFn(fetchController.signal);
    } finally {
        clearTimeout(timeoutId);
        if (parentSignal) {
            parentSignal.removeEventListener('abort', onParentAbort);
        }
    }
}

/**
 * JIT Prefetcher for Loading Observations
 */
export async function loadObservationForQuestion(index) {
    const s = getState();
    if (index >= s.questions.length) return;
    
    // Check state first
    if (s.questions[index].observation) return s.questions[index].observation;
    
    // Check runtime cache for pending fetch
    if (pendingFetches.has(index)) return pendingFetches.get(index);

    const controller = new AbortController();
    activeControllers.set(index, controller);

    const fetchPromise = (async () => {
        const q = getState().questions[index];
        const currentConfig = getState().config;
        
        // Mode detection
        const isStandardExpert = currentConfig.difficulty === 'all' && !currentConfig.isRarityMode;
        const isRareExpert = currentConfig.difficulty === 'all' && currentConfig.isRarityMode;

        try {
            let targetTaxon = q.taxon;
            
            // If in Rare Expert mode and we haven't assigned a taxon yet, fetch a random deep page
            if (isRareExpert && !targetTaxon) {
                const totalSpecies = currentConfig.expertTotalSpecies || 0;
                
                let deepPage = engine.calculateDeepPage(totalSpecies);
                let validResults = [];
                let attempts = 0;
                const maxAttempts = 2;

                while (validResults.length === 0 && attempts < maxAttempts && deepPage >= 1) {
                    attempts++;

                    const deepData = await fetchWithTimeout(
                        signal => api.fetchSpeciesPool({
                            perPage: 50,
                            page: deepPage,
                            wantsPhotos: currentConfig.wantsPhotos,
                            wantsSounds: currentConfig.wantsSounds,
                            months: currentConfig.months,
                            placeId: currentConfig.placeId,
                            lat: currentConfig.lat,
                            lng: currentConfig.lng,
                            radius: currentConfig.radius,
                            taxonId: currentConfig.taxonId,
                            establishmentStatus: currentConfig.establishmentStatus
                        }, signal),
                        controller.signal
                    );

                    if (deepData.results && deepData.results.length > 0) {
                        if (currentConfig.preventDuplicates) {
                            const existingIds = getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined);
                            validResults = deepData.results.filter(r => !existingIds.includes(r.taxon.id));
                        } else {
                            const existingIdCounts = {};
                            getState().questions.forEach(quest => {
                                if (quest.taxon?.id) {
                                    existingIdCounts[quest.taxon.id] = (existingIdCounts[quest.taxon.id] || 0) + 1;
                                }
                            });
                            
                            validResults = deepData.results.filter(r => {
                                const selectedCount = existingIdCounts[r.taxon.id] || 0;
                                const totalAvailable = Math.max(1, r.count || 1);
                                return selectedCount < totalAvailable;
                            });
                        }
                    }
                    
                    if (validResults.length === 0) {
                        deepPage--;
                    }
                }
                
                if (validResults.length === 0) {
                    const emptyData = { error: true, emptyPool: true };
                    updateQuestion(index, { observation: emptyData });
                    return emptyData;
                }

                const randomItem = engine.selectRareTaxonFromPool(validResults, currentConfig.weightingMethod);

                targetTaxon = randomItem.taxon;
                updateQuestion(index, { taxon: targetTaxon });
            }
            
            const withoutTaxonIds = (isStandardExpert && currentConfig.preventDuplicates)
                ? getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined)
                : [];
                
            let notObsIds = [];
            
            if (isStandardExpert && currentConfig.preventDuplicates) {
                notObsIds = [];
            } else if (targetTaxon) {
                notObsIds = getState().questions
                    .filter(quest => quest.taxon?.id === targetTaxon.id)
                    .map(quest => quest.observation?.uuid)
                    .filter(uuid => uuid !== undefined);
            } else {
                notObsIds = getState().questions
                    .map(quest => quest.observation?.uuid)
                    .filter(uuid => uuid !== undefined);
            }

            const data = await fetchWithTimeout(
                signal => api.fetchObservation({
                    wantsPhotos: currentConfig.wantsPhotos,
                    wantsSounds: currentConfig.wantsSounds,
                    months: currentConfig.months,
                    placeId: currentConfig.placeId,
                    lat: currentConfig.lat,
                    lng: currentConfig.lng,
                    radius: currentConfig.radius,
                    difficulty: isStandardExpert ? 'all' : 'specific',
                    taxonId: isStandardExpert ? currentConfig.taxonId : targetTaxon?.id,
                    establishmentStatus: currentConfig.establishmentStatus,
                    withoutTaxonIds,
                    notObsIds
                }, signal),
                controller.signal
            );

            if (data.results && data.results.length > 0) {
                const obs = data.results[0];
                const updates = { observation: obs };
                
                if (isStandardExpert) updates.taxon = obs.taxon;
                
                updateQuestion(index, updates);
                
                if (obs.photos && obs.photos.length > 0) {
                    const preload = new Image();
                    preload.src = obs.photos[0].url.replace('square', 'medium');
                    // Retain strong reference in Map to prevent garbage collection sweep
                    preloadedImages.set(index, preload);
                }
                return obs;
            } else {
                const emptyData = { error: true, emptyPool: true };
                updateQuestion(index, { observation: emptyData });
                return emptyData;
            }
        } catch(e) {
            const errorData = { error: true };
            
            if (e.status === 429) {
                errorData.isRateLimited = true;
                console.warn(`Question ${index + 1}: Rate limited (HTTP 429).`);
            } else if (e.name === 'AbortError') {
                console.warn(`Question ${index + 1}: Network request timed out.`);
            } else {
                console.error(`Question ${index + 1}: Fetch failed`, e);
            }

            updateQuestion(index, { observation: errorData });
            
            return errorData;
        } finally {
            pendingFetches.delete(index);
            activeControllers.delete(index);
        }
    })();

    pendingFetches.set(index, fetchPromise);
    return fetchPromise;
}
