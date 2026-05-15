package com.streamai.iptv;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		applyDisplayCutoutMode();
		enableImmersiveMode();
	}

	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		// Android ripristina le system bars dopo dialog/notifiche di sistema.
		// Quando l'activity riprende il focus, ri-applichiamo l'immersive
		// sticky per mantenere l'esperienza fullscreen.
		if (hasFocus) {
			enableImmersiveMode();
		}
	}

	/**
	 * Cutout mode (2026-05-15) — fix barra nera intorno al notch.
	 *
	 * Sui device con camera frontale a notch/punch-hole, in landscape lo
	 * spazio della camera viene normalmente "letterboxato" con una barra
	 * nera. Per evitarlo impostiamo il cutout mode programmaticamente:
	 * - API 30+ (Android 11+): `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS` →
	 *   il contenuto disegna sotto il cutout in qualsiasi orientamento.
	 * - API 28-29 (Android 9-10): `SHORT_EDGES` → contenuto sotto il
	 *   cutout sui lati corti (in landscape: sinistra e destra).
	 * - API &lt; 28: i device non hanno cutout supportato a livello OS,
	 *   nessuna azione necessaria.
	 *
	 * Il valore va impostato sui `WindowManager.LayoutParams` perché il
	 * theme XML non è sempre rispettato quando Capacitor cambia tema
	 * post-splash.
	 */
	private void applyDisplayCutoutMode() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
			WindowManager.LayoutParams params = getWindow().getAttributes();
			params.layoutInDisplayCutoutMode =
					WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
			getWindow().setAttributes(params);
		} else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
			WindowManager.LayoutParams params = getWindow().getAttributes();
			params.layoutInDisplayCutoutMode =
					WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
			getWindow().setAttributes(params);
		}
		// Background nero per il decor: in caso di transienti durante la
		// rotazione, evita flash bianchi/grigi sotto la WebView.
		getWindow().setBackgroundDrawable(null);
		getWindow().getDecorView().setBackgroundColor(Color.BLACK);
	}

	/**
	 * Modalità landscape immersiva (2026-05-15).
	 *
	 * Disegna edge-to-edge sotto status bar e navigation bar, le nasconde
	 * entrambe e abilita lo swipe-to-reveal transient. Il content view della
	 * WebView Capacitor riempie quindi l'intero schermo, incluso lo spazio
	 * normalmente occupato dal notch in landscape (grazie a
	 * `applyDisplayCutoutMode()`).
	 *
	 * Usa le API AndroidX `WindowCompat` / `WindowInsetsControllerCompat` per
	 * un'implementazione uniforme su API 22+ senza branch manuali per
	 * vecchie versioni.
	 */
	private void enableImmersiveMode() {
		WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
		WindowInsetsControllerCompat controller =
				new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
		controller.hide(WindowInsetsCompat.Type.systemBars());
		controller.setSystemBarsBehavior(
				WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
	}

	@Override
	public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
		super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
		// Quando si esce dal PiP rientriamo in immersive landscape.
		if (!isInPictureInPictureMode) {
			enableImmersiveMode();
		}
	}
}
