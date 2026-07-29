/**
 * js/stopwords.js
 * Curated stop-word dictionary for ecological field note spoiler redaction.
 */

// 1. Comprehensive English Grammar & Functional Words
const FUNCTIONAL_STOP_WORDS = [
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 
    'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 
    'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 
    'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 
    'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 
    'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 
    'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 
    'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 
    'just', 'don', 'should', 'now'
];

// 2. Common Observer Verbs, States & Adjectives
const OBSERVER_TERMS = [
    'saw', 'see', 'seen', 'look', 'looking', 'looked', 'find', 'found', 'finding', 
    'spot', 'spotted', 'spotting', 'catch', 'caught', 'catching', 'observe', 'observed', 
    'observing', 'hear', 'heard', 'hearing', 'listen', 'listened', 'listening', 'fly', 
    'flying', 'flew', 'swim', 'swimming', 'swam', 'run', 'running', 'ran', 'walk', 
    'walking', 'walked', 'sit', 'sitting', 'sat', 'perch', 'perched', 'perching', 'eat', 
    'eating', 'ate', 'feed', 'feeding', 'fed', 'sing', 'singing', 'sang', 'call', 
    'calling', 'called', 'make', 'making', 'made', 'take', 'taking', 'took', 'get', 
    'getting', 'got', 'crawling', 'climbing', 'jumping', 'resting', 'dead', 'alive',
    'roadkill', 'fast', 'slow', 'quick', 'loud', 'quiet', 'silent', 'noisy', 'near', 
    'far', 'close', 'high', 'low'
];

// 3. Base Colors, Generic Patterns, & Shapes 
const DESCRIPTORS = [
    'black', 'blue', 'brown', 'golden', 'gray', 'grey', 'green', 'orange', 'pink', 
    'purple', 'red', 'silver', 'white', 'yellow', 'dark', 'light', 'pale', 'bright', 
    'dull', 'clear', 'striped', 'banded', 'ringed', 'barred', 'mottled', 'speckled', 
    'tufted', 'bald', 'smooth', 'rough', 'large', 'small', 'huge', 'tiny', 'great', 
    'lesser', 'least', 'little', 'big', 'short', 'long', 'thick', 'thin', 'wide', 
    'narrow', 'broad', 'slender', 'stout', 'round', 'flat', 'sharp', 'blunt', 'wet', 'dry'
];

// 4. Geographic, Regional & Directional Indicators
const GEOGRAPHIC_DESCRIPTORS = [
    'american', 'african', 'asian', 'european', 'pacific', 'atlantic', 'arctic', 
    'north', 'northern', 'south', 'southern', 'east', 'eastern', 'west', 'western', 
    'central', 'coastal', 'alpine', 'mountain', 'island', 'common', 'rare', 'wild', 
    'domestic', 'feral', 'native', 'introduced', 'invasive', 'alien', 'endemic', 
    'world', 'new', 'old', 'canada', 'canadian', 'mexican', 'australian', 'indian', 
    'siberian', 'eurasian', 'oriental'
];

// 5. Environmental Nouns, Habitats, Weather & Time
const HABITAT_TIME_DESCRIPTORS = [
    'tree', 'wood', 'woods', 'forest', 'field', 'grass', 'marsh', 'swamp', 'river', 
    'creek', 'stream', 'lake', 'pond', 'sea', 'ocean', 'sand', 'rock', 'mud', 'dirt', 
    'soil', 'water', 'park', 'garden', 'house', 'yard', 'barn', 'city', 'town', 'road', 
    'street', 'trail', 'path', 'beach', 'shore', 'coast', 'cliff', 'cave', 'meadow', 
    'pasture', 'bog', 'fen', 'spring', 'pool', 'puddle', 'ditch', 'bridge', 'wall', 
    'fence', 'window', 'bush', 'shrub', 'vine', 'weed', 'plant', 'leaf', 'leaves', 
    'flower', 'root', 'stem', 'branch', 'twig', 'bark', 'log', 'stump', 'ground', 'earth', 
    'stone', 'pebble', 'boulder', 'hill', 'ridge', 'valley', 'canyon', 'desert', 
    'prairie', 'plains', 'mound', 'dune', 'bank', 'ravine', 'gorge', 'bluff', 'ledge', 
    'canopy', 'understory', 'brush', 'thicket', 'scrub', 'bramble', 'sun', 'cloud', 
    'rain', 'snow', 'ice', 'wind', 'sky', 'weather', 'day', 'night', 'morning', 'evening', 
    'afternoon', 'dusk', 'dawn', 'summer', 'autumn', 'fall', 'winter', 'month', 'year', 
    'today', 'yesterday', 'tomorrow'
];

// 6. Broad Taxonomic Groups & Animal Traces
const BROAD_TAXA_AND_TRACES = [
    'bird', 'mammal', 'animal', 'insect', 'bug', 'spider', 'reptile', 'snake', 'lizard', 
    'frog', 'toad', 'fish', 'moss', 'fern', 'lichen', 'fungus', 'mushroom', 'nest', 
    'web', 'burrow', 'den', 'hive', 'track', 'tracks', 'scat', 'feather', 'shell', 'hole'
];

// 7. Generic Parts & Human Materials
const PARTS_AND_MATERIALS = [
    'stick', 'trunk', 'thorn', 'seed', 'nut', 'berry', 'cone', 'eye', 'head', 'leg', 
    'wing', 'tail', 'bone', 'fur', 'hair', 'skin', 'scale', 'glass', 'concrete', 
    'pavement', 'asphalt', 'pipe', 'brick', 'gravel', 'dust', 'ash', 'building', 
    'roof', 'pole', 'wire', 'line', 'sign', 'car', 'boat', 'trash', 'garbage'
];

// Combine into an immutable, O(1) fast lookup Set
const STOP_WORDS_SET = Object.freeze(new Set([
    ...FUNCTIONAL_STOP_WORDS,
    ...OBSERVER_TERMS,
    ...DESCRIPTORS,
    ...GEOGRAPHIC_DESCRIPTORS,
    ...HABITAT_TIME_DESCRIPTORS,
    ...BROAD_TAXA_AND_TRACES,
    ...PARTS_AND_MATERIALS
]));

/**
 * Checks whether a given word is a stop-word or generic descriptor.
 * @param {string} word - The term to test.
 * @returns {boolean}
 */
export function isStopWord(word) {
    if (!word || typeof word !== 'string') return false;
    const cleanWord = word.toLowerCase().trim().replace(/[^\w]/g, '');
    return STOP_WORDS_SET.has(cleanWord);
}

/**
 * Filters an array of name fragments, stripping out short words and stop-words.
 * @param {string[]} fragments - Raw token fragments from a species name.
 * @param {number} [minLength=3] - Minimum length threshold for tokens.
 * @returns {string[]} Filtered, meaningful fragments for redaction.
 */
export function filterSignificantFragments(fragments, minLength = 3) {
    if (!Array.isArray(fragments)) return [];
    
    return fragments.filter(fragment => {
        const clean = fragment.toLowerCase().trim().replace(/[^\w]/g, '');
        return clean.length >= minLength && !isStopWord(clean);
    });
}
