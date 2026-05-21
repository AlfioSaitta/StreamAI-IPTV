// EGL surfaceless context + OpenGL FBO helpers for SPIKE-1 harness.
// Linux-only.
//
// I prototipi GL 3.0+ (FBO API) non sono in <GL/gl.h> della Mesa stock
// (GL 1.x); li carichiamo a runtime via eglGetProcAddress in C, evitando
// la dipendenza da loader esterni (GLEW / glad / libepoxy). I wrapper C
// sotto sono il minimo indispensabile per SPIKE-1 (FBO RGBA8 + glReadPixels).
//
//go:build mpv && linux

package main

// #cgo pkg-config: egl gl
// #include <stdlib.h>
// #include <string.h>
// #include <EGL/egl.h>
// #include <EGL/eglext.h>
// #include <GL/gl.h>
// #include <GL/glext.h>
//
// // ---- GL function pointers (GL 3.0 FBO) ----
//
// typedef void   (*PFN_glGenFramebuffers)(GLsizei, GLuint*);
// typedef void   (*PFN_glBindFramebuffer)(GLenum, GLuint);
// typedef void   (*PFN_glDeleteFramebuffers)(GLsizei, const GLuint*);
// typedef void   (*PFN_glFramebufferTexture2D)(GLenum, GLenum, GLenum, GLuint, GLint);
// typedef GLenum (*PFN_glCheckFramebufferStatus)(GLenum);
//
// static PFN_glGenFramebuffers         p_glGenFramebuffers;
// static PFN_glBindFramebuffer         p_glBindFramebuffer;
// static PFN_glDeleteFramebuffers      p_glDeleteFramebuffers;
// static PFN_glFramebufferTexture2D    p_glFramebufferTexture2D;
// static PFN_glCheckFramebufferStatus  p_glCheckFramebufferStatus;
//
// static int spike1_gl_load(void) {
//     #define LOAD(sym) do { \
//         p_##sym = (PFN_##sym)eglGetProcAddress(#sym); \
//         if (!p_##sym) return -1; \
//     } while (0)
//     LOAD(glGenFramebuffers);
//     LOAD(glBindFramebuffer);
//     LOAD(glDeleteFramebuffers);
//     LOAD(glFramebufferTexture2D);
//     LOAD(glCheckFramebufferStatus);
//     #undef LOAD
//     return 0;
// }
//
// // spike1_create_fbo: texture RGBA8 W*H + framebuffer collegato.
// // Return: 0 ok, -2 spike1_gl_load fallita, altri valori = GLenum status.
// static int spike1_create_fbo(int w, int h, GLuint* out_fbo, GLuint* out_tex) {
//     if (!p_glGenFramebuffers && spike1_gl_load() < 0) return -2;
//
//     GLuint tex = 0, fbo = 0;
//     glGenTextures(1, &tex);
//     glBindTexture(GL_TEXTURE_2D, tex);
//     glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0,
//                  GL_RGBA, GL_UNSIGNED_BYTE, NULL);
//     glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
//     glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
//     glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
//     glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
//
//     p_glGenFramebuffers(1, &fbo);
//     p_glBindFramebuffer(GL_FRAMEBUFFER, fbo);
//     p_glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
//                              GL_TEXTURE_2D, tex, 0);
//     GLenum status = p_glCheckFramebufferStatus(GL_FRAMEBUFFER);
//     if (status != GL_FRAMEBUFFER_COMPLETE) {
//         p_glDeleteFramebuffers(1, &fbo);
//         glDeleteTextures(1, &tex);
//         return (int)status;
//     }
//     p_glBindFramebuffer(GL_FRAMEBUFFER, 0);
//     glBindTexture(GL_TEXTURE_2D, 0);
//
//     *out_fbo = fbo;
//     *out_tex = tex;
//     return 0;
// }
//
// static void spike1_destroy_fbo(GLuint fbo, GLuint tex) {
//     if (p_glDeleteFramebuffers) p_glDeleteFramebuffers(1, &fbo);
//     glDeleteTextures(1, &tex);
// }
//
// // spike1_readback_rgba: bind FBO -> glReadPixels RGBA8 -> unbind.
// static void spike1_readback_rgba(GLuint fbo, int w, int h, void* pix) {
//     if (!p_glBindFramebuffer) return;
//     p_glBindFramebuffer(GL_FRAMEBUFFER, fbo);
//     glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, pix);
//     p_glBindFramebuffer(GL_FRAMEBUFFER, 0);
// }
//
// // glGetString safe wrapper (Go non gestisce direttamente const GLubyte*).
// static const char* spike1_gl_get_string(GLenum name) {
//     return (const char*)glGetString(name);
// }
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

