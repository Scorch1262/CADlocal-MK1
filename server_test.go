package main

import (
	"encoding/hex"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPBKDF2Vectors(t *testing.T) {
	got := hex.EncodeToString(pbkdf2SHA256([]byte("password"), []byte("salt"), 1, 20))
	if got != "120fb6cffcf8b32c43e7225256c4f837a86548c9" {
		t.Fatalf("iter1: %s", got)
	}
	got = hex.EncodeToString(pbkdf2SHA256([]byte("password"), []byte("salt"), 2, 20))
	if got != "ae4d0c95af6b46d32d0adff928f06dd02a303f8e" {
		t.Fatalf("iter2: %s", got)
	}
}

func TestFlow(t *testing.T) {
	dir := t.TempDir()
	app, err := newApp(dir)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(app.routes())
	defer srv.Close()
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	do := func(method, path, body string) (int, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}

	if code, _ := do("GET", "/api/files", ""); code != 401 {
		t.Fatalf("ohne Login erwartet 401, war %d", code)
	}
	if code, _ := do("GET", "/", ""); code != 302 {
		t.Fatalf("/ ohne Login erwartet Redirect, war %d", code)
	}
	if code, b := do("POST", "/api/register", `{"username":"anna","password":"geheim1"}`); code != 200 {
		t.Fatalf("register: %d %s", code, b)
	}
	if code, _ := do("POST", "/api/register", `{"username":"ANNA","password":"geheim1"}`); code != 400 {
		t.Fatalf("doppelter Nutzer erwartet 400, war %d", code)
	}
	if code, _ := do("POST", "/api/login", `{"username":"anna","password":"falsch"}`); code != 401 {
		t.Fatalf("falsches Kennwort erwartet 401, war %d", code)
	}
	if code, b := do("POST", "/api/login", `{"username":"anna","password":"geheim1"}`); code != 200 {
		t.Fatalf("login: %d %s", code, b)
	}
	// users.json: Name im Klartext, Kennwort nur als Hash
	raw, _ := os.ReadFile(filepath.Join(dir, "users.json"))
	if !strings.Contains(string(raw), `"anna"`) || strings.Contains(string(raw), "geheim1") || !strings.Contains(string(raw), "pbkdf2-sha256") {
		t.Fatalf("users.json unerwartet: %s", raw)
	}
	if st, err := os.Stat(filepath.Join(dir, "daten", "anna")); err != nil || !st.IsDir() {
		t.Fatal("Nutzerordner fehlt")
	}
	body := `{"format":"BrowserCAD","version":1,"type":"assembly","name":"x"}`
	if code, b := do("PUT", "/api/files/test.ccad", body); code != 200 {
		t.Fatalf("put: %d %s", code, b)
	}
	if code, _ := do("PUT", "/api/files/..%2Fevil.ccad", body); code == 200 {
		t.Fatal("Pfad-Trick wurde akzeptiert")
	}
	if code, _ := do("PUT", "/api/files/test2.ccad", `{"foo":1}`); code != 400 {
		t.Fatal("Fremdformat wurde akzeptiert")
	}
	code, list := do("GET", "/api/files", "")
	if code != 200 || !strings.Contains(list, `"test.ccad"`) || !strings.Contains(list, `"assembly"`) {
		t.Fatalf("list: %d %s", code, list)
	}
	if code, b := do("GET", "/api/files/test.ccad", ""); code != 200 || b != body {
		t.Fatalf("get: %d %s", code, b)
	}
	if code, _ := do("GET", "/api/download-all", ""); code != 200 {
		t.Fatal("zip")
	}
	if code, _ := do("DELETE", "/api/files/test.ccad", ""); code != 200 {
		t.Fatal("delete")
	}
	if code, _ := do("POST", "/api/logout", ""); code != 200 {
		t.Fatal("logout")
	}
	if code, _ := do("GET", "/api/files", ""); code != 401 {
		t.Fatal("nach Logout muss 401 kommen")
	}
}

// Nutzerverwaltung: Rollen, Kennwort zurücksetzen, Löschen, Absicherung
func TestAdmin(t *testing.T) {
	dir := t.TempDir()
	app, err := newApp(dir)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(app.routes())
	defer srv.Close()
	newClient := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	do := func(c *http.Client, method, path, body string) (int, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	admin, bob := newClient(), newClient()

	do(admin, "POST", "/api/register", `{"username":"chef","password":"geheim1"}`) // erster Nutzer = Admin
	do(admin, "POST", "/api/login", `{"username":"chef","password":"geheim1"}`)
	do(bob, "POST", "/api/register", `{"username":"bob","password":"bobbob1"}`)
	do(bob, "POST", "/api/login", `{"username":"bob","password":"bobbob1"}`)

	if _, b := do(admin, "GET", "/api/me", ""); !strings.Contains(b, `"admin":true`) {
		t.Fatalf("erster Nutzer muss Admin sein: %s", b)
	}
	if _, b := do(bob, "GET", "/api/me", ""); !strings.Contains(b, `"admin":false`) {
		t.Fatalf("zweiter Nutzer darf kein Admin sein: %s", b)
	}
	if code, _ := do(bob, "GET", "/api/admin/users", ""); code != 403 {
		t.Fatalf("Nicht-Admin muss 403 bekommen, war %d", code)
	}
	if code, _ := do(bob, "GET", "/admin", ""); code != 403 {
		t.Fatalf("Nicht-Admin darf /admin nicht sehen, war %d", code)
	}
	if code, _ := do(admin, "GET", "/admin", ""); code != 200 {
		t.Fatalf("Admin-Seite: %d", code)
	}
	if code, b := do(admin, "GET", "/api/admin/users", ""); code != 200 || !strings.Contains(b, `"bob"`) || !strings.Contains(b, `"chef"`) {
		t.Fatalf("Nutzerliste: %d %s", code, b)
	}

	// Admin legt Nutzer mit generiertem Kennwort an
	code, b := do(admin, "POST", "/api/admin/users", `{"username":"clara","password":""}`)
	if code != 200 || !strings.Contains(b, `"password":"`) || strings.Contains(b, `"password":""`) {
		t.Fatalf("generiertes Kennwort fehlt: %d %s", code, b)
	}

	// Kennwort zurücksetzen: altes ungültig, Sitzung von bob beendet, neues gültig
	if code, b := do(admin, "POST", "/api/admin/users/bob/password", `{"password":"neuesPW9"}`); code != 200 {
		t.Fatalf("reset: %d %s", code, b)
	}
	if code, _ := do(bob, "GET", "/api/me", ""); code != 401 {
		t.Fatal("Sitzung von bob muss nach dem Zurücksetzen beendet sein")
	}
	if code, _ := do(bob, "POST", "/api/login", `{"username":"bob","password":"bobbob1"}`); code != 401 {
		t.Fatal("altes Kennwort darf nicht mehr gehen")
	}
	if code, _ := do(bob, "POST", "/api/login", `{"username":"bob","password":"neuesPW9"}`); code != 200 {
		t.Fatal("neues Kennwort muss gehen")
	}
	if code, _ := do(admin, "POST", "/api/admin/users/bob/password", `{"password":"abc"}`); code != 400 {
		t.Fatal("zu kurzes Kennwort muss abgelehnt werden")
	}

	// eigenes Kennwort ändern
	if code, _ := do(bob, "POST", "/api/account/password", `{"old":"falsch","new":"nochmal77"}`); code != 403 {
		t.Fatal("falsches altes Kennwort muss abgelehnt werden")
	}
	if code, _ := do(bob, "POST", "/api/account/password", `{"old":"neuesPW9","new":"nochmal77"}`); code != 200 {
		t.Fatal("Kennwort ändern")
	}
	if code, _ := do(bob, "GET", "/api/me", ""); code != 200 {
		t.Fatal("eigene Sitzung bleibt nach Kennwortänderung bestehen")
	}

	// Rollen und Absicherung des letzten Admins
	if code, _ := do(admin, "POST", "/api/admin/users/chef/admin", `{"admin":false}`); code != 400 {
		t.Fatal("letzter Admin darf nicht herabgestuft werden")
	}
	if code, _ := do(admin, "DELETE", "/api/admin/users/chef", ""); code != 400 {
		t.Fatal("eigenes Konto darf nicht gelöscht werden")
	}
	if code, _ := do(admin, "POST", "/api/admin/users/bob/admin", `{"admin":true}`); code != 200 {
		t.Fatal("bob zum Admin machen")
	}

	// Löschen: Daten werden verschoben, nicht vernichtet
	do(bob, "PUT", "/api/files/x.ccad", `{"format":"BrowserCAD","version":1,"type":"part"}`)
	if code, _ := do(admin, "DELETE", "/api/admin/users/bob", ""); code != 200 {
		t.Fatal("bob löschen")
	}
	if _, err := os.Stat(filepath.Join(dir, "daten", "bob")); err == nil {
		t.Fatal("Ordner von bob müsste verschoben sein")
	}
	ents, _ := os.ReadDir(filepath.Join(dir, "daten", "_geloescht"))
	if len(ents) != 1 {
		t.Fatal("Ordner muss unter daten/_geloescht liegen")
	}
	if code, _ := do(bob, "GET", "/api/me", ""); code != 401 {
		t.Fatal("Sitzung des gelöschten Nutzers muss beendet sein")
	}

	// Es gibt keinen Endpunkt zum Beenden des Programms mehr
	if code, _ := do(admin, "POST", "/api/shutdown", ""); code == 200 {
		t.Fatal("/api/shutdown darf nicht existieren")
	}

	// Migration: Nutzerdatei ohne Admin -> erster Nutzer wird Admin
	dir2 := t.TempDir()
	os.WriteFile(filepath.Join(dir2, "users.json"), []byte(`{"users":[{"username":"alt","password":"x","created":"","folder":"daten/alt"}]}`), 0o600)
	app2, err := newApp(dir2)
	if err != nil || !app2.users.isAdmin("alt") {
		t.Fatal("Migration: erster Nutzer muss Admin werden")
	}
}
