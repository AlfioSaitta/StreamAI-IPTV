// EGL surfaceless context + OpenGL FBO helpers for SPIKE-1 harness.
// Linux-only (mpv tag necessario per coerenza con main.go).
//
//go:build mpv && linux

package main

// #cgo pkg-config: egl gl
// #include <EGL/egl.h>
// #include <EGL/eglext.h>
// #include <GL/gl.h>
// #include <GL/glext.h>
// #include <mpv/render.h>
//
// // Forward declaration della callback Go esportata da main.go.
// extern void goSpike1UpdateCallback(void);
//
// // Trampoline statico richiesto da mpv_render_context_set_update_callback.
// // mpv chiama questa funzione (potenzialmente da un thread libmpv interno);
// // la callback Go è thread-safe (push non-blocking su channel buffered).
// static void spike1_update_trampoline(void* ctx) {
//     (void)ctx;
//     goSpike1UpdateCallback();
// }
//
// // Wrapper per glGetString: Go non può chiamare direttamente glGetString
// // come funzione cgo perché restituisce const GLubyte* (unsigned char*).
// static const char* spike1_gl_get_string(GLenum name) {
//     return (const char*)glGetString(name);
// }
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

// eglContext incapsula display + context EGL surfaceless. La risorsa è
// process-singleton in questo PoC.
type eglContext struct {
	display C.EGLDisplay
	ctx     C.EGLContext
}

// initEGLSurfaceless apre un display EGL "platform=surfaceless" (Mesa
// EGL_MESA_platform_surfaceless o EGL_KHR_surfaceless_context) e crea
// un context OpenGL Core 3.3+ senza alcuna finestra/sorgente.
//
// Refs:
//   - https://registry.khronos.org/EGL/extensions/MESA/EGL_MESA_platform_surfaceless.txt
//   - https://registry.khronos.org/EGL/extensions/KHR/EGL_KHR_surfaceless_context.txt
func initEGLSurfaceless() (*eglContext, error) {
	// EGL_PLATFORM_SURFACELESS_MESA = 0x31DD (vedi EGL/eglmesaext.h).
	const eglPlatformSurfacelessMESA = 0x31DD

	display := C.eglGetPlatformDisplay(
		C.EGLenum(eglPlatformSurfacelessMESA),
		C.EGL_DEFAULT_DISPLAY,
		nil,
	)
	if display == nil || display == C.EGL_NO_DISPLAY {
		// Fallback: prova default display (X11/Wayland binding implicito).
		display = C.eglGetDisplay(C.EGL_DEFAULT_DISPLAY)
		if display == nil || display == C.EGL_NO_DISPLAY {
			return nil, errors.New("eglGetPlatformDisplay(SURFACELESS_MESA) e eglGetDisplay(DEFAULT) hanno entrambi fallito")
		}
	}

	var major, minor C.EGLint
	if C.eglInitialize(display, &major, &minor) != C.EGL_TRUE {
		return nil, fmt.Errorf("eglInitialize: %s", eglErrorString())
	}

	if C.eglBindAPI(C.EGL_OPENGL_API) != C.EGL_TRUE {
		return nil, fmt.Errorf("eglBindAPI(EGL_OPENGL_API): %s — necessaria su driver con OpenGL desktop", eglErrorString())
	}

	configAttribs := []C.EGLint{
		C.EGL_SURFACE_TYPE, C.EGL_DONT_CARE, // surfaceless: non vincoliamo a window/pbuffer
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
		return nil, fmt.Errorf("eglChooseConfig: %s (nConfigs=%d)", eglErrorString(), nCfg)
	}

	// Core profile 3.3 — sufficiente per FBO + glReadPixels RGBA8.
	ctxAttribs := []C.EGLint{
		C.EGL_CONTEXT_MAJOR_VERSION, 3,
		C.EGL_CONTEXT_MINOR_VERSION, 3,
		// EGL_CONTEXT_OPENGL_PROFILE_MASK / CORE_PROFILE_BIT (EGL 1.5).
		0x30FD, 0x00000001,
		C.EGL_NONE,
	}
	ctx := C.eglCreateContext(display, cfg, C.EGL_NO_CONTEXT, &ctxAttribs[0])
	if ctx == nil || ctx == C.EGL_NO_CONTEXT {
		return nil, fmt.Errorf("eglCreateContext: %s", eglErrorString())
	}

	// Bind senza surface — richiede EGL_KHR_surfaceless_context (driver Mesa lo supporta).
	if C.eglMakeCurrent(display, C.EGL_NO_SURFACE, C.EGL_NO_SURFACE, ctx) != C.EGL_TRUE {
		C.eglDestroyContext(display, ctx)
		return nil, fmt.Errorf("eglMakeCurrent(surfaceless): %s — driver non supporta EGL_KHR_surfaceless_context?", eglErrorString())
	}

	return &eglContext{display: display, ctx: ctx}, nil
}