// eglContext incapsula display + context EGL surfaceless.
type eglContext struct {
	display C.EGLDisplay
	ctx     C.EGLContext
}

// initEGLSurfaceless crea un context OpenGL Core 3.3 surfaceless via Mesa.
//
// Refs:
//   - EGL_MESA_platform_surfaceless
//   - EGL_KHR_surfaceless_context
func initEGLSurfaceless() (*eglContext, error) {
	// EGL_PLATFORM_SURFACELESS_MESA = 0x31DD (vedi EGL/eglmesaext.h).
	const eglPlatformSurfacelessMESA = 0x31DD

	display := C.eglGetPlatformDisplay(
		C.EGLenum(eglPlatformSurfacelessMESA),
		unsafe.Pointer(uintptr(C.EGL_DEFAULT_DISPLAY)),
		nil,
	)
	if isNullDisplay(display) {
		// Fallback: default display (X11/Wayland binding implicito).
		display = C.eglGetDisplay(C.EGLNativeDisplayType(unsafe.Pointer(uintptr(C.EGL_DEFAULT_DISPLAY))))
		if isNullDisplay(display) {
			return nil, errors.New("eglGetPlatformDisplay(SURFACELESS_MESA) e eglGetDisplay(DEFAULT) hanno entrambi fallito")
		}
	}

	var major, minor C.EGLint
	if C.eglInitialize(display, &major, &minor) != C.EGL_TRUE {
		return nil, fmt.Errorf("eglInitialize: %s", eglErrorString())
	}

	if C.eglBindAPI(C.EGL_OPENGL_API) != C.EGL_TRUE {
		return nil, fmt.Errorf("eglBindAPI(EGL_OPENGL_API): %s", eglErrorString())
	}

	configAttribs := []C.EGLint{
		C.EGL_SURFACE_TYPE, C.EGL_DONT_CARE,
		C.EGL_RENDERABLE_TYPE, C.EGL_OPENGL_BIT,
		C.EGL_RED_SIZE, 8,
		C.EGL_GREEN_SIZE, 8,
		C.EGL_BLUE_SIZE, 8,
		C.EGL_ALPHA_SIZE, 8,
		C.EGL_NONE,
	}
	var cfg C.EGLConfig
	var nCfg C.EGLint
	if C.eglChooseConfig(display, &configAttribs[0], &cfg, 1, &nCfg) != C.EGL_TRUE || nCfg < 1 {
		return nil, fmt.Errorf("eglChooseConfig: %s (nConfigs=%d)", eglErrorString(), int(nCfg))
	}

	// Core profile 3.3.
	ctxAttribs := []C.EGLint{
		C.EGL_CONTEXT_MAJOR_VERSION, 3,
		C.EGL_CONTEXT_MINOR_VERSION, 3,
		// EGL_CONTEXT_OPENGL_PROFILE_MASK / CORE_PROFILE_BIT (EGL 1.5).
		0x30FD, 0x00000001,
		C.EGL_NONE,
	}
	ctx := C.eglCreateContext(display, cfg, nil, &ctxAttribs[0])
	if isNullContext(ctx) {
		return nil, fmt.Errorf("eglCreateContext: %s", eglErrorString())
	}

	if C.eglMakeCurrent(display, nil, nil, ctx) != C.EGL_TRUE {
		C.eglDestroyContext(display, ctx)
		return nil, fmt.Errorf("eglMakeCurrent(surfaceless): %s — driver senza EGL_KHR_surfaceless_context?", eglErrorString())
	}

	if rc := C.spike1_gl_load(); rc != 0 {
		C.eglMakeCurrent(display, nil, nil, nil)
		C.eglDestroyContext(display, ctx)
		return nil, errors.New("spike1_gl_load: simboli FBO non risolvibili via eglGetProcAddress")
	}

	return &eglContext{display: display, ctx: ctx}, nil
}

