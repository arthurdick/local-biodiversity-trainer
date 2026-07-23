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

export function generateWeightedPool(dataResults, questionLimit, preventDuplicates) {
    const questions = [];
    
    if (preventDuplicates) {
        let availablePool = dataResults.map(r => ({ taxon: r.taxon, count: r.count }));
        const limit = Math.min(questionLimit, availablePool.length);

        for (let i = 0; i < limit; i++) {
            const totalWeight = availablePool.reduce((sum, item) => sum + item.count, 0);
            if (totalWeight <= 0) break;

            const roll = Math.random() * totalWeight;
            let runningWeight = 0, selectedIndex = 0;

            for (let j = 0; j < availablePool.length; j++) {
                runningWeight += availablePool[j].count;
                if (roll <= runningWeight) {
                    selectedIndex = j;
                    break;
                }
            }

            questions.push({ taxon: availablePool[selectedIndex].taxon, observation: null });
            availablePool.splice(selectedIndex, 1);
        }
    } else {
        let totalWeights = 0;
        const weightedPool = dataResults.map(r => {
            totalWeights += r.count;
            return { taxon: r.taxon, threshold: totalWeights };
        });

        for (let i = 0; i < questionLimit; i++) {
            const roll = Math.random() * totalWeights;
            const selected = weightedPool.find(item => roll <= item.threshold);
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
