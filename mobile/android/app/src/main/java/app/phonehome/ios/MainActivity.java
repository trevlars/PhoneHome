package app.phonehome.ios;

import android.animation.Animator;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.core.splashscreen.SplashScreenViewProvider;
import com.getcapacitor.BridgeActivity;
import app.phonehome.callkit.PhoneHomeCapBridge;
import app.phonehome.callkit.PhoneHomeLaunch;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    /** Same cycle as PhoneHomeBridgeViewController.heroCycle / app.css phoneRing. */
    private static final long HERO_CYCLE_MS = 2600L;
    /**
     * iOS launch handset (180pt). The 123dp shrink matched the welcome mark but
     * made the intro tiny; the larger size is the one to keep. Rings stay 150:180.
     */
    private static final float HERO_DP = 180f;
    private static final float RING_DP = HERO_DP * (150f / 180f);
    private View launchCover;
    private final ArrayList<Animator> launchAnimators = new ArrayList<>();
    private final PhoneHomeLaunch.LaunchCoverListener coverListener = this::hideLaunchCover;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen splash =
            androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        splash.setOnExitAnimationListener(SplashScreenViewProvider::remove);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        installLaunchCover();
        PhoneHomeLaunch.INSTANCE.attach(coverListener);
        PhoneHomeCapBridge.INSTANCE.injectSaved(getBridge(), this);
        PhoneHomeLaunch.INSTANCE.requestRuntimePermissions(this);
        PhoneHomeLaunch.INSTANCE.consumeInviteIntent(this, getIntent());
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            web.getSettings().setMediaPlaybackRequiresUserGesture(false);
            web.getSettings().setSupportZoom(false);
            web.getSettings().setBuiltInZoomControls(false);
            web.getSettings().setDisplayZoomControls(false);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        PhoneHomeLaunch.INSTANCE.onResume();
    }

    @Override
    public void onPause() {
        PhoneHomeLaunch.INSTANCE.onPause();
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PhoneHomeLaunch.INSTANCE.consumeInviteIntent(this, intent);
    }

    @Override
    public void onDestroy() {
        PhoneHomeLaunch.INSTANCE.detach(coverListener);
        super.onDestroy();
    }

    /**
     * Same hero as iOS {@code PhoneHomeBridgeViewController.installLaunchCover}:
     * frameless LaunchPhone, two gold rings leaving, phone rattle. Not the launcher icon.
     */
    private void installLaunchCover() {
        float density = getResources().getDisplayMetrics().density;
        int side = Math.round(HERO_DP * density);
        int ringSide = Math.round(RING_DP * density);
        boolean animate = !reduceMotion();

        FrameLayout cover = new FrameLayout(this);
        cover.setBackgroundColor(Color.parseColor("#0C1814"));
        cover.setClickable(false);
        cover.setClipChildren(false);

        FrameLayout hero = new FrameLayout(this);
        hero.setTag("ph-hero");
        hero.setClipChildren(false);
        cover.addView(hero, new FrameLayout.LayoutParams(side, side, Gravity.CENTER));

        int stroke = Math.max(1, Math.round(1.5f * density));
        int ringColor = Color.argb(Math.round(0.34f * 255f), 239, 192, 74);
        for (int i = 0; i < 2; i++) {
            View ring = new View(this);
            GradientDrawable oval = new GradientDrawable();
            oval.setShape(GradientDrawable.OVAL);
            oval.setColor(Color.TRANSPARENT);
            oval.setStroke(stroke, ringColor);
            ring.setBackground(oval);
            ring.setAlpha(0f);
            ring.setScaleX(0.55f);
            ring.setScaleY(0.55f);
            hero.addView(ring, new FrameLayout.LayoutParams(ringSide, ringSide, Gravity.CENTER));
            if (animate) startRing(ring, i == 0 ? 0L : 850L);
        }

        ImageView phone = new ImageView(this);
        phone.setImageResource(R.drawable.launch_phone);
        phone.setScaleType(ImageView.ScaleType.FIT_CENTER);
        hero.addView(phone, new FrameLayout.LayoutParams(side, side, Gravity.CENTER));
        phone.post(() -> {
            phone.setPivotX(phone.getWidth() / 2f);
            // iOS anchor: (24 + 132 * 0.7) / 180 — pivot through the handset, not the cord.
            phone.setPivotY(phone.getHeight() * ((24f + 132f * 0.7f) / 180f));
            if (animate) startPhoneRing(phone, density);
        });

        addContentView(
            cover,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        launchCover = cover;
        cover.postDelayed(this::hideLaunchCover, 8000);
    }

    private void startRing(View ring, long delayMs) {
        ObjectAnimator scaleX = ObjectAnimator.ofFloat(ring, View.SCALE_X, 0.55f, 1.35f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(ring, View.SCALE_Y, 0.55f, 1.35f);
        ObjectAnimator alpha = ObjectAnimator.ofFloat(ring, View.ALPHA, 0.7f, 0f);
        DecelerateInterpolator easeOut = new DecelerateInterpolator();
        for (ObjectAnimator anim : new ObjectAnimator[] { scaleX, scaleY, alpha }) {
            anim.setDuration(HERO_CYCLE_MS);
            anim.setStartDelay(delayMs);
            anim.setRepeatCount(ValueAnimator.INFINITE);
            anim.setInterpolator(easeOut);
            launchAnimators.add(anim);
            anim.start();
        }
    }

    private void startPhoneRing(ImageView phone, float density) {
        float[] rotTimes = { 0f, 0.02f, 0.05f, 0.08f, 0.11f, 0.14f, 0.17f, 0.20f, 0.24f, 0.28f, 1f };
        float[] rotDeg = { 0f, -9f, 8f, -8f, 7f, -6f, 5f, -3f, 1.5f, 0f, 0f };
        float[] liftTimes = { 0f, 0.02f, 0.05f, 0.08f, 1f };
        float[] liftPt = { 0f, -1.5f, -1.5f, 0f, 0f };
        ValueAnimator anim = ValueAnimator.ofFloat(0f, 1f);
        anim.setDuration(HERO_CYCLE_MS);
        anim.setRepeatCount(ValueAnimator.INFINITE);
        anim.setInterpolator(new LinearInterpolator());
        anim.addUpdateListener(a -> {
            float t = (Float) a.getAnimatedValue();
            phone.setRotation(keyed(rotTimes, rotDeg, t));
            phone.setTranslationY(keyed(liftTimes, liftPt, t) * density);
        });
        launchAnimators.add(anim);
        anim.start();
    }

    /** easeInEaseOut between the iOS keyframe samples. */
    private static float keyed(float[] times, float[] values, float t) {
        if (t <= times[0]) return values[0];
        for (int i = 1; i < times.length; i++) {
            if (t <= times[i]) {
                float span = times[i] - times[i - 1];
                float u = span == 0f ? 1f : (t - times[i - 1]) / span;
                u = u * u * (3f - 2f * u);
                return values[i - 1] + (values[i] - values[i - 1]) * u;
            }
        }
        return values[values.length - 1];
    }

    private boolean reduceMotion() {
        try {
            return Settings.Global.getFloat(
                getContentResolver(),
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f
            ) == 0f;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private void hideLaunchCover() {
        View cover = launchCover;
        if (cover == null) return;
        launchCover = null;
        View hero = cover.findViewWithTag("ph-hero");
        if (hero != null) {
            hero.animate()
                .scaleX(1.08f)
                .scaleY(1.08f)
                .setDuration(420)
                .setInterpolator(new DecelerateInterpolator())
                .start();
        }
        cover.animate().alpha(0f).setDuration(420).setInterpolator(new DecelerateInterpolator()).withEndAction(() -> {
            for (Animator anim : launchAnimators) anim.cancel();
            launchAnimators.clear();
            ViewGroup parent = (ViewGroup) cover.getParent();
            if (parent != null) parent.removeView(cover);
        });
    }
}
