# Local Biodiversity Trainer

An interactive web application designed to help users test and improve their identification skills for local wildlife and plant species, weighted by real-world observation frequencies.

🚀 **Live App:** [https://arthurdick.github.io/local-biodiversity-trainer/](https://arthurdick.github.io/local-biodiversity-trainer/)

---

## Key Features

* **Location-Based Quizzing:** Practice identifying species specific to any region by searching for a city, park, or country, or by using exact GPS coordinates.
* **Taxon Filtering:** Focus your training on specific groups of organisms, such as Birds, Fungi, or Owls.
* **Media Type Selection:** Choose to train with photo observations, audio sound clips, or both.
* **Seasonality & Month Filtering:** Filter species observations by specific months of the year to practice seasonal species identification.
* **Customizable Difficulty & Length:** Select pool sizes ranging from Top 15 (Beginner) to Top 500 (Hard), or test yourself in **Expert Mode** sampling directly from all regional observations. Choose quiz lengths between 5 and 50 questions.
* **Duplicate Species Prevention:** Toggle setting to enforce unique species per quiz session or allow repeating frequent species.
* **Real-World Frequency Sampling:** Questions are weighted according to actual observation counts in the selected area.
* **Unified Media Carousel & Context:** Cycle through observation photos (with full-resolution viewing) and playable audio recordings per question, complete with date observed, attribution, and map location links.
* **Smart Answer Checking & Partial Credit:** Supports common names, scientific names, and taxonomical aliases validated against iNaturalist taxonomy. Users can select a taxonomic rank (Species, Genus, Family, or Order) for their guess, earning partial credit (up to 1.0 points for Species, down to 0.2 for Order) if the guess is a valid ancestor of the target.
* **Performance & Reliability:** The app features a Just-In-Time (JIT) runtime cache for prefetching observations to ensure seamless transitions. It also calculates dynamic network timeouts based on user connection speed (detecting slow 2G/3G networks) and includes an offline fallback for Genus-level matching.
* **Missed Species Review:** Review missed questions and partial-credit answers at the end of each session with visual/audio cards and direct links to iNaturalist and Wikipedia.
* **Preference Memory:** Automatically remembers your chosen location, taxon, media options, seasonal months, duplicate preferences, and quiz settings between sessions using local storage.

---

## How to Use

1. **Configure Setup:** Choose your target location, optional taxon filter, preferred media types (photos/sounds), month filters, pool size, question count, and duplicate species preference.
2. **Take the Quiz:** Examine research-grade observation images or listen to recorded audio clips fetched dynamically.
3. **Submit Answers:** Select your confidence rank and type common or scientific names to check your answer against the database.
4. **Review:** Analyze missed or partially correct species at the end of the session with direct references to strengthen your local ecological knowledge.

---

## 🛠️ Local Development

Because this project relies on **ES Modules** (`type="module"`), standard browser security rules (CORS) prevent loading the JavaScript files directly via the `file://` protocol. The app must be served over a local HTTP server.

### Quick Start with Python

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

