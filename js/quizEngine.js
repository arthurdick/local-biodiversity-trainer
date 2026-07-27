import * as api from './api.js';

export function normalize(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getQuestionThumbnail(q, currentMediaArray) {
    const photoMedia = currentMediaArray.find(m => m.type === 'photo');
    if (photoMedia) return photoMedia.mediumUrl;
    if (q.observation && q.observation.photos && q.observation.photos.length > 0) {
        return q.observation.photos[0].url.replace('square', 'medium');
    }
    return '';
}

/**
 * Standardizes logarithmic weighting mathematically to reduce API skewing.
 */
export function getLogWeight(count) {
    return Math.log10(Math.max(1, count) + 1);
}

export function generateWeightedPool(dataResults, questionLimit, preventDuplicates, isRarityMode = false) {
    const questions = [];
    
    // Create a working pool using the standardized weights
    let availablePool = dataResults.map(r => {
        const count = Math.max(1, r.count || 1); 
        const logWeight = getLogWeight(count);
        
        return {
            taxon: r.taxon,
            weight: isRarityMode ? (1 / logWeight) : logWeight
        };
    });
    
    if (preventDuplicates) {
        const limit = Math.min(questionLimit, availablePool.length);

        let totalWeight = availablePool.reduce((sum, item) => sum + item.weight, 0);

        for (let i = 0; i < limit; i++) {
            if (totalWeight <= 0) break;

            const roll = Math.random() * totalWeight;
            let runningWeight = 0, selectedIndex = availablePool.length - 1;

            for (let j = 0; j < availablePool.length; j++) {
                runningWeight += availablePool[j].weight;
                if (roll <= runningWeight) {
                    selectedIndex = j;
                    break;
                }
            }

            const selectedItem = availablePool[selectedIndex];
            questions.push({ taxon: selectedItem.taxon, observation: null });
            
            totalWeight -= selectedItem.weight;
            availablePool.splice(selectedIndex, 1);
        }
    } else {
        let totalWeights = 0;
        const weightedPool = availablePool.map(item => {
            totalWeights += item.weight;
            return { taxon: item.taxon, threshold: totalWeights };
        });

        for (let i = 0; i < questionLimit; i++) {
            const roll = Math.random() * totalWeights;
            const selected = weightedPool.find(item => roll <= item.threshold) || weightedPool[weightedPool.length - 1];
            questions.push({ taxon: selected.taxon, observation: null });
        }
    }
    return questions;
}

/**
 * Deep paging algorithm for Rare Expert mode.
 */
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

/**
 * Selects a rare taxon utilizing inverse logarithmic weighting for isolated small pools.
 */
export function selectRareTaxonFromPool(validResults) {
    let totalWeight = 0;
    const weightedResults = validResults.map(r => {
        const count = Math.max(1, r.count || 1);
        const logWeight = getLogWeight(count);
        const weight = 1 / logWeight;
        totalWeight += weight;
        return { item: r, threshold: totalWeight };
    });
    
    const roll = Math.random() * totalWeight;
    return (weightedResults.find(w => roll <= w.threshold) || weightedResults[weightedResults.length - 1]).item;
}

export function checkExactMatch(inputStr, taxon) {
    const normalizedInput = normalize(inputStr);
    const matchSci = normalizedInput === normalize(taxon.name);
    const matchCommon = taxon.preferred_common_name ? (normalizedInput === normalize(taxon.preferred_common_name)) : false;
    
    if (matchSci || matchCommon) {
        return { isCorrect: true, matchedNameDisplay: matchSci ? taxon.name : taxon.preferred_common_name, normalizedInput };
    }
    return { isCorrect: false, matchedNameDisplay: "", normalizedInput };
}

export function getPointsForRank(rank) {
    switch(rank) {
        case 'species': return 10;
        case 'genus': return 7;
        case 'family': return 4;
        case 'order': return 2;
        default: return 0;
    }
}

/**
 * Orchestrates local strict matching, API ancestor validation, and offline Genus fallback.
 */
export async function evaluateAnswer(inputStr, guessedRank, taxon, isOnline, getTimeoutFn) {
    let { isCorrect, matchedNameDisplay, normalizedInput } = checkExactMatch(inputStr, taxon);
    let pointsEarned = 0;

    if (guessedRank !== 'species') {
        isCorrect = false;
    } else if (isCorrect) {
        pointsEarned = getPointsForRank('species');
    }

    if (!isCorrect && isOnline) {
        try {
            const controller = new AbortController();
            const timeoutMs = getTimeoutFn ? getTimeoutFn() : 10000;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            
            const searchData = await api.checkTaxonSearch(inputStr, guessedRank, controller.signal);
            clearTimeout(timeoutId);
            
            if (searchData.results && searchData.results.length > 0) {
                for (const result of searchData.results) {
                    const isExactMatch = result.id === taxon.id;
                    const isGuessChildOfTarget = result.ancestor_ids && result.ancestor_ids.includes(taxon.id);
                    const isGuessParentOfTarget = taxon.ancestor_ids && taxon.ancestor_ids.includes(result.id);
                    
                    const validNames = [normalize(result.name), normalize(result.preferred_common_name), normalize(result.matched_term)];
                    
                    if (validNames.includes(normalizedInput)) {
                        if (guessedRank === 'species' && (isExactMatch || isGuessChildOfTarget || isGuessParentOfTarget)) {
                            isCorrect = true;
                            pointsEarned = getPointsForRank('species');
                            matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                            break;
                        } else if (guessedRank !== 'species' && isGuessParentOfTarget) {
                            isCorrect = true;
                            pointsEarned = getPointsForRank(guessedRank);
                            matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                            break;
                        }
                    }
                }
            }
        } catch (error) { console.warn("API check failed. Relying on local strict match."); }
    }

    // Offline / Local Genus Fallback
    if (!isCorrect && guessedRank === 'genus' && taxon.name) {
        const actualGenus = normalize(taxon.name.split(' ')[0]);
        if (normalizedInput === actualGenus) {
            isCorrect = true;
            pointsEarned = getPointsForRank('genus');
            matchedNameDisplay = taxon.name.split(' ')[0];
        }
    }

    return { isCorrect, pointsEarned, matchedNameDisplay };
}
