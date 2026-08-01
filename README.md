# Local Biodiversity Trainer

An interactive web application designed to help users test and improve their identification skills for local wildlife and plant species, weighted by real-world observation frequencies.

🚀 **Live App:** [https://arthurdick.github.io/local-biodiversity-trainer/](https://arthurdick.github.io/local-biodiversity-trainer/)

---

## Key Features

* **Location-Based Quizzing:** Practice identifying species specific to any region by searching for a city, park, or country, or by using exact GPS/custom coordinates with customizable search radiuses. Handles obscured or private location geoprivacy by falling back gracefully to text-based map links.
* **iNaturalist Life List Import:** Enter an iNaturalist username to filter quiz pools:
  * **Observed Species Only:** Test on species you’ve already logged in real life to reinforce memory.
  * **Unobserved Species Only:** Test strictly on species in your target region that you HAVEN'T logged yet to target "lifers".
* **Multiple Choice & Smart Distractor Engine:** Toggle between free-text answer inputs and an accessible 4-option multiple choice grid. Distractor options are dynamically fetched and weighted by real-world community confusion counts so options present authentic identification challenges. Includes desktop keyboard shortcuts (`1`–`4`).
* **Taxon Filtering & Target Badges:** Focus training on specific groups of organisms (e.g., Birds, Fungi, Owls) with target taxon autocomplete, and toggle an iconic taxon badge overlay (e.g., *Aves*, *Insecta*) on active quiz cards.
* **Establishment Status Filtering:** Filter species selection by establishment status to train specifically on **Native**, **Introduced**, or **Endemic** species, or include all taxa.
* **Weighting Method Selection:** Select between **Linear** weighting (reflecting true relative observation counts) and **Logarithmic** weighting (flattening relative counts so common species do not completely dominate the pool).
* **Media Type Selection:** Train using high-resolution observation photos, recorded audio clips, or both.
* **Interactive Full-Resolution Photo Zoom:** Zoom into observation photos using an accessible modal dialog (`<dialog>`), complete with click-centered panning and keyboard controls.
* **Seasonality & Month Filtering:** Select specific months (Jan to Dec) or use quick preset buttons (**Spring**, **Summer**, **Autumn**, **Winter**, **Select All**, **Clear**) to practice identifying seasonal species in your local ecosystem.
* **Customizable Difficulty & Length:** Choose pool sizes from Top 15 (Beginner) to Top 500 (Hard), or test yourself in **Expert Mode** sampling directly from all regional observations. Select quiz lengths of 5, 10, 20, or 50 questions.
* **Duplicate Species Prevention:** Enforce unique species per session or allow repeating frequent species based on observation count thresholds.
* **Rare Mode & Deep-Paging Algorithm:** Invert frequency weighting to focus on infrequent local species. In Expert Rare Mode, a log-weighted deep-paging algorithm dynamically samples species down to page 200 of regional observation data.
* **Spoiler-Free Field Notes (Hints):** Reveal observation notes as hints with an automatic redaction system backed by a curated stop-word dictionary (`js/stopwords.js`) that strips scientific names, binomial epithets, common names, possessive variants, and name fragments without over-redacting generic prose.
* **Smart Answer Checking & Partial Credit:** Supports common names, scientific names, and taxonomical aliases validated against iNaturalist taxonomy. In free-text mode, users can select a taxonomic rank (Species, Genus, Family, or Order) for their guess, earning partial credit (up to 1.0 points for Species down to 0.2 for Order) if the guess is a valid ancestor of the target.
* **Performance, Throttling & Network Reliability:**
  * **Global Request Throttler:** Enforces a minimum 1000ms delay between API requests to prevent HTTP 429 rate limit errors, with full support for cancelable requests via `AbortController`.
  * **JIT Runtime Cache:** Prefetches upcoming question observations seamlessly in the background.
  * **Connection-Aware Network Timeouts:** Automatically detects slow connections (2G/3G) and extends network request timeouts up to 30 seconds. Includes a manual retry mechanism if network calls fail.
* **Accessibility & Screen Reader Support:** Centralized screen reader live-region announcer (`aria-live` polite/assertive), accessible modal dialogs (`<dialog>`), high-contrast focus rings, and full keyboard navigation across form controls, quiz cards, and multiple choice options.
* **Missed & Partial Credit Species Review:** Review missed or partially correct species at the end of each session with thumbnail cards, audio indicators, guess comparison, and direct links to iNaturalist taxon and observation pages.
* **Preference Memory:** Automatically remembers location, taxon, user life list settings, media options, seasonality filters, weighting methods, establishment status, quiz difficulty, and multiple choice preferences between sessions using `localStorage`.

---

## 🌿 Ecological Context & Synanthropic Bias

This application weights species selection based on community observation data from iNaturalist. Users should keep in mind that **observation frequency does not equal true ecological abundance**:

* **Synanthropic Bias:** iNaturalist observations are heavily concentrated in cities, suburbs, parks, and roadside trails. Species that thrive alongside humans (synanthropic taxa, such as urban weeds, human-adapted birds/insects, and invasive species) are logged far more often than shy, deep-forest, or wildland native species.
* **Observer Accessibility:** High observation counts often reflect where humans travel rather than true regional species density.
* **Rare Mode Limitation:** Enabling Rare Mode samples species from the lower tail of observation counts. However, because those infrequent observations are still generated by human observers, **Rare Mode is not a fix for synanthropic or spatial bias**, as it simply samples less frequently logged records within human-accessible areas.

---

## How to Use

1. **Configure Setup:** Choose your target location, optional target taxon, optional iNaturalist user life list filter, establishment status filter, weighting method (Linear/Logarithmic), media types (photos/sounds), month filters (via manual selection or seasonal presets), pool size, question limit, and gameplay toggles (Multiple Choice mode, Rare Mode, unique species, iconic taxon badge).
2. **Take the Quiz:** Examine research-grade observation images or listen to recorded audio clips fetched dynamically. Use the full-resolution image zoom or toggle field note hints if needed.
3. **Submit Answers:** In Multiple Choice mode, click or press `1`–`4` to select the species. In Free-Text mode, select your confidence rank (Species, Genus, Family, Order) and type common or scientific names to check your answer against the database.
4. **Review:** Analyze missed or partially correct species at the end of the session with direct references to strengthen your local ecological knowledge.

---

## 🛠️ Project Architecture & Local Development

This project is built using vanilla JavaScript with modular **ES Modules** (`type="module"`), state isolation, and DOM rendering.

### Architecture Highlights
* `js/state.js`: Single source of truth state store with deep freezing (`Object.freeze`) in development mode, immutable state updates, and custom event dispatching.
* `js/api.js`: Low-level wrapper for the iNaturalist v2 API featuring a custom `RequestQueue` throttler, parameter builders, user autocomplete, taxa verification, similar species lookups, dynamic network timeout calculation, and license file fetching.
* `js/observationService.js`: Prefetching pipeline, connection-aware network timeout calculator, and deep-paging selection manager.
* `js/quizEngine.js`: Core domain algorithms for frequency weighting, deep page calculations, real-world lookalike distractor ranking, exact/alias taxonomic matching, answer evaluation, and hint spoiler redaction.
* `js/stopwords.js`: Curated stop-word dictionary filtering generic grammar, observer terms, and environmental descriptors to prevent over-redacting field notes.
* `js/ui.js`: Rendering layer mapping state updates directly to DOM nodes using standard DOM methods, screen reader live-region announcements, option skeleton states, and hyperlinked TASL media attributions.
* `js/app.js`: Application entry point tying state subscribers, event listeners, keyboard shortcut handlers (`1`–`4`), user preferences, autocomplete controllers, and modal dialog handlers together.

### Quick Start with Python

Because this project relies on ES Modules, browser CORS security rules require serving the application over an HTTP server rather than opening `index.html` directly via `file://`.

Python comes pre-installed on most macOS and Linux systems. You can spin up a lightweight, zero-dependency local server directly from your terminal:

1. **Navigate to the project root:**
`cd /path/to/local-biodiversity-trainer`

2. **Start the HTTP server:**
`python3 -m http.server 8000`

3. **Open in your browser:**
Go to [http://localhost:8000](http://localhost:8000) to test the app.

---

## Data Attribution

Species data, sound clips, and photos are provided by [iNaturalist](https://www.inaturalist.org). This application is an independent open-source project and is not officially affiliated with iNaturalist.
