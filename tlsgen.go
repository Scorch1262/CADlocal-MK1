package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// ensureCert legt neben der exe ein selbstsigniertes Zertifikat an (cert.pem / key.pem) und erneuert es,
// wenn sich die IP-Adressen des Rechners geändert haben. HTTPS wird für WebHID (SpaceMouse) im Netzwerk benötigt.
func ensureCert(dir string) (string, string, error) {
	certFile := filepath.Join(dir, "cert.pem")
	keyFile := filepath.Join(dir, "key.pem")
	ips := append([]net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, localIPs()...)

	if pair, err := tls.LoadX509KeyPair(certFile, keyFile); err == nil && len(pair.Certificate) > 0 {
		if c, err := x509.ParseCertificate(pair.Certificate[0]); err == nil && time.Now().Before(c.NotAfter.Add(-24*time.Hour)) && coversAll(c, ips) {
			return certFile, keyFile, nil
		}
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	host, _ := os.Hostname()
	names := []string{"localhost"}
	if host != "" {
		names = append(names, host)
	}
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "BrowserCAD", Organization: []string{"BrowserCAD"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              names,
		IPAddresses:           ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	kb, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return "", "", err
	}
	if err := os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600); err != nil {
		return "", "", err
	}
	return certFile, keyFile, nil
}

func coversAll(c *x509.Certificate, ips []net.IP) bool {
	for _, ip := range ips {
		found := false
		for _, cip := range c.IPAddresses {
			if cip.Equal(ip) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
