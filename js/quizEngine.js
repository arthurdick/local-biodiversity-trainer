import * as api from './api.js';

function normalize(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Strip diacritics/accents
        .toLowerCase()
        .replace(/[-—–]/g, ' ')          // Convert ALL hyphens and dashes to spaces
        .replace(/[^\p{L}\p{N}\s]/gu, '')// Strip all remaining punctuation
        .replace(/\s+/g, ' ')            // Condense spaces
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

export function generateWeightedPool(dataResults, questionLimit, preventDuplicates, isRarityMode = false, weightingMethod = 'linear') {
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

        // 1. Recalculate total weight on every iteration
        const totalWeight = availablePool.reduce((sum, item) => sum + item.weight, 0);
        if (totalWeight <= 0) break;

        // 2. Weighted random sampling
        const roll = Math.random() * totalWeight;
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
        questions.push({ taxon: selectedItem.taxon, observation: null });

        // 3. Pool depletion logic
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

/**
 * Orchestrates local strict matching and API ancestor validation.
 */
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
            // NOTE: checkTaxonSearch filters results by guessedRank at the API level:
            // - 'species' rank limits API results to species/subspecies/varieties.
            // - Higher ranks ('genus', 'family', etc.) limit API results strictly to that rank.
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
                            // Matches exact species, or subspecies/variety parents/children
                            if (isExactMatch || isGuessChildOfTarget || isGuessParentOfTarget) {
                                isCorrect = true;
                                pointsEarned = getPointsForRank('species');
                                matchedNameDisplay = result.matched_term || result.preferred_common_name || result.name;
                                break;
                            }
                        } else if (isGuessParentOfTarget) {
                            // Higher rank guesses (Genus/Family/Order) must be a valid ancestor of the target
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
