define(function (require) {
    // Load any app-specific modules
    // with a relative require call,
    // like:
    var P = require('./oPlot');

    // Load library/vendor modules using
    // full IDs, like:
    var ol = require('openlayers');
    var Util = require('Util');

    //init map
    var map = new ol.Map({
        target: 'map',
        layers: [
            new ol.layer.Tile({
                source: new ol.source.OSM()
            })
        ],
        view: new ol.View({
            center: ol.proj.fromLonLat([37.41, 8.82]),
            zoom: 4
        })
    });

    var plotInstance = new P();

    //init oplot tool
    plotInstance.initTool(map);

    var toolBar = document.getElementById('oplot-tool-bar');

    Util.addEvent(toolBar, 'click', click);

    function click(e) {
        console.log(e.target.id);
        var typeText = e.target.id;
        if(typeText == 'clear'){
            plotInstance.quiteEdit();
        } else if(typeText == 'save'){
            plotInstance.saveAs();
        }else {
            plotInstance.startEdit(typeText);
        }
    }

});