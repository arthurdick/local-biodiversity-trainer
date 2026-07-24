const API_BASE = 'https://api.inaturalist.org/v2';

/**
 * Builds URL query parameters for media requirements.
 */
const getMediaParams = (wantsPhotos, wantsSounds) => {
    if (wantsPhotos && !wantsSounds) return '&photos=true';
    if (!wantsPhotos && wantsSounds) return '&sounds=true';
    return '';
};

/**
 * Builds URL query parameters for seasonality filtering.
 */
const getMonthParams = (months) => {
    if (!months || months.length === 12 || months.length === 0) return '';
    return `&month=${months.join(',')}`;
};

export const fetchPlaces = async (query, signal) => {
    const fields = encodeURIComponent('(id:!t,name:!t,display_name:!t)');
    const res = await fetch(`${API_BASE}/places?q=${encodeURIComponent(query)}&fields=${fields}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch places');
    return res.json();
};

export const fetchTaxaAutocomplete = async (query, signal) => {
    const fields = encodeURIComponent('(id:!t,name:!t,preferred_common_name:!t)');
    const res = await fetch(`${API_BASE}/taxa/autocomplete?q=${encodeURIComponent(query)}&fields=${fields}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch taxa');
    return res.json();
};

export const fetchSpeciesPool = async ({ difficulty, wantsPhotos, wantsSounds, months, placeId, lat, lng, taxonId }, signal) => {
    let url = `${API_BASE}/observations/species_counts?quality_grade=research&captive=false&per_page=${encodeURIComponent(difficulty)}${getMediaParams(wantsPhotos, wantsSounds)}${getMonthParams(months)}`;
    
    if (placeId) {
        url += `&place_id=${encodeURIComponent(placeId)}`;
    } else if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        url += `&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=10`;
    }
    
    if (taxonId) {
        url += `&taxon_id=${encodeURIComponent(taxonId)}`;
    }
    
    const fields = encodeURIComponent('(count:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,ancestor_ids:!t))');
    url += `&fields=${fields}`;

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Failed to fetch species pool');
    return res.json();
};

export const fetchObservation = async ({ wantsPhotos, wantsSounds, months, placeId, lat, lng, difficulty, taxonId, withoutTaxonIds = [] }, signal) => {
    let url = `${API_BASE}/observations?quality_grade=research&captive=false&per_page=1&order_by=random${getMediaParams(wantsPhotos, wantsSounds)}${getMonthParams(months)}`;
    
    if (placeId) {
        url += `&place_id=${encodeURIComponent(placeId)}`;
    } else if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        url += `&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=10`;
    }

    if (difficulty === 'all') {
        url += `&rank=species,subspecies`;
        if (taxonId) url += `&taxon_id=${encodeURIComponent(taxonId)}`;
        if (withoutTaxonIds && withoutTaxonIds.length > 0) {
            url += `&without_taxon_id=${withoutTaxonIds.map(id => encodeURIComponent(id)).join(',')}`;
        }
    } else if (taxonId) {
        url += `&taxon_id=${encodeURIComponent(taxonId)}`;
    }
    
    const fields = encodeURIComponent('(observed_on:!t,place_guess:!t,location:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,ancestor_ids:!t),photos:(url:!t,attribution:!t),sounds:(file_url:!t,attribution:!t))');
    url += `&fields=${fields}`;

    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Failed to fetch observation');
    return res.json();
};

export const checkTaxonSearch = async (inputStr, guessedRank, signal) => {
    const rankQuery = guessedRank === 'species' ? 'species,subspecies' : guessedRank;
    const fields = encodeURIComponent('(id:!t,name:!t,preferred_common_name:!t,matched_term:!t,ancestor_ids:!t,rank:!t)');
    
    const url = `${API_BASE}/taxa?q=${encodeURIComponent(inputStr)}&rank=${rankQuery}&is_active=true&per_page=500&fields=${fields}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Failed to fetch search validation');
    return res.json();
};
