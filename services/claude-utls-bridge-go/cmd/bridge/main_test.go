package main

import (
	"net/http"
	"testing"
)

func TestSkipHopByHopHeader(t *testing.T) {
	tests := map[string]bool{
		"Connection":        true,
		"Transfer-Encoding": true,
		"Upgrade":           true,
		"Content-Type":      false,
		"Authorization":     false,
	}
	for key, expected := range tests {
		if actual := skipHopByHopHeader(key); actual != expected {
			t.Fatalf("header=%s expected=%v actual=%v", key, expected, actual)
		}
	}
}

func TestCopyRequestHeaders(t *testing.T) {
	src := http.Header{}
	src.Set("Authorization", "Bearer token")
	src.Set("Content-Type", "application/json")
	src.Set("Connection", "keep-alive")
	src.Set("Host", "example.com")
	src.Set("Content-Length", "123")

	dst := http.Header{}
	copyRequestHeaders(dst, src)

	if got := dst.Get("Authorization"); got != "Bearer token" {
		t.Fatalf("Authorization not copied: %q", got)
	}
	if got := dst.Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type not copied: %q", got)
	}
	if got := dst.Get("Connection"); got != "" {
		t.Fatalf("Connection should be removed: %q", got)
	}
	if got := dst.Get("Host"); got != "" {
		t.Fatalf("Host should be removed: %q", got)
	}
	if got := dst.Get("Content-Length"); got != "" {
		t.Fatalf("Content-Length should be removed: %q", got)
	}
}
