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
