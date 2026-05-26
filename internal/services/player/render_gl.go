//go:build mpv && linux

package player

/*
#cgo pkg-config: egl gl
#include "render_gl.h"
*/
import "C"

import (
	"errors"
	"fmt"
	"sync"
	"unsafe"
)

type glBackend struct {
	display C.EGLDisplay
	ctx     C.EGLContext
	fbo     C.GLuint
	tex     C.GLuint
	w, h    int
	mu      sync.Mutex
}

// isNullDisplay / isNullContext: EGLDisplay/EGLContext sono `void*` opachi
// che cgo non confronta direttamente con `nil`. Confrontiamo via
// unsafe.Pointer (il sentinel EGL_NO_DISPLAY è `(EGLDisplay)0`).
func isNullDisplay(d C.EGLDisplay) bool {
	return *(*unsafe.Pointer)(unsafe.Pointer(&d)) == nil
}

func isNullContext(c C.EGLContext) bool {
	return *(*unsafe.Pointer)(unsafe.Pointer(&c)) == nil
}

//export streamai_get_proc_address
func streamai_get_proc_address(ctx unsafe.Pointer, name *C.char) unsafe.Pointer {
	return unsafe.Pointer(C.eglGetProcAddress(name))
}

func initEGL() (*glBackend, error) {
	const eglPlatformSurfacelessMESA = 0x31DD
	display := C.eglGetPlatformDisplay(C.EGLenum(eglPlatformSurfacelessMESA), unsafe.Pointer(uintptr(C.EGL_DEFAULT_DISPLAY)), nil)
	if isNullDisplay(display) {
		display = C.eglGetDisplay(C.EGLNativeDisplayType(unsafe.Pointer(uintptr(C.EGL_DEFAULT_DISPLAY))))
	}
	if isNullDisplay(display) {
		return nil, errors.New("eglGetDisplay failed")
	}

	if C.eglInitialize(display, nil, nil) != C.EGL_TRUE {
		return nil, errors.New("eglInitialize failed")
	}

	C.eglBindAPI(C.EGL_OPENGL_API)

	configAttribs := []C.EGLint{
		C.EGL_SURFACE_TYPE, C.EGL_DONT_CARE,
		C.EGL_RENDERABLE_TYPE, C.EGL_OPENGL_BIT,
		C.EGL_NONE,
	}
	var cfg C.EGLConfig
	var nCfg C.EGLint
	C.eglChooseConfig(display, &configAttribs[0], &cfg, 1, &nCfg)

	ctxAttribs := []C.EGLint{
		C.EGL_CONTEXT_MAJOR_VERSION, 3,
		C.EGL_CONTEXT_MINOR_VERSION, 3,
		C.EGL_NONE,
	}
	ctx := C.eglCreateContext(display, cfg, nil, &ctxAttribs[0])
	if isNullContext(ctx) {
		return nil, errors.New("eglCreateContext failed")
	}

	if C.eglMakeCurrent(display, nil, nil, ctx) != C.EGL_TRUE {
		return nil, errors.New("eglMakeCurrent failed")
	}

	return &glBackend{display: display, ctx: ctx}, nil
}

func (g *glBackend) makeCurrent() error {
	if rc := C.streamai_gl_make_current(g.display, g.ctx); rc != 0 {
		return fmt.Errorf("eglMakeCurrent failed: %d", rc)
	}
	return nil
}

func (g *glBackend) destroy() {
	if !isNullDisplay(g.display) {
		C.eglMakeCurrent(g.display, nil, nil, nil)
		if g.fbo != 0 {
			C.streamai_gl_delete_framebuffers(1, &g.fbo)
			C.glDeleteTextures(1, &g.tex)
		}
		if !isNullContext(g.ctx) {
			C.eglDestroyContext(g.display, g.ctx)
		}
		C.eglTerminate(g.display)
	}
}

func (g *glBackend) ensureFBO(w, h int) error {
	if g.fbo != 0 && g.w == w && g.h == h {
		return nil
	}
	if g.fbo != 0 {
		C.streamai_gl_delete_framebuffers(1, &g.fbo)
		C.glDeleteTextures(1, &g.tex)
	}
	rc := C.streamai_create_fbo(C.int(w), C.int(h), &g.fbo, &g.tex)
	if rc != 0 {
		return fmt.Errorf("create FBO failed: %d", rc)
	}
	g.w, g.h = w, h
	return nil
}
