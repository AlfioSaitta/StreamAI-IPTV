//go:build mpv && linux
#include <mpv/client.h>
#include <mpv/render.h>
#include <stddef.h>

extern void streamai_render_update_callback(void*);

void streamai_set_render_update_callback(mpv_render_context* ctx, void* userdata) {
    mpv_render_context_set_update_callback(ctx, streamai_render_update_callback, userdata);
}
