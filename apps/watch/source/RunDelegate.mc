import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Botones:  START/STOP  empezar · pausar (en pausa abre el menú de guardar)
//           BACK/LAP    siguiente paso del entrenamiento
//           MENÚ        avisar de dolor al entrenador
class RunDelegate extends WatchUi.BehaviorDelegate {

    var run;

    function initialize(controller) {
        BehaviorDelegate.initialize();
        run = controller;
    }

    function onSelect() {
        if (run.state == RunController.PAUSED) {
            var menu = new WatchUi.Menu2({ :title => "En pausa" });
            menu.addItem(new WatchUi.MenuItem("Reanudar", null, :resume, null));
            menu.addItem(new WatchUi.MenuItem("Guardar", null, :save, null));
            menu.addItem(new WatchUi.MenuItem("Descartar", null, :discard, null));
            WatchUi.pushView(menu, new PauseMenuDelegate(run), WatchUi.SLIDE_UP);
        } else {
            run.startOrPause();
        }
        return true;
    }

    function onBack() {
        if (run.state == RunController.RUNNING) {
            run.lap();
            return true;
        }
        if (run.state == RunController.PAUSED) {
            return onSelect();
        }
        return false; // en reposo: salir de la app
    }

    function onMenu() {
        if (run.state == RunController.IDLE) {
            return false;
        }
        var menu = new WatchUi.Menu2({ :title => "¿Dolor?" });
        menu.addItem(new WatchUi.MenuItem("Leve (2)", "Sigo bien", 2, null));
        menu.addItem(new WatchUi.MenuItem("Moderado (5)", "Me molesta", 5, null));
        menu.addItem(new WatchUi.MenuItem("Fuerte (7)", "Cambio la pisada", 7, null));
        WatchUi.pushView(menu, new PainMenuDelegate(run), WatchUi.SLIDE_UP);
        return true;
    }
}

class PauseMenuDelegate extends WatchUi.Menu2InputDelegate {

    var run;

    function initialize(controller) {
        Menu2InputDelegate.initialize();
        run = controller;
    }

    function onSelect(item) {
        var id = item.getId();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (id == :resume) {
            run.startOrPause();
        } else if (id == :save) {
            run.finish(true);
        } else if (id == :discard) {
            run.finish(false);
        }
    }
}

class PainMenuDelegate extends WatchUi.Menu2InputDelegate {

    var run;

    function initialize(controller) {
        Menu2InputDelegate.initialize();
        run = controller;
    }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        run.reportPain(item.getId());
    }
}
