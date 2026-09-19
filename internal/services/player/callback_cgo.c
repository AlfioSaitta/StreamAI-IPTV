//go:build mpv && (linux || darwin)

/* Trampoline per mpv_render_context_set_update_callback.
 *
 * Perché un file .c separato: `mpv_cgo.go` contiene definizioni C nel proprio
 * preambolo, e cgo VIETA di definire funzioni C nel preambolo di un file che
 * usa `//export` ("the preamble must not contain any definitions"). La funzione
 * esportata da Go (`goPlayerUpdateCallback`) sta quindi in callback_cgo.go, e
 * la definizione del trampoline vive qui.
 *
 * Vincolo libmpv (render.h, sezione "Threading"): dentro questo callback NON si
 * possono chiamare funzioni libmpv/mpv_render_* e non si deve bloccarsi. Qui
 * pubblichiamo soltanto un flag; il render resta nel chiamante di RenderFrame,
 * che è l'unico punto in cui `mpv_render_context_update()` viene invocata
 * (obbligatorio dopo ogni callback, sempre secondo render.h).
 */

#include <mpv/render.h>

extern void goPlayerUpdateCallback(void);

static void streamai_update_trampoline(void *ctx) {
    (void)ctx;
    goPlayerUpdateCallback();
}

/* Registra il callback di update sul render context. Ritorna 0 su successo.
 *
 * Il parametro è `void*` perché il lato Go che chiama questa funzione non può
 * includere <mpv/render.h> (vedi callback_cgo.go): il cast avviene qui. */
int streamai_set_update_callback(void *ctx) {
    if (ctx == NULL) {
        return -1;
    }
    mpv_render_context_set_update_callback((mpv_render_context *)ctx,
                                          streamai_update_trampoline, NULL);
    return 0;
}
