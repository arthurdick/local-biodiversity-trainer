import * as api from './api.js';

export function getUTCTodayString() {
    return new Date().toISOString().split('T')[0];
}

export function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
    }
    return hash;
}

export function createPRNG(seedInt) {
    let s = seedInt >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function getQuestionRNG(globalSeedInt, questionIndex) {
    const slotSeed = globalSeedInt + (questionIndex * 10007);
    return createPRNG(slotSeed);
}

export function buildLocationSeedKey(config) {
    const dateStr = config.dailySeedDate || getUTCTodayString();
    let locStr = '';
    if (config.locMode === 'search' && config.placeId) {
        locStr = `place_${config.placeId}`;
    } else if (config.lat !== null && config.lng !== null) {
        // Enforce 3 decimal places for seed alignment
        const latRound = Number(config.lat).toFixed(3);
        const lngRound = Number(config.lng).toFixed(3);
        locStr = `coords_${latRound}_${lngRound}_r${config.radius || 10}`;
    } else {
        locStr = 'global';
    }

    if (config.taxonId) {
        locStr += `_taxon_${config.taxonId}`;
    }

    const pFlag = config.wantsPhotos ? '1' : '0';
    const sFlag = config.wantsSounds ? '1' : '0';
    locStr += `_m${pFlag}${sFlag}`;

    return `${dateStr}:${locStr}`;
}

export function applyDailyEnforcements(baseFormState) {
    const todayUTC = getUTCTodayString();
    const now = new Date();
    const currentMonthStr = String(now.getUTCMonth() + 1);

    return {
        ...baseFormState,
        questionLimit: 10,
        difficulty: '125',
        months: [currentMonthStr],
        lifeListMode: 'off',
        showIconicTaxonBadge: true,
        preventDuplicates: true,
        isRarityMode: false,
        weightingMethod: 'linear',
        establishmentStatus: 'any',
        isMultipleChoice: false,
        isDailyMode: true,
        dailySeedDate: baseFormState.dailySeedDate || todayUTC
    };
}

function normalize(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[-—–]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getQuestionThumbnail(q, currentMediaArray) {
    const photoMedia = currentMediaArray.find(m => m.type === 'photo');
    if (photoMedia) {
        return {
            url: photoMedia.mediumUrl,
            attribution: `Photo: ${photoMedia.attribution}`
        };
    }
    
    const soundMedia = currentMediaArray.find(m => m.type === 'sound');
    if (soundMedia) {
        return {
            url: '',
            attribution: `Sound: ${soundMedia.attribution || 'iNaturalist Contributor'}`
        };
    }

    return { url: '', attribution: '' };
}

function getWeight(count, method = 'linear') {
    if (method === 'linear') {
        return Math.max(1, count);
    }
    return Math.log10(Math.max(1, count) + 1);
}

export function generateWeightedPool(dataResults, questionLimit, preventDuplicates, isRarityMode = false, weightingMethod = 'linear', rng = Math.random) {
    const questions = [];
    
    let availablePool = dataResults.map(r => {
        const count = Math.max(1, r.count || 1); 
        const rawWeight = getWeight(count, weightingMethod);
        
        return {
            taxon: r.taxon,
            count: count,
            weight: isRarityMode ? (1 / rawWeight) : rawWeight,
            selectedCount: 0
        };
    });

    const limit = preventDuplicates
        ? Math.min(questionLimit, availablePool.length)
        : questionLimit;

    for (let i = 0; i < limit; i++) {
        if (availablePool.length === 0) break;

        const totalWeight = availablePool.reduce((sum, item) => sum + item.weight, 0);
        if (totalWeight <= 0) break;

        const roll = rng() * totalWeight;
        let runningWeight = 0;
        let selectedIndex = availablePool.length - 1;

        for (let j = 0; j < availablePool.length; j++) {
            runningWeight += availablePool[j].weight;
            if (roll <= runningWeight) {
                selectedIndex = j;
                break;
            }
        }

        const selectedItem = availablePool[selectedIndex];
        questions.push({ taxon: selectedItem.taxon, count: selectedItem.count, observation: null });

        if (preventDuplicates) {
            availablePool.splice(selectedIndex, 1);
        } else {
            selectedItem.selectedCount += 1;
            if (selectedItem.selectedCount >= selectedItem.count) {
                availablePool.splice(selectedIndex, 1);
            }
        }
    }

    return questions;
}

export function calculateDeepPage(totalSpecies) {
    let deepPage = 1;
    if (totalSpecies > 50) {
        const maxPages = Math.min(Math.ceil(totalSpecies / 50), 200);
        let totalWeight = 0;
        const pageWeights = [];
        
        for (let p = 1; p <= maxPages; p++) {
            const weight = 1 + Math.log10(p);
            totalWeight += weight;
            pageWeights.push({ page: p, threshold: totalWeight });
        }
        
        const roll = Math.random() * totalWeight;
        deepPage = (pageWeights.find(pw => roll <= pw.threshold) || pageWeights[pageWeights.length - 1]).page;
    }
    return deepPage;
}

export function calculateStandardPage(totalSpecies) {
    let page = 1;
    if (totalSpecies > 50) {
        const maxPages = Math.min(Math.ceil(totalSpecies / 50), 200);
        let totalWeight = 0;
        const pageWeights = [];
        
        for (let p = 1; p <= maxPages; p++) {
            const weight = 1 / Math.pow(p, 2);
            totalWeight += weight;
            pageWeights.push({ page: p, threshold: totalWeight });
        }
        
        const roll = Math.random() * totalWeight;
        page = (pageWeights.find(pw => roll <= pw.threshold) || pageWeights[0]).page;
    }
    return page;
}

export function selectRareTaxonFromPool(validResults, weightingMethod = 'linear') {
    let totalWeight = 0;
    const weightedResults = validResults.map(r => {
        const count = Math.max(1, r.count || 1);
        const rawWeight = getWeight(count, weightingMethod);
        const weight = 1 / rawWeight;
        totalWeight += weight;
        return { item: r, threshold: totalWeight };
    });
    
    const roll = Math.random() * totalWeight;
    return (weightedResults.find(w => roll <= w.threshold) || weightedResults[weightedResults.length - 1]).item;
}

function checkExactMatch(inputStr, taxon) {
    const normalizedInput = normalize(inputStr);
    const matchSci = normalizedInput === normalize(taxon.name);
    const matchCommon = taxon.preferred_common_name ? (normalizedInput === normalize(taxon.preferred_common_name)) : false;
    
    if (matchSci || matchCommon) {
        return { isCorrect: true, matchedNameDisplay: matchSci ? taxon.name : taxon.preferred_common_name, normalizedInput };
    }
    return { isCorrect: false, matchedNameDisplay: "", normalizedInput };
}

function getPointsForRank(rank) {
    switch(rank) {
        case 'species': return 10;
        case 'genus': return 7;
        case 'family': return 4;
        case 'order': return 2;
        default: return 0;
    }
}

export function generateMultipleChoiceOptions(targetTaxon, fallbackPool = [], candidateTaxa = [], excludedIds = new Set()) {
    if (!targetTaxon) return [];

    const formatName = (t) => t.preferred_common_name
        ? `${t.preferred_common_name} (${t.name})`
        : t.name;

    const targetId = targetTaxon.id;
    const targetOption = {
        id: targetId,
        displayName: formatName(targetTaxon),
        isCorrect: true
    };

    const distractorCandidates = [];
    const usedIds = new Set([targetId, ...excludedIds]);

    // Helper to safely extract taxon and count weight
    const addCandidate = (item) => {
        if (!item) return;
        const t = item.taxon || item;
        const count = Math.max(1, item.count || t.count || 1);
        
        if (t && t.id && !usedIds.has(t.id)) {
            distractorCandidates.push({
                id: t.id,
                displayName: formatName(t),
                count: count,
                isCorrect: false
            });
            usedIds.add(t.id);
        }
    };

    // 1. Add candidates fetched from API tiers (lookalikes, ancestors, iconic)
    if (Array.isArray(candidateTaxa)) {
        candidateTaxa.forEach(addCandidate);
    }

    // 2. Fallback pool (regional pool)
    if (distractorCandidates.length < 3 && Array.isArray(fallbackPool)) {
        fallbackPool.forEach(addCandidate);
    }

    // Weighted sampling without replacement based on observation/confusion count
    const selectedDistractors = [];
    while (selectedDistractors.length < 3 && distractorCandidates.length > 0) {
        const totalWeight = distractorCandidates.reduce((sum, c) => sum + c.count, 0);
        let roll = Math.random() * totalWeight;
        let chosenIndex = distractorCandidates.length - 1;

        for (let i = 0; i < distractorCandidates.length; i++) {
            roll -= distractorCandidates[i].count;
            if (roll <= 0) {
                chosenIndex = i;
                break;
            }
        }

        selectedDistractors.push(distractorCandidates[chosenIndex]);
        distractorCandidates.splice(chosenIndex, 1);
    }

    const finalOptions = [targetOption, ...selectedDistractors];

    // Uniform shuffle of grid button positions (1–4)
    for (let i = finalOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalOptions[i], finalOptions[j]] = [finalOptions[j], finalOptions[i]];
    }

    return finalOptions;
}

export async function evaluateAnswer(inputStr, guessedRank, taxon, signal = null) {
    let { isCorrect, matchedNameDisplay, normalizedInput } = checkExactMatch(inputStr, taxon);
    let pointsEarned = 0;
    let networkError = false;

    if (guessedRank !== 'species') {
        isCorrect = false;
    } else if (isCorrect) {
        pointsEarned = getPointsForRank('species');
    }

    if (!isCorrect) {
        try {
            const searchData = await api.checkTaxonSearch(inputStr, guessedRank, signal);
            
            if (searchData.results && searchData.results.length > 0) {
                for (const result of searchData.results) {
                    const isExactMatch = result.id === taxon.id;
                    const isGuessChildOfTarget = result.ancestor_ids && result.ancestor_ids.includes(taxon.id);
                    const isGuessParentOfTarget = taxon.ancestor_ids && taxon.ancestor_ids.includes(result.id);
                    
                    const validNames = [
                        normalize(result.name),
                        normalize(result.preferred_common_name),
                        normalize(result.matched_term)
                    ];
                    
                    if (validNames.includes(normalizedInput)) {
                        if (guessedRank === 'species') {
                            if (isExactMatch || isGuessChildOfTarget || isGuessParentOfTarget) {
                                isCorrect = true;
                                pointsEarned = getPointsForRank('species');
                                matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                                break;
                            }
                        } else if (isGuessParentOfTarget) {
                            isCorrect = true;
                            pointsEarned = getPointsForRank(guessedRank);
                            matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                            break;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("API check failed. Relying on local strict match.");
            networkError = true;
        }
    }

    return { isCorrect, pointsEarned, matchedNameDisplay, networkError };
}
