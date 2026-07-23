# Local Biodiversity Trainer

An interactive web application designed to help users test and improve their identification skills for local wildlife and plant species, weighted by real-world observation frequencies.

🚀 **Live App:** [https://arthurdick.github.io/local-biodiversity-trainer/](https://arthurdick.github.io/local-biodiversity-trainer/)

---

## Key Features

* **Location-Based Quizzing:** Practice identifying species specific to any region by searching for a city, park, or country, or by using exact GPS coordinates.
* **Taxon Filtering:** Focus your training on specific groups of organisms, such as Birds, Fungi, or Owls.
* **Media Type Selection:** Choose to train with photo observations, audio sound clips, or both.
* **Seasonality & Month Filtering:** Filter species observations by specific months of the year to practice seasonal species identification.
* **Customizable Difficulty & Length:** Select pool sizes ranging from the top 15 species to top 500 expert pools, and pick quiz lengths between 5 and 50 questions.
* **Real-World Frequency Sampling:** Questions are weighted according to actual observation counts in the selected area.
* **Unified Media Carousel & Context:** Cycle through observation photos and playable audio recordings per question, complete with date observed, attribution, and map location links.
* **Smart Answer Checking:** Supports common names, scientific names, and taxonomical aliases validated against iNaturalist taxonomy, complete with direct educational links in feedback.
* **Missed Species Review:** Review missed questions at the end of each session with visual/audio cards and direct links to iNaturalist and Wikipedia.
* **Preference Memory:** Automatically remembers your chosen location, taxon, media options, seasonal months, and quiz settings between sessions using local storage.

---

## How to Use

1. **Configure Setup:** Choose your target location, optional taxon filter, preferred media types (photos/sounds), month filters, pool size, and question count.
2. **Take the Quiz:** Examine research-grade observation images or listen to recorded audio clips fetched dynamically.
3. **Submit Answers:** Type common or scientific names to check your answer against the database.
4. **Review:** Analyze missed species at the end of the session with direct references to strengthen your local ecological knowledge.

---

## 🛠️ Local Development

Because this project relies on **ES Modules** (`type="module"`), standard browser security rules (CORS) prevent loading the JavaScript files directly via the `file://` protocol. The app must be served over a local HTTP server.

### Quick Start with Python

Python comes pre-installed on most macOS and Linux systems. You can spin up a lightweight, zero-dependency local server directly from your terminal:

1. **Navigate to the project root:**
```bash
cd /path/to/local-biodiversity-trainer

```

2. **Start the HTTP server:**
```bash
python3 -m http.server 8000

```

3. **Open in your browser:**
Go to [http://localhost:8000](http://localhost:8000) to test the app.

---

## Data Attribution

Species data, sound clips, and photos are provided by [iNaturalist](https://www.inaturalist.org). This application is an independent open-source project and is not officially affiliated with iNaturalist.

