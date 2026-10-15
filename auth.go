package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------- PBKDF2-HMAC-SHA256 (Standardbibliothek-only) ----------

func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hLen := prf.Size()
	blocks := (keyLen + hLen - 1) / hLen
	dk := make([]byte, 0, blocks*hLen)
	u := make([]byte, hLen)
	for block := 1; block <= blocks; block++ {
		prf.Reset()
		prf.Write(salt)
		prf.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		dk = prf.Sum(dk)
		t := dk[len(dk)-hLen:]
		copy(u, t)
		for n := 2; n <= iter; n++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for x := range u {
				t[x] ^= u[x]
			}
		}
	}
	return dk[:keyLen]
}

const pbkdfIter = 150000

func hashPassword(pw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	h := pbkdf2SHA256([]byte(pw), salt, pbkdfIter, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", pbkdfIter, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(h))
}

func checkPassword(pw, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got := pbkdf2SHA256([]byte(pw), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ---------- Nutzerdatei (users.json, Klartext außer dem Kennwort-Hash) ----------

type User struct {
	Username  string `json:"username"`
	Password  string `json:"password"` // nur der Hash, nie das Klartext-Kennwort
	Admin     bool   `json:"admin"`
	Created   string `json:"created"`
	LastLogin string `json:"lastLogin,omitempty"`
	Folder    string `json:"folder"`
}

type UserStore struct {
	mu   sync.Mutex
	path string
	list []User
}

func loadUsers(dir string) (*UserStore, error) {
	s := &UserStore{path: filepath.Join(dir, "users.json")}
	b, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return nil, err
	}
	var f struct {
		Users []User `json:"users"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("users.json fehlerhaft: %w", err)
	}
	s.list = f.Users
	// Migration / Sicherheitsnetz: mindestens ein Administrator muss existieren
	if len(s.list) > 0 {
		has := false
		for _, u := range s.list {
			has = has || u.Admin
		}
		if !has {
			s.list[0].Admin = true
			_ = s.saveLocked()
		}
	}
	return s, nil
}

func (s *UserStore) saveLocked() error {
	out, err := json.MarshalIndent(struct {
		Users []User `json:"users"`
	}{s.list}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *UserStore) find(name string) (User, bool) {
	for _, u := range s.list {
		if strings.EqualFold(u.Username, name) {
			return u, true
		}
	}
	return User{}, false
}

var userRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)

func (a *App) createUser(name, pw string) error {
	return a.createUserRole(name, pw, false)
}

// createUserRole legt einen Nutzer an. Der allererste Nutzer wird immer Administrator.
func (a *App) createUserRole(name, pw string, admin bool) error {
	if !userRe.MatchString(name) {
		return errors.New("Nutzername: 3–32 Zeichen (Buchstaben, Ziffern, _ . -)")
	}
	if len([]rune(pw)) < 6 {
		return errors.New("Kennwort muss mindestens 6 Zeichen haben")
	}
	s := a.users
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.find(name); ok {
		return errors.New("Nutzername ist bereits vergeben")
	}
	folder := filepath.Join("daten", strings.ToLower(name))
	if err := os.MkdirAll(filepath.Join(a.baseDir, folder), 0o755); err != nil {
		return err
	}
	if len(s.list) == 0 {
		admin = true
	}
	s.list = append(s.list, User{Username: name, Password: hashPassword(pw), Admin: admin, Created: time.Now().Format(time.RFC3339), Folder: filepath.ToSlash(folder)})
	return s.saveLocked()
}

func validPassword(pw string) error {
	if len([]rune(pw)) < 6 {
		return errors.New("Kennwort muss mindestens 6 Zeichen haben")
	}
	return nil
}

func (s *UserStore) indexLocked(name string) int {
	for i, u := range s.list {
		if strings.EqualFold(u.Username, name) {
			return i
		}
	}
	return -1
}

func (s *UserStore) adminCountLocked() int {
	n := 0
	for _, u := range s.list {
		if u.Admin {
			n++
		}
	}
	return n
}

func (s *UserStore) isAdmin(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if i := s.indexLocked(name); i >= 0 {
		return s.list[i].Admin
	}
	return false
}

func (s *UserStore) setPassword(name, pw string) error {
	if err := validPassword(pw); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.indexLocked(name)
	if i < 0 {
		return errors.New("Nutzer nicht gefunden")
	}
	s.list[i].Password = hashPassword(pw)
	return s.saveLocked()
}

func (s *UserStore) setAdmin(name string, admin bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.indexLocked(name)
	if i < 0 {
		return errors.New("Nutzer nicht gefunden")
	}
	if !admin && s.list[i].Admin && s.adminCountLocked() <= 1 {
		return errors.New("Der letzte Administrator kann nicht herabgestuft werden")
	}
	s.list[i].Admin = admin
	return s.saveLocked()
}

func (s *UserStore) touchLogin(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if i := s.indexLocked(name); i >= 0 {
		s.list[i].LastLogin = time.Now().Format(time.RFC3339)
		_ = s.saveLocked()
	}
}

// remove löscht den Eintrag (Daten werden vom Aufrufer behandelt)
func (s *UserStore) remove(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.indexLocked(name)
	if i < 0 {
		return errors.New("Nutzer nicht gefunden")
	}
	if s.list[i].Admin && s.adminCountLocked() <= 1 {
		return errors.New("Der letzte Administrator kann nicht gelöscht werden")
	}
	s.list = append(s.list[:i], s.list[i+1:]...)
	return s.saveLocked()
}

func (s *UserStore) snapshot() []User {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]User, len(s.list))
	copy(out, s.list)
	return out
}

// Zufallskennwort ohne leicht verwechselbare Zeichen
func generatePassword() string {
	const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func (a *App) verifyUser(name, pw string) (User, bool) {
	a.users.mu.Lock()
	u, ok := a.users.find(name)
	a.users.mu.Unlock()
	if !ok {
		// Zeitverhalten angleichen
		checkPassword(pw, "pbkdf2-sha256$150000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
		return User{}, false
	}
	return u, checkPassword(pw, u.Password)
}

func (a *App) userDir(username string) string {
	return filepath.Join(a.baseDir, "daten", strings.ToLower(username))
}

// ---------- Sitzungen ----------

type session struct {
	user string
	exp  time.Time
}

type Sessions struct {
	mu    sync.Mutex
	m     map[string]session
	fails map[string][]time.Time
}

func newSessions() *Sessions {
	return &Sessions{m: map[string]session{}, fails: map[string][]time.Time{}}
}

const cookieName = "bcad_session"

func (s *Sessions) create(user string) string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	s.mu.Lock()
	s.m[tok] = session{user: user, exp: time.Now().Add(24 * time.Hour)}
	s.mu.Unlock()
	return tok
}

func (s *Sessions) get(tok string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	se, ok := s.m[tok]
	if !ok || time.Now().After(se.exp) {
		delete(s.m, tok)
		return "", false
	}
	se.exp = time.Now().Add(24 * time.Hour) // gleitend verlängern
	s.m[tok] = se
	return se.user, true
}

// destroyUser beendet alle Sitzungen eines Nutzers (außer der Sitzung except)
func (s *Sessions) destroyUser(name, except string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for t, se := range s.m {
		if strings.EqualFold(se.user, name) && t != except {
			delete(s.m, t)
		}
	}
}

func (s *Sessions) destroy(tok string) {
	s.mu.Lock()
	delete(s.m, tok)
	s.mu.Unlock()
}

// einfache Bremse gegen Kennwort-Raten: 8 Fehlversuche je IP in 5 Minuten
func (s *Sessions) blocked(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := time.Now().Add(-5 * time.Minute)
	var keep []time.Time
	for _, t := range s.fails[ip] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	s.fails[ip] = keep
	return len(keep) >= 8
}

func (s *Sessions) fail(ip string) {
	s.mu.Lock()
	s.fails[ip] = append(s.fails[ip], time.Now())
	s.mu.Unlock()
}

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func (a *App) currentUser(r *http.Request) (string, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return "", false
	}
	return a.sess.get(c.Value)
}
