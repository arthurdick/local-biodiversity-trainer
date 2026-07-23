const API_BASE = 'https://api.inaturalist.org/v2';

export const fetchPlaces = async (query, signal) => {
    const fields = encodeURIComponent('(id:!t,name:!t,display_name:!t)');
    const res = await fetch(`${API_BASE}/places?q=${query}&fields=${fields}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch places');
    return res.json();
};

export const fetchTaxaAutocomplete = async (query, signal) => {
    const fields = encodeURIComponent('(id:!t,name:!t,preferred_common_name:!t)');
    const res = await fetch(`${API_BASE}/taxa/autocomplete?q=${query}&fields=${fields}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch taxa');
    return res.json();
};

export const fetchSpeciesPool = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch species pool');
    return res.json();
};

export const fetchObservation = async (url, signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Failed to fetch observation');
    return res.json();
};

export const checkTaxonSearch = async (inputStr, signal) => {
    const fields = encodeURIComponent('(id:!t,name:!t,preferred_common_name:!t,matched_term:!t,ancestor_ids:!t,rank:!t)');
    const url = `${API_BASE}/taxa/autocomplete?q=${encodeURIComponent(inputStr)}&is_active=true&per_page=30&fields=${fields}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Failed to fetch search validation');
    return res.json();
};
