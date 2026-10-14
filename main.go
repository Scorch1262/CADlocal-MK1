// BrowserCAD – stellt ein browserbasiertes CAD-Programm im Netzwerk bereit.
// Alle Daten (config.json, users.json, daten/<nutzer>/...) liegen neben der ausführbaren Datei.
package main

import (
	"bufio"
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed all:web
var webEmbed embed.FS

var version = "dev"

// Config wird beim ersten Start neben der exe als config.json angelegt.
type Config struct {
	Port              int                 `json:"port"`
	HTTPS             bool                `json:"https"`
	HTTPSPort         int                 `json:"httpsPort"`
	OpenBrowser       bool                `json:"openBrowser"`
	AllowRegistration bool                `json:"allowRegistration"`
	RegistrationCode  string              `json:"registrationCode"`
	Converters        map[string][]string `json:"converters"`
}

func defaultConfig() Config {
	return Config{
		Port: 8080, HTTPS: true, HTTPSPort: 8443, OpenBrowser: true,
		AllowRegistration: true, RegistrationCode: "",
		Converters: map[string][]string{},
	}
}

// App hält Pfade, Konfiguration und Zustand.
type App struct {
	baseDir string
	cfg     Config
	users   *UserStore
	sess    *Sessions
	web     fs.FS
}

func baseDir() string {
	exe, err := os.Executable()
	if err != nil {
		d, _ := os.Getwd()
		return d
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r
	}
	dir := filepath.Dir(exe)
	// "go run": Binary liegt im Temp-Verzeichnis -> Arbeitsverzeichnis benutzen
	if strings.Contains(exe, "go-build") {
		d, _ := os.Getwd()
		return d
	}
	// macOS-App: .../BrowserCAD.app/Contents/MacOS/BrowserCAD -> Ordner neben der .app
	if runtime.GOOS == "darwin" && strings.Contains(dir, ".app/Contents/MacOS") {
		for i := 0; i < 3; i++ {
			dir = filepath.Dir(dir)
		}
	}
	return dir
}

func loadConfig(dir string) Config {
	cfg := defaultConfig()
	p := filepath.Join(dir, "config.json")
	b, err := os.ReadFile(p)
	if err != nil {
		out, _ := json.MarshalIndent(cfg, "", "  ")
		_ = os.WriteFile(p, out, 0o644)
		return cfg
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		log.Printf("config.json fehlerhaft (%v) – Standardwerte werden benutzt", err)
		return defaultConfig()
	}
	if cfg.Converters == nil {
		cfg.Converters = map[string][]string{}
	}
	return cfg
}

func newApp(dir string) (*App, error) {
	sub, err := fs.Sub(webEmbed, "web")
	if err != nil {
		return nil, err
	}
	a := &App{baseDir: dir, cfg: loadConfig(dir), sess: newSessions(), web: sub}
	a.users, err = loadUsers(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dir, "daten"), 0o755); err != nil {
		return nil, err
	}
	return a, nil
}

var mimeTypes = map[string]string{
	".html": "text/html; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".mjs":  "text/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg":  "image/svg+xml",
	".png":  "image/png",
	".ico":  "image/x-icon",
	".wasm": "application/wasm",
	".txt":  "text/plain; charset=utf-8",
}

