define(function() {
    function addEvent(element, event, listener) {
        if (element.addEventListener) {
            element.addEventListener(event, listener, false);
        } else if (element.attachEvent) {
            element.attachEvent('on' + event, listener);
        } else {
            element["on" + event] = listener;
        }
    };

    function removeEvent(element, event, listener) {
        if (element.removeEventListener) {
            element.removeEventListener(event, listener, false);
        } else if (element.detachEvent) {
            element.detachEvent('on' + event, listener);
        } else {
            element['on' + event] = null;
        }
    };

    function getStyle(element, attr) {
        //IE写法
        if (element.currentStyle) {
            return element.currentStyle[attr];
            //标准
        } else {
            return getComputedStyle(element, false)[attr];
        }
    };

    return {
        addEvent: addEvent,
        removeEvent: removeEvent,
        getStyle: getStyle
    }
})