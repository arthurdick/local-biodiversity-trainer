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

export function generateWeightedPool(dataResults, questionLimit, preventDuplicates, isRarityMode = false) {
    const questions = [];
    
    // Create a working pool with our adjusted weights
    let availablePool = dataResults.map(r => {
        // Enforce a minimum count of 1 to prevent log10(1) = 0 and subsequent Infinity issues
        const count = Math.max(1, r.count || 1); 
        // Apply logarithmic transformation to smooth extreme skews
        const logWeight = Math.log10(count + 1);
        
        return {
            taxon: r.taxon,
            // If rarity mode is on, invert the log weight
            weight: isRarityMode ? (1 / logWeight) : logWeight
        };
    });
    
    if (preventDuplicates) {
        const limit = Math.min(questionLimit, availablePool.length);

        let totalWeight = availablePool.reduce((sum, item) => sum + item.weight, 0);

        for (let i = 0; i < limit; i++) {
            if (totalWeight <= 0) break;

            const roll = Math.random() * totalWeight;
            // Default selectedIndex to the last item to prevent floating-point rounding errors defaulting to index 0
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
            // Fallback to the last item to handle potential float rounding precision issues
            const selected = weightedPool.find(item => roll <= item.threshold) || weightedPool[weightedPool.length - 1];
            questions.push({ taxon: selected.taxon, observation: null });
        }
    }
    return questions;
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
