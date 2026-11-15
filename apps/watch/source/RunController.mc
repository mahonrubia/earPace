import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Timer;
import Toybox.UserProfile;
import Toybox.WatchUi;

// Estado de la carrera: grabación FIT, sensores, enlace con el móvil e indicaciones.
class RunController {

    enum { IDLE, RUNNING, PAUSED }

    var state = IDLE;
    var session = null;
    var timer;
    var link;
    var coach;
    var tick = 0;

    // Últimos valores para la vista.
    var hr = null;
    var cadence = null;
    var speed = null;
    var distance = 0.0;
    var seconds = 0;
    var gpsQuality = 0;

    // Indicación en pantalla.
    var cueText = null;
    var cuePriority = 3;
    var cueUntil = 0;
    var targetLine = null;     // del móvil; si no hay, del entrenador local
    var title = null;

    function initialize() {
    }

    function setUp() {
        coach = new LocalCoach();
        link = new PhoneLink(self);
        var cfg = Application.Storage.getValue("cfg");
        if (cfg != null) {
            applyConfig(cfg);
        }
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        sendProfile();
    }

    function tearDown() {
        if (timer != null) {
            timer.stop();
        }
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        if (session != null && session.isRecording()) {
            session.stop();
            session.save();
        }
    }

    function onPosition(info) {
        if (info != null && info.accuracy != null) {
            gpsQuality = info.accuracy;
        }
    }

    // Zonas, peso y pulso en reposo que el usuario tiene configurados en Garmin.
    function sendProfile() {
        var p = UserProfile.getProfile();
        var msg = { "k" => "prof", "zones" => UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_RUNNING) };
        if (p != null) {
            if (p.weight != null) { msg["w"] = p.weight; }                      // gramos
            if (p.restingHeartRate != null) { msg["rhr"] = p.restingHeartRate; }
        }
        link.send(msg, true);
    }

    // ── Acciones del usuario ──────────────────────────────────────────────

    function startOrPause() {
        if (state == IDLE) {
            session = ActivityRecording.createSession({ :name => "Pinganillo", :sport => Activity.SPORT_RUNNING });
            session.start();
            state = RUNNING;
            coach.reset();
            event("start", null);
            buzz(2);
        } else if (state == RUNNING) {
            session.stop();
            state = PAUSED;
            event("pause", null);
            buzz(1);
        } else {
            session.start();
            state = RUNNING;
            event("resume", null);
            buzz(1);
        }
        WatchUi.requestUpdate();
    }

    function lap() {
        if (state != RUNNING) {
            return;
        }
        session.addLap();
        event("lap", null);
        var c = coach.lap(seconds, distance);
        if (c != null && !link.phoneAlive()) {
            showCue(c[0], c[1], c[2]);
        }
    }

    function finish(save) {
        if (session != null) {
            if (session.isRecording()) {
                session.stop();
            }
            if (save) {
                session.save();
            } else {
                session.discard();
            }
            session = null;
        }
        event("stop", save ? 1 : 0);
        state = IDLE;
    }

    function reportPain(level) {
        event("pain", level);
        if (!link.phoneAlive()) {
            if (level >= 6) {
                showCue("DOLOR " + level + "/10\nPARA", 4, 1);
            } else if (level >= 4) {
                showCue("DOLOR " + level + "/10\nBaja a Z1", 3, 1);
            } else {
                showCue("DOLOR " + level + "/10\nSeguimos", 1, 2);
            }
        }
    }

    function event(name, value) {
        var msg = { "k" => "ev", "e" => name, "t" => seconds, "d" => distance.toNumber() };
        if (value != null) {
            msg["v"] = value;
        }
        link.send(msg, true);
    }

    // ── Bucle de 1 Hz ─────────────────────────────────────────────────────

    function onTick() {
        tick += 1;
        var info = Activity.getActivityInfo();
        if (info != null) {
            hr = info.currentHeartRate;
            cadence = info.currentCadence;
            speed = info.currentSpeed;
            if (info.elapsedDistance != null) { distance = info.elapsedDistance; }
            if (info.timerTime != null) { seconds = info.timerTime / 1000; }
        }

        if (state == RUNNING) {
            var local = coach.update(seconds, distance, hr);
            var alive = link.phoneAlive();
            if (local != null && (!alive || local[2] == 1)) {
                // Sin móvil manda el entrenador local; la alerta de pulso máximo, siempre.
                showCue(local[0], local[1], local[2]);
            }
            if (!alive) {
                targetLine = coach.targetLine();
            }
            if (tick % 3 == 0 && info != null) {
                var s = { "k" => "s", "t" => seconds, "d" => distance.toNumber() };
                if (hr != null) { s["hr"] = hr; }
                if (cadence != null) { s["cad"] = cadence; }
                if (speed != null) { s["spd"] = (speed * 100).toNumber(); }               // cm/s
                if (info.altitude != null) { s["alt"] = info.altitude.toNumber(); }
                if (info.currentHeading != null) {
                    var deg = (Math.toDegrees(info.currentHeading)).toNumber();
                    s["hdg"] = (deg + 360) % 360;
                }
                link.send(s, false);
            }
        }
        WatchUi.requestUpdate();
    }

    // ── Mensajes del móvil ────────────────────────────────────────────────

    function onPhoneCue(text, haptic, priority) {
        if (text == null) {
            return;
        }
        showCue(text, haptic == null ? 1 : haptic, priority == null ? 3 : priority);
    }

    function onPhoneStatus(data) {
        var z = data["z"];
        var pmin = data["pmin"];
        if (pmin != null && data["pmax"] != null) {
            targetLine = fmtPace(pmin) + "-" + fmtPace(data["pmax"]) + " /km";
        } else if (z != null && data["lo"] != null) {
            targetLine = "Z" + z + " " + data["lo"] + "-" + data["hi"];
        } else {
            targetLine = null;
        }
    }

    function onPhoneConfig(data) {
        Application.Storage.setValue("cfg", data);
        applyConfig(data);
        buzz(1);
        WatchUi.requestUpdate();
    }

    function applyConfig(data) {
        title = data["title"];
        coach.setSteps(data["steps"]);
    }

    // ── Indicaciones ──────────────────────────────────────────────────────

    function showCue(text, haptic, priority) {
        cueText = text;
        cuePriority = priority;
        cueUntil = System.getTimer() + (priority == 1 ? 12000 : 8000);
        buzz(haptic);
        try {
            Attention.backlight(true);
        } catch (e) {
            // Algunos AMOLED limitan la retroiluminación: no es crítico.
        }
        WatchUi.requestUpdate();
    }

    // 0 nada · 1 corta · 2 doble · 3 larga · 4 alerta
    function buzz(kind) {
        if (kind == null || kind == 0) {
            return;
        }
        if (Attention has :vibrate) {
            var p;
            if (kind == 1) {
                p = [new Attention.VibeProfile(75, 250)];
            } else if (kind == 2) {
                p = [new Attention.VibeProfile(100, 200), new Attention.VibeProfile(0, 150), new Attention.VibeProfile(100, 200)];
            } else if (kind == 3) {
                p = [new Attention.VibeProfile(100, 900)];
            } else {
                p = [new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 150),
                     new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 150),
                     new Attention.VibeProfile(100, 400)];
            }
            Attention.vibrate(p);
        }
        if (kind >= 3 && Attention has :playTone) {
            Attention.playTone(kind == 4 ? Attention.TONE_ALERT_HI : Attention.TONE_LAP);
        }
    }

    function fmtPace(secPerKm) {
        return (secPerKm / 60) + ":" + (secPerKm % 60).format("%02d");
    }
}
