package player

import (
	"os"
	"testing"
)

func TestNewShmTransport_Robustness(t *testing.T) {
	name := "streamai-test-shm"
	path := "/dev/shm/" + name
	size := 1024

	// 1. Assicuriamoci che non esista
	os.Remove(path)

	// 2. Creiamolo manualmente per simulare un file orfano
	f, err := os.Create(path)
	if err != nil {
		t.Skipf("Impossibile creare file in /dev/shm: %v", err)
	}
	f.Close()

	// 3. Chiamiamo newShmTransport. Prima falliva con O_EXCL.
	transport, err := newShmTransport(name, size)
	if err != nil {
		t.Fatalf("newShmTransport fallito con file preesistente: %v", err)
	}
	defer transport.Close()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("Il file SHM non esiste dopo la creazione")
	}

	// 4. Test scrittura/lettura basica
	data := []byte("hello world")
	n, err := transport.Write(data)
	if err != nil {
		t.Fatalf("Write fallita: %v", err)
	}
	if n != len(data) {
		t.Fatalf("n = %d, want %d", n, len(data))
	}

	for i, b := range data {
		if transport.data[i] != b {
			t.Fatalf("data[%d] = %b, want %b", i, transport.data[i], b)
		}
	}
}
