package cast

import "testing"

func TestIsValidIPv4(t *testing.T) {
	cases := map[string]bool{
		"192.168.1.10":  true,
		"10.0.0.1":      true,
		"255.255.255.0": true,
		"0.0.0.0":       true,
		"":              false,
		"not-an-ip":     false,
		"::1":           false, // IPv6: out of scope CastV2 (vedi Fase 2 IPv4-only)
		"256.0.0.1":     false,
		"1.2.3":         false,
	}
	for in, want := range cases {
		if got := isValidIPv4(in); got != want {
			t.Errorf("isValidIPv4(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestClamp01(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{-1, 0}, {0, 0}, {0.5, 0.5}, {1, 1}, {1.5, 1},
	}
	for _, c := range cases {
		if got := clamp01(c.in); got != c.want {
			t.Errorf("clamp01(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestGuessContentType(t *testing.T) {
	cases := map[string]string{
		"http://x/stream.m3u8":     "application/x-mpegURL",
		"http://x/manifest.mpd":    "application/dash+xml",
		"http://x/video.mkv":       "video/x-matroska",
		"http://x/movie.mp4":       "video/mp4",
		"http://x/segment.ts":      "video/mp2t",
		"http://x/live/CHANNEL":    "video/mp4", // default fallback
		"HTTP://X/STREAM.M3U8?ts=1": "application/x-mpegURL", // case-insensitive
	}
	for in, want := range cases {
		if got := guessContentType(in); got != want {
			t.Errorf("guessContentType(%q) = %q, want %q", in, got, want)
		}
	}
}

