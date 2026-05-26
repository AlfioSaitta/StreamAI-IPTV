//go:build linux

package player

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
)

type shmTransport struct {
	name string
	file *os.File
	data []byte
	size int
}

func newShmTransport(name string, size int) (*shmTransport, error) {
	// shm_open /dev/shm/<name>
	// Nota: su Linux shm_open crea file in /dev/shm
	path := "/dev/shm/" + name
	// Rimuoviamo O_EXCL per permettere il riutilizzo o la sovrascrittura se il file esiste già (es. dopo un crash)
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, fmt.Errorf("shm_open: %w", err)
	}

	if err := f.Truncate(int64(size)); err != nil {
		f.Close()
		os.Remove(path)
		return nil, fmt.Errorf("shm truncate: %w", err)
	}

	data, err := syscall.Mmap(int(f.Fd()), 0, size, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
	if err != nil {
		f.Close()
		os.Remove(path)
		return nil, fmt.Errorf("shm mmap: %w", err)
	}

	t := &shmTransport{
		name: name,
		file: f,
		data: data,
		size: size,
	}

	runtime.SetFinalizer(t, func(tt *shmTransport) { tt.Close() })
	return t, nil
}

func (t *shmTransport) Close() error {
	if t.data != nil {
		syscall.Munmap(t.data)
		t.data = nil
	}
	if t.file != nil {
		t.file.Close()
		os.Remove("/dev/shm/" + t.name)
		t.file = nil
	}
	return nil
}

func (t *shmTransport) Write(p []byte) (n int, err error) {
	if len(p) > t.size {
		p = p[:t.size]
	}
	copy(t.data, p)
	return len(p), nil
}