func (e *eglContext) destroy() {
	if e == nil || isNullDisplay(e.display) {
		return
	}
	C.eglMakeCurrent(e.display, nil, nil, nil)
	if !isNullContext(e.ctx) {
		C.eglDestroyContext(e.display, e.ctx)
	}
	C.eglTerminate(e.display)
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

func eglErrorString() string {
	switch C.eglGetError() {
	case C.EGL_SUCCESS:
		return "EGL_SUCCESS"
	case C.EGL_NOT_INITIALIZED:
		return "EGL_NOT_INITIALIZED"
	case C.EGL_BAD_ACCESS:
		return "EGL_BAD_ACCESS"
	case C.EGL_BAD_ALLOC:
		return "EGL_BAD_ALLOC"
	case C.EGL_BAD_ATTRIBUTE:
		return "EGL_BAD_ATTRIBUTE"
	case C.EGL_BAD_CONTEXT:
		return "EGL_BAD_CONTEXT"
	case C.EGL_BAD_CONFIG:
		return "EGL_BAD_CONFIG"
	case C.EGL_BAD_CURRENT_SURFACE:
		return "EGL_BAD_CURRENT_SURFACE"
	case C.EGL_BAD_DISPLAY:
		return "EGL_BAD_DISPLAY"
	case C.EGL_BAD_SURFACE:
		return "EGL_BAD_SURFACE"
	case C.EGL_BAD_MATCH:
		return "EGL_BAD_MATCH"
	case C.EGL_BAD_PARAMETER:
		return "EGL_BAD_PARAMETER"
	case C.EGL_BAD_NATIVE_PIXMAP:
		return "EGL_BAD_NATIVE_PIXMAP"
	case C.EGL_BAD_NATIVE_WINDOW:
		return "EGL_BAD_NATIVE_WINDOW"
	case C.EGL_CONTEXT_LOST:
		return "EGL_CONTEXT_LOST"
	default:
		return fmt.Sprintf("EGL error 0x%x", uint32(C.eglGetError()))
	}
}

// ---- FBO helpers (Go thin wrappers) ---------------------------------------

func createFBO(w, h int) (uint32, uint32, error) {
	var cFbo, cTex C.GLuint
	rc := C.spike1_create_fbo(C.int(w), C.int(h), &cFbo, &cTex)
	switch {
	case rc == 0:
		return uint32(cFbo), uint32(cTex), nil
	case rc == -2:
		return 0, 0, errors.New("FBO create: GL function pointers non risolvibili")
	default:
		return 0, 0, fmt.Errorf("FBO incomplete: 0x%x", uint32(rc))
	}
}

func destroyFBO(fbo, tex uint32) {
	C.spike1_destroy_fbo(C.GLuint(fbo), C.GLuint(tex))
}

func readbackRGBA(fbo uint32, w, h int, pixBuf []byte) {
	if len(pixBuf) < w*h*4 {
		return
	}
	C.spike1_readback_rgba(C.GLuint(fbo), C.int(w), C.int(h), unsafe.Pointer(&pixBuf[0]))
}

func glGetString(name uint32) string {
	cs := C.spike1_gl_get_string(C.GLenum(name))
	if cs == nil {
		return ""
	}
	return C.GoString(cs)
}