// serveEmbedded liefert eine Datei aus dem eingebetteten web-Ordner.
func (a *App) serveEmbedded(w http.ResponseWriter, r *http.Request, name string, cache string) {
	name = path.Clean("/" + name)[1:]
	// vorab gzip-komprimierte Dateien (WASM) transparent ausliefern
	if f, err := a.web.Open(name + ".gz"); err == nil {
		defer f.Close()
		w.Header().Set("Content-Type", mimeTypes[strings.ToLower(path.Ext(name))])
		w.Header().Set("Cache-Control", cache)
		w.Header().Set("Vary", "Accept-Encoding")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			if st, err := f.Stat(); err == nil {
				w.Header().Set("Content-Length", fmt.Sprint(st.Size()))
			}
			_, _ = io.Copy(w, f)
			return
		}
		zr, err := gzip.NewReader(f)
		if err != nil {
			http.Error(w, "defekte Datei", 500)
			return
		}
		_, _ = io.Copy(w, zr)
		return
	}
	f, err := a.web.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	if ct, ok := mimeTypes[strings.ToLower(path.Ext(name))]; ok {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", cache)
	if rs, ok := f.(io.ReadSeeker); ok {
		http.ServeContent(w, r, name, time.Time{}, rs)
		return
	}
	_, _ = io.Copy(w, f)
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()

	// --- Seiten ---
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := a.currentUser(r); !ok {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		a.serveEmbedded(w, r, "app.html", "no-cache")
	})
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := a.currentUser(r); ok {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		a.serveEmbedded(w, r, "login.html", "no-cache")
	})
	mux.HandleFunc("GET /register", func(w http.ResponseWriter, r *http.Request) {
		a.serveEmbedded(w, r, "register.html", "no-cache")
	})

	// --- statische Dateien ---
	mux.HandleFunc("GET /assets/", func(w http.ResponseWriter, r *http.Request) {
		a.serveEmbedded(w, r, r.URL.Path, "no-cache")
	})
	mux.HandleFunc("GET /vendor/", func(w http.ResponseWriter, r *http.Request) {
		// der CAD-Kern ist nur für angemeldete Nutzer
		if _, ok := a.currentUser(r); !ok {
			http.Error(w, "Anmeldung erforderlich", http.StatusUnauthorized)
			return
		}
		a.serveEmbedded(w, r, r.URL.Path, "public, max-age=86400")
	})
	mux.HandleFunc("GET /app/", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := a.currentUser(r); !ok {
			http.Error(w, "Anmeldung erforderlich", http.StatusUnauthorized)
			return
		}
		a.serveEmbedded(w, r, r.URL.Path, "no-cache")
	})

	// --- API ---
	a.apiRoutes(mux)

	return securityHeaders(mux)
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		h.ServeHTTP(w, r)
	})
}

// localIPs liefert alle IPv4-Adressen dieses Rechners (für die Start-Meldung und das Zertifikat).
func localIPs() []net.IP {
	var out []net.IP
	ifs, _ := net.Interfaces()
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, ad := range addrs {
			if ipn, ok := ad.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLoopback() {
				out = append(out, ipn.IP)
			}
		}
	}
	return out
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func waitForEnter() {
	fmt.Println("\nEnter drücken zum Beenden ...")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

func main() {
	dir := baseDir()
	app, err := newApp(dir)
	if err != nil {
		fmt.Println("Start fehlgeschlagen:", err)
		waitForEnter()
		os.Exit(1)
	}
	handler := app.routes()

	fmt.Printf("\n=== BrowserCAD %s ===\n", version)
	fmt.Println("Datenordner:", dir)
	httpAddr := fmt.Sprintf(":%d", app.cfg.Port)
	errCh := make(chan error, 2)

	go func() { errCh <- http.ListenAndServe(httpAddr, handler) }()
	fmt.Printf("\nHTTP:   http://localhost:%d\n", app.cfg.Port)
	for _, ip := range localIPs() {
		fmt.Printf("        http://%s:%d   (andere Rechner im Netzwerk)\n", ip, app.cfg.Port)
	}

	if app.cfg.HTTPS {
		certFile, keyFile, err := ensureCert(dir)
		if err != nil {
			fmt.Println("HTTPS nicht verfügbar:", err)
		} else {
			go func() {
				errCh <- http.ListenAndServeTLS(fmt.Sprintf(":%d", app.cfg.HTTPSPort), certFile, keyFile, handler)
			}()
			fmt.Printf("\nHTTPS:  https://localhost:%d  (selbstsigniertes Zertifikat – Browserwarnung einmalig bestätigen)\n", app.cfg.HTTPSPort)
			for _, ip := range localIPs() {
				fmt.Printf("        https://%s:%d\n", ip, app.cfg.HTTPSPort)
			}
			fmt.Println("        Die SpaceMouse (WebHID) funktioniert nur über HTTPS oder über http://localhost.")
		}
	}
	fmt.Println("\nBeenden mit Strg+C (oder im Programm: Datei > Server beenden, nur lokal).")

	if app.cfg.OpenBrowser {
		go func() {
			time.Sleep(700 * time.Millisecond)
			openBrowser(fmt.Sprintf("http://localhost:%d", app.cfg.Port))
		}()
	}
	if err := <-errCh; err != nil {
		fmt.Println("\nServerfehler:", err)
		waitForEnter()
		os.Exit(1)
	}
}
