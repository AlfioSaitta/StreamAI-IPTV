//go:build linux || freebsd || openbsd || netbsd || dragonfly

package mediakeys

import "os"

// procPID ritorna il PID corrente. Estratto in funzione per evitare
// di importare "os" nel file principale (i tag build potrebbero
// includere il principale anche su OS non-unix).
func procPID() int { return os.Getpid() }

