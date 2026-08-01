import { store } from './state.js';
import * as api from './api.js';
import * as engine from './quizEngine.js';

let currentSessionId = 0;

const pendingFetches = new Map();
const activeControllers = new Map();
const preloadedImages = new Map();

let expertRareLock = Promise.resolve();

export function clearCache() {
    currentSessionId++; 
    activeControllers.forEach(controller => controller.abort());
    activeControllers.clear();
    pendingFetches.clear();
    preloadedImages.clear();
    api.clearApiQueue().catch(err => console.error('Error draining queue:', err));
    expertRareLock = Promise.resolve();
}

export async function loadObservationForQuestion(index) {
    const s = store.getState();
    if (index >= s.questions.length) return;
    
    if (s.questions[index].observation) return s.questions[index].observation;
    if (pendingFetches.has(index)) return pendingFetches.get(index);

    const requestSessionId = currentSessionId;
    const controller = new AbortController();
    activeControllers.set(index, controller);

    const fetchPromise = (async () => {
        const q = store.getState().questions[index];
        const currentConfig = store.getState().config;
        
        const isStandardExpert = currentConfig.difficulty === 'all' && !currentConfig.isRarityMode;
        const isRareExpert = currentConfig.difficulty === 'all' && currentConfig.isRarityMode;

        try {
            let targetTaxon = q.taxon;
            const needsPreSelection = isRareExpert || (isStandardExpert && currentConfig.lifeListMode !== 'off');

            if (needsPreSelection && !targetTaxon) {
                const previousLock = expertRareLock;
                let releaseLock;
                expertRareLock = new Promise(resolve => releaseLock = resolve);
                await previousLock.catch(() => {});

                try {
                    targetTaxon = store.getState().questions[index].taxon;

                    if (!targetTaxon) {
                        const totalSpecies = currentConfig.expertTotalSpecies || 0;
                        
                        let targetPage = isRareExpert
                            ? engine.calculateDeepPage(totalSpecies)
                            : engine.calculateStandardPage(totalSpecies);

                        let validResults = [];
                        let attempts = 0;
                        const maxAttempts = 2;

                        while (validResults.length === 0 && attempts < maxAttempts && targetPage >= 1) {
                            attempts++;

                            const deepData = await api.fetchSpeciesPool({
                                perPage: 50, page: targetPage,
                                wantsPhotos: currentConfig.wantsPhotos, wantsSounds: currentConfig.wantsSounds,
                                months: currentConfig.months, placeId: currentConfig.placeId,
                                lat: currentConfig.lat, lng: currentConfig.lng, radius: currentConfig.radius,
                                taxonId: currentConfig.taxonId, establishmentStatus: currentConfig.establishmentStatus,
                                lifeListMode: currentConfig.lifeListMode, userLogin: currentConfig.userLogin, userId: currentConfig.userId,
                                isDailyMode: currentConfig.isDailyMode,
                                dailySeedDate: currentConfig.dailySeedDate
                            }, controller.signal);

                            if (deepData.results && deepData.results.length > 0) {
                                if (currentConfig.preventDuplicates) {
                                    const existingIds = store.getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined);
                                    validResults = deepData.results.filter(r => !existingIds.includes(r.taxon.id));
                                } else {
                                    const existingIdCounts = {};
                                    store.getState().questions.forEach(quest => {
                                        if (quest.taxon?.id) existingIdCounts[quest.taxon.id] = (existingIdCounts[quest.taxon.id] || 0) + 1;
                                    });
                                    
                                    validResults = deepData.results.filter(r => {
                                        const selectedCount = existingIdCounts[r.taxon.id] || 0;
                                        const totalAvailable = Math.max(1, r.count || 1);
                                        return selectedCount < totalAvailable;
                                    });
                                }
                            }
                            
                            if (validResults.length === 0) targetPage--;
                        }
                        
                        if (requestSessionId !== currentSessionId) return null;

                        if (validResults.length === 0) {
                            const emptyData = { error: true, emptyPool: true };
                            if (requestSessionId !== currentSessionId) return null;
                            
                            store.updateQuestion(index, { observation: emptyData });
                            store.dispatchEvent(new CustomEvent('observation:loaded', { detail: { index, observation: emptyData, error: true, emptyPool: true } }));
                            return emptyData;
                        }

                        if (isRareExpert) {
                            const randomItem = engine.selectRareTaxonFromPool(validResults, currentConfig.weightingMethod);
                            targetTaxon = randomItem.taxon;
                        } else {
                            const generatedPool = engine.generateWeightedPool(
                                validResults,
                                1,
                                currentConfig.preventDuplicates,
                                false,
                                currentConfig.weightingMethod
                            );
                            targetTaxon = generatedPool[0].taxon;
                        }
                        
                        if (requestSessionId !== currentSessionId) return null;
                        store.updateQuestion(index, { taxon: targetTaxon });
                    }
                } finally {
                    releaseLock();
                }
            }
            
            const withoutTaxonIds = (isStandardExpert && currentConfig.preventDuplicates && !targetTaxon)
                ? store.getState().questions.map(quest => quest.taxon?.id).filter(id => id !== undefined)
                : [];
                
            let notObsIds = [];
            
            if (isStandardExpert && currentConfig.preventDuplicates && !targetTaxon) {
                notObsIds = [];
            } else if (targetTaxon) {
                notObsIds = store.getState().questions
                    .filter(quest => quest.taxon?.id === targetTaxon.id)
                    .map(quest => quest.observation?.uuid)
                    .filter(uuid => uuid !== undefined);
            } else {
                notObsIds = store.getState().questions
                    .map(quest => quest.observation?.uuid)
                    .filter(uuid => uuid !== undefined);
            }

            let dailyPage = 1;
            if (currentConfig.isDailyMode) {
                const totalObs = q.count || 1;
                const maxPages = Math.min(totalObs, 30);

                const seedKey = engine.buildLocationSeedKey(currentConfig);
                const globalSeedInt = engine.hashString(seedKey);
                const questionRng = engine.getQuestionRNG(globalSeedInt, index);

                dailyPage = Math.floor(questionRng() * maxPages) + 1;
            }

            const data = await api.fetchObservation({
                wantsPhotos: currentConfig.wantsPhotos, wantsSounds: currentConfig.wantsSounds,
                months: currentConfig.months, placeId: currentConfig.placeId,
                lat: currentConfig.lat, lng: currentConfig.lng, radius: currentConfig.radius,
                difficulty: (isStandardExpert && !targetTaxon) ? 'all' : 'specific',
                taxonId: targetTaxon ? targetTaxon.id : currentConfig.taxonId,
                establishmentStatus: currentConfig.establishmentStatus,
                lifeListMode: currentConfig.lifeListMode, userLogin: currentConfig.userLogin, userId: currentConfig.userId,
                isDailyMode: currentConfig.isDailyMode,
                dailySeedDate: currentConfig.dailySeedDate,
                page: dailyPage,
                withoutTaxonIds, notObsIds
            }, controller.signal);

            if (requestSessionId !== currentSessionId) return null;

            if (data.results && data.results.length > 0) {
                const obs = data.results[0];
                const updates = { observation: obs };
                
                if (isStandardExpert && !targetTaxon) updates.taxon = obs.taxon;
                
                if (requestSessionId !== currentSessionId) return null;
                
                store.updateQuestion(index, updates);
                store.dispatchEvent(new CustomEvent('observation:loaded', { detail: { index, observation: obs } }));
                
                if (obs.photos && obs.photos.length > 0) {
                    const preload = new Image();
                    preload.src = obs.photos[0].url.replace('square', 'medium');
                    preloadedImages.set(index, preload);
                }
                return obs;
            } else {
                const emptyData = { error: true, emptyPool: true };
                
                if (requestSessionId !== currentSessionId) return null;
                
                store.updateQuestion(index, { observation: emptyData });
                store.dispatchEvent(new CustomEvent('observation:loaded', { detail: { index, observation: emptyData, error: true, emptyPool: true } }));
                return emptyData;
            }
        } catch(e) {
            if (requestSessionId !== currentSessionId) return null;

            const errorData = { error: true };
            if (e.status === 429) {
                errorData.isRateLimited = true;
            } 

            if (requestSessionId !== currentSessionId) return null;

            store.updateQuestion(index, { observation: errorData });
            store.dispatchEvent(new CustomEvent('observation:loaded', { detail: { index, observation: errorData, error: true } }));
            return errorData;
        } finally {
            pendingFetches.delete(index);
            activeControllers.delete(index);
        }
    })();

    pendingFetches.set(index, fetchPromise);
    return fetchPromise;
}
