//go:build linux

package pip

// edgeResizeSupported è true dove il runtime JS di Wails NON gestisce il
// resize dai bordi: su Linux `drag.js` esce subito con
// `if (!resizable || !IsWindows()) return`, quindi le maniglie le disegna la
// vista PiP e il resize parte dal messaggio `wails:resize:<edge>`, che il
// backend GTK3 implementa già (`gtk_window_begin_resize_drag`).
const edgeResizeSupported = true
