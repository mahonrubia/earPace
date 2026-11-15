import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

class RunView extends WatchUi.View {

    const ZONE_COLORS = [Graphics.COLOR_LT_GRAY, Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLUE,
                         Graphics.COLOR_GREEN, Graphics.COLOR_ORANGE, Graphics.COLOR_RED];

    var run;

    function initialize(controller) {
        View.initialize();
        run = controller;
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        if (run.cueText != null && System.getTimer() < run.cueUntil) {
            drawCue(dc, w, h);
            return;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        // Tiempo
        dc.drawText(cx, h * 0.08, Graphics.FONT_MEDIUM, fmtTime(run.seconds), Graphics.TEXT_JUSTIFY_CENTER);

        // Pulso (color por zona) y ritmo
        var zone = run.coach.zoneOf(run.hr);
        dc.setColor(ZONE_COLORS[zone], Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.28, h * 0.26, Graphics.FONT_NUMBER_MILD, run.hr != null ? run.hr.toString() : "--", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w * 0.28, h * 0.46, Graphics.FONT_XTINY, zone > 0 ? "Z" + zone : "FC", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.70, h * 0.26, Graphics.FONT_NUMBER_MILD, fmtPace(run.speed), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w * 0.70, h * 0.46, Graphics.FONT_XTINY, "/km", Graphics.TEXT_JUSTIFY_CENTER);

        // Distancia y cadencia
        var line = (run.distance / 1000.0).format("%.2f") + " km";
        if (run.cadence != null) {
            line = line + "  " + run.cadence + " cad";
        }
        dc.drawText(cx, h * 0.56, Graphics.FONT_SMALL, line, Graphics.TEXT_JUSTIFY_CENTER);

        // Línea inferior: estado u objetivo actual
        var bottom;
        var color = Graphics.COLOR_LT_GRAY;
        if (run.state == RunController.IDLE) {
            bottom = run.gpsQuality >= 3 ? "START para empezar" : "Buscando GPS...";
            color = run.gpsQuality >= 3 ? Graphics.COLOR_GREEN : Graphics.COLOR_YELLOW;
            if (run.title != null) {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, h * 0.80, Graphics.FONT_XTINY, run.title, Graphics.TEXT_JUSTIFY_CENTER);
            }
        } else if (run.state == RunController.PAUSED) {
            bottom = "EN PAUSA";
            color = Graphics.COLOR_YELLOW;
        } else {
            bottom = run.targetLine != null ? run.targetLine : "Carrera libre";
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.69, Graphics.FONT_SMALL, bottom, Graphics.TEXT_JUSTIFY_CENTER);

        // Indicador de enlace con el móvil
        dc.setColor(run.link.phoneAlive() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, h * 0.93, 4);
    }

    // Indicación a pantalla completa: fondo según prioridad, texto grande.
    function drawCue(dc, w, h) {
        var bg = Graphics.COLOR_BLACK;
        var fg = Graphics.COLOR_WHITE;
        if (run.cuePriority == 1) {
            bg = Graphics.COLOR_RED;
        } else if (run.cuePriority == 2) {
            bg = Graphics.COLOR_ORANGE;
            fg = Graphics.COLOR_BLACK;
        }
        dc.setColor(fg, bg);
        dc.clear();

        var lines = split(run.cueText);
        var font = Graphics.FONT_MEDIUM;
        // Si alguna línea no cabe, baja el tamaño de letra.
        for (var i = 0; i < lines.size(); i++) {
            if (dc.getTextWidthInPixels(lines[i], font) > w * 0.86) {
                font = Graphics.FONT_SMALL;
            }
        }
        for (var i = 0; i < lines.size(); i++) {
            if (dc.getTextWidthInPixels(lines[i], font) > w * 0.86) {
                font = Graphics.FONT_TINY;
            }
        }
        var lh = dc.getFontHeight(font);
        var y = (h - lh * lines.size()) / 2;
        for (var i = 0; i < lines.size(); i++) {
            dc.drawText(w / 2, y + i * lh, font, lines[i], Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    function split(text) {
        var out = [];
        var rest = text;
        var idx = rest.find("\n");
        while (idx != null) {
            out.add(rest.substring(0, idx));
            rest = rest.substring(idx + 1, rest.length());
            idx = rest.find("\n");
        }
        out.add(rest);
        return out;
    }

    function fmtTime(s) {
        var hh = s / 3600;
        var mm = (s % 3600) / 60;
        var ss = s % 60;
        if (hh > 0) {
            return hh + ":" + mm.format("%02d") + ":" + ss.format("%02d");
        }
        return mm + ":" + ss.format("%02d");
    }

    function fmtPace(speed) {
        if (speed == null || speed < 0.7) {
            return "-:--";
        }
        var p = (1000.0 / speed).toNumber();
        return (p / 60) + ":" + (p % 60).format("%02d");
    }
}
