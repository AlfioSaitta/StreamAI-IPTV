#ifndef STREAMAI_RENDER_GL_H
#define STREAMAI_RENDER_GL_H

#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

// Definiamo GL_GLEXT_PROTOTYPES prima di includere i file GL per avere le dichiarazioni dirette
#ifndef GL_GLEXT_PROTOTYPES
#define GL_GLEXT_PROTOTYPES
#endif

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>

#ifndef GL_RGBA8
#define GL_RGBA8 0x8058
#endif

int streamai_gl_load();
int streamai_create_fbo(int w, int h, GLuint* out_fbo, GLuint* out_tex);
void* streamai_get_proc_address_trampoline(void* ctx, const char* name);
int streamai_create_gl_ctx(mpv_handle* h, mpv_render_context** out);
int streamai_gl_make_current(EGLDisplay display, EGLContext ctx);
int streamai_gl_render(mpv_render_context* ctx, int fbo, int w, int h);
void streamai_gl_delete_framebuffers(int n, const GLuint* fbos);
void streamai_gl_read_pixels(int fbo, int w, int h, void* buf);

#endif
