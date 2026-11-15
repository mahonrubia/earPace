import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

// Canal con la app del móvil (Connect IQ Mobile SDK).
// Protocolo (diccionarios pequeños, clave "k" = tipo):
//   reloj → móvil  {k:"s", t, d, hr, cad, spd, alt, hdg}     muestra en vivo
//                  {k:"ev", e:"start|pause|resume|lap|stop|pain", v}
//                  {k:"prof", zones:[6], w, rhr}             perfil de Garmin
//   móvil → reloj  {k:"cue", s:"texto", h:0..4, p:1..4}      indicación
//                  {k:"st", z, lo, hi, pmin, pmax}           objetivo actual
//                  {k:"cfg", steps:[[kind,durType,dur,zone]], title}
class PhoneLink {

    var busy = false;
    var busySince = 0;
    var lastHeard = -100000;   // System.getTimer() del último mensaje del móvil
    var handler;               // objeto con onPhoneCue / onPhoneStatus / onPhoneConfig
    var listener;

    function initialize(h) {
        handler = h;
        listener = new LinkListener(self);
        Communications.registerForPhoneAppMessages(method(:onMessage));
    }

    // El móvil está vivo si ha dicho algo en los últimos 20 s.
    function phoneAlive() {
        return System.getTimer() - lastHeard < 20000;
    }

    function onMessage(msg) {
        var data = msg.data;
        if (data == null || !(data instanceof Lang.Dictionary)) {
            return;
        }
        lastHeard = System.getTimer();
        var kind = data["k"];
        if (kind == null) {
            return;
        }
        if (kind.equals("cue")) {
            handler.onPhoneCue(data["s"], data["h"], data["p"]);
        } else if (kind.equals("st")) {
            handler.onPhoneStatus(data);
        } else if (kind.equals("cfg")) {
            handler.onPhoneConfig(data);
        }
    }

    // Envía solo si el envío anterior terminó: una muestra perdida no importa,
    // una cola atascada sí. Los eventos (important = true) se envían siempre.
    function send(payload, important) {
        var now = System.getTimer();
        if (busy && !important && now - busySince < 8000) {
            return;
        }
        if (!System.getDeviceSettings().phoneConnected) {
            return;
        }
        busy = true;
        busySince = now;
        Communications.transmit(payload, null, listener);
    }
}

class LinkListener extends Communications.ConnectionListener {

    var link;

    function initialize(l) {
        ConnectionListener.initialize();
        link = l;
    }

    function onComplete() {
        link.busy = false;
    }

    function onError() {
        link.busy = false;
    }
}
