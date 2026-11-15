import Toybox.Lang;
import Toybox.UserProfile;

// Entrenador local reducido para cuando no hay móvil cerca:
// pasos del entrenamiento, zona de pulso objetivo, parciales y seguridad.
// El entrenador completo (clima, desnivel, lesiones, zapatillas...) vive en el móvil.
class LocalCoach {

    const KIND_NAMES = ["CALENTAR", "SERIE", "RECUPERA", "ENFRIAR", "CONTINUO"];

    var zones;            // [minZ1, maxZ1, maxZ2, maxZ3, maxZ4, maxZ5]
    var steps = [];       // [[kind, durType(0 tiempo,1 distancia,2 abierto), dur, zone]]
    var stepIdx = 0;
    var stepStartT = 0;
    var stepStartD = 0.0;
    var done = false;
    var aboveSince = -1;
    var lastHrCue = -1000;
    var lastKm = 0;
    var lastKmT = 0;
    var maxSince = -1;
    var lastMaxCue = -1000;
    var announced = false;

    function initialize() {
        zones = UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_RUNNING);
    }

    function setSteps(s) {
        if (s != null && s instanceof Lang.Array) {
            steps = s;
        }
    }

    function reset() {
        stepIdx = 0;
        stepStartT = 0;
        stepStartD = 0.0;
        done = false;
        announced = false;
        aboveSince = -1;
        lastKm = 0;
        lastKmT = 0;
    }

    function currentStep() {
        if (done || stepIdx >= steps.size()) {
            return null;
        }
        return steps[stepIdx];
    }

    function zoneOf(hr) {
        if (zones == null || zones.size() < 6 || hr == null) {
            return 0;
        }
        if (hr < zones[0]) {
            return 0;
        }
        for (var i = 1; i < 6; i++) {
            if (hr <= zones[i]) {
                return i;
            }
        }
        return 5;
    }

    function targetZone() {
        var st = currentStep();
        if (st == null || st[3] == null || st[3] < 1) {
            return 0;
        }
        return st[3];
    }

    // Texto fijo de la línea de objetivo, p. ej. "Z2 135-148".
    function targetLine() {
        var z = targetZone();
        if (z < 1 || zones == null || zones.size() < 6) {
            return null;
        }
        var lo = z == 1 ? zones[0] : zones[z - 1] + 1;
        return "Z" + z + " " + lo + "-" + zones[z];
    }

    function stepCue() {
        var st = currentStep();
        if (st == null) {
            return "COMPLETADO";
        }
        var txt = KIND_NAMES[st[0]];
        if (st[1] == 0) {
            txt = txt + " " + (st[2] / 60) + ":" + (st[2] % 60).format("%02d");
        } else if (st[1] == 1) {
            txt = txt + " " + st[2] + " m";
        } else {
            txt = txt + " (LAP)";
        }
        var tl = targetLine();
        return tl != null ? txt + "\n" + tl : txt;
    }

    function advance(t, d) {
        stepIdx += 1;
        stepStartT = t;
        stepStartD = d;
        aboveSince = -1;
        if (stepIdx >= steps.size()) {
            done = true;
        }
    }

    // Devuelve [texto, vibración, prioridad] o null. Siempre lleva la cuenta de
    // los pasos (aunque mande el móvil) para poder tomar el relevo en cualquier momento.
    function update(t, d, hr) {
        var cue = null;

        var st = currentStep();
        if (st != null) {
            if (!announced) {
                announced = true;
                cue = [stepCue(), 2, 2];
            }
            var over = (st[1] == 0 && t - stepStartT >= st[2]) || (st[1] == 1 && d - stepStartD >= st[2]);
            if (over) {
                advance(t, d);
                cue = [stepCue(), done ? 3 : 2, 2];
            }
        }

        if (hr != null && zones != null && zones.size() >= 6) {
            // Seguridad: pulso prácticamente máximo durante 15 s.
            if (hr >= zones[5] * 0.98) {
                if (maxSince < 0) {
                    maxSince = t;
                }
                if (t - maxSince >= 15 && t - lastMaxCue >= 120) {
                    lastMaxCue = t;
                    return ["FC MAXIMA " + hr + "\nCAMINA", 4, 1];
                }
            } else {
                maxSince = -1;
            }

            var z = targetZone();
            if (z > 0 && t - stepStartT >= 60) {
                var top = zones[z];
                if (hr > top + 2) {
                    if (aboveSince < 0) {
                        aboveSince = t;
                    }
                    if (cue == null && t - aboveSince >= 20 && t - lastHrCue >= 90) {
                        lastHrCue = t;
                        cue = ["BAJA RITMO\nFC " + hr + " > " + top, 2, 2];
                    }
                } else {
                    aboveSince = -1;
                }
            }
        }

        var km = (d / 1000).toNumber();
        if (km > lastKm) {
            var lap = (t - lastKmT) / (km - lastKm);
            lastKm = km;
            lastKmT = t;
            if (cue == null) {
                cue = ["KM " + km + "  " + (lap / 60) + ":" + (lap % 60).format("%02d"), 1, 3];
            }
        }
        return cue;
    }

    function lap(t, d) {
        if (currentStep() == null) {
            return null;
        }
        advance(t, d);
        return [stepCue(), 2, 2];
    }
}
