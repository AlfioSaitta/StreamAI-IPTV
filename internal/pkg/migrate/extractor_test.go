package migrate

import (
	"os"
	"testing"

	"github.com/syndtr/goleveldb/leveldb"
)

func TestReadLevelDB(t *testing.T) {
	// Crea un DB temporaneo
	tmpDir, err := os.MkdirTemp("", "leveldb-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	db, err := leveldb.OpenFile(tmpDir, nil)
	if err != nil {
		t.Fatalf("Failed to open leveldb: %v", err)
	}

	testData := map[string]string{
		"key1": "value1",
		"key2": "value2",
		"\x00\x01key3": "\x01value3",
	}

	for k, v := range testData {
		if err := db.Put([]byte(k), []byte(v), nil); err != nil {
			t.Fatalf("Failed to put data: %v", err)
		}
	}
	db.Close()

	// Testa readLevelDB
	entries, err := readLevelDB(tmpDir)
	if err != nil {
		t.Fatalf("readLevelDB failed: %v", err)
	}

	if len(entries) != len(testData) {
		t.Errorf("Expected %d entries, got %d", len(testData), len(entries))
	}

	for k, v := range testData {
		if string(entries[k]) != v {
			t.Errorf("Key %s: expected %s, got %s", k, v, string(entries[k]))
		}
	}
}

func TestCleanLSValue(t *testing.T) {
	tests := []struct {
		input    []byte
		expected string
	}{
		{[]byte{0x01, 'h', 'e', 'l', 'l', 'o'}, "hello"},
		{[]byte("world"), "world"},
		{[]byte{}, ""},
	}

	for _, tt := range tests {
		got := cleanLSValue(tt.input)
		if got != tt.expected {
			t.Errorf("cleanLSValue(%v) = %v; want %v", tt.input, got, tt.expected)
		}
	}
}

func TestCleanLSKey(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"_file://\x00\x01streamai_profiles", "streamai_profiles"},
		{"\x01key", "key"},
		{"simple", "simple"},
	}

	for _, tt := range tests {
		got := cleanLSKey(tt.input)
		if got != tt.expected {
			t.Errorf("cleanLSKey(%v) = %v; want %v", tt.input, got, tt.expected)
		}
	}
}
