package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func apiErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (a *App) auth(h func(w http.ResponseWriter, r *http.Request, user string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.currentUser(r)
		if !ok {
			apiErr(w, http.StatusUnauthorized, "Nicht angemeldet")
			return
		}
		h(w, r, u)
	}
}

func (a *App) setCookie(w http.ResponseWriter, r *http.Request, tok string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: r.TLS != nil, MaxAge: maxAge,
	})
}

// gültiger Dateiname: Buchstaben/Ziffern/Leerzeichen/_-.() und Endung .ccad
var fileRe = regexp.MustCompile(`^[\p{L}\p{N} _.()\-]{1,80}\.ccad$`)
var typeRe = regexp.MustCompile(`"type"\s*:\s*"(part|assembly)"`)

func isLoopback(r *http.Request) bool {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func (a *App) apiRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, r *http.Request) {
		var exts []string
		for k := range a.cfg.Converters {
			exts = append(exts, k)
		}
		sort.Strings(exts)
		writeJSON(w, 200, map[string]any{
			"version": version, "registration": a.cfg.AllowRegistration,
			"codeRequired": a.cfg.RegistrationCode != "", "converters": exts,
			"local": isLoopback(r),
		})
	})

	mux.HandleFunc("POST /api/register", func(w http.ResponseWriter, r *http.Request) {
		if !a.cfg.AllowRegistration {
			apiErr(w, 403, "Registrierung ist deaktiviert (config.json)")
			return
		}
		var in struct{ Username, Password, Code string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			apiErr(w, 400, "Ungültige Anfrage")
			return
		}
		if a.cfg.RegistrationCode != "" && in.Code != a.cfg.RegistrationCode {
			apiErr(w, 403, "Registrierungscode falsch")
			return
		}
		if err := a.createUser(strings.TrimSpace(in.Username), in.Password); err != nil {
			apiErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if a.sess.blocked(ip) {
			apiErr(w, 429, "Zu viele Fehlversuche – bitte 5 Minuten warten")
			return
		}
		var in struct{ Username, Password string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			apiErr(w, 400, "Ungültige Anfrage")
			return
		}
		u, ok := a.verifyUser(strings.TrimSpace(in.Username), in.Password)
		if !ok {
			a.sess.fail(ip)
			time.Sleep(600 * time.Millisecond)
			apiErr(w, 401, "Nutzername oder Kennwort falsch")
			return
		}
		a.setCookie(w, r, a.sess.create(u.Username), 86400)
		writeJSON(w, 200, map[string]any{"ok": true, "username": u.Username})
	})

	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(cookieName); err == nil {
			a.sess.destroy(c.Value)
		}
		a.setCookie(w, r, "", -1)
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/me", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		writeJSON(w, 200, map[string]any{"username": user})
	}))

	// ----- Dateien des Nutzers -----
	mux.HandleFunc("GET /api/files", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		dir := a.userDir(user)
		ents, _ := os.ReadDir(dir)
		type item struct {
			Name     string `json:"name"`
			Type     string `json:"type"`
			Size     int64  `json:"size"`
			Modified string `json:"modified"`
		}
		out := []item{}
		for _, e := range ents {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".ccad") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			typ := "part"
			if f, err := os.Open(filepath.Join(dir, e.Name())); err == nil {
				buf := make([]byte, 1024)
				n, _ := f.Read(buf)
				f.Close()
				if m := typeRe.FindSubmatch(buf[:n]); m != nil {
					typ = string(m[1])
				}
			}
			out = append(out, item{e.Name(), typ, info.Size(), info.ModTime().Format(time.RFC3339)})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
		writeJSON(w, 200, out)
	}))

	mux.HandleFunc("GET /api/files/{name}", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		name := r.PathValue("name")
		if !fileRe.MatchString(name) {
			apiErr(w, 400, "Ungültiger Dateiname")
			return
		}
		f, err := os.Open(filepath.Join(a.userDir(user), name))
		if err != nil {
			apiErr(w, 404, "Datei nicht gefunden")
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.Copy(w, f)
	}))

	mux.HandleFunc("PUT /api/files/{name}", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		name := r.PathValue("name")
		if !fileRe.MatchString(name) {
			apiErr(w, 400, "Ungültiger Dateiname (erlaubt: Buchstaben, Ziffern, Leerzeichen, _ - . ( ) und Endung .ccad)")
			return
		}
		dir := a.userDir(user)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			apiErr(w, 500, err.Error())
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<29) // 512 MB
		tmp, err := os.CreateTemp(dir, ".upload-*")
		if err != nil {
			apiErr(w, 500, err.Error())
			return
		}
		_, cerr := io.Copy(tmp, r.Body)
		tmp.Close()
		if cerr != nil {
			os.Remove(tmp.Name())
			apiErr(w, 400, "Übertragung fehlgeschlagen: "+cerr.Error())
			return
		}
		// Kontrolle: muss gültiges JSON mit format=BrowserCAD sein (nur den Anfang prüfen)
		if f, err := os.Open(tmp.Name()); err == nil {
			buf := make([]byte, 512)
			n, _ := f.Read(buf)
			f.Close()
			if !strings.Contains(string(buf[:n]), `"BrowserCAD"`) {
				os.Remove(tmp.Name())
				apiErr(w, 400, "Keine BrowserCAD-Datei")
				return
			}
		}
		dst := filepath.Join(dir, name)
		if _, err := os.Stat(dst); err == nil {
			_ = os.Rename(dst, dst+".bak") // letzte Version als .bak behalten
		}
		if err := os.Rename(tmp.Name(), dst); err != nil {
			os.Remove(tmp.Name())
			apiErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "saved": time.Now().Format(time.RFC3339)})
	}))

	mux.HandleFunc("DELETE /api/files/{name}", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		name := r.PathValue("name")
		if !fileRe.MatchString(name) {
			apiErr(w, 400, "Ungültiger Dateiname")
			return
		}
		p := filepath.Join(a.userDir(user), name)
		if err := os.Remove(p); err != nil {
			apiErr(w, 404, "Datei nicht gefunden")
			return
		}
		_ = os.Remove(p + ".bak")
		writeJSON(w, 200, map[string]any{"ok": true})
	}))

	// alle Dateien des Nutzers als ZIP
	mux.HandleFunc("GET /api/download-all", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		dir := a.userDir(user)
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="BrowserCAD-`+strings.ToLower(user)+`.zip"`)
		zw := zip.NewWriter(w)
		defer zw.Close()
		ents, _ := os.ReadDir(dir)
		for _, e := range ents {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".ccad") {
				continue
			}
			f, err := os.Open(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			zf, err := zw.Create(e.Name())
			if err == nil {
				_, _ = io.Copy(zf, f)
			}
			f.Close()
		}
	}))

	// optionale externe Konverter (Creo / SolidWorks -> STEP), in config.json konfiguriert
	mux.HandleFunc("POST /api/convert", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		ext := strings.ToLower(filepath.Ext(r.URL.Query().Get("name")))
		tpl, ok := a.cfg.Converters[ext]
		if !ok || len(tpl) == 0 {
			apiErr(w, 501, "Für "+ext+" ist kein Konverter in config.json eingerichtet")
			return
		}
		tmpDir, err := os.MkdirTemp("", "bcad-conv-")
		if err != nil {
			apiErr(w, 500, err.Error())
			return
		}
		defer os.RemoveAll(tmpDir)
		in := filepath.Join(tmpDir, "input"+ext)
		out := filepath.Join(tmpDir, "output.step")
		f, err := os.Create(in)
		if err != nil {
			apiErr(w, 500, err.Error())
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<29)
		if _, err := io.Copy(f, r.Body); err != nil {
			f.Close()
			apiErr(w, 400, err.Error())
			return
		}
		f.Close()
		args := make([]string, len(tpl))
		for i, s := range tpl {
			s = strings.ReplaceAll(s, "{in}", in)
			args[i] = strings.ReplaceAll(s, "{out}", out)
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		if outb, err := cmd.CombinedOutput(); err != nil {
			msg := string(outb)
			if len(msg) > 400 {
				msg = msg[:400]
			}
			apiErr(w, 500, "Konverter fehlgeschlagen: "+err.Error()+" "+msg)
			return
		}
		b, err := os.ReadFile(out)
		if err != nil {
			apiErr(w, 500, "Konverter hat keine Ausgabedatei erzeugt")
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(b)
	}))

	// Server beenden – nur von diesem Rechner aus
	mux.HandleFunc("POST /api/shutdown", a.auth(func(w http.ResponseWriter, r *http.Request, user string) {
		if !isLoopback(r) {
			apiErr(w, 403, "Nur lokal erlaubt")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
		go func() { time.Sleep(300 * time.Millisecond); os.Exit(0) }()
	}))
}
