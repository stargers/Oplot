;
(function (root, factory) {
    if (typeof exports === "object") {
        module.exports = factory();
    } else if (typeof define === "function" && define.amd) {
        define(['ol-debug'], factory);
    } else {
        root.P = factory();
    }
}(this, function () {

    var P = function (map, config) {
        this.version = '0.0.1';
        this.config = config || {
            singleModel: true, // 是否使用单选模式（每次进行任意标绘时, 都需要重新选择标绘类型     
        };

        this.state = {
            map: map || null, //map实例
            currentPlotType: null, // 当前标绘类型
            lastPlotType: null,
            drawInteraction: null, // 使用中的标绘交互逻辑
            layer: null,
            source: null,
            init: 'state init'
        }
    };

    var Constants = {
        TWO_PI: Math.PI * 2,
        HALF_PI: Math.PI / 2,
        FITTING_COUNT: 100,
        ZERO_TOLERANCE: 0.0001,
    };

    var ShapeConstants = {
        curve: {
            t: 0.3
        },
        closedcurve: {
            t: 0.3
        },
        straightarrow: {
            fixPointCount : 2,
            maxArrowLength : 3000000,
            arrowLengthScale : 5,
        },
        finearrow: {
            tailWidthFactor: 0.15,
            neckWidthFactor: 0.2,
            headWidthFactor: 0.25,
            headAngle: Math.PI / 8.5,
            neckAngle: Math.PI / 13,
            fixPointCount: 2
        },
        attackarrow: {
            headHeightFactor: 0.18,
            headWidthFactor: 0.3,
            neckHeightFactor: 0.85,
            neckWidthFactor: 0.15,
            headTailFactor: 0.8,
        },
        tailedattackarrow: {
            headHeightFactor: 0.18,
            headWidthFactor: 0.3,
            neckHeightFactor: 0.85,
            neckWidthFactor: 0.15,
            tailWidthFactor: 0.1,
            headTailFactor: 0.8,
            swallowTailFactor: 1,
            swallowTailPnt: null,
        }
    }

    // 标绘类型
    P.prototype.PlotType = {
        // 点
        point: {
            className: 'Point',
            originType: 'Point',
        },
        marker: {
            className: 'Marker',
            originType: 'Point',
            geometryFn: markerDrawFn
        },
        // 多线
        lineString: {
            className: 'LineString',
            originType: 'LineString'
        },
        //弧线
        arc: {
            className: 'Arc',
            originType: 'LineString',
            geometryFn: arcDrawFn
        },
        //自由曲线
        curve: {
            className: 'Curve',
            originType: 'LineString',
            geometryFn: curveDrawFn,
        },
        //闭合曲线
        closedcurve: {
            className: 'ClosedCurve',
            originType: 'Polygon',
            geometryFn: closedcurveDrawFn
        },
        // 自由面
        polygon: {
            className: 'Polygon',
            originType: 'Polygon'
        },
        // 矩形
        box: {
            className: 'Box',
            originType: 'Circle',
            geometryFn: ol.interaction.Draw.createBox()
        },
        // 星形
        star: {
            className: 'Star',
            originType: 'Circle',
            geometryFn: starDrawFn
        },
        // 线状单箭头
        straightarrow: {
            className: 'StraightArrow',
            originType: 'LineString',
            geometryFn: straightArrowDrawFn,
        },
        // 直线面状单箭头
        finearrow: {
            className: 'FineArrow',
            originType: 'LineString',
            geometryFn: finearrowDrawFn
        },
        // 面状三点平单箭头
        attackarrow: {
            className: 'AttackArrow',
            originType: 'LineString',
            geometryFn: attackarrowDrawFn
        },
        // 面状三点尖单箭头
        tailedattackarrow: {
            className: 'tailedAttackArrow',
            originType: 'LineString',
            geometryFn: tailedAttackArrowDrawFn
            
        }
    }

    P.prototype.initTool = function (map, config) {
        if (!!config) {
            this.config.singleModel = config.singleModel;
        }

        if (!this.state.map) {
            this.state.map = map;
        }
        var source = new ol.source.Vector();
        var vector = new ol.layer.Vector({
            source: source,
            style: new ol.style.Style({
                fill: new ol.style.Fill({
                    color: 'rgba(255, 255, 255, 0.2)'
                }),
                stroke: new ol.style.Stroke({
                    color: '#ffcc33',
                    width: 2
                }),
                image: new ol.style.Circle({
                    radius: 7,
                    fill: new ol.style.Fill({
                        color: '#ffcc33'
                    })
                })
            })
        });
        this.state.map.addLayer(vector);

        this.state.map = map;
        this.state.source = source;
        this.state.layer = vector;
    }

    // type  : string 标绘类型的字符串，P.PlotType 的枚举值
    P.prototype.startEdit = function (type) {
        // 当前标绘类型
        var currentType = this.PlotType[type];
        var _state = this.state;
        if (!currentType)
            return console.log('unknown plot type');
        this.state.currentPlotType = currentType;
        //判断当前标绘类型是否改变
        if (!!_state.lastPlotType &&
            _state.lastPlotType.className != currentType.className) {
            //改变 -- 清除上次标绘的交互
            this.removeInteraction();
        }

        this.addInteraction(currentType);
        _state.lastPlotType = currentType;
    }

    // 清除标绘features
    P.prototype.quiteEdit = function () {
        this.removeInteraction();

        this.state.source.clear();
    }

    // 导出标绘features 为KML
    P.prototype.saveAs = function () {
        var KMLFormat = new ol.format.KML();
        var features = this.state.source.getFeatures();
        var formatData = KMLFormat.writeFeatures(features);
        var file = new Blob([formatData], {
            type: 'text/plain'
        });
        var url = URL.createObjectURL(file);

        var a = document.createElement('a');
        a.download = 'plot.kml';
        a.href = url;
        a.click()
    }



    P.prototype.addInteraction = function (plotType) {
        var _state = this.state;
        var dblClickInteraction = null;
        if (!_state.map) {
            throw new Error('please init oplot first');
        }

        var draw = new ol.interaction.Draw({
            clickTolerance: 20,
            source: _state.source,
            type: plotType.originType,
            geometryFunction: plotType.geometryFn,
        });
        console.log(_state.map.getInteractions());
        window.arr = _state.map.getInteractions()

        //在编辑过程中,找到双击交互并禁用
        _state.map.getInteractions().forEach(function (value) {
            if (value instanceof ol.interaction.DoubleClickZoom) {
                !!value.setActive && value.setActive(false);
                dblClickInteraction = value;
                console.log('dblclick', dblClickInteraction);
            }
        })

        _state.map.addInteraction(draw);
        _state.drawInteraction = draw;

        draw.on('drawend', function (event) {
            // event.preventDefault();
            // event.stopPropagation();

            //单选模式
            if (this.config.singleModel) {
                this.removeInteraction();
                console.log('draw end', event);
            }
            setTimeout(function () {
                dblClickInteraction.setActive(true);
            }, 0);
        }.bind(this))
    }

    P.prototype.removeInteraction = function () {
        if (!this.state.map) {
            return false;
        }
        this.state.map.removeInteraction(this.state.drawInteraction);
    }



    /**
     * 自定义marker绘制函数
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     */
    function markerDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.Point(null);
        }
    }

    /**
     * 曲线标绘形状 绘制函数
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     */
    function arcDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.LineString(null);
        }
        var count = coordinates.length;

        if (count == 2) {
            geometry.setCoordinates(coordinates);
            return geometry;
        } else if (count == 3) {
            var pnt1 = coordinates[0];
            var pnt2 = coordinates[1];
            var pnt3 = coordinates[2];
            var center = PlotUtils.getCircleCenterOfThreePoints(pnt1, pnt2, pnt3);
            var radius = PlotUtils.distance(pnt1, center);

            var angle1 = PlotUtils.getAzimuth(pnt1, center);
            var angle2 = PlotUtils.getAzimuth(pnt2, center);
            if (PlotUtils.isClockWise(pnt1, pnt2, pnt3)) {
                var startAngle = angle2;
                var endAngle = angle1;
            } else {
                startAngle = angle1;
                endAngle = angle2;
            }

            var newCoordinates = PlotUtils.getArcPoints(center, radius, startAngle, endAngle);

            geometry.setCoordinates(newCoordinates);
            return geometry;
        } else {
            // 当点击三个点之后,点击完成，完成绘制，退出并emit drawend 事件
            this.finishDrawing();
        }
    }

    /**
     * 
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     */
    function curveDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.LineString(null);
        }
        var count = coordinates.length;

        if (count == 2) {
            geometry.setCoordinates(coordinates);
        } else {
            geometry.setCoordinates(PlotUtils.getCurvePoints(ShapeConstants.curve.t, coordinates));
        }

        return geometry;
    }


    /**
     * 线状单箭头 绘制函数
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     * @returns 
     */
    function straightArrowDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.LineString(null);
        }
        count = coordinates.length;

        if(count == 3){
            this.finishDrawing();
        }

        var pnt1 = coordinates[0];
        var pnt2 = coordinates[1];
        var distance = PlotUtils.distance(pnt1, pnt2);
        var len = distance / ShapeConstants.straightarrow.arrowLengthScale;
        len = len > ShapeConstants.straightarrow.maxArrowLength 
                        ? ShapeConstants.straightarrow.maxArrowLength : len;
        var leftPnt = PlotUtils.getThirdPoint(pnt1, pnt2, Math.PI / 6, len, false);
        var rightPnt = PlotUtils.getThirdPoint(pnt1, pnt2, Math.PI / 6, len, true);
        geometry.setCoordinates([pnt1, pnt2, leftPnt, pnt2, rightPnt]);

        return geometry;
    }


    /**
     * 直线面状单箭头
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     * @returns 
     */
    function finearrowDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.Polygon(null);
        }

        var count = coordinates.length;
        if(count == 1){
            geometry.setCoordinates(coordinates);
            return geometry;
        }else if(count == 2){
            var pnt1 = coordinates[0];
            var pnt2 = coordinates[1];
            var len = PlotUtils.getBaseLength(coordinates);
            var tailWidth = len * ShapeConstants.finearrow.tailWidthFactor;
            var neckWidth = len * ShapeConstants.finearrow.neckWidthFactor;
            var headWidth = len * ShapeConstants.finearrow.headWidthFactor;
            var tailLeft = PlotUtils.getThirdPoint(pnt2, pnt1, Constants.HALF_PI, tailWidth, true);
            var tailRight = PlotUtils.getThirdPoint(pnt2, pnt1, Constants.HALF_PI, tailWidth, false);
            var headLeft = PlotUtils.getThirdPoint(pnt1, pnt2, ShapeConstants.finearrow.headAngle, headWidth, false);
            var headRight = PlotUtils.getThirdPoint(pnt1, pnt2, ShapeConstants.finearrow.headAngle, headWidth, true);
            var neckLeft = PlotUtils.getThirdPoint(pnt1, pnt2, ShapeConstants.finearrow.neckAngle, neckWidth, false);
            var neckRight = PlotUtils.getThirdPoint(pnt1, pnt2, ShapeConstants.finearrow.neckAngle, neckWidth, true);
            var pList = [tailLeft, neckLeft, headLeft, pnt2, headRight, neckRight, tailRight];

            pList.push(pList[0].slice());
            
            geometry.setCoordinates([pList]);
            return geometry;
        }else {
            this.finishDrawing();
        }
    }

    
    /**
     * 面状三点平单箭头 绘制函数
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     * @returns 
     */
    function attackarrowDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.Polygon(null);
        }
        var count = coordinates.length;
        console.log(count);

        if (count == 1) {
            geometry.setCoordinates([coordinates]);
            return geometry;
        }
        if (count == 2) {
            geometry.setCoordinates([coordinates]);
            return geometry;
        }else if(count == 3){
            // 计算箭尾
            var tailLeft = coordinates[0];
            var tailRight = coordinates[1];
            if (PlotUtils.isClockWise(coordinates[0], coordinates[1], coordinates[2])) {
                tailLeft = coordinates[1];
                tailRight = coordinates[0];
            }
            var midTail = PlotUtils.mid(tailLeft, tailRight);
            var bonePnts = [midTail].concat(coordinates.slice(2));
            // 计算箭头
            var headPnts = getArrowHeadPoints(bonePnts, tailLeft, tailRight);
            var neckLeft = headPnts[0];
            var neckRight = headPnts[4];
            var tailWidthFactor = PlotUtils.distance(tailLeft, tailRight) / PlotUtils.getBaseLength(bonePnts);
            // 计算箭身
            var bodyPnts = getArrowBodyPoints(bonePnts, neckLeft, neckRight, tailWidthFactor);
            // 整合
            var count = bodyPnts.length;
            var leftPnts = [tailLeft].concat(bodyPnts.slice(0, count / 2));
            leftPnts.push(neckLeft);
            var rightPnts = [tailRight].concat(bodyPnts.slice(count / 2, count));
            rightPnts.push(neckRight);

            leftPnts = PlotUtils.getQBSplinePoints(leftPnts);
            rightPnts = PlotUtils.getQBSplinePoints(rightPnts);

            geometry.setCoordinates([leftPnts.concat(headPnts, rightPnts.reverse())]);
            return geometry;
        }else{
            this.finishDrawing();
        }
    }

    function getArrowHeadPoints(points, tailLeft, tailRight){
        var len = PlotUtils.getBaseLength(points);
        var headHeight = len * ShapeConstants.attackarrow.headHeightFactor;
        var headPnt = points[points.length - 1];
        len = PlotUtils.distance(headPnt, points[points.length - 2]);
        var tailWidth = PlotUtils.distance(tailLeft, tailRight);
        if (headHeight > tailWidth * ShapeConstants.attackarrow.headTailFactor) {
            headHeight = tailWidth * ShapeConstants.attackarrow.headTailFactor;
        }
        var headWidth = headHeight * ShapeConstants.attackarrow.headWidthFactor;
        var neckWidth = headHeight * ShapeConstants.attackarrow.neckWidthFactor;
        headHeight = headHeight > len ? len : headHeight;
        var neckHeight = headHeight * ShapeConstants.attackarrow.neckHeightFactor;
        var headEndPnt = PlotUtils.getThirdPoint(points[points.length - 2], headPnt, 0, headHeight, true);
        var neckEndPnt = PlotUtils.getThirdPoint(points[points.length - 2], headPnt, 0, neckHeight, true);
        var headLeft = PlotUtils.getThirdPoint(headPnt, headEndPnt, Constants.HALF_PI, headWidth, false);
        var headRight = PlotUtils.getThirdPoint(headPnt, headEndPnt, Constants.HALF_PI, headWidth, true);
        var neckLeft = PlotUtils.getThirdPoint(headPnt, neckEndPnt, Constants.HALF_PI, neckWidth, false);
        var neckRight = PlotUtils.getThirdPoint(headPnt, neckEndPnt, Constants.HALF_PI, neckWidth, true);
        return [neckLeft, headLeft, headPnt, headRight, neckRight];
    }

    function getArrowBodyPoints(points, neckLeft, neckRight, tailWidthFactor) {
        var allLen = PlotUtils.wholeDistance(points);
        var len = PlotUtils.getBaseLength(points);
        var tailWidth = len * tailWidthFactor;
        var neckWidth = PlotUtils.distance(neckLeft, neckRight);
        var widthDif = (tailWidth - neckWidth) / 2;
        var tempLen = 0, leftBodyPnts = [], rightBodyPnts = [];
        for (var i = 1; i < points.length - 1; i++) {
            var angle = PlotUtils.getAngleOfThreePoints(points[i - 1], points[i], points[i + 1]) / 2;
            tempLen += PlotUtils.distance(points[i - 1], points[i]);
            var w = (tailWidth / 2 - tempLen / allLen * widthDif) / Math.sin(angle);
            var left = PlotUtils.getThirdPoint(points[i - 1], points[i], Math.PI - angle, w, true);
            var right = PlotUtils.getThirdPoint(points[i - 1], points[i], angle, w, false);
            leftBodyPnts.push(left);
            rightBodyPnts.push(right);
        }
        return leftBodyPnts.concat(rightBodyPnts);
    };

    /**
     * 面状三点尖单箭头 绘制函数
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     * @returns 
     */
    function tailedAttackArrowDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.Polygon(null);
        }
        var count = coordinates.length;
        console.log(count);
        

        if (count == 2) {
            geometry.setCoordinates([coordinates]);
            return geometry;
        } else if(count == 3){
            var pnts = coordinates;
            var tailLeft = pnts[0];
            var tailRight = pnts[1];
            if (PlotUtils.isClockWise(pnts[0], pnts[1], pnts[2])) {
                tailLeft = pnts[1];
                tailRight = pnts[0];
            }
            var midTail = PlotUtils.mid(tailLeft, tailRight);
            var bonePnts = [midTail].concat(pnts.slice(2));
            var headPnts = getArrowHeadPoints(bonePnts, tailLeft, tailRight);
            var neckLeft = headPnts[0];
            var neckRight = headPnts[4];
            var tailWidth = PlotUtils.distance(tailLeft, tailRight);
            var allLen = PlotUtils.getBaseLength(bonePnts);
            var len = allLen * ShapeConstants.tailedattackarrow.tailWidthFactor * ShapeConstants.tailedattackarrow.swallowTailFactor;
            ShapeConstants.tailedattackarrow.swallowTailPnt = PlotUtils.getThirdPoint(bonePnts[1], bonePnts[0], 0, len, true);
            var factor = tailWidth / allLen;
            var bodyPnts = getArrowBodyPoints(bonePnts, neckLeft, neckRight, factor);
            var count = bodyPnts.length;
            var leftPnts = [tailLeft].concat(bodyPnts.slice(0, count / 2));
            leftPnts.push(neckLeft);
            var rightPnts = [tailRight].concat(bodyPnts.slice(count / 2, count));
            rightPnts.push(neckRight);

            leftPnts = PlotUtils.getQBSplinePoints(leftPnts);
            rightPnts = PlotUtils.getQBSplinePoints(rightPnts);
            geometry.setCoordinates([leftPnts.concat(headPnts, rightPnts.reverse(), [ShapeConstants.tailedattackarrow.swallowTailPnt, leftPnts[0]])]);
            
            return geometry;
        }else {
            this.finishDrawing();
        }
    }

    function closedcurveDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.Polygon(null);
        }

        var count = coordinates.length;
        if (count < 2) {
            geometry.setCoordinates([coordinates]);            
            return geometry;
        }
        if (count == 2) {
            geometry.setCoordinates([coordinates]);
            return geometry;
        }
        else {
            coordinates.push(coordinates[0], coordinates[1]);
            var normals = [];
            for (var i = 0; i < count - 2; i++) {
                var normalPoints = PlotUtils.getBisectorNormals(ShapeConstants.closedcurve.t, coordinates[i], coordinates[i + 1], coordinates[i + 2]);
                normals = normals.concat(normalPoints);
            }
            var len = normals.length;
            normals = [normals[len - 1]].concat(normals.slice(0, len - 1));

            var pList = [];
            for (i = 0; i < count - 2; i++) {
                var pnt1 = coordinates[i];
                var pnt2 = coordinates[i + 1];
                pList.push(pnt1);
                for (var i = 0; i <= Constants.FITTING_COUNT; i++) {
                    var pnt = PlotUtils.getCubicValue(i / Constants.FITTING_COUNT, pnt1, normals[i * 2], normals[i * 2 + 1], pnt2);
                    pList.push(pnt);
                }
                pList.push(pnt2);
            }
            geometry.setCoordinates([pList]);
            return geometry;
        }
    }

    /**
     * 星形标绘形状 绘制函数
     * 
     * @param {any} coordinates 
     * @param {any} geometry 
     * @returns 
     */
    function starDrawFn(coordinates, geometry) {
        if (!geometry) {
            geometry = new ol.geom.Polygon(null);
        }

        console.log(coordinates.length)

        var center = coordinates[0];
        var last = coordinates[1];


        var dx = center[0] - last[0];
        var dy = center[1] - last[1];
        var radius = Math.sqrt(dx * dx + dy * dy);

        var rotation = Math.atan2(dy, dx);
        var newCoordinates = [];
        var numPoints = 12;
        for (var i = 0; i < numPoints; ++i) {
            var angle = rotation + i * 2 * Math.PI / numPoints;
            var fraction = i % 2 === 0 ? 1 : 0.5;
            var offsetX = radius * fraction * Math.cos(angle);
            var offsetY = radius * fraction * Math.sin(angle);
            newCoordinates.push([center[0] + offsetX, center[1] + offsetY]);
        }
        newCoordinates.push(newCoordinates[0].slice());
        geometry.setCoordinates([newCoordinates]);
        return geometry;
    }

    Constants = {
        TWO_PI: Math.PI * 2,
        HALF_PI: Math.PI / 2,
        FITTING_COUNT: 100,
        ZERO_TOLERANCE: 0.0001
    };

    PlotUtils = {};

    PlotUtils.distance = function (pnt1, pnt2) {
        return Math.sqrt(Math.pow((pnt1[0] - pnt2[0]), 2) + Math.pow((pnt1[1] - pnt2[1]), 2));
    };

    PlotUtils.wholeDistance = function (points) {
        var distance = 0;
        for (var i = 0; i < points.length - 1; i++)
            distance += PlotUtils.distance(points[i], points[i + 1]);
        return distance;
    };

    PlotUtils.getBaseLength = function (points) {
        return Math.pow(PlotUtils.wholeDistance(points), 0.99);
        //return PlotUtils.wholeDistance(points);
    };

    PlotUtils.mid = function (pnt1, pnt2) {
        return [(pnt1[0] + pnt2[0]) / 2, (pnt1[1] + pnt2[1]) / 2];
    };

    PlotUtils.getCircleCenterOfThreePoints = function (pnt1, pnt2, pnt3) {
        var pntA = [(pnt1[0] + pnt2[0]) / 2, (pnt1[1] + pnt2[1]) / 2];
        var pntB = [pntA[0] - pnt1[1] + pnt2[1], pntA[1] + pnt1[0] - pnt2[0]];
        var pntC = [(pnt1[0] + pnt3[0]) / 2, (pnt1[1] + pnt3[1]) / 2];
        var pntD = [pntC[0] - pnt1[1] + pnt3[1], pntC[1] + pnt1[0] - pnt3[0]];
        return PlotUtils.getIntersectPoint(pntA, pntB, pntC, pntD);
    };

    PlotUtils.getIntersectPoint = function (pntA, pntB, pntC, pntD) {
        if (pntA[1] == pntB[1]) {
            var f = (pntD[0] - pntC[0]) / (pntD[1] - pntC[1]);
            var x = f * (pntA[1] - pntC[1]) + pntC[0];
            var y = pntA[1];
            return [x, y];
        }
        if (pntC[1] == pntD[1]) {
            var e = (pntB[0] - pntA[0]) / (pntB[1] - pntA[1]);
            x = e * (pntC[1] - pntA[1]) + pntA[0];
            y = pntC[1];
            return [x, y];
        }
        e = (pntB[0] - pntA[0]) / (pntB[1] - pntA[1]);
        f = (pntD[0] - pntC[0]) / (pntD[1] - pntC[1]);
        y = (e * pntA[1] - pntA[0] - f * pntC[1] + pntC[0]) / (e - f);
        x = e * y - e * pntA[1] + pntA[0];
        return [x, y];
    };

    PlotUtils.getAzimuth = function (startPnt, endPnt) {
        var azimuth;
        var angle = Math.asin(Math.abs(endPnt[1] - startPnt[1]) / PlotUtils.distance(startPnt, endPnt));
        if (endPnt[1] >= startPnt[1] && endPnt[0] >= startPnt[0])
            azimuth = angle + Math.PI;
        else if (endPnt[1] >= startPnt[1] && endPnt[0] < startPnt[0])
            azimuth = Constants.TWO_PI - angle;
        else if (endPnt[1] < startPnt[1] && endPnt[0] < startPnt[0])
            azimuth = angle;
        else if (endPnt[1] < startPnt[1] && endPnt[0] >= startPnt[0])
            azimuth = Math.PI - angle;
        return azimuth;
    };

    PlotUtils.getAngleOfThreePoints = function (pntA, pntB, pntC) {
        var angle = PlotUtils.getAzimuth(pntB, pntA) - PlotUtils.getAzimuth(pntB, pntC);
        return (angle < 0 ? angle + Constants.TWO_PI : angle);
    };

    PlotUtils.isClockWise = function (pnt1, pnt2, pnt3) {
        return ((pnt3[1] - pnt1[1]) * (pnt2[0] - pnt1[0]) > (pnt2[1] - pnt1[1]) * (pnt3[0] - pnt1[0]));
    };

    PlotUtils.getPointOnLine = function (t, startPnt, endPnt) {
        var x = startPnt[0] + (t * (endPnt[0] - startPnt[0]));
        var y = startPnt[1] + (t * (endPnt[1] - startPnt[1]));
        return [x, y];
    };

    PlotUtils.getCubicValue = function (t, startPnt, cPnt1, cPnt2, endPnt) {
        t = Math.max(Math.min(t, 1), 0);
        var tp = 1 - t;
        var t2 = t * t;
        var t3 = t2 * t;
        var tp2 = tp * tp;
        var tp3 = tp2 * tp;
        var x = (tp3 * startPnt[0]) + (3 * tp2 * t * cPnt1[0]) + (3 * tp * t2 * cPnt2[0]) + (t3 * endPnt[0]);
        var y = (tp3 * startPnt[1]) + (3 * tp2 * t * cPnt1[1]) + (3 * tp * t2 * cPnt2[1]) + (t3 * endPnt[1]);
        return [x, y];
    };

    PlotUtils.getThirdPoint = function (startPnt, endPnt, angle, distance, clockWise) {
        var azimuth = PlotUtils.getAzimuth(startPnt, endPnt);
        var alpha = clockWise ? azimuth + angle : azimuth - angle;
        var dx = distance * Math.cos(alpha);
        var dy = distance * Math.sin(alpha);
        return [endPnt[0] + dx, endPnt[1] + dy];
    };

    PlotUtils.getArcPoints = function (center, radius, startAngle, endAngle) {
        var x, y, coordinates = [];
        var angleDiff = endAngle - startAngle;
        angleDiff = angleDiff < 0 ? angleDiff + Constants.TWO_PI : angleDiff;
        for (var i = 0; i <= Constants.FITTING_COUNT; i++) {
            var angle = startAngle + angleDiff * i / Constants.FITTING_COUNT;
            x = center[0] + radius * Math.cos(angle);
            y = center[1] + radius * Math.sin(angle);
            coordinates.push([x, y]);
        }
        return coordinates;
    };

    PlotUtils.getBisectorNormals = function (t, pnt1, pnt2, pnt3) {
        var normal = PlotUtils.getNormal(pnt1, pnt2, pnt3);
        var dist = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1]);
        var uX = normal[0] / dist;
        var uY = normal[1] / dist;
        var d1 = PlotUtils.distance(pnt1, pnt2);
        var d2 = PlotUtils.distance(pnt2, pnt3);
        if (dist > Constants.ZERO_TOLERANCE) {
            if (PlotUtils.isClockWise(pnt1, pnt2, pnt3)) {
                var dt = t * d1;
                var x = pnt2[0] - dt * uY;
                var y = pnt2[1] + dt * uX;
                var bisectorNormalRight = [x, y];
                dt = t * d2;
                x = pnt2[0] + dt * uY;
                y = pnt2[1] - dt * uX;
                var bisectorNormalLeft = [x, y];
            } else {
                dt = t * d1;
                x = pnt2[0] + dt * uY;
                y = pnt2[1] - dt * uX;
                bisectorNormalRight = [x, y];
                dt = t * d2;
                x = pnt2[0] - dt * uY;
                y = pnt2[1] + dt * uX;
                bisectorNormalLeft = [x, y];
            }
        } else {
            x = pnt2[0] + t * (pnt1[0] - pnt2[0]);
            y = pnt2[1] + t * (pnt1[1] - pnt2[1]);
            bisectorNormalRight = [x, y];
            x = pnt2[0] + t * (pnt3[0] - pnt2[0]);
            y = pnt2[1] + t * (pnt3[1] - pnt2[1]);
            bisectorNormalLeft = [x, y];
        }
        return [bisectorNormalRight, bisectorNormalLeft];
    };

    PlotUtils.getNormal = function (pnt1, pnt2, pnt3) {
        var dX1 = pnt1[0] - pnt2[0];
        var dY1 = pnt1[1] - pnt2[1];
        var d1 = Math.sqrt(dX1 * dX1 + dY1 * dY1);
        dX1 /= d1;
        dY1 /= d1;

        var dX2 = pnt3[0] - pnt2[0];
        var dY2 = pnt3[1] - pnt2[1];
        var d2 = Math.sqrt(dX2 * dX2 + dY2 * dY2);
        dX2 /= d2;
        dY2 /= d2;

        var uX = dX1 + dX2;
        var uY = dY1 + dY2;
        return [uX, uY];
    };

    PlotUtils.getCurvePoints = function (t, controlPoints) {
        var leftControl = PlotUtils.getLeftMostControlPoint(controlPoints, t);
        var normals = [leftControl];
        for (var i = 0; i < controlPoints.length - 2; i++) {
            var pnt1 = controlPoints[i];
            var pnt2 = controlPoints[i + 1];
            var pnt3 = controlPoints[i + 2];
            var normalPoints = PlotUtils.getBisectorNormals(t, pnt1, pnt2, pnt3);
            normals = normals.concat(normalPoints);
        }
        var rightControl = PlotUtils.getRightMostControlPoint(controlPoints, t);
        normals.push(rightControl);
        var points = [];
        for (i = 0; i < controlPoints.length - 1; i++) {
            pnt1 = controlPoints[i];
            pnt2 = controlPoints[i + 1];
            points.push(pnt1);
            for (var t = 0; t < Constants.FITTING_COUNT; t++) {
                var pnt = PlotUtils.getCubicValue(t / Constants.FITTING_COUNT, pnt1, normals[i * 2], normals[i * 2 + 1], pnt2);
                points.push(pnt);
            }
            points.push(pnt2);
        }
        return points;
    };

    PlotUtils.getLeftMostControlPoint = function (controlPoints, t) {
        var pnt1 = controlPoints[0];
        var pnt2 = controlPoints[1];
        var pnt3 = controlPoints[2];
        var coordinates = PlotUtils.getBisectorNormals(0, pnt1, pnt2, pnt3);
        var normalRight = coordinates[0];
        var normal = PlotUtils.getNormal(pnt1, pnt2, pnt3);
        var dist = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1]);
        if (dist > Constants.ZERO_TOLERANCE) {
            var mid = PlotUtils.mid(pnt1, pnt2);
            var pX = pnt1[0] - mid[0];
            var pY = pnt1[1] - mid[1];

            var d1 = PlotUtils.distance(pnt1, pnt2);
            // normal at midpoint
            var n = 2.0 / d1;
            var nX = -n * pY;
            var nY = n * pX;

            // upper triangle of symmetric transform matrix
            var a11 = nX * nX - nY * nY
            var a12 = 2 * nX * nY;
            var a22 = nY * nY - nX * nX;

            var dX = normalRight[0] - mid[0];
            var dY = normalRight[1] - mid[1];

            // coordinates of reflected vector
            var controlX = mid[0] + a11 * dX + a12 * dY;
            var controlY = mid[1] + a12 * dX + a22 * dY;
        } else {
            controlX = pnt1[0] + t * (pnt2[0] - pnt1[0]);
            controlY = pnt1[1] + t * (pnt2[1] - pnt1[1]);
        }
        return [controlX, controlY];
    };

    PlotUtils.getRightMostControlPoint = function (controlPoints, t) {
        var count = controlPoints.length;
        var pnt1 = controlPoints[count - 3];
        var pnt2 = controlPoints[count - 2];
        var pnt3 = controlPoints[count - 1];
        var coordinates = PlotUtils.getBisectorNormals(0, pnt1, pnt2, pnt3);
        var normalLeft = coordinates[1];
        var normal = PlotUtils.getNormal(pnt1, pnt2, pnt3);
        var dist = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1]);
        if (dist > Constants.ZERO_TOLERANCE) {
            var mid = PlotUtils.mid(pnt2, pnt3);
            var pX = pnt3[0] - mid[0];
            var pY = pnt3[1] - mid[1];

            var d1 = PlotUtils.distance(pnt2, pnt3);
            // normal at midpoint
            var n = 2.0 / d1;
            var nX = -n * pY;
            var nY = n * pX;

            // upper triangle of symmetric transform matrix
            var a11 = nX * nX - nY * nY
            var a12 = 2 * nX * nY;
            var a22 = nY * nY - nX * nX;

            var dX = normalLeft[0] - mid[0];
            var dY = normalLeft[1] - mid[1];

            // coordinates of reflected vector
            var controlX = mid[0] + a11 * dX + a12 * dY;
            var controlY = mid[1] + a12 * dX + a22 * dY;
        } else {
            controlX = pnt3[0] + t * (pnt2[0] - pnt3[0]);
            controlY = pnt3[1] + t * (pnt2[1] - pnt3[1]);
        }
        return [controlX, controlY];
    };

    PlotUtils.getBezierPoints = function (points) {
        if (points.length <= 2)
            return points;

        var bezierPoints = [];
        var n = points.length - 1;
        for (var t = 0; t <= 1; t += 0.01) {
            var x = y = 0;
            for (var index = 0; index <= n; index++) {
                var factor = PlotUtils.getBinomialFactor(n, index);
                var a = Math.pow(t, index);
                var b = Math.pow((1 - t), (n - index));
                x += factor * a * b * points[index][0];
                y += factor * a * b * points[index][1];
            }
            bezierPoints.push([x, y]);
        }
        bezierPoints.push(points[n]);
        return bezierPoints;
    };

    PlotUtils.getBinomialFactor = function (n, index) {
        return PlotUtils.getFactorial(n) / (PlotUtils.getFactorial(index) * PlotUtils.getFactorial(n - index));
    };

    PlotUtils.getFactorial = function (n) {
        if (n <= 1)
            return 1;
        if (n == 2)
            return 2;
        if (n == 3)
            return 6;
        if (n == 4)
            return 24;
        if (n == 5)
            return 120;
        var result = 1;
        for (var i = 1; i <= n; i++)
            result *= i;
        return result;
    };

    PlotUtils.getQBSplinePoints = function (points) {
        if (points.length <= 2)
            return points;

        var n = 2;

        var bSplinePoints = [];
        var m = points.length - n - 1;
        bSplinePoints.push(points[0]);
        for (var i = 0; i <= m; i++) {
            for (var t = 0; t <= 1; t += 0.05) {
                var x = 0;
                var y = 0;
                for (var k = 0; k <= n; k++) {
                    var factor = PlotUtils.getQuadricBSplineFactor(k, t);
                    x += factor * points[i + k][0];
                    y += factor * points[i + k][1];
                }
                bSplinePoints.push([x, y]);
            }
        }
        bSplinePoints.push(points[points.length - 1]);
        return bSplinePoints;
    };

    PlotUtils.getQuadricBSplineFactor = function (k, t) {
        if (k == 0)
            return Math.pow(t - 1, 2) / 2;
        if (k == 1)
            return (-2 * Math.pow(t, 2) + 2 * t + 1) / 2;
        if (k == 2)
            return Math.pow(t, 2) / 2;
        return 0;
    };

    return P;
}));