//go:build unix

// flock(2) wrapper per Linux + macOS + *BSD. Build tag `unix` copre
// tutti i Unix-like supportati da Go (Linux, macOS, FreeBSD, ...).
package singleinstance

import (
	"os"

	"golang.org/x/sys/unix"
)

// tryFlock prova LOCK_EX|LOCK_NB. Errore = lock già preso.
func tryFlock(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}

func unflock(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_UN)
}

