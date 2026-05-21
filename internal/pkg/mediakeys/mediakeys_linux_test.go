//go:build linux || freebsd || openbsd || netbsd || dragonfly

package mediakeys

import "testing"

func TestSanitizeIdentity(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"StreamAI", "streamai"},
		{"Stream AI 2.0", "streamai20"},
		{"foo_bar", "foo_bar"},
		{"$$$", "streamai"},
		{"", "streamai"},
		{"  Streamai  ", "streamai"},
		{"Über", "ber"}, // non-ASCII strip
	}
	for _, tc := range cases {
		if got := sanitizeIdentity(tc.in); got != tc.want {
			t.Errorf("sanitizeIdentity(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

