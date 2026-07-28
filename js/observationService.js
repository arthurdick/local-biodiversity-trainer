import { getState, updateQuestion } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';

// --- RUNTIME CACHE ---
const pendingFetches = new Map();
const activeControllers = new Map();

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

    if (!navigator.onLine) {
        const errorData = { error: true };
        updateQuestion(index, { observation: errorData });
        return errorData;
    }

    const controller = new AbortController();
    activeControllers.set(index, controller);

    const fetchPromise = (async () => {
        const q = getState().questions[index]; // Fetch fresh copy
        const currentConfig = getState().config;
        
        // Mode detection
        const isStandardExpert = currentConfig.difficulty === 'all' && !currentConfig.isRarityMode;
        const isRareExpert = currentConfig.difficulty === 'all' && currentConfig.isRarityMode;

        try {
            const timeoutMs = getDynamicNetworkTimeout();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            
            let targetTaxon = q.taxon;
            
            // If in Rare Expert mode and we haven't assigned a taxon yet, fetch a random deep page
            if (isRareExpert && !targetTaxon) {
                const totalSpecies = currentConfig.expertTotalSpecies || 0;
                
                // Abstracted math into the engine to standardize weighting
                const deepPage = engine.calculateDeepPage(totalSpecies);

                const deepData = await api.fetchSpeciesPool({
                    perPage: 50,
                    page: deepPage,
                    wantsPhotos: currentConfig.wantsPhotos,
                    wantsSounds: currentConfig.wantsSounds,
                    months: currentConfig.months,
                    placeId: s.placeId,
                    lat: s.lat,
                    lng: s.lng,
                    radius: s.radius,
                    taxonId: s.taxonId
                }, controller.signal);

                if (deepData.results && deepData.results.length > 0) {
                    let validResults = deepData.results;
                    
                    if (currentConfig.preventDuplicates) {
                        const existingIds = getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined);
                        validResults = deepData.results.filter(r => !existingIds.includes(r.taxon.id));
                    } else {
                        // Calculate how many times each taxon has already been queued
                        const existingIdCounts = {};
                        getState().questions.forEach(quest => {
                            if (quest.taxon?.id) {
                                existingIdCounts[quest.taxon.id] = (existingIdCounts[quest.taxon.id] || 0) + 1;
                            }
                        });
                        
                        // Filter out taxa where the selected count meets or exceeds total available observations
                        validResults = deepData.results.filter(r => {
                            const selectedCount = existingIdCounts[r.taxon.id] || 0;
                            const totalAvailable = Math.max(1, r.count || 1);
                            return selectedCount < totalAvailable;
                        });
                    }
                    
                    if (validResults.length === 0) {
                        clearTimeout(timeoutId);
                        const emptyData = { error: true, emptyPool: true };
                        updateQuestion(index, { observation: emptyData });
                        return emptyData;
                    }

                    let randomItem;

                    // Standardized small pool calculations handled strictly by the engine
                    if (totalSpecies <= 50) {
                        randomItem = engine.selectRareTaxonFromPool(validResults);
                    } else {
                        randomItem = validResults[Math.floor(Math.random() * validResults.length)];
                    }

                    targetTaxon = randomItem.taxon;
                    updateQuestion(index, { taxon: targetTaxon });
                } else {
                    clearTimeout(timeoutId);
                    const emptyData = { error: true, emptyPool: true };
                    updateQuestion(index, { observation: emptyData });
                    return emptyData;
                }
            }
            
            const withoutTaxonIds = (isStandardExpert && currentConfig.preventDuplicates)
                ? getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined)
                : [];
                
            let notObsIds = [];
            
            if (isStandardExpert && currentConfig.preventDuplicates) {
                // The without_taxon_id parameter handles deduplication entirely; no observation UUIDs needed.
                notObsIds = [];
            } else if (targetTaxon) {
                // Specific taxon mode: only exclude previous observation UUIDs for THIS specific taxon.
                notObsIds = getState().questions
                    .filter(quest => quest.taxon?.id === targetTaxon.id)
                    .map(quest => quest.observation?.uuid)
                    .filter(uuid => uuid !== undefined);
            } else {
                // Standard Expert with duplicates allowed: map all previous UUIDs as a fallback.
                notObsIds = getState().questions
                    .map(quest => quest.observation?.uuid)
                    .filter(uuid => uuid !== undefined);
            }

            const data = await api.fetchObservation({
                wantsPhotos: currentConfig.wantsPhotos,
                wantsSounds: currentConfig.wantsSounds,
                months: currentConfig.months,
                placeId: s.placeId,
                lat: s.lat,
                lng: s.lng,
                radius: s.radius,
                difficulty: isStandardExpert ? 'all' : 'specific',
                taxonId: isStandardExpert ? s.taxonId : targetTaxon?.id,
                withoutTaxonIds,
                notObsIds
            }, controller.signal);

            clearTimeout(timeoutId);

            if (data.results && data.results.length > 0) {
                const obs = data.results[0];
                const updates = { observation: obs };
                
                if (isStandardExpert) updates.taxon = obs.taxon;
                
                updateQuestion(index, updates);
                
                if (obs.photos && obs.photos.length > 0) {
                    const preload = new Image();
                    preload.src = obs.photos[0].url.replace('square', 'medium');
                }
                return obs;
            } else {
                const emptyData = { error: true, emptyPool: true };
                updateQuestion(index, { observation: emptyData });
                return emptyData;
            }
        } catch(e) {
            const errorData = { error: true };
            if (e.name !== 'AbortError') {
                updateQuestion(index, { observation: errorData });
            }
            return errorData;
        } finally {
            pendingFetches.delete(index);
            activeControllers.delete(index);
        }
    })();

    pendingFetches.set(index, fetchPromise);
    return fetchPromise;
}
