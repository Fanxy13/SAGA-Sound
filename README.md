# SagaSound

Soundclouds Humble Upgrade – SoundCloud im Browser mit eigenem Layout, eigener Bibliothek und eigenen Empfehlungen.

## Online stellen (GitHub Pages)

Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
Nach ein, zwei Minuten läuft die App unter <https://fanxy13.github.io/SAGA-Sound/>.

Lokal: `python3 -m http.server 8000` → <http://localhost:8000>.
(Direkt per Doppelklick auf `index.html` geht nicht, weil die App ES-Module nutzt.)

## Technik

- **Wiedergabe:** offizielles [SoundCloud HTML5 Widget](https://developers.soundcloud.com/docs/api/html5-widget) als unsichtbarer Player, gesteuert über die Widget-API. Kein API-Key, kein Server.
- **Profil & Links:** werden über SoundCloud-oEmbed aufgelöst (`soundcloud.com/name`, Track-, Playlist- und Künstler-Links).
- **Daten:** Likes, Playlists, Verlauf und Cache liegen nur im Browser (`localStorage`). Backup/Import im Profil-Menü.
- **Empfehlungen:** laufen komplett lokal. Likes, Plays, Skips und gefolgte Künstler ergeben Affinitäten zu Künstlern, Genres und Tags. Kandidaten kommen aus den Uploads und Likes deiner Lieblingskünstler; die Liste wird nach Ähnlichkeit, Frische und Popularität gewichtet und so gemischt, dass sich Künstler nicht wiederholen. Daraus entstehen *Für dich*, *Saga Mix* (täglich neu), Genre-Mixes, *Weil du X hörst*, *Neu für dich*, *Wiederentdecken* und das endlose Radio am Ende der Warteschlange.

## Tastatur

| Taste | Aktion |
| --- | --- |
| `Leertaste` | Play / Pause |
| `←` `→` | 10 s zurück / vor |
| `Shift` + `←` `→` | vorheriger / nächster Track |
| `↑` `↓` | Lautstärke |
| `L` `S` `R` `M` | Like, Zufall, Wiederholen, Stumm |
| `Q` `F` `/` | Warteschlange, Vollbild, Suche |

## Hinweise

- Werbung: SagaSound blendet selbst keine Werbung ein. Bei Tracks, deren Künstler Werbung aktiviert haben, kann SoundCloud im offiziellen Widget vorab einen kurzen Spot abspielen – den blockiert SagaSound nicht. Komplett werbefrei geht offiziell nur mit SoundCloud Go.
- Go+-Tracks können im Widget nur als 30-Sekunden-Vorschau laufen (`30s`-Label).
- Manche Browser (vor allem iOS Safari) starten Audio in einem iframe erst nach einem Tipp direkt in den Player. Dann blendet SagaSound kurz den offiziellen Player ein.
- SoundCloud erlaubt laut Nutzungsbedingungen ohne Zustimmung keine Dienste, die das SoundCloud-Angebot mit ihren Playern nachbauen. SagaSound ist deshalb als privates Projekt gedacht.

Schriften: [Geist](https://vercel.com/font) (SIL OFL, siehe `fonts/OFL.txt`). Icons: [Lucide](https://lucide.dev) (ISC).
