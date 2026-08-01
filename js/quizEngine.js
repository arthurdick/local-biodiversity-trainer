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
 * Generates 4 smart multiple choice options (1 target + 3 distractors weighted by confusion count).
 * @param {Object} targetTaxon - The target correct taxon.
 * @param {Array} questionsPool - Active quiz questions pool for fallback distractors.
 * @param {Array} apiSimilarResults - Results array from iNaturalist /identifications/similar_species.
 * @returns {Array<{id: number, displayName: string, isCorrect: boolean}>} Shuffled options.
 */
export function generateMultipleChoiceOptions(targetTaxon, questionsPool = [], apiSimilarResults = []) {
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

    // 1. Sort API similar results by count (highest real-world confusion first)
    if (Array.isArray(apiSimilarResults) && apiSimilarResults.length > 0) {
        const sortedByCount = [...apiSimilarResults]
            .filter(item => item.taxon && item.taxon.id !== targetId)
            .sort((a, b) => (b.count || 0) - (a.count || 0));

        // Take up to the top 8 most frequently confused lookalikes
        const topLookalikes = sortedByCount.slice(0, 8);

        topLookalikes.forEach(item => {
            distractorCandidates.push({
                id: item.taxon.id,
                displayName: formatName(item.taxon),
                isCorrect: false
            });
        });
    }

    // 2. Fallback A: Same iconic taxon from the active pool (e.g., Birds with Birds)
    if (distractorCandidates.length < 3 && Array.isArray(questionsPool)) {
        const existingIds = new Set(distractorCandidates.map(d => d.id));
        
        questionsPool.forEach(q => {
            const t = q.observation?.taxon || q.taxon;
            if (t && t.id !== targetId && !existingIds.has(t.id)) {
                if (t.iconic_taxon_name && t.iconic_taxon_name === targetTaxon.iconic_taxon_name) {
                    distractorCandidates.push({
                        id: t.id,
                        displayName: formatName(t),
                        isCorrect: false
                    });
                    existingIds.add(t.id);
                }
            }
        });
    }

    // 3. Fallback B: Any remaining species from the active pool
    if (distractorCandidates.length < 3 && Array.isArray(questionsPool)) {
        const existingIds = new Set(distractorCandidates.map(d => d.id));

        questionsPool.forEach(q => {
            const t = q.observation?.taxon || q.taxon;
            if (t && t.id !== targetId && !existingIds.has(t.id)) {
                distractorCandidates.push({
                    id: t.id,
                    displayName: formatName(t),
                    isCorrect: false
                });
                existingIds.add(t.id);
            }
        });
    }

    // Randomly pick 3 items from our top candidate pool
    for (let i = distractorCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [distractorCandidates[i], distractorCandidates[j]] = [distractorCandidates[j], distractorCandidates[i]];
    }

    const selectedDistractors = distractorCandidates.slice(0, 3);
    const finalOptions = [targetOption, ...selectedDistractors];

    // Final shuffle of option positions (so target isn't always slot #1)
    for (let i = finalOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalOptions[i], finalOptions[j]] = [finalOptions[j], finalOptions[i]];
    }

    return finalOptions;
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
