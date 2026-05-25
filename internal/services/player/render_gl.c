//go:build mpv && linux

#include "render_gl.h"
#include <stddef.h>

extern void* streamai_get_proc_address(void*, char*);

int streamai_gl_load() {
    return 0; // In questo scenario carichiamo via render_gl.h
}

int streamai_create_fbo(int w, int h, GLuint* out_fbo, GLuint* out_tex) {
    GLuint tex = 0, fbo = 0;
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    
    // Filtri per assicurarci che la texture sia valida
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        glDeleteFramebuffers(1, &fbo);
        glDeleteTextures(1, &tex);
        return (int)status;
    }

    *out_fbo = fbo;
    *out_tex = tex;
    return 0;
}

void* streamai_get_proc_address_trampoline(void* ctx, const char* name) {
    return streamai_get_proc_address(ctx, (char*)name);
}

int streamai_create_gl_ctx(mpv_handle* h, mpv_render_context** out) {
    char api_type[] = MPV_RENDER_API_TYPE_OPENGL;
    mpv_opengl_init_params gl_init = {
        .get_proc_address = streamai_get_proc_address_trampoline,
        .get_proc_address_ctx = NULL,
    };
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, api_type},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init},
        {0}
    };
    return mpv_render_context_create(out, h, params);
}

int streamai_gl_make_current(EGLDisplay display, EGLContext ctx) {
    if (eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx) != EGL_TRUE) {
        return (int)eglGetError();
    }
    return 0;
}

int streamai_gl_render(mpv_render_context* ctx, int fbo, int w, int h) {
    int flip_y = 0;
    mpv_opengl_fbo opengl_fbo = { .fbo = fbo, .w = w, .h = h, .internal_format = GL_RGBA8 };
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &opengl_fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
        {0}
    };

    // Assicuriamoci che il viewport sia impostato correttamente prima di renderizzare
    glViewport(0, 0, w, h);
    // Puliamo il buffer con un colore neutro (nero) per evitare il flickering blu se MPV non disegna
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    return mpv_render_context_render(ctx, params);
}

void streamai_gl_delete_framebuffers(int n, const GLuint* fbos) {
    glDeleteFramebuffers(n, fbos);
}

void streamai_gl_read_pixels(int fbo, int w, int h, void* buf) {
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    
    // Non usiamo glFinish qui se chiamiamo dopo un render che ha già i suoi sync.
    // In realtà mpv_render_context_render assicura che il rendering sia pronto
    // per essere consumato. glFinish() può essere rimosso o spostato.
    // Per ora lo lasciamo ma siamo consapevoli che è un bottleneck.

    // Configurazione pixel store per allineamento a 1 byte (RGBA è 4 byte, ma meglio essere espliciti)
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    
    glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, buf);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}
