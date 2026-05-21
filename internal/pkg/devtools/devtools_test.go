package devtools

import "testing"

func TestEnabled(t *testing.T) {
	cases := []struct {
		v    string
		want bool
	}{
		{"", false},
		{"0", false},
		{"false", false},
		{"no", false},
		{"random", false},
		{"1", true},
		{"true", true},
		{"TRUE", true},
		{"Yes", true},
		{" on ", true},
	}
	for _, tc := range cases {
		t.Run(tc.v, func(t *testing.T) {
			t.Setenv(EnvVar, tc.v)
			if got := Enabled(); got != tc.want {
				t.Fatalf("Enabled(%q) = %v, want %v", tc.v, got, tc.want)
			}
		})
	}
}

func TestKeyBindingsRespectsOptIn(t *testing.T) {
	t.Setenv(EnvVar, "")
	if got := KeyBindings(); got != nil {
		t.Fatalf("KeyBindings without opt-in should be nil, got %d entries", len(got))
	}
	t.Setenv(EnvVar, "1")
	got := KeyBindings()
	if got == nil {
		t.Fatal("KeyBindings with opt-in should not be nil")
	}
	for _, want := range []string{"cmdorctrl+shift+i", "f12"} {
		if _, ok := got[want]; !ok {
			t.Fatalf("expected accelerator %q missing", want)
		}
	}
}

func TestKeyBindingsCallbackNilSafe(t *testing.T) {
	t.Setenv(EnvVar, "1")
	bindings := KeyBindings()
	for accel, fn := range bindings {
		// Chiamare con nil window: il callback deve no-op senza panic.
		// Regression guard per il caso "tasto premuto durante teardown".
		fn(nil)
		_ = accel
	}
}

