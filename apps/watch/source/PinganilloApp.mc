import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Pinganillo: entrenador de carrera en la muñeca.
// El reloj graba la actividad, envía los datos en vivo al móvil y muestra/vibra
// las indicaciones que este le devuelve. Sin móvil, usa un entrenador local reducido.
class PinganilloApp extends Application.AppBase {

    var run;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        run = new RunController();
        run.setUp();
    }

    function onStop(state) {
        if (run != null) {
            run.tearDown();
        }
    }

    function getInitialView() {
        var view = new RunView(run);
        return [view, new RunDelegate(run)];
    }
}
