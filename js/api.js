const API_BASE = 'https://api.inaturalist.org/v2';

/**
 * Appends URL query parameters for media requirements.
 */
const appendMediaParams = (params, wantsPhotos, wantsSounds) => {
    if (wantsPhotos && !wantsSounds) {
        params.set('photos', 'true');
    } else if (!wantsPhotos && wantsSounds) {
        params.set('sounds', 'true');
    }
};

/**
 * Appends URL query parameters for seasonality filtering.
 */
const appendMonthParams = (params, months) => {
    if (months && months.length > 0 && months.length < 12) {
        params.set('month', months.join(','));
    }
};

export const fetchPlaces = async (query, signal) => {
    const params = new URLSearchParams({
        q: query,
        fields: '(id:!t,name:!t,display_name:!t)'
    });

    const res = await fetch(`${API_BASE}/places?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch places');
    return res.json();
};

export const fetchTaxaAutocomplete = async (query, signal) => {
    const params = new URLSearchParams({
        q: query,
        fields: '(id:!t,name:!t,preferred_common_name:!t)'
    });

    const res = await fetch(`${API_BASE}/taxa/autocomplete?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch taxa');
    return res.json();
};

export const fetchSpeciesPool = async ({ difficulty, wantsPhotos, wantsSounds, months, placeId, lat, lng, taxonId }, signal) => {
    const params = new URLSearchParams({
        quality_grade: 'research',
        captive: 'false',
        per_page: String(difficulty),
        fields: '(count:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,ancestor_ids:!t))'
    });

    appendMediaParams(params, wantsPhotos, wantsSounds);
    appendMonthParams(params, months);

    if (placeId) {
        params.set('place_id', String(placeId));
    } else if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
        params.set('radius', '10');
    }

    if (taxonId) {
        params.set('taxon_id', String(taxonId));
    }

    const res = await fetch(`${API_BASE}/observations/species_counts?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch species pool');
    return res.json();
};

export const fetchObservation = async ({ wantsPhotos, wantsSounds, months, placeId, lat, lng, difficulty, taxonId, withoutTaxonIds = [] }, signal) => {
    const params = new URLSearchParams({
        quality_grade: 'research',
        captive: 'false',
        per_page: '1',
        order_by: 'random',
        fields: '(id:!t,observed_on:!t,place_guess:!t,location:!t,taxon:(id:!t,name:!t,preferred_common_name:!t,ancestor_ids:!t),photos:(url:!t,attribution:!t),sounds:(file_url:!t,attribution:!t))'
    });

    appendMediaParams(params, wantsPhotos, wantsSounds);
    appendMonthParams(params, months);

    if (placeId) {
        params.set('place_id', String(placeId));
    } else if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
        params.set('radius', '10');
    }

    if (difficulty === 'all') {
        params.set('rank', 'species,subspecies');
        if (taxonId) params.set('taxon_id', String(taxonId));
        if (withoutTaxonIds && withoutTaxonIds.length > 0) {
            params.set('without_taxon_id', withoutTaxonIds.join(','));
        }
    } else if (taxonId) {
        params.set('taxon_id', String(taxonId));
    }

    const res = await fetch(`${API_BASE}/observations?${params}`, { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Failed to fetch observation');
    return res.json();
};

export const checkTaxonSearch = async (inputStr, guessedRank, signal) => {
    const rankQuery = guessedRank === 'species' ? 'species,subspecies' : guessedRank;
    const params = new URLSearchParams({
        q: inputStr,
        rank: rankQuery,
        is_active: 'true',
        per_page: '500',
        fields: '(id:!t,name:!t,preferred_common_name:!t,matched_term:!t,ancestor_ids:!t,rank:!t)'
    });

    const res = await fetch(`${API_BASE}/taxa?${params}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch search validation');
    return res.json();
};
