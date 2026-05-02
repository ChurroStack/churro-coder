package main

import (
	"runtime"
	"strings"
	"testing"
)

func TestVersionString(t *testing.T) {
	s := versionString()
	if !strings.Contains(s, version) {
		t.Errorf("versionString() = %q, want it to contain %q", s, version)
	}
	if !strings.Contains(s, runtime.GOOS) {
		t.Errorf("versionString() = %q, want it to contain GOOS %q", s, runtime.GOOS)
	}
	if !strings.Contains(s, runtime.GOARCH) {
		t.Errorf("versionString() = %q, want it to contain GOARCH %q", s, runtime.GOARCH)
	}
}