func (e *eglContext) destroy() {
	if e == nil || e.display == nil {
		return
	}
	C.eglMakeCurrent(e.display, C.EGL_NO_SURFACE, C.EGL_NO_SURFACE, C.EGL_NO_CONTEXT)
	if e.ctx != nil {
		C.eglDestroyContext(e.display, e.ctx)
	}
	C.eglTerminate(e.display)
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

// ---- FBO helpers -----------------------------------------------------------

// createFBO costruisce un framebuffer object RGBA8 di dimensioni W×H con
// una texture color attachment 0. Non aggiungiamo depth/stencil — libmpv
// per render-API non li richiede sulla pipeline 2D di output finale.
func createFBO(w, h int) (fbo, tex uint32, err error) {
	var cFbo, cTex C.GLuint
	C.glGenFramebuffers(1, &cFbo)
	C.glGenTextures(1, &cTex)

	C.glBindTexture(C.GL_TEXTURE_2D, cTex)
	C.glTexImage2D(C.GL_TEXTURE_2D, 0, C.GL_RGBA8,
		C.GLsizei(w), C.GLsizei(h), 0,
		C.GL_RGBA, C.GL_UNSIGNED_BYTE, nil)
	C.glTexParameteri(C.GL_TEXTURE_2D, C.GL_TEXTURE_MIN_FILTER, C.GL_LINEAR)
	C.glTexParameteri(C.GL_TEXTURE_2D, C.GL_TEXTURE_MAG_FILTER, C.GL_LINEAR)
	C.glTexParameteri(C.GL_TEXTURE_2D, C.GL_TEXTURE_WRAP_S, C.GL_CLAMP_TO_EDGE)
	C.glTexParameteri(C.GL_TEXTURE_2D, C.GL_TEXTURE_WRAP_T, C.GL_CLAMP_TO_EDGE)

	C.glBindFramebuffer(C.GL_FRAMEBUFFER, cFbo)
	C.glFramebufferTexture2D(C.GL_FRAMEBUFFER, C.GL_COLOR_ATTACHMENT0,
		C.GL_TEXTURE_2D, cTex, 0)

	status := C.glCheckFramebufferStatus(C.GL_FRAMEBUFFER)
	if status != C.GL_FRAMEBUFFER_COMPLETE {
		C.glDeleteFramebuffers(1, &cFbo)
		C.glDeleteTextures(1, &cTex)
		return 0, 0, fmt.Errorf("FBO incomplete: 0x%x", uint32(status))
	}

	// Rilascio binding default per evitare side-effect su mpv (mpv setta
	// il suo binding prima di renderizzare).
	C.glBindFramebuffer(C.GL_FRAMEBUFFER, 0)
	C.glBindTexture(C.GL_TEXTURE_2D, 0)

	return uint32(cFbo), uint32(cTex), nil
}

func destroyFBO(fbo, tex uint32) {
	cFbo := C.GLuint(fbo)
	cTex := C.GLuint(tex)
	C.glDeleteFramebuffers(1, &cFbo)
	C.glDeleteTextures(1, &cTex)
}

// readbackRGBA esegue glReadPixels sul FBO corrente (binding implicito
// gestito dal chiamante: subito dopo mpv_render_context_render il FBO è
// ancora bound dal command queue). pixBuf deve avere capacità
// W*H*4 byte.
func readbackRGBA(fbo uint32, w, h int, pixBuf []byte) {
	C.glBindFramebuffer(C.GL_FRAMEBUFFER, C.GLuint(fbo))
	C.glReadPixels(0, 0, C.GLsizei(w), C.GLsizei(h),
		C.GL_RGBA, C.GL_UNSIGNED_BYTE,
		unsafe.Pointer(&pixBuf[0]))
	C.glBindFramebuffer(C.GL_FRAMEBUFFER, 0)
}

// glGetString è un wrapper safe che restituisce "" se il driver ritorna
// NULL (es. context non corrente).
func glGetString(name uint32) string {
	cs := C.spike1_gl_get_string(C.GLenum(name))
	if cs == nil {
		return ""
	}
	return C.GoString(cs)
}

