/* nvd3 version 1.9.50 (https://github.com/glassbox-front-end/nvd3) 2026-07-02 */
(function(){

// set up main nv object
var nv = {};

// the major global objects under the nv namespace
nv.dev = false; //set false when in production
nv.tooltip = nv.tooltip || {}; // For the tooltip system
nv.utils = nv.utils || {}; // Utility subsystem
nv.models = nv.models || {}; //stores all the possible models/components
nv.charts = {}; //stores all the ready to use charts
nv.logs = {}; //stores some statistics and potential error messages
nv.dom = {}; //DOM manipulation functions

nv.dispatch = d3.dispatch('render_start', 'render_end');

// Function bind polyfill
// Needed ONLY for phantomJS as it's missing until version 2.0 which is unreleased as of this comment
// https://github.com/ariya/phantomjs/issues/10522
// http://kangax.github.io/compat-table/es5/#Function.prototype.bind
// phantomJS is used for running the test suite
if (!Function.prototype.bind) {
    Function.prototype.bind = function (oThis) {
        if (typeof this !== "function") {
            // closest thing possible to the ECMAScript 5 internal IsCallable function
            throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
        }

        var aArgs = Array.prototype.slice.call(arguments, 1),
            fToBind = this,
            fNOP = function () {},
            fBound = function () {
                return fToBind.apply(this instanceof fNOP && oThis
                        ? this
                        : oThis,
                    aArgs.concat(Array.prototype.slice.call(arguments)));
            };

        fNOP.prototype = this.prototype;
        fBound.prototype = new fNOP();
        return fBound;
    };
}

//  Development render timers - disabled if dev = false
if (nv.dev) {
    nv.dispatch.on('render_start', function(e) {
        nv.logs.startTime = +new Date();
    });

    nv.dispatch.on('render_end', function(e) {
        nv.logs.endTime = +new Date();
        nv.logs.totalTime = nv.logs.endTime - nv.logs.startTime;
        nv.log('total', nv.logs.totalTime); // used for development, to keep track of graph generation times
    });
}

// Logs all arguments, and returns the last so you can test things in place
// Note: in IE8 console.log is an object not a function, and if modernizr is used
// then calling Function.prototype.bind with with anything other than a function
// causes a TypeError to be thrown.
nv.log = function() {
    if (nv.dev && window.console && console.log && console.log.apply)
        console.log.apply(console, arguments);
    else if (nv.dev && window.console && typeof console.log == "function" && Function.prototype.bind) {
        var log = Function.prototype.bind.call(console.log, console);
        log.apply(console, arguments);
    }
    return arguments[arguments.length - 1];
};

// print console warning, should be used by deprecated functions
nv.deprecated = function(name, info) {
    if (console && console.warn) {
        console.warn('nvd3 warning: `' + name + '` has been deprecated. ', info || '');
    }
};

// The nv.render function is used to queue up chart rendering
// in non-blocking async functions.
// When all queued charts are done rendering, nv.dispatch.render_end is invoked.
nv.render = function render(step) {
    // number of graphs to generate in each timeout loop
    step = step || 1;

    nv.render.active = true;
    nv.dispatch.render_start();

    var renderLoop = function() {
        var chart, graph;

        for (var i = 0; i < step && (graph = nv.render.queue[i]); i++) {
            chart = graph.generate();
            if (typeof graph.callback == typeof(Function)) graph.callback(chart);
        }

        nv.render.queue.splice(0, i);

        if (nv.render.queue.length) {
            setTimeout(renderLoop);
        }
        else {
            nv.dispatch.render_end();
            nv.render.active = false;
        }
    };

    setTimeout(renderLoop);
};

nv.render.active = false;
nv.render.queue = [];

/*
Adds a chart to the async rendering queue. This method can take arguments in two forms:
nv.addGraph({
    generate: <Function>
    callback: <Function>
})

or

nv.addGraph(<generate Function>, <callback Function>)

The generate function should contain code that creates the NVD3 model, sets options
on it, adds data to an SVG element, and invokes the chart model. The generate function
should return the chart model.  See examples/lineChart.html for a usage example.

The callback function is optional, and it is called when the generate function completes.
*/
nv.addGraph = function(obj) {
    if (typeof arguments[0] === typeof(Function)) {
        obj = {generate: arguments[0], callback: arguments[1]};
    }

    nv.render.queue.push(obj);

    if (!nv.render.active) {
        nv.render();
    }
};

// Node/CommonJS exports
if (typeof(module) !== 'undefined' && typeof(exports) !== 'undefined') {
  module.exports = nv;
}

if (typeof(window) !== 'undefined') {
  window.nv = nv;
}
/* Facade for queueing DOM write operations
 * with Fastdom (https://github.com/wilsonpage/fastdom)
 * if available.
 * This could easily be extended to support alternate
 * implementations in the future.
 */
nv.dom.write = function(callback) {
	if (window.fastdom !== undefined) {
		return fastdom.write(callback);
	}
	return callback();
};

/* Facade for queueing DOM read operations
 * with Fastdom (https://github.com/wilsonpage/fastdom)
 * if available.
 * This could easily be extended to support alternate
 * implementations in the future.
 */
nv.dom.read = function(callback) {
	if (window.fastdom !== undefined) {
		return fastdom.read(callback);
	}
	return callback();
};/* Utility class to handle creation of an interactive layer.
 This places a rectangle on top of the chart. When you mouse move over it, it sends a dispatch
 containing the X-coordinate. It can also render a vertical line where the mouse is located.

 dispatch.elementMousemove is the important event to latch onto.  It is fired whenever the mouse moves over
 the rectangle. The dispatch is given one object which contains the mouseX/Y location.
 It also has 'pointXValue', which is the conversion of mouseX to the x-axis scale.
 */
nv.interactiveGuideline = function() {
    "use strict";

    var margin = { left: 0, top: 0 } //Pass the chart's top and left magins. Used to calculate the mouseX/Y.
        ,   width = null
        ,   height = null
        ,   xScale = d3.scale.linear()
        ,   dispatch = d3.dispatch('elementMousemove', 'elementMouseout', 'elementClick', 'elementDblclick', 'elementMouseDown', 'elementMouseUp')
        ,   showGuideLine = true
        ,   svgContainer = null // Must pass the chart's svg, we'll use its mousemove event.
        ,   tooltip = nv.models.tooltip()
        ,   isMSIE = "ActiveXObject" in window // Checkt if IE by looking for activeX.
    ;

    tooltip
        .duration(0)
        .hideDelay(0)
        .hidden(false);

    function layer(selection) {
        selection.each(function(data) {
            var container = d3.select(this);
            var availableWidth = (width || 960), availableHeight = (height || 400);
            var wrap = container.selectAll("g.nv-wrap.nv-interactiveLineLayer")
                .data([data]);
            var wrapEnter = wrap.enter()
                .append("g").attr("class", " nv-wrap nv-interactiveLineLayer");
            wrapEnter.append("g").attr("class","nv-interactiveGuideLine");

            if (!svgContainer) {
                return;
            }

            function mouseHandler() {
                var d3mouse = d3.mouse(this);
                var mouseX = d3mouse[0];
                var mouseY = d3mouse[1];
                var subtractMargin = true;
                var mouseOutAnyReason = false;
                if (isMSIE) {
                    /*
                     D3.js (or maybe SVG.getScreenCTM) has a nasty bug in Internet Explorer 10.
                     d3.mouse() returns incorrect X,Y mouse coordinates when mouse moving
                     over a rect in IE 10.
                     However, d3.event.offsetX/Y also returns the mouse coordinates
                     relative to the triggering <rect>. So we use offsetX/Y on IE.
                     */
                    mouseX = d3.event.offsetX;
                    mouseY = d3.event.offsetY;

                    /*
                     On IE, if you attach a mouse event listener to the <svg> container,
                     it will actually trigger it for all the child elements (like <path>, <circle>, etc).
                     When this happens on IE, the offsetX/Y is set to where ever the child element
                     is located.
                     As a result, we do NOT need to subtract margins to figure out the mouse X/Y
                     position under this scenario. Removing the line below *will* cause
                     the interactive layer to not work right on IE.
                     */
                    if(d3.event.target.tagName !== "svg") {
                        subtractMargin = false;
                    }

                    if (d3.event.target.className.baseVal.match("nv-legend")) {
                        mouseOutAnyReason = true;
                    }

                }

                if(subtractMargin) {
                    mouseX -= margin.left;
                    mouseY -= margin.top;
                }

                /* If mouseX/Y is outside of the chart's bounds,
                 trigger a mouseOut event.
                 */
                if (mouseX < 0 || mouseY < 0
                    || mouseX > availableWidth || mouseY > availableHeight
                    || (d3.event.relatedTarget && d3.event.relatedTarget.ownerSVGElement === undefined)
                    || mouseOutAnyReason
                    ) {

                    if (isMSIE) {
                        if (d3.event.relatedTarget
                            && d3.event.relatedTarget.ownerSVGElement === undefined
                            && (d3.event.relatedTarget.className === undefined
                                || d3.event.relatedTarget.className.match(tooltip.nvPointerEventsClass))) {

                            return;
                        }
                    }
                    dispatch.elementMouseout({
                        mouseX: mouseX,
                        mouseY: mouseY
                    });
                    layer.renderGuideLine(null); //hide the guideline
                    tooltip.hidden(true);
                    return;
                } else {
                    tooltip.hidden(false);
                }


                var scaleIsOrdinal = typeof xScale.rangeBands === 'function';
                var pointXValue = undefined;

                // Ordinal scale has no invert method
                if (scaleIsOrdinal) {
                    var elementIndex = d3.bisect(xScale.range(), mouseX) - 1;
                    // Check if mouseX is in the range band
                    if (xScale.range()[elementIndex] + xScale.rangeBand() >= mouseX) {
                        pointXValue = xScale.domain()[d3.bisect(xScale.range(), mouseX) - 1];
                    }
                    else {
                        dispatch.elementMouseout({
                            mouseX: mouseX,
                            mouseY: mouseY
                        });
                        layer.renderGuideLine(null); //hide the guideline
                        tooltip.hidden(true);
                        return;
                    }
                }
                else {
                    pointXValue = xScale.invert(mouseX);
                }

                dispatch.elementMousemove({
                    mouseX: mouseX,
                    mouseY: mouseY,
                    pointXValue: pointXValue
                });

                //If user double clicks the layer, fire a elementDblclick
                if (d3.event.type === "dblclick") {
                    dispatch.elementDblclick({
                        mouseX: mouseX,
                        mouseY: mouseY,
                        pointXValue: pointXValue
                    });
                }

                // if user single clicks the layer, fire elementClick
                if (d3.event.type === 'click') {
                    dispatch.elementClick({
                        mouseX: mouseX,
                        mouseY: mouseY,
                        pointXValue: pointXValue
                    });
                }

                // if user presses mouse down the layer, fire elementMouseDown
                if (d3.event.type === 'mousedown') {
                	dispatch.elementMouseDown({
                		mouseX: mouseX,
                		mouseY: mouseY,
                		pointXValue: pointXValue
                	});
                }

                // if user presses mouse down the layer, fire elementMouseUp
                if (d3.event.type === 'mouseup') {
                	dispatch.elementMouseUp({
                		mouseX: mouseX,
                		mouseY: mouseY,
                		pointXValue: pointXValue
                	});
                }
            }

            svgContainer
                .on("touchmove",mouseHandler)
                .on("mousemove",mouseHandler, true)
                .on("mouseout" ,mouseHandler,true)
                .on("mousedown" ,mouseHandler,true)
                .on("mouseup" ,mouseHandler,true)
                .on("dblclick" ,mouseHandler)
                .on("click", mouseHandler)
            ;

            layer.guideLine = null;
            //Draws a vertical guideline at the given X postion.
            layer.renderGuideLine = function(x) {
                if (!showGuideLine) return;
                if (layer.guideLine && layer.guideLine.attr("x1") === x) return;
                nv.dom.write(function() {
                    var line = wrap.select(".nv-interactiveGuideLine")
                        .selectAll("line")
                        .data((x != null) ? [nv.utils.NaNtoZero(x)] : [], String);
                    line.enter()
                        .append("line")
                        .attr("class", "nv-guideline")
                        .attr("x1", function(d) { return d;})
                        .attr("x2", function(d) { return d;})
                        .attr("y1", availableHeight)
                        .attr("y2",0);
                    line.exit().remove();
                });
            }
        });
    }

    layer.dispatch = dispatch;
    layer.tooltip = tooltip;

    layer.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return layer;
    };

    layer.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return layer;
    };

    layer.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return layer;
    };

    layer.xScale = function(_) {
        if (!arguments.length) return xScale;
        xScale = _;
        return layer;
    };

    layer.showGuideLine = function(_) {
        if (!arguments.length) return showGuideLine;
        showGuideLine = _;
        return layer;
    };

    layer.svgContainer = function(_) {
        if (!arguments.length) return svgContainer;
        svgContainer = _;
        return layer;
    };

    return layer;
};

/* Utility class that uses d3.bisect to find the index in a given array, where a search value can be inserted.
 This is different from normal bisectLeft; this function finds the nearest index to insert the search value.

 For instance, lets say your array is [1,2,3,5,10,30], and you search for 28.
 Normal d3.bisectLeft will return 4, because 28 is inserted after the number 10.  But interactiveBisect will return 5
 because 28 is closer to 30 than 10.

 Unit tests can be found in: interactiveBisectTest.html

 Has the following known issues:
 * Will not work if the data points move backwards (ie, 10,9,8,7, etc) or if the data points are in random order.
 * Won't work if there are duplicate x coordinate values.
 */
nv.interactiveBisect = function (values, searchVal, xAccessor) {
    "use strict";
    if (! (values instanceof Array)) {
        return null;
    }
    var _xAccessor;
    if (typeof xAccessor !== 'function') {
        _xAccessor = function(d) {
            return d.x;
        }
    } else {
        _xAccessor = xAccessor;
    }
    var _cmp = function(d, v) {
        // Accessors are no longer passed the index of the element along with
        // the element itself when invoked by d3.bisector.
        //
        // Starting at D3 v3.4.4, d3.bisector() started inspecting the
        // function passed to determine if it should consider it an accessor
        // or a comparator. This meant that accessors that take two arguments
        // (expecting an index as the second parameter) are treated as
        // comparators where the second argument is the search value against
        // which the first argument is compared.
        return _xAccessor(d) - v;
    };

    var bisect = d3.bisector(_cmp).left;
    var index = d3.max([0, bisect(values,searchVal) - 1]);
    var currentValue = _xAccessor(values[index]);

    if (typeof currentValue === 'undefined') {
        currentValue = index;
    }

    if (currentValue === searchVal) {
        return index; //found exact match
    }

    var nextIndex = d3.min([index+1, values.length - 1]);
    var nextValue = _xAccessor(values[nextIndex]);

    if (typeof nextValue === 'undefined') {
        nextValue = nextIndex;
    }

    if (Math.abs(nextValue - searchVal) >= Math.abs(currentValue - searchVal)) {
        return index;
    } else {
        return nextIndex
    }
};

/*
 Returns the index in the array "values" that is closest to searchVal.
 Only returns an index if searchVal is within some "threshold".
 Otherwise, returns null.
 */
nv.nearestValueIndex = function (values, searchVal, threshold) {
    "use strict";
    var yDistMax = Infinity, indexToHighlight = null;
    values.forEach(function(d,i) {
        var delta = Math.abs(searchVal - d);
        if ( d != null && delta <= yDistMax && delta < threshold) {
            yDistMax = delta;
            indexToHighlight = i;
        }
    });
    return indexToHighlight;
};

/* Model which can be instantiated to handle tooltip rendering.
 Example usage:
 var tip = nv.models.tooltip().gravity('w').distance(23)
 .data(myDataObject);

 tip();    //just invoke the returned function to render tooltip.
 */
nv.models.tooltip = function() {
    "use strict";
    
    /*
    Tooltip data. If data is given in the proper format, a consistent tooltip is generated.
    Example Format of data:
    {
        key: "Date",
        value: "August 2009",
        series: [
            {key: "Series 1", value: "Value 1", color: "#000"},
            {key: "Series 2", value: "Value 2", color: "#00f"}
        ]
    }
    */
    var id = "nvtooltip-" + Math.floor(Math.random() * 100000) // Generates a unique id when you create a new tooltip() object.
        ,   data = null
        ,   gravity = 'w'   // Can be 'n','s','e','w'. Determines how tooltip is positioned.
        ,   distance = 25 // Distance to offset tooltip from the mouse location.
        ,   snapDistance = 0   // Tolerance allowed before tooltip is moved from its current position (creates 'snapping' effect)
        ,   classes = null  // Attaches additional CSS classes to the tooltip DIV that is created.
        ,   chartContainer = null // Parent dom element of the SVG that holds the chart.
        ,   hidden = true  // Start off hidden, toggle with hide/show functions below.
        ,   hideDelay = 200  // Delay (in ms) before the tooltip hides after calling hide().
        ,   tooltip = null // d3 select of the tooltip div.
        ,   lastPosition = { left: null, top: null } // Last position the tooltip was in.
        ,   enabled = true  // True -> tooltips are rendered. False -> don't render tooltips.
        ,   negateTrend = false
        ,   duration = 100 // Tooltip movement duration, in ms.
        ,   headerEnabled = true // If is to show the tooltip header.
        ,   nvPointerEventsClass = "nv-pointer-events-none" // CSS class to specify whether element should not have mouse events.
    ;

    /*
     Function that returns the position (relative to the viewport) the tooltip should be placed in.
     Should return: {
        left: <leftPos>,
        top: <topPos>
     }
     */
    var position = function() {
        return {
            left: d3.event !== null ? d3.event.offsetX : 0,
            top: d3.event !== null ? d3.event.offsetY : 0
        };
    };

    // Format function for the tooltip values column.
    var valueFormatter = function(d, i) {
        return d;
    };

    var refFormatter = function(d,i){
        if ( Math.abs(d.refValue) > 0 ){
            var r = (d.value - d.refValue) / d.refValue;

            return d3.format('.1f')(r * 100.0) + '%';
        }

        return '';

    };

    // Format function for the tooltip header value.
    var headerFormatter = function(d) {
        return (d.value || d.data);
    };

    var footerFormatter = function(d) {
        return d.footer;
    };

    var keyFormatter = function(d, i) {
        return d;
    };

    // By default, the tooltip model renders a beautiful table inside a DIV.
    // You can override this function if a custom tooltip is desired.
    var contentGenerator = function(d) {
        if (d === null) {
            return '';
        }

        if ( (d.series || []).filter( function(d){ return d.value !== null; }).length === 0 ){
            return ' ';
        }

        var table = d3.select(document.createElement("table"));
        if (headerEnabled) {
            var theadEnter = table.selectAll("thead")
                .data([d])
                .enter().append("thead");

            theadEnter.append("tr")
                .append("td")
                .attr("colspan", 3)
                .append("strong")
                .classed("x-value", true)
                .html(headerFormatter(d));
        }

        var tbodyEnter = table.selectAll("tbody")
            .data([d])
            .enter().append("tbody");



        var trowEnter = tbodyEnter.selectAll("tr")
                .data(function(p) { return (p.series || []).filter(function(p){ return p.value || p.refValue; })})
                .enter()
                .append("tr")
                .classed("highlight", function(p) { return p.highlight});

        trowEnter.append("td")
            .classed("legend-color-guide",true)
            .append("div")
            .style("background-color", function(p) { return p.color});

        trowEnter.append("td")
            .classed("key",true)
            .classed("total",function(p) { return !!p.total})
            .html(function(p, i) { return keyFormatter(p.key, i)});

        trowEnter
            .append('td')
            .classed('value', true)
            .html(function (p, i) {
                return '(' + valueFormatter(p.value, i) + ')';
            });

        trowEnter.append("td")
            .classed("ref-value",true)
            .classed("positive", function(p ,i){
                return data.negateTrend ? (p.value < p.refValue) : (p.value > p.refValue);
            })
            .classed("negative", function(p ,i){
                return data.negateTrend ? (p.value > p.refValue) : (p.value < p.refValue);
            })
            .html(function(p, i) { return refFormatter(p, i) });

        trowEnter.append("td")
            .classed("has-alert", function(p){
                return p.data && p.pointAlert && p.pointAlert(p.data)
                 || p.data && p.pointAlertGroup && p.pointAlertGroup(p.data);
            })
            .classed('low-confident', function(p) {
                return p.data && p.isLowConfidence && p.isLowConfidence(p.data)
            })
            .html('<div class="alert-icon"></div>')

        trowEnter.selectAll("td").each(function(p) {
            if (p.highlight) {
                var opacityScale = d3.scale.linear().domain([0,1]).range(["#fff",p.color]);
                var opacity = 0.6;
                d3.select(this)
                    .style("border-bottom-color", opacityScale(opacity))
                    .style("border-top-color", opacityScale(opacity))
                ;
            }
        });

        var html = table.node().outerHTML;
        var footer = footerFormatter(d);
        if (footer !== undefined)
            html += "<div class='footer'>" + footer + "</div>";
        return html;

    };

    var dataSeriesExists = function(d) {
        if (d && d.series) {
            if (d.series instanceof Array) {
                return !!d.series.length;
            }
            // if object, it's okay just convert to array of the object
            if (d.series instanceof Object) {
                d.series = [d.series];
                return true;
            }
        }
        return false;
    };

    // Calculates the gravity offset of the tooltip. Parameter is position of tooltip
    // relative to the viewport.
    var calcGravityOffset = function(pos) {
        var height = tooltip.node().offsetHeight,
            width = tooltip.node().offsetWidth,
            clientWidth = tooltip.node().parentNode.clientWidth, // Don't want scrollbars.
            clientHeight = tooltip.node().parentNode.clientHeight, // Don't want scrollbars.
            left, top, tmp;

        // calculate position based on gravity
        switch (gravity) {
            case 'e':
                left = - width - distance;
                top = - (height / 2);
                if(pos.left + left < 0) left = distance;
                if((tmp = pos.top + top) < 0) top -= tmp;
                if((tmp = pos.top + top + height) > clientHeight) top -= tmp - clientHeight;
                break;
            case 'w':
                left = distance;
                top = - (height / 2);
                if (pos.left + left + width > clientWidth) left = - width - distance;
                if ((tmp = pos.top + top) < 0) top -= tmp;
                if ((tmp = pos.top + top + height) > clientHeight) top -= tmp - clientHeight;
                break;
            case 'n':
                left = - (width / 2) - 5; // - 5 is an approximation of the mouse's height.
                top = distance;
                if (pos.top + top + height > clientHeight) top = - height - distance;
                if ((tmp = pos.left + left) < 0) left -= tmp;
                if ((tmp = pos.left + left + width) > clientWidth) left -= tmp - clientWidth;
                break;
            case 's':
                left = - (width / 2);
                top = - height - distance;
                if (pos.top + top < 0) top = distance;
                if ((tmp = pos.left + left) < 0) left -= tmp;
                if ((tmp = pos.left + left + width) > clientWidth) left -= tmp - clientWidth;
                break;
            case 'center':
                left = - (width / 2);
                top = - (height / 2);
                break;
            default:
                left = 0;
                top = 0;
                break;
        }

        return { 'left': left, 'top': top };
    };

    /*
     Positions the tooltip in the correct place, as given by the position() function.
     */
    var positionTooltip = function() {
        nv.dom.read(function() {
            var pos = position(),
                gravityOffset = calcGravityOffset(pos),
                left = Math.max(0, pos.left + gravityOffset.left),
                top = pos.top + gravityOffset.top;

            // delay hiding a bit to avoid flickering
            if (hidden) {
                tooltip
                    .interrupt()
                    .transition()
                    .delay(hideDelay)
                    .duration(0)
                    .style('opacity', 0);
            } else {
                // using tooltip.style('transform') returns values un-usable for tween
                var old_translate = 'translate(' + lastPosition.left + 'px, ' + lastPosition.top + 'px)';
                var new_translate = 'translate(' + left + 'px, ' + top + 'px)';
                var translateInterpolator = d3.interpolateString(old_translate, new_translate);
                var is_hidden = tooltip.style('opacity') < 0.1;

                tooltip
                    .interrupt() // cancel running transitions
                    .transition()
                    .duration(is_hidden ? 0 : duration)
                    // using tween since some versions of d3 can't auto-tween a translate on a div
                    .styleTween('transform', function (d) {
                        return translateInterpolator;
                    }, 'important')
                    // Safari has its own `-webkit-transform` and does not support `transform`
                    .styleTween('-webkit-transform', function (d) {
                        return translateInterpolator;
                    })
                    .style('-ms-transform', new_translate)
                    .style('opacity', 1);
            }

            lastPosition.left = left;
            lastPosition.top = top;
        });
    };

    // Creates new tooltip container, or uses existing one on DOM.
    function initTooltip() {
        if (!tooltip) {
            var container = chartContainer ? chartContainer : document.body;

            // Create new tooltip div if it doesn't exist on DOM.
            tooltip = d3.select(container).append("div")
                .attr("class", "nvtooltip " + (classes ? classes : "xy-tooltip"))
                .attr("id", id);
            tooltip.style("top", 0).style("left", 0);
            tooltip.style('opacity', 0);
            tooltip.style('position', 'absolute');
            tooltip.selectAll("div, table, td, tr").classed(nvPointerEventsClass, true);
            tooltip.classed(nvPointerEventsClass, true);
        }
    }

    // Draw the tooltip onto the DOM.
    function nvtooltip() {
        if (!enabled) return;
        if (!dataSeriesExists(data)) return;

        nv.dom.write(function () {
            initTooltip();
            // Generate data and set it into tooltip.
            // Bonus - If you override contentGenerator and return falsey you can use something like
            //         React or Knockout to bind the data for your tooltip.
            var newContent = contentGenerator(data);
            if (newContent) {
                tooltip.node().innerHTML = newContent;
            }

            positionTooltip();
        });

        return nvtooltip;
    }

    nvtooltip.nvPointerEventsClass = nvPointerEventsClass;
    nvtooltip.options = nv.utils.optionsFunc.bind(nvtooltip);

    nvtooltip._options = Object.create({}, {
        // simple read/write options
        duration: {get: function(){return duration;}, set: function(_){duration=_;}},
        gravity: {get: function(){return gravity;}, set: function(_){gravity=_;}},
        distance: {get: function(){return distance;}, set: function(_){distance=_;}},
        snapDistance: {get: function(){return snapDistance;}, set: function(_){snapDistance=_;}},
        classes: {get: function(){return classes;}, set: function(_){classes=_;}},
        chartContainer: {get: function(){return chartContainer;}, set: function(_){chartContainer=_;}},
        enabled: {get: function(){return enabled;}, set: function(_){enabled=_;}},
        negateTrend: {get: function(){return negateTrend;}, set: function(_){negateTrend=_;}},
        hideDelay: {get: function(){return hideDelay;}, set: function(_){hideDelay=_;}},
        contentGenerator: {get: function(){return contentGenerator;}, set: function(_){contentGenerator=_;}},
        valueFormatter: {get: function(){return valueFormatter;}, set: function(_){valueFormatter=_;}},
        headerFormatter: {get: function(){return headerFormatter;}, set: function(_){headerFormatter=_;}},
        footerFormatter: {get: function(){return footerFormatter;}, set: function(_){footerFormatter=_;}},
        keyFormatter: {get: function(){return keyFormatter;}, set: function(_){keyFormatter=_;}},
        headerEnabled: {get: function(){return headerEnabled;}, set: function(_){headerEnabled=_;}},
        position: {get: function(){return position;}, set: function(_){position=_;}},

        // Deprecated options
        fixedTop: {get: function(){return null;}, set: function(_){
            // deprecated after 1.8.1
            nv.deprecated('fixedTop', 'feature removed after 1.8.1');
        }},
        offset: {get: function(){return {left: 0, top: 0};}, set: function(_){
            // deprecated after 1.8.1
            nv.deprecated('offset', 'use chart.tooltip.distance() instead');
        }},

        // options with extra logic
        hidden: {get: function(){return hidden;}, set: function(_){
            if (hidden != _) {
                hidden = !!_;
                nvtooltip();
            }
        }},
        data: {get: function(){return data;}, set: function(_){
            // if showing a single data point, adjust data format with that
            if (_.point) {
                _.value = _.point.x;
                _.series = _.series || {};
                _.series.value = _.point.y;
                _.series.color = _.point.color || _.series.color;
            }
            data = _;
        }},

        // read only properties
        node: {get: function(){return tooltip.node();}, set: function(_){}},
        id: {get: function(){return id;}, set: function(_){}}
    });

    nv.utils.initOptions(nvtooltip);
    return nvtooltip;
};
(function() {

    /*
     Returns a function, that, as long as it continues to be invoked, will not be triggered.
     The function will be called after it stops being called for N milliseconds.
     If `immediate` is passed, trigger the function on the leading edge, instead of the trailing.

     Usage:
     var myEfficientFn = debounce(function() {
     // All the taxing stuff you do
     }, 250);
     window.addEventListener('resize', myEfficientFn);
     */

    function debounce(func, wait, immediate) {
        var timeout;
        return function () {
            var context = this, args = arguments;
            var later = function () {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            var callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    };

    nv.utils.debounce = debounce;

    /*
     Gets the browser window size

     Returns object with height and width properties
     */
    nv.utils.windowSize = function () {
        // Sane defaults
        var size = {width: 640, height: 480};

        // Most recent browsers use
        if (window.innerWidth && window.innerHeight) {
            size.width = window.innerWidth;
            size.height = window.innerHeight;
            return (size);
        }

        // IE can use depending on mode it is in
        if (document.compatMode == 'CSS1Compat' &&
            document.documentElement &&
            document.documentElement.offsetWidth) {

            size.width = document.documentElement.offsetWidth;
            size.height = document.documentElement.offsetHeight;
            return (size);
        }

        // Earlier IE uses Doc.body
        if (document.body && document.body.offsetWidth) {
            size.width = document.body.offsetWidth;
            size.height = document.body.offsetHeight;
            return (size);
        }

        return (size);
    };

    /*
     Binds callback function to run when window is resized
     */
    nv.utils.windowResize = function (handler) {
        handler = debounce(handler, 330);
        if (window.addEventListener) {
            window.addEventListener('resize', handler);
        } else {
            nv.log("ERROR: Failed to bind to window.resize with: ", handler);
        }
        // return object with clear function to remove the single added callback.
        return {
            callback: handler,
            clear: function () {
                window.removeEventListener('resize', handler);
            }
        }
    };


    /*
     Backwards compatible way to implement more d3-like coloring of graphs.
     Can take in nothing, an array, or a function/scale
     To use a normal scale, get the range and pass that because we must be able
     to take two arguments and use the index to keep backward compatibility
     */
    nv.utils.getColor = function (color) {
        //if you pass in nothing, get default colors back
        if (color === undefined) {
            return nv.utils.defaultColor();

            //if passed an array, turn it into a color scale
            // use isArray, instanceof fails if d3 range is created in an iframe
        } else if (Array.isArray(color)) {
            var color_scale = d3.scale.ordinal().range(color);
            return function (d, i) {
                var key = i === undefined ? d : i;
                return d.color || color_scale(key);
            };

            //if passed a function or scale, return it, or whatever it may be
            //external libs, such as angularjs-nvd3-directives use this
        } else {
            //can't really help it if someone passes rubbish as color
            return color;
        }
    };


    /*
     Default color chooser uses a color scale of 20 colors from D3
     https://github.com/mbostock/d3/wiki/Ordinal-Scales#categorical-colors
     */
    nv.utils.defaultColor = function () {
        // get range of the scale so we'll turn it into our own function.
        return nv.utils.getColor(d3.scale.category20().range());
    };


    /*
     Returns a color function that takes the result of 'getKey' for each series and
     looks for a corresponding color from the dictionary
     */
    nv.utils.customTheme = function (dictionary, getKey, defaultColors) {
        // use default series.key if getKey is undefined
        getKey = getKey || function (series) {
                return series.key
            };
        defaultColors = defaultColors || d3.scale.category20().range();

        // start at end of default color list and walk back to index 0
        var defIndex = defaultColors.length;

        return function (series, index) {
            var key = getKey(series);
            if (typeof dictionary[key] === 'function') {
                return dictionary[key]();
            } else if (dictionary[key] !== undefined) {
                return dictionary[key];
            } else {
                // no match in dictionary, use a default color
                if (!defIndex) {
                    // used all the default colors, start over
                    defIndex = defaultColors.length;
                }
                defIndex = defIndex - 1;
                return defaultColors[defIndex];
            }
        };
    };


    /*
     From the PJAX example on d3js.org, while this is not really directly needed
     it's a very cool method for doing pjax, I may expand upon it a little bit,
     open to suggestions on anything that may be useful
     */
    nv.utils.pjax = function (links, content) {

        var load = function (href) {
            d3.html(href, function (fragment) {
                var target = d3.select(content).node();
                target.parentNode.replaceChild(
                    d3.select(fragment).select(content).node(),
                    target);
                nv.utils.pjax(links, content);
            });
        };

        d3.selectAll(links).on("click", function () {
            history.pushState(this.href, this.textContent, this.href);
            load(this.href);
            d3.event.preventDefault();
        });

        d3.select(window).on("popstate", function () {
            if (d3.event.state) {
                load(d3.event.state);
            }
        });
    };


    /*
     For when we want to approximate the width in pixels for an SVG:text element.
     Most common instance is when the element is in a display:none; container.
     Forumla is : text.length * font-size * constant_factor
     */
    nv.utils.calcApproxTextWidth = function (svgTextElem) {
        if (typeof svgTextElem.style === 'function'
            && typeof svgTextElem.text === 'function') {

            var fontSize = parseInt(svgTextElem.style("font-size").replace("px", ""), 10);
            var textLength = svgTextElem.text().length;
            return textLength * fontSize * 0.5;
        }
        return 0;
    };


    /*
     Numbers that are undefined, null or NaN, convert them to zeros.
     */
    nv.utils.NaNtoZero = function (n) {
        if (typeof n !== 'number'
            || isNaN(n)
            || n === null
            || n === Infinity
            || n === -Infinity) {

            return 0;
        }
        return n;
    };

    /*
     Add a way to watch for d3 transition ends to d3
     */
    d3.selection.prototype.watchTransition = function (renderWatch) {
        var args = [this].concat([].slice.call(arguments, 1));
        return renderWatch.transition.apply(renderWatch, args);
    };


    /*
     Helper object to watch when d3 has rendered something
     */
    nv.utils.renderWatch = function (dispatch, duration) {
        if (!(this instanceof nv.utils.renderWatch)) {
            return new nv.utils.renderWatch(dispatch, duration);
        }

        var _duration = duration !== undefined ? duration : 250;
        var renderStack = [];
        var self = this;

        this.models = function (models) {
            models = [].slice.call(arguments, 0);
            models.forEach(function (model) {
                model.__rendered = false;
                (function (m) {
                    m.dispatch.on('renderEnd', function (arg) {
                        m.__rendered = true;
                        self.renderEnd('model');
                    });
                })(model);

                if (renderStack.indexOf(model) < 0) {
                    renderStack.push(model);
                }
            });
            return this;
        };

        this.reset = function (duration) {
            if (duration !== undefined) {
                _duration = duration;
            }
            renderStack = [];
        };

        this.transition = function (selection, args, duration) {
            args = arguments.length > 1 ? [].slice.call(arguments, 1) : [];

            if (args.length > 1) {
                duration = args.pop();
            } else {
                duration = _duration !== undefined ? _duration : 250;
            }
            selection.__rendered = false;

            if (renderStack.indexOf(selection) < 0) {
                renderStack.push(selection);
            }

            if (duration === 0) {
                selection.__rendered = true;
                selection.delay = function () {
                    return this;
                };
                selection.duration = function () {
                    return this;
                };
                return selection;
            } else {
                if (selection.length === 0) {
                    selection.__rendered = true;
                } else if (selection.every(function (d) {
                        return !d.length;
                    })) {
                    selection.__rendered = true;
                } else {
                    selection.__rendered = false;
                }

                var n = 0;
                return selection
                    .transition()
                    .duration(duration)
                    .each(function () {
                        ++n;
                    })
                    .each('end', function (d, i) {
                        if (--n === 0) {
                            selection.__rendered = true;
                            self.renderEnd.apply(this, args);
                        }
                    });
            }
        };

        this.renderEnd = function () {
            if (renderStack.every(function (d) {
                    return d.__rendered;
                })) {
                renderStack.forEach(function (d) {
                    d.__rendered = false;
                });
                dispatch.renderEnd.apply(this, arguments);
            }
        }

    };


    /*
     Takes multiple objects and combines them into the first one (dst)
     example:  nv.utils.deepExtend({a: 1}, {a: 2, b: 3}, {c: 4});
     gives:  {a: 2, b: 3, c: 4}
     */
    nv.utils.deepExtend = function (dst) {
        var sources = arguments.length > 1 ? [].slice.call(arguments, 1) : [];
        sources.forEach(function (source) {
            for (var key in source) {
                var isArray = dst[key] instanceof Array;
                var isObject = typeof dst[key] === 'object';
                var srcObj = typeof source[key] === 'object';

                if (isObject && !isArray && srcObj) {
                    nv.utils.deepExtend(dst[key], source[key]);
                } else {
                    dst[key] = source[key];
                }
            }
        });
    };


    /*
     state utility object, used to track d3 states in the models
     */
    nv.utils.state = function () {
        if (!(this instanceof nv.utils.state)) {
            return new nv.utils.state();
        }
        var state = {};
        var _self = this;
        var _setState = function () {
        };
        var _getState = function () {
            return {};
        };
        var init = null;
        var changed = null;

        this.dispatch = d3.dispatch('change', 'set');

        this.dispatch.on('set', function (state) {
            _setState(state, true);
        });

        this.getter = function (fn) {
            _getState = fn;
            return this;
        };

        this.setter = function (fn, callback) {
            if (!callback) {
                callback = function () {
                };
            }
            _setState = function (state, update) {
                fn(state);
                if (update) {
                    callback();
                }
            };
            return this;
        };

        this.init = function (state) {
            init = init || {};
            nv.utils.deepExtend(init, state);
        };

        var _set = function () {
            var settings = _getState();

            if (JSON.stringify(settings) === JSON.stringify(state)) {
                return false;
            }

            for (var key in settings) {
                if (state[key] === undefined) {
                    state[key] = {};
                }
                state[key] = settings[key];
                changed = true;
            }
            return true;
        };

        this.update = function () {
            if (init) {
                _setState(init, false);
                init = null;
            }
            if (_set.call(this)) {
                this.dispatch.change(state);
            }
        };

    };


    /*
     Snippet of code you can insert into each nv.models.* to give you the ability to
     do things like:
     chart.options({
     showXAxis: true,
     tooltips: true
     });

     To enable in the chart:
     chart.options = nv.utils.optionsFunc.bind(chart);
     */
    nv.utils.optionsFunc = function (args) {
        if (args) {
            d3.map(args).forEach((function (key, value) {
                if (typeof this[key] === "function") {
                    this[key](value);
                }
            }).bind(this));
        }
        return this;
    };


    /*
     numTicks:  requested number of ticks
     data:  the chart data

     returns the number of ticks to actually use on X axis, based on chart data
     to avoid duplicate ticks with the same value
     */
    nv.utils.calcTicksX = function (numTicks, data) {
        // find max number of values from all data streams
        var numValues = 1;
        var i = 0;
        for (i; i < data.length; i += 1) {
            var stream_len = data[i] && data[i].values ? data[i].values.length : 0;
            numValues = stream_len > numValues ? stream_len : numValues;
        }
        nv.log("Requested number of ticks: ", numTicks);
        nv.log("Calculated max values to be: ", numValues);
        // make sure we don't have more ticks than values to avoid duplicates
        numTicks = numTicks > numValues ? numTicks = numValues - 1 : numTicks;
        // make sure we have at least one tick
        numTicks = numTicks < 1 ? 1 : numTicks;
        // make sure it's an integer
        numTicks = Math.floor(numTicks);
        nv.log("Calculating tick count as: ", numTicks);
        return numTicks;
    };


    /*
     returns number of ticks to actually use on Y axis, based on chart data
     */
    nv.utils.calcTicksY = function (numTicks, data) {
        // currently uses the same logic but we can adjust here if needed later
        return nv.utils.calcTicksX(numTicks, data);
    };


    /*
     Add a particular option from an options object onto chart
     Options exposed on a chart are a getter/setter function that returns chart
     on set to mimic typical d3 option chaining, e.g. svg.option1('a').option2('b');

     option objects should be generated via Object.create() to provide
     the option of manipulating data via get/set functions.
     */
    nv.utils.initOption = function (chart, name) {
        // if it's a call option, just call it directly, otherwise do get/set
        if (chart._calls && chart._calls[name]) {
            chart[name] = chart._calls[name];
        } else {
            chart[name] = function (_) {
                if (!arguments.length) return chart._options[name];
                chart._overrides[name] = true;
                chart._options[name] = _;
                return chart;
            };
            // calling the option as _option will ignore if set by option already
            // so nvd3 can set options internally but the stop if set manually
            chart['_' + name] = function (_) {
                if (!arguments.length) return chart._options[name];
                if (!chart._overrides[name]) {
                    chart._options[name] = _;
                }
                return chart;
            }
        }
    };


    /*
     Add all options in an options object to the chart
     */
    nv.utils.initOptions = function (chart) {
        chart._overrides = chart._overrides || {};
        var ops = Object.getOwnPropertyNames(chart._options || {});
        var calls = Object.getOwnPropertyNames(chart._calls || {});
        ops = ops.concat(calls);
        for (var i in ops) {
            nv.utils.initOption(chart, ops[i]);
        }
    };


    /*
     Inherit options from a D3 object
     d3.rebind makes calling the function on target actually call it on source
     Also use _d3options so we can track what we inherit for documentation and chained inheritance
     */
    nv.utils.inheritOptionsD3 = function (target, d3_source, oplist) {
        target._d3options = oplist.concat(target._d3options || []);
        oplist.unshift(d3_source);
        oplist.unshift(target);
        d3.rebind.apply(this, oplist);
    };


    /*
     Remove duplicates from an array
     */
    nv.utils.arrayUnique = function (a) {
        return a.sort().filter(function (item, pos) {
            return !pos || item != a[pos - 1];
        });
    };


    /*
     Keeps a list of custom symbols to draw from in addition to d3.svg.symbol
     Necessary since d3 doesn't let you extend its list -_-
     Add new symbols by doing nv.utils.symbols.set('name', function(size){...});
     */
    nv.utils.symbolMap = d3.map();


    /*
     Replaces d3.svg.symbol so that we can look both there and our own map
     */
    nv.utils.symbol = function () {
        var type,
            size = 64;

        function symbol(d, i) {
            var t = type.call(this, d, i);
            var s = size.call(this, d, i);
            if (d3.svg.symbolTypes.indexOf(t) !== -1) {
                return d3.svg.symbol().type(t).size(s)();
            } else {
                return nv.utils.symbolMap.get(t)(s);
            }
        }

        symbol.type = function (_) {
            if (!arguments.length) return type;
            type = d3.functor(_);
            return symbol;
        };
        symbol.size = function (_) {
            if (!arguments.length) return size;
            size = d3.functor(_);
            return symbol;
        };
        return symbol;
    };


    /*
     Inherit option getter/setter functions from source to target
     d3.rebind makes calling the function on target actually call it on source
     Also track via _inherited and _d3options so we can track what we inherit
     for documentation generation purposes and chained inheritance
     */
    nv.utils.inheritOptions = function (target, source) {
        // inherit all the things
        var ops = Object.getOwnPropertyNames(source._options || {});
        var calls = Object.getOwnPropertyNames(source._calls || {});
        var inherited = source._inherited || [];
        var d3ops = source._d3options || [];
        var args = ops.concat(calls).concat(inherited).concat(d3ops);
        args.unshift(source);
        args.unshift(target);
        d3.rebind.apply(this, args);
        // pass along the lists to keep track of them, don't allow duplicates
        target._inherited = nv.utils.arrayUnique(ops.concat(calls).concat(inherited).concat(ops).concat(target._inherited || []));
        target._d3options = nv.utils.arrayUnique(d3ops.concat(target._d3options || []));
    };


    /*
     Runs common initialize code on the svg before the chart builds
     */
    nv.utils.initSVG = function (svg) {
        svg.classed({'nvd3-svg': true});
        svg.attr("xmlns", "http://www.w3.org/2000/svg")
            .attr("xmlns:xlink","http://www.w3.org/1999/xlink")
            .attr("version","1.1");
    };

    nv.utils.dropShadow = function(container, dy, dx, stdDeviation){
        var filter = container.selectAll('filter#drop-shadow').data([1]);
        var filterEnter = filter.enter().append('filter')
            .attr('id', 'drop-shadow');

        filterEnter.append('feGaussianBlur')
            .attr('in', 'SourceAlpha')
            .attr('stdDeviation', stdDeviation || 1.2);

        filterEnter.append('feOffset')
            .attr('dx', dx || 1)
            .attr('dy', dy || 1)
            .attr('result', 'offsetblur');

        filterEnter.append('feFlood')
            .attr('floodColor', 'rgba(250,250,250,0.3)');

        filterEnter.append('feComposite')
            .attr('in2', 'offsetblur')
            .attr('operator', 'in');

        var feMerge = filterEnter.append('feMerge');
        feMerge.append('feMergeNode');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    };


    /*
     Sanitize and provide default for the container height.
     */
    nv.utils.sanitizeHeight = function (height, container) {
        return (height || parseInt(container.style('height'), 10) || 400);
    };


    /*
     Sanitize and provide default for the container width.
     */
    nv.utils.sanitizeWidth = function (width, container) {
        return (width || parseInt(container.style('width'), 10) || 960);
    };


    /*
     Calculate the available height for a chart.
     */
    nv.utils.availableHeight = function (height, container, margin) {
        return Math.max(0, nv.utils.sanitizeHeight(height, container) - margin.top - margin.bottom);
    };

    /*
     Calculate the available width for a chart.
     */
    nv.utils.availableWidth = function (width, container, margin) {
        return Math.max(0, nv.utils.sanitizeWidth(width, container) - margin.left - margin.right);
    };

    /*
     Clear any rendered chart components and display a chart's 'noData' message
     */
    nv.utils.noData = function (chart, container) {
        var opt = chart.options(),
            margin = opt.margin(),
            noData = opt.noData(),
            data = (noData == null) ? ["No Data Available"] : [noData],
            height = nv.utils.availableHeight(null, container, margin),
            width = nv.utils.availableWidth(null, container, margin),
            x = margin.left + width / 2,
            y = margin.top + height / 2;

        //Remove any previously created chart components
        container.selectAll('g').remove();

        var noDataText = container.selectAll('.nv-noData').data(data);

        noDataText.enter().append('text')
            .attr('class', 'nvd3 nv-noData')
            // .attr('dy', '-.7em')
            .style('text-anchor', 'middle');

        noDataText
            .attr('x', x)
            .attr('y', y+15)
            .text(function (t) {
                return t;
            });

        var iconEnter = noDataText.enter().append('g')
            .classed('nv-noData-icon', true)
            .attr('transform', "translate(" + (+x-10) + " " + (+y-25) + ") scale(1.25)")
            .attr('viewBox', '0 0 20 20');

        iconEnter.append('path')
            .attr('d', "M9.6,3.29A6.74,6.74,0,1,0,16.34,10,6.74,6.74,0,0,0,9.6,3.29ZM5.5,8.63a1,1,0,1,1,1,1A1,1,0,0,1,5.5,8.63Zm6.52,4L7.54,13.87a.68.68,0,0,1-.85-.48.69.69,0,0,1,.48-.86l4.48-1.24A.7.7,0,1,1,12,12.64Zm.51-3a1,1,0,1,1,1-1A1,1,0,0,1,12.53,9.65Z" )
            .attr('transform', "translate(-1 -1.43)" )
            .attr('fill', "none");

        iconEnter.append('path')
            .attr('d', "M12.53,7.61a1,1,0,1,0,1,1A1,1,0,0,0,12.53,7.61Z" )
            .attr('transform', "translate(-1 -1.43)" )
            .attr('fill', "#ddd");

        iconEnter.append('path')
            .attr('d', "M7.54,8.63a1,1,0,1,0-1,1A1,1,0,0,0,7.54,8.63Z" )
            .attr('transform', "translate(-1 -1.43)" )
            .attr('fill', "#ddd");

        iconEnter.append('path')
            .attr('d', "M7.54,8.63a1,1,0,1,0-1,1A1,1,0,0,0,7.54,8.63Z" )
            .attr('transform', "translate(-1 -1.43)" )
            .attr('fill', "#ddd");

        iconEnter.append('path')
            .attr('d', "M20.69,19l-4.2-3.8a8.59,8.59,0,1,0-1.27,1.37l4.23,3.81a.92.92,0,0,0,1.31-.06A.94.94,0,0,0,20.69,19ZM9.6,16.77A6.74,6.74,0,1,1,16.34,10,6.74,6.74,0,0,1,9.6,16.77Z" )
            .attr('transform', "translate(-1 -1.43)" )
            .attr('fill', "#ddd");

        iconEnter.append('path')
            .attr('d', "M11.65,11.29,7.17,12.53a.69.69,0,0,0-.48.86.68.68,0,0,0,.85.48L12,12.64a.7.7,0,1,0-.37-1.35Z" )
            .attr('transform', "translate(-1 -1.43)" )
            .attr('fill', "#ddd");

    };

    /*
     Wrap long labels.
     */
    nv.utils.wrapTicks = function (text, width) {
        text.each(function () {
            var text = d3.select(this),
                words = text.text().split(/\s+/).reverse(),
                word,
                line = [],
                lineNumber = 0,
                lineHeight = 1.1,
                y = text.attr("y"),
                dy = parseFloat(text.attr("dy")),
                tspan = text.text(null).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy + "em");
            while (word = words.pop()) {
                line.push(word);
                tspan.text(line.join(" "));
                if (tspan.node().getComputedTextLength() > width) {
                    line.pop();
                    tspan.text(line.join(" "));
                    line = [word];
                    tspan = text.append("tspan").attr("x", 0).attr("y", y).attr("dy", ++lineNumber * lineHeight + dy + "em").text(word);
                }
            }
        });
    };

    /*
     Apply positioning styles to an external legend container div.
     Numeric top/left/bottom values are converted to px; height/width are always px.
     */
    nv.utils.styleExternalLegendContainer = function (element, styles) {
        var el = element;
        var edgeProps = ['top', 'bottom', 'left'];

        edgeProps.forEach(function (prop) {
            if (prop in styles) {
                var val = styles[prop];
                el = el.style(prop, typeof val === 'number' ? val + 'px' : val);
            }
        });

        if ('height' in styles) el = el.style('height', styles.height + 'px');
        if ('width' in styles) el = el.style('width', styles.width + 'px');

        return el;
    };

    nv.utils.createLegendTooltip = function (valueFormatter) {
        return nv.models
            .tooltip()
            .classes('nv-legend-tooltip')
            .headerEnabled(false)
            .duration(0)
            .valueFormatter(valueFormatter || function (d) { return d; });
    };

    nv.utils.bindLegendScrollHide = function (legendElement, legendTooltip) {
        legendElement.on('scroll', function () {
            if (!legendTooltip.hidden()) {
                legendTooltip.hidden(true);
            }
        });
    };

    nv.utils.removeExternalLegend = function (containerEl) {
        d3.select(containerEl.parentNode).selectAll('.nv-legendContainer').remove();
    };

    /*
     Renders a legend in an external div container (pieChart, discreteBarChart).
     Returns layout dimensions and the legend container element.
     */
    nv.utils.renderExternalLegend = function (options) {
        var legend = options.legend;
        var legendData = options.data;
        var containerEl = options.containerEl;
        var d3Container = options.d3Container;
        var legendPosition = options.position;
        var availableWidth = options.availableWidth;
        var availableHeight = options.availableHeight;
        var margin = options.margin;
        var height = options.height;
        var rightColumnCount = options.rightColumnCount !== undefined ? options.rightColumnCount : 2;
        var shrinkChartWidth = !!options.shrinkChartWidth;
        var rightAlign = options.rightAlign;
        var minChartWidth = options.minChartWidth;
        var legendTransform = 'translate(0,0)';

        if (minChartWidth === undefined) {
            minChartWidth = shrinkChartWidth ? Math.floor(availableWidth / 2) : 0;
        }

        function configureStackedLegend() {
            legend
                .width(availableWidth)
                .height(availableHeight / 2)
                .columnCount('auto');
            return availableHeight / 2;
        }

        var maxLegendWidth;
        var legendWidth;

        var newLegendWrap = d3.select(containerEl.parentNode);
        var newLegend = newLegendWrap.append('div').attr('class', 'nv-legendContainer');
        var newLegendSvg = newLegend.append('svg').attr('class', 'nvd3');
        newLegendSvg.append('g').attr('class', ' nv-legendWrap');

        nv.utils.initSVG(newLegendSvg);

        if (legendPosition === 'top') {
            availableHeight = configureStackedLegend();

            nv.utils.styleExternalLegendContainer(newLegend, {
                top: 0,
                left: 0,
                height: availableHeight,
                width: availableWidth
            });

        } else if (legendPosition === 'right') {
            maxLegendWidth = Math.max(0, availableWidth - minChartWidth);

            legend
                .height(availableHeight)
                .width(maxLegendWidth)
                .columnCount(rightColumnCount)
                .rightAlign(rightAlign !== undefined ? rightAlign : false);

            legendTransform = 'translate(10, 10)';

        } else if (legendPosition === 'bottom') {
            availableHeight = configureStackedLegend();
            margin.top = 0;

            nv.utils.styleExternalLegendContainer(newLegend, {
                bottom: 0,
                left: 0,
                height: availableHeight,
                width: availableWidth
            });
        }

        newLegend
            .select('.nv-legendWrap')
            .datum(legendData)
            .call(legend)
            .attr('transform', legendTransform);

        newLegendSvg.style('height', legend.height() + 20 + 'px');

        if (legendPosition === 'right') {
            var measuredWidth = legend.layoutWidth();
            legendWidth = Math.min(maxLegendWidth, Math.ceil(measuredWidth > 0 ? measuredWidth : maxLegendWidth) + 20);

            if (shrinkChartWidth) {
                availableWidth -= legendWidth;
            }

            newLegendSvg.style('width', legendWidth + 'px');

            nv.utils.styleExternalLegendContainer(newLegend, {
                top: 0,
                left: availableWidth,
                width: legendWidth
            });
        }

        if (legendPosition === 'top' && margin.top != legend.height()) {
            margin.top = availableHeight;
            availableHeight = nv.utils.availableHeight(height, d3Container, margin);
        }

        return {
            legendElement: newLegend,
            availableWidth: availableWidth,
            availableHeight: availableHeight,
            margin: margin
        };
    };

    nv.utils.showLegendTooltipAt = function (legendTooltip, d, seriesData) {
        legendTooltip.position(function () {
            var pos = d.element.getBoundingClientRect();
            return { top: pos.y - 20, left: pos.x + 20 };
        });

        legendTooltip.data({ series: seriesData }).hidden(false);
    };

    /*
     Check equality of 2 array
     */
    nv.utils.arrayEquals = function (array1, array2) {
        if (array1 === array2)
            return true;

        if (!array1 || !array2)
            return false;

        // compare lengths - can save a lot of time
        if (array1.length != array2.length)
            return false;

        for (var i = 0,
                 l = array1.length; i < l; i++) {
            // Check if we have nested arrays
            if (array1[i] instanceof Array && array2[i] instanceof Array) {
                // recurse into the nested arrays
                if (!nv.arrayEquals(array1[i], array2[i]))
                    return false;
            } else if (array1[i] != array2[i]) {
                // Warning - two different object instances will never be equal: {x:20} != {x:20}
                return false;
            }
        }
        return true;
    };

})();nv.models.axis = function () {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var axis = d3.svg.axis();
    var scale = d3.scale.linear();

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 75 //only used for tickLabel currently
        , height = 60 //only used for tickLabel currently
        , axisLabelText = null
        , showMaxMin = true //TODO: showMaxMin should be disabled on all ordinal scaled axes
        , rotateLabels = 0
        , rotateYLabel = true
        , staggerLabels = false
        , isOrdinal = false
        , ticks = null
        , xValues = null
        , axisLabelDistance = 0
        , duration = 250
        , dispatch = d3.dispatch('renderEnd')
    ;
    axis
        .scale(scale)
        .orient('bottom')
        .tickFormat(function (d) {
            return d
        })
    ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var scale0;
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function _unique(values, fmt) {
        var vs = [];


        for (var i = 0; i < values.length; i++) {
            if (i === 0 || fmt(values[i]) !== fmt(values[i - 1])) {
                vs.push(values[i]);
            }
        }

        return vs;
    }


    function _dialate(values, maxLength) {

        values = _unique(values.sort(), function(d){ return d;});

        if (values.length > (maxLength + 1)) {

            var vs = [],
                step = Math.max(1, Math.ceil(values.length / maxLength));

            for (var i = 0; i < values.length; i++) {
                if ((i % step) === 0 || i === (values.length - 1)) {
                    var v = values[i];
                    vs.push(v);
                }
            }

            return vs;
        }

        return values;

    }

    function chart(selection) {
        renderWatch.reset();
        selection.each(function (data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            // console.log( axis.orient(), axis.scale().range());


            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-axis').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-axis');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            if (xValues !== null) {

                if (axis.orient() == 'top' || axis.orient() == 'bottom') {
                    var maxTicks = Math.ceil(Math.abs(scale.range()[1] - scale.range()[0]) / 100);

                    axis.tickValues(_dialate(xValues, maxTicks));
                }
                else {
                    axis.tickValues(xValues);
                }
            }
            else if (ticks !== null) {
                axis.ticks(ticks);
            }
            else if (axis.orient() == 'top' || axis.orient() == 'bottom')
                axis.ticks(Math.abs(scale.range()[1] - scale.range()[0]) / 100);

            //TODO: consider calculating width/height based on whether or not label is added, for reference in charts using this component
            g.watchTransition(renderWatch, 'axis').call(axis);

            scale0 = scale0 || axis.scale();





            var fmt = axis.tickFormat();
            if (fmt == null) {
                fmt = scale0.tickFormat();
            }

            if ( axis.orient() === 'left' || axis.orient() === 'right') {
                var ticksData = g.selectAll('.tick').data() || [];

                var uniqTicksData = _unique(ticksData, fmt);

                if ( showMaxMin ){
                    if ( uniqTicksData.length > 0 ) {
                        if (uniqTicksData[0] === scale.domain()[0]) {
                            uniqTicksData.splice(0, 1);
                        }
                    }

                    if ( uniqTicksData.length > 0 ) {
                        if (fmt(uniqTicksData[uniqTicksData.length - 1]) === fmt(scale.domain()[1])) {
                            uniqTicksData.pop();
                        }
                    }
                }

                // console.log('uniq', ticksData, uniqTicksData);
                axis.tickValues(uniqTicksData);
                g.call(axis);
            }


/*
            // unique tick values
            g.selectAll('.tick').data(uniqTicksData).exit().remove();
*/


            var axisLabel = g.selectAll('text.nv-axislabel')
                .data([axisLabelText || null]);
            axisLabel.exit().remove();

            var xLabelMargin;
            var axisMaxMin;
            var w;
            switch (axis.orient()) {
                case 'top':
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    w = 0;
                    if (scale.range().length === 1) {
                        w = isOrdinal ? scale.range()[0] * 2 + scale.rangeBand() : 0;
                    } else if (scale.range().length === 2) {
                        w = isOrdinal ? scale.range()[0] + scale.range()[1] + scale.rangeBand() : scale.range()[1];
                    } else if (scale.range().length > 2) {
                        w = scale.range()[scale.range().length - 1] + (scale.range()[1] - scale.range()[0]);
                    }
                    ;
                    axisLabel
                        .attr('text-anchor', 'middle')
                        .attr('y', 0)
                        .attr('x', w / 2);
                    if (showMaxMin) {
                        axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            .data(scale.domain());
                        axisMaxMin.enter().append('g').attr('class', function (d, i) {
                            return ['nv-axisMaxMin', 'nv-axisMaxMin-x', (i == 0 ? 'nv-axisMin-x' : 'nv-axisMax-x')].join(' ')
                        }).append('text');
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function (d, i) {
                                return 'translate(' + nv.utils.NaNtoZero(scale(d)) + ',0)'
                            })
                            .select('text')
                            .attr('dy', '-0.5em')
                            .attr('y', -axis.tickPadding())
                            .attr('text-anchor', 'middle')
                            .text(function (d, i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max top')
                            .attr('transform', function (d, i) {
                                return 'translate(' + nv.utils.NaNtoZero(scale.range()[i]) + ',0)'
                            });
                    }
                    break;
                case 'bottom':
                    xLabelMargin = axisLabelDistance + 36;
                    var maxTextWidth = 30;
                    var textHeight = 0;
                    var xTicks = g.selectAll('g').select("text");
                    var rotateLabelsRule = '';
                    if (rotateLabels % 360) {
                        //Calculate the longest xTick width
                        xTicks.each(function (d, i) {
                            var box = this.getBoundingClientRect();
                            var width = box.width;
                            textHeight = box.height;
                            if (width > maxTextWidth) maxTextWidth = width;
                        });
                        rotateLabelsRule = 'rotate(' + rotateLabels + ' 0,' + (textHeight / 2 + axis.tickPadding()) + ')';
                        //Convert to radians before calculating sin. Add 30 to margin for healthy padding.
                        var sin = Math.abs(Math.sin(rotateLabels * Math.PI / 180));
                        xLabelMargin = (sin ? sin * maxTextWidth : maxTextWidth) + 30;
                        //Rotate all xTicks
                        xTicks
                            .attr('transform', rotateLabelsRule)
                            .style('text-anchor', rotateLabels % 360 > 0 ? 'start' : 'end');
                    } else {
                        if (staggerLabels) {
                            xTicks
                                .attr('transform', function (d, i) {
                                    return 'translate(0,' + (i % 2 == 0 ? '0' : '12') + ')'
                                });
                        } else {
                            xTicks.attr('transform', "translate(0,0)");
                        }
                    }
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    w = 0;
                    if (scale.range().length === 1) {
                        w = isOrdinal ? scale.range()[0] * 2 + scale.rangeBand() : 0;
                    } else if (scale.range().length === 2) {
                        w = isOrdinal ? scale.range()[0] + scale.range()[1] + scale.rangeBand() : scale.range()[1];
                    } else if (scale.range().length > 2) {
                        w = scale.range()[scale.range().length - 1] + (scale.range()[1] - scale.range()[0]);
                    }
                    ;
                    axisLabel
                        .attr('text-anchor', 'middle')
                        .attr('y', xLabelMargin)
                        .attr('x', w / 2);
                    if (showMaxMin) {
                        //if (showMaxMin && !isOrdinal) {
                        axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                        //.data(scale.domain())
                            .data([scale.domain()[0], scale.domain()[scale.domain().length - 1]]);
                        axisMaxMin.enter().append('g').attr('class', function (d, i) {
                            return ['nv-axisMaxMin', 'nv-axisMaxMin-x', (i == 0 ? 'nv-axisMin-x' : 'nv-axisMax-x')].join(' ')
                        }).append('text');
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function (d, i) {
                                return 'translate(' + nv.utils.NaNtoZero((scale(d) + (isOrdinal ? scale.rangeBand() / 2 : 0))) + ',0)'
                            })
                            .select('text')
                            .attr('dy', '.71em')
                            .attr('y', axis.tickPadding())
                            .attr('transform', rotateLabelsRule)
                            .style('text-anchor', rotateLabels ? (rotateLabels % 360 > 0 ? 'start' : 'end') : 'middle')
                            .text(function (d, i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max bottom')
                            .attr('transform', function (d, i) {
                                return 'translate(' + nv.utils.NaNtoZero((scale(d) + (isOrdinal ? scale.rangeBand() / 2 : 0))) + ',0)'
                            });
                    }

                    break;
                case 'right':
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    axisLabel
                        .style('text-anchor', rotateYLabel ? 'middle' : 'begin')
                        .attr('transform', rotateYLabel ? 'rotate(90)' : '')
                        .attr('y', rotateYLabel ? (-Math.max(margin.right, width) + 12) : -10) //TODO: consider calculating this based on largest tick width... OR at least expose this on chart
                        .attr('x', rotateYLabel ? (d3.max(scale.range()) / 2) : axis.tickPadding());
                    if (showMaxMin) {
                        axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            .data(scale.domain());
                        axisMaxMin.enter().append('g').attr('class', function (d, i) {
                            return ['nv-axisMaxMin', 'nv-axisMaxMin-y', (i == 0 ? 'nv-axisMin-y' : 'nv-axisMax-y')].join(' ')
                        }).append('text')
                            .style('opacity', 0);
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function (d, i) {
                                return 'translate(0,' + nv.utils.NaNtoZero(scale(d)) + ')'
                            })
                            .select('text')
                            .attr('dy', '.32em')
                            .attr('y', 0)
                            .attr('x', axis.tickPadding())
                            .style('text-anchor', 'start')
                            .text(function (d, i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max right')
                            .attr('transform', function (d, i) {
                                return 'translate(0,' + nv.utils.NaNtoZero(scale.range()[i]) + ')'
                            })
                            .select('text')
                            .style('opacity', 1);
                    }
                    break;
                case 'left':
                    /*
                     //For dynamically placing the label. Can be used with dynamically-sized chart axis margins
                     var yTicks = g.selectAll('g').select("text");
                     yTicks.each(function(d,i){
                     var labelPadding = this.getBoundingClientRect().width + axis.tickPadding() + 16;
                     if(labelPadding > width) width = labelPadding;
                     });
                     */
                    axisLabel.enter().append('text').attr('class', 'nv-axislabel');
                    axisLabel
                        .style('text-anchor', rotateYLabel ? 'middle' : 'end')
                        .attr('transform', rotateYLabel ? 'rotate(-90)' : '')
                        .attr('y', rotateYLabel ? (-Math.max(margin.left, width) + 25 - (axisLabelDistance || 0)) : -10)
                        .attr('x', rotateYLabel ? (-d3.max(scale.range()) / 2) : -axis.tickPadding());
                    if (showMaxMin) {
                        axisMaxMin = wrap.selectAll('g.nv-axisMaxMin')
                            .data(scale.domain());
                        axisMaxMin.enter().append('g').attr('class', function (d, i) {
                            return ['nv-axisMaxMin', 'nv-axisMaxMin-y', (i == 0 ? 'nv-axisMin-y' : 'nv-axisMax-y')].join(' ')
                        }).append('text')
                            .style('opacity', 0);
                        axisMaxMin.exit().remove();
                        axisMaxMin
                            .attr('transform', function (d, i) {
                                return 'translate(0,' + nv.utils.NaNtoZero(scale0(d)) + ')'
                            })
                            .select('text')
                            .attr('dy', '.32em')
                            .attr('y', 0)
                            .attr('x', -axis.tickPadding())
                            .attr('text-anchor', 'end')
                            .text(function (d, i) {
                                var v = fmt(d);
                                return ('' + v).match('NaN') ? '' : v;
                            });
                        axisMaxMin.watchTransition(renderWatch, 'min-max right')
                            .attr('transform', function (d, i) {
                                return 'translate(0,' + nv.utils.NaNtoZero(scale.range()[i]) + ')'
                            })
                            .select('text')
                            .style('opacity', 1);
                    }
                    break;
            }
            axisLabel.text(function (d) {
                return d
            });

            if (showMaxMin && (axis.orient() === 'left' || axis.orient() === 'right')) {
                //check if max and min overlap other values, if so, hide the values that overlap
                g.selectAll('g') // the g's wrapping each tick
                    .each(function (d, i) {
                        d3.select(this).select('text').attr('opacity', 1);
                        if (scale(d) < scale.range()[1] + 10 || scale(d) > scale.range()[0] - 10) { // 10 is assuming text height is 16... if d is 0, leave it!
                            if (d > 1e-10 || d < -1e-10) // accounts for minor floating point errors... though could be problematic if the scale is EXTREMELY SMALL
                                d3.select(this).attr('opacity', 0);

                            d3.select(this).select('text').attr('opacity', 0); // Don't remove the ZERO line!!
                        }
                    });

                //if Max and Min = 0 only show min, Issue #281
                if (scale.domain()[0] == scale.domain()[1] && scale.domain()[0] == 0) {
                    wrap.selectAll('g.nv-axisMaxMin').style('opacity', function (d, i) {
                        return !i ? 1 : 0
                    });
                }
            }

            if (showMaxMin && (axis.orient() === 'top' || axis.orient() === 'bottom')) {
                var maxMinRange = [];
                wrap.selectAll('g.nv-axisMaxMin')
                    .each(function (d, i) {
                        try {
                            if (i) // i== 1, max position
                                maxMinRange.push(scale(d) - this.getBoundingClientRect().width - 4);  //assuming the max and min labels are as wide as the next tick (with an extra 4 pixels just in case)
                            else // i==0, min position
                                maxMinRange.push(scale(d) + this.getBoundingClientRect().width + 4)
                        } catch (err) {
                            if (i) // i== 1, max position
                                maxMinRange.push(scale(d) - 4);  //assuming the max and min labels are as wide as the next tick (with an extra 4 pixels just in case)
                            else // i==0, min position
                                maxMinRange.push(scale(d) + 4);
                        }
                    });
                // the g's wrapping each tick
                g.selectAll('g').each(function (d, i) {
                    if (scale(d) < maxMinRange[0] || scale(d) > maxMinRange[1]) {
                        if (d > 1e-10 || d < -1e-10) // accounts for minor floating point errors... though could be problematic if the scale is EXTREMELY SMALL
                            d3.select(this).remove();
                        else
                            d3.select(this).select('text').remove(); // Don't remove the ZERO line!!
                    }
                });
            }

            //Highlight zero tick line
            g.selectAll('.tick')
                .filter(function (d) {
                    /*
                     The filter needs to return only ticks at or near zero.
                     Numbers like 0.00001 need to count as zero as well,
                     and the arithmetic trick below solves that.
                     */
                    return !parseFloat(Math.round(d * 100000) / 1000000) && (d !== undefined)
                })
                .classed('zero', true);

            //store old scales for use in transitions on update
            scale0 = scale.copy();

        });

        renderWatch.renderEnd('axis immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.axis = axis;
    chart.dispatch = dispatch;

    chart.options = nv.utils.optionsFunc.bind(chart);
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        axisLabelDistance: {
            get: function () {
                return axisLabelDistance;
            }, set: function (_) {
                axisLabelDistance = _;
            }
        },
        staggerLabels: {
            get: function () {
                return staggerLabels;
            }, set: function (_) {
                staggerLabels = _;
            }
        },
        rotateLabels: {
            get: function () {
                return rotateLabels;
            }, set: function (_) {
                rotateLabels = _;
            }
        },
        rotateYLabel: {
            get: function () {
                return rotateYLabel;
            }, set: function (_) {
                rotateYLabel = _;
            }
        },
        showMaxMin: {
            get: function () {
                return showMaxMin;
            }, set: function (_) {
                showMaxMin = _;
            }
        },
        axisLabel: {
            get: function () {
                return axisLabelText;
            }, set: function (_) {
                axisLabelText = _;
            }
        },
        height: {
            get: function () {
                return height;
            }, set: function (_) {
                height = _;
            }
        },
        ticks: {
            get: function () {
                return ticks;
            }, set: function (_) {
                ticks = _;
            }
        },
        xValues: {
            get: function () {
                return xValues;
            }, set: function (_) {
                xValues = _;
            }
        },
        width: {
            get: function () {
                return width;
            }, set: function (_) {
                width = _;
            }
        },

        // options that require extra logic in the setter
        margin: {
            get: function () {
                return margin;
            }, set: function (_) {
                margin.top = _.top !== undefined ? _.top : margin.top;
                margin.right = _.right !== undefined ? _.right : margin.right;
                margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
                margin.left = _.left !== undefined ? _.left : margin.left;
            }
        },
        duration: {
            get: function () {
                return duration;
            }, set: function (_) {
                duration = _;
                renderWatch.reset(duration);
            }
        },
        scale: {
            get: function () {
                return scale;
            }, set: function (_) {
                scale = _;
                axis.scale(scale);
                isOrdinal = typeof scale.rangeBands === 'function';
                nv.utils.inheritOptionsD3(chart, scale, ['domain', 'range', 'rangeBand', 'rangeBands']);
            }
        }
    });

    nv.utils.initOptions(chart);
    nv.utils.inheritOptionsD3(chart, axis, ['orient', 'tickValues', 'tickSubdivide', 'tickSize', 'tickPadding', 'tickFormat']);
    nv.utils.inheritOptionsD3(chart, scale, ['domain', 'range', 'rangeBand', 'rangeBands']);

    return chart;
};
nv.models.boxPlot = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , x = d3.scale.ordinal()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , color = nv.utils.defaultColor()
        , container = null
        , xDomain
        , yDomain
        , xRange
        , yRange
        , dispatch = d3.dispatch('elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        , duration = 250
        , maxBoxWidth = null
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0;
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            // Setup Scales
            x   .domain(xDomain || data.map(function(d,i) { return getX(d,i); }))
                .rangeBands(xRange || [0, availableWidth], .1);

            // if we know yDomain, no need to calculate
            var yData = []
            if (!yDomain) {
                // (y-range is based on quartiles, whiskers and outliers)

                // lower values
                var yMin = d3.min(data.map(function(d) {
                    var min_arr = [];

                    min_arr.push(d.values.Q1);
                    if (d.values.hasOwnProperty('whisker_low') && d.values.whisker_low !== null) { min_arr.push(d.values.whisker_low); }
                    if (d.values.hasOwnProperty('outliers') && d.values.outliers !== null) { min_arr = min_arr.concat(d.values.outliers); }

                    return d3.min(min_arr);
                }));

                // upper values
                var yMax = d3.max(data.map(function(d) {
                    var max_arr = [];

                    max_arr.push(d.values.Q3);
                    if (d.values.hasOwnProperty('whisker_high') && d.values.whisker_high !== null) { max_arr.push(d.values.whisker_high); }
                    if (d.values.hasOwnProperty('outliers') && d.values.outliers !== null) { max_arr = max_arr.concat(d.values.outliers); }

                    return d3.max(max_arr);
                }));

                yData = [ yMin, yMax ] ;
            }

            y.domain(yDomain || yData);
            y.range(yRange || [availableHeight, 0]);

            //store old scales if they exist
            x0 = x0 || x;
            y0 = y0 || y.copy().range([y(0),y(0)]);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap');
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var boxplots = wrap.selectAll('.nv-boxplot').data(function(d) { return d });
            var boxEnter = boxplots.enter().append('g').style('stroke-opacity', 1e-6).style('fill-opacity', 1e-6);
            boxplots
                .attr('class', 'nv-boxplot')
                .attr('transform', function(d,i,j) { return 'translate(' + (x(getX(d,i)) + x.rangeBand() * .05) + ', 0)'; })
                .classed('hover', function(d) { return d.hover });
            boxplots
                .watchTransition(renderWatch, 'nv-boxplot: boxplots')
                .style('stroke-opacity', 1)
                .style('fill-opacity', .75)
                .delay(function(d,i) { return i * duration / data.length })
                .attr('transform', function(d,i) {
                    return 'translate(' + (x(getX(d,i)) + x.rangeBand() * .05) + ', 0)';
                });
            boxplots.exit().remove();

            // ----- add the SVG elements for each boxPlot -----

            // conditionally append whisker lines
            boxEnter.each(function(d,i) {
              var box = d3.select(this);

              ['low', 'high'].forEach(function(key) {
                if (d.values.hasOwnProperty('whisker_' + key) && d.values['whisker_' + key] !== null) {
                  box.append('line')
                    .style('stroke', (d.color) ? d.color : color(d,i))
                    .attr('class', 'nv-boxplot-whisker nv-boxplot-' + key);

                  box.append('line')
                    .style('stroke', (d.color) ? d.color : color(d,i))
                    .attr('class', 'nv-boxplot-tick nv-boxplot-' + key);
                }
              });
            });

            // outliers
            // TODO: support custom colors here
            var outliers = boxplots.selectAll('.nv-boxplot-outlier').data(function(d) {
                if (d.values.hasOwnProperty('outliers') && d.values.outliers !== null) { return d.values.outliers; }
                else { return []; }
            });
            outliers.enter().append('circle')
                .style('fill', function(d,i,j) { return color(d,j) }).style('stroke', function(d,i,j) { return color(d,j) })
                .on('mouseover', function(d,i,j) {
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        series: { key: d, color: color(d,j) },
                        e: d3.event
                    });
                })
                .on('mouseout', function(d,i,j) {
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        series: { key: d, color: color(d,j) },
                        e: d3.event
                    });
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({e: d3.event});
                });

            outliers.attr('class', 'nv-boxplot-outlier');
            outliers
              .watchTransition(renderWatch, 'nv-boxplot: nv-boxplot-outlier')
                .attr('cx', x.rangeBand() * .45)
                .attr('cy', function(d,i,j) { return y(d); })
                .attr('r', '3');
            outliers.exit().remove();

            var box_width = function() { return (maxBoxWidth === null ? x.rangeBand() * .9 : Math.min(75, x.rangeBand() * .9)); };
            var box_left  = function() { return x.rangeBand() * .45 - box_width()/2; };
            var box_right = function() { return x.rangeBand() * .45 + box_width()/2; };

            // update whisker lines and ticks
            ['low', 'high'].forEach(function(key) {
              var endpoint = (key === 'low') ? 'Q1' : 'Q3';

              boxplots.select('line.nv-boxplot-whisker.nv-boxplot-' + key)
                .watchTransition(renderWatch, 'nv-boxplot: boxplots')
                  .attr('x1', x.rangeBand() * .45 )
                  .attr('y1', function(d,i) { return y(d.values['whisker_' + key]); })
                  .attr('x2', x.rangeBand() * .45 )
                  .attr('y2', function(d,i) { return y(d.values[endpoint]); });

              boxplots.select('line.nv-boxplot-tick.nv-boxplot-' + key)
                .watchTransition(renderWatch, 'nv-boxplot: boxplots')
                  .attr('x1', box_left )
                  .attr('y1', function(d,i) { return y(d.values['whisker_' + key]); })
                  .attr('x2', box_right )
                  .attr('y2', function(d,i) { return y(d.values['whisker_' + key]); });
            });

            ['low', 'high'].forEach(function(key) {
              boxEnter.selectAll('.nv-boxplot-' + key)
                .on('mouseover', function(d,i,j) {
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        series: { key: d.values['whisker_' + key], color: color(d,j) },
                        e: d3.event
                    });
                })
                .on('mouseout', function(d,i,j) {
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        series: { key: d.values['whisker_' + key], color: color(d,j) },
                        e: d3.event
                    });
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({e: d3.event});
                });
            });

            // boxes
            boxEnter.append('rect')
                .attr('class', 'nv-boxplot-box')
                // tooltip events
                .on('mouseover', function(d,i) {
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        key: d.label,
                        value: d.label,
                        series: [
                            { key: 'Q3', value: d.values.Q3, color: d.color || color(d,i) },
                            { key: 'Q2', value: d.values.Q2, color: d.color || color(d,i) },
                            { key: 'Q1', value: d.values.Q1, color: d.color || color(d,i) }
                        ],
                        data: d,
                        index: i,
                        e: d3.event
                    });
                })
                .on('mouseout', function(d,i) {
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        key: d.label,
                        value: d.label,
                        series: [
                            { key: 'Q3', value: d.values.Q3, color: d.color || color(d,i) },
                            { key: 'Q2', value: d.values.Q2, color: d.color || color(d,i) },
                            { key: 'Q1', value: d.values.Q1, color: d.color || color(d,i) }
                        ],
                        data: d,
                        index: i,
                        e: d3.event
                    });
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({e: d3.event});
                });

            // box transitions
            boxplots.select('rect.nv-boxplot-box')
              .watchTransition(renderWatch, 'nv-boxplot: boxes')
                .attr('y', function(d,i) { return y(d.values.Q3); })
                .attr('width', box_width)
                .attr('x', box_left )

                .attr('height', function(d,i) { return Math.abs(y(d.values.Q3) - y(d.values.Q1)) || 1 })
                .style('fill', function(d,i) { return d.color || color(d,i) })
                .style('stroke', function(d,i) { return d.color || color(d,i) });

            // median line
            boxEnter.append('line').attr('class', 'nv-boxplot-median');

            boxplots.select('line.nv-boxplot-median')
              .watchTransition(renderWatch, 'nv-boxplot: boxplots line')
                .attr('x1', box_left)
                .attr('y1', function(d,i) { return y(d.values.Q2); })
                .attr('x2', box_right)
                .attr('y2', function(d,i) { return y(d.values.Q2); });

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();
        });

        renderWatch.renderEnd('nv-boxplot immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:   {get: function(){return width;}, set: function(_){width=_;}},
        height:  {get: function(){return height;}, set: function(_){height=_;}},
        maxBoxWidth: {get: function(){return maxBoxWidth;}, set: function(_){maxBoxWidth=_;}},
        x:       {get: function(){return getX;}, set: function(_){getX=_;}},
        y:       {get: function(){return getY;}, set: function(_){getY=_;}},
        xScale:  {get: function(){return x;}, set: function(_){x=_;}},
        yScale:  {get: function(){return y;}, set: function(_){y=_;}},
        xDomain: {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain: {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:  {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:  {get: function(){return yRange;}, set: function(_){yRange=_;}},
        id:          {get: function(){return id;}, set: function(_){id=_;}},
        // rectClass: {get: function(){return rectClass;}, set: function(_){rectClass=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};
nv.models.boxPlotChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var boxplot = nv.models.boxPlot()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        ;

    var margin = {top: 15, right: 10, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.getColor()
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , staggerLabels = false
        , tooltip = nv.models.tooltip()
        , x
        , y
        , noData = "No Data Available."
        , dispatch = d3.dispatch('beforeUpdate', 'renderEnd')
        , duration = 250
        ;

    xAxis
        .orient('bottom')
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickFormat(d3.format(',.1f'))
    ;

    tooltip.duration(0);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(boxplot);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = (width  || parseInt(container.style('width')) || 960)
                    - margin.left - margin.right,
                availableHeight = (height || parseInt(container.style('height')) || 400)
                    - margin.top - margin.bottom;

            chart.update = function() {
                dispatch.beforeUpdate();
                container.transition().duration(duration).call(chart);
            };
            chart.container = this;

            // Display No Data message if there's nothing to show. (quartiles required at minimum)
            if (!data || !data.length ||
                    !data.filter(function(d) { return d.values.hasOwnProperty("Q1") && d.values.hasOwnProperty("Q2") && d.values.hasOwnProperty("Q3"); }).length) {
                var noDataText = container.selectAll('.nv-noData').data([noData]);

                noDataText.enter().append('text')
                    .attr('class', 'nvd3 nv-noData')
                    .attr('dy', '-.7em')
                    .style('text-anchor', 'middle');

                noDataText
                    .attr('x', margin.left + availableWidth / 2)
                    .attr('y', margin.top + availableHeight / 2)
                    .text(function(d) { return d });

                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = boxplot.xScale();
            y = boxplot.yScale().clamp(true);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-boxPlotWithAxes').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-boxPlotWithAxes').append('g');
            var defsEnter = gEnter.append('defs');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis')
                .append('g').attr('class', 'nv-zeroLine')
                .append('line');

            gEnter.append('g').attr('class', 'nv-barsWrap');

            g.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            // Main Chart Component(s)
            boxplot
                .width(availableWidth)
                .height(availableHeight);

            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }))

            barsWrap.transition().call(boxplot);


            defsEnter.append('clipPath')
                .attr('id', 'nv-x-label-clip-' + boxplot.id())
                .append('rect');

            g.select('#nv-x-label-clip-' + boxplot.id() + ' rect')
                .attr('width', x.rangeBand() * (staggerLabels ? 2 : 1))
                .attr('height', 16)
                .attr('x', -x.rangeBand() / (staggerLabels ? 1 : 2 ));

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    .ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis').attr('transform', 'translate(0,' + y.range()[0] + ')');
                g.select('.nv-x.nv-axis').call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis').selectAll('g');
                if (staggerLabels) {
                    xTicks
                        .selectAll('text')
                        .attr('transform', function(d,i,j) { return 'translate(0,' + (j % 2 == 0 ? '5' : '17') + ')' })
                }
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    .ticks( Math.floor(availableHeight/36) ) // can't use nv.utils.calcTicksY with Object data
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis').call(yAxis);
            }

            // Zero line
            g.select(".nv-zeroLine line")
                .attr("x1",0)
                .attr("x2",availableWidth)
                .attr("y1", y(0))
                .attr("y2", y(0))
            ;

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------
        });

        renderWatch.renderEnd('nv-boxplot chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    boxplot.dispatch.on('elementMouseover.tooltip', function(evt) {
        tooltip.data(evt).hidden(false);
    });

    boxplot.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.data(evt).hidden(true);
    });

    boxplot.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.boxplot = boxplot;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        staggerLabels: {get: function(){return staggerLabels;}, set: function(_){staggerLabels=_;}},
        showXAxis: {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis: {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        tooltipContent:    {get: function(){return tooltip;}, set: function(_){tooltip=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            boxplot.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            boxplot.color(color);
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( (_) ? 'right' : 'left');
        }}
    });

    nv.utils.inheritOptions(chart, boxplot);
    nv.utils.initOptions(chart);

    return chart;
}

// Chart design based on the recommendations of Stephen Few. Implementation
// based on the work of Clint Ivy, Jamie Love, and Jason Davies.
// http://projects.instantcognition.com/protovis/bulletchart/

nv.models.bullet = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , orient = 'left' // TODO top & bottom
        , reverse = false
        , ranges = function(d) { return d.ranges }
        , markers = function(d) { return d.markers ? d.markers : [] }
        , measures = function(d) { return d.measures }
        , rangeLabels = function(d) { return d.rangeLabels ? d.rangeLabels : [] }
        , markerLabels = function(d) { return d.markerLabels ? d.markerLabels : []  }
        , measureLabels = function(d) { return d.measureLabels ? d.measureLabels : []  }
        , forceX = [0] // List of numbers to Force into the X scale (ie. 0, or a max / min, etc.)
        , width = 380
        , height = null
        , container = null
        , tickFormat = null
        , getX = function(d){ return d[0]; }
        , getY = function(d){ return d[1]; }
        , color = nv.utils.getColor(['#1f77b4'])
        , dispatch = d3.dispatch('elementMouseover', 'elementMouseout', 'elementMousemove')
        ;

    function chart(selection) {
        selection.each(function(d, i) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            var rangez = ranges.call(this, d, i).slice(),
                markerz = markers.call(this, d, i),
                measurez = measures.call(this, d, i).slice();

            // Setup Scales
            // Compute the new x-scale.
            var x1 = d3.scale.linear()
                .domain( d3.extent(d3.merge([forceX, [d3.max(rangez, getY)], [d3.sum(measurez, getY)]])) )
                .range(reverse ? [availableWidth, 0] : [0, availableWidth]);

            // Retrieve the old x-scale, if this is an update.
            var x0 = this.__chart__ || d3.scale.linear()
                .domain([0, Infinity])
                .range(x1.range());

            // Stash the new scale.
            this.__chart__ = x1;

/*
            var rangeMin = d3.min(rangez), //rangez[2]
                rangeMax = d3.max(rangez), //rangez[0]
                rangeAvg = rangez[1];
*/

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-bullet').data([d]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-bullet');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            g.selectAll('rect.nv-range').data(rangez)
                .enter()
                .append('rect')
                .attr('class', 'nv-range');

            var w1 = function (d) {
                    return Math.abs(x1(getY(d)) - x1(0))
                },
                xp1 = function (d) {
                    return d < 0 ? x1(getY(d)) : x1(0)
                };

            g.selectAll('rect.nv-range')
                .attr('height', availableHeight)
                .attr('width', w1)
                .attr('x', xp1);

            g.selectAll('rect.nv-measure')
                .data(measurez)
                .enter()
                .append('rect')
                .attr('class', 'nv-measure');

            var measureHeight = Math.max(10, measurez.length > 0 ? availableHeight / (measurez.length): 20);

            g.selectAll('rect.nv-measure')
                .style('fill', color)
                .attr('height', measureHeight)
                .attr('y', function(d,i){ return i * measureHeight; } )
                .attr('width', function(d){ return getY(d) < 0 ? x1(0) - x1(getY(d)) : x1(getY(d)) - x1(0); } )
                .attr('x', function (d, i) {
                    return x1(i > 0 ? d3.sum(measurez.slice(0, i), function (d) {
                        return Math.max(0, getY(d));
                    }) + Math.min(0, getY(d)) : 0);
                })
                .on('mouseover', function(d,i) {
                    dispatch.elementMouseover({
                        value: getY(d),
                        label: getX(d),
                        color: d3.select(this).style("fill")
                    })
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({
                        value: getY(d),
                        label: getX(d),
                        color: d3.select(this).style("fill")
                    })
                })
                .on('mouseout', function(d,i) {
                    dispatch.elementMouseout({
                        value: getY(d),
                        label: getX(d),
                        color: d3.select(this).style("fill")
                    })
                });

            g.selectAll("line.nv-marker")
              .data(markerz)
              .enter()
              .append('line')
              .attr('class', 'nv-marker');

            g.selectAll("line.nv-marker")
                .attr('x1', function(d){ return x1(getY(d)); })
                .attr('x2', function(d){ return x1(getY(d)); })
                .attr('y1', 0)
                .attr('y2', availableHeight);

            wrap.selectAll('.nv-range')
                .on('mouseover', function(d,i) {
                    dispatch.elementMouseover({
                        value: getY(d),
                        label: getX(d),
                        color: d3.select(this).style("fill")
                    })
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({
                        value: getY(d),
                        label: getX(d),
                        color: d3.select(this).style("fill")
                    })
                })
                .on('mouseout', function(d,i) {
                    dispatch.elementMouseout({
                        value: getY(d),
                        label: getX(d),
                        color: d3.select(this).style("fill")
                    })
                });
        });

        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        ranges:      {get: function(){return ranges;}, set: function(_){ranges=_;}}, // ranges (bad, satisfactory, good)
        markers:     {get: function(){return markers;}, set: function(_){markers=_;}}, // markers (previous, goal)
        measures: {get: function(){return measures;}, set: function(_){measures=_;}}, // measures (actual, forecast)
        forceX:      {get: function(){return forceX;}, set: function(_){forceX=_;}},
        width:    {get: function(){return width;}, set: function(_){width=_;}},
        height:    {get: function(){return height;}, set: function(_){height=_;}},
        tickFormat:    {get: function(){return tickFormat;}, set: function(_){tickFormat=_;}},
        x: {
            get: function () {
                return getX;
            }, set: function (_) {
                getX = _;
            }
        },
        y: {
            get: function () {
                return getY;
            }, set: function (_) {
                getY = _;
            }
        },

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        orient: {get: function(){return orient;}, set: function(_){ // left, right, top, bottom
            orient = _;
            reverse = orient == 'right' || orient == 'bottom';
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};



// Chart design based on the recommendations of Stephen Few. Implementation
// based on the work of Clint Ivy, Jamie Love, and Jason Davies.
// http://projects.instantcognition.com/protovis/bulletchart/
nv.models.bulletChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var bullet = nv.models.bullet();
    var tooltip = nv.models.tooltip();

    var orient = 'left' // TODO top & bottom
        , reverse = false
        , margin = {top: 5, right: 40, bottom: 20, left: 120}
        , ranges = function(d) { return d.ranges }
        , markers = function(d) { return d.markers ? d.markers : [] }
        , measures = function(d) { return d.measures }
        , width = null
        , height = null
        , tickFormat = null
        , valueFormat = d3.format(',.3f')
        , ticks = null
        , getX = function(d) { return d[0]; }
        , getY = function(d) { return d[1]; }
        , noData = null
        , dispatch = d3.dispatch()
        ;

    tooltip
        .duration(0)
        .headerEnabled(false);

    function chart(selection) {
        selection.each(function(d, i) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin),
                that = this;

            chart.update = function() { chart(selection) };
            chart.container = this;

            tooltip.chartContainer(chart.container.parentNode);

            // Display No Data message if there's nothing to show.
            if (!d || !d.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            var rangez = ranges.call(this, d[0], i).slice(),
                markerz = markers.call(this, d[0], i).slice(),
                measurez = measures.call(this, d[0], i).slice();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-bulletChart').data(d);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-bulletChart');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-bulletWrap');
            gEnter.append('g').attr('class', 'nv-titles');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Compute the new x-scale.
            var x1 = d3.scale.linear()
                .domain(
                    d3.extent(

                        d3.merge([
                            bullet.forceX(),
                            d3.extent(rangez, bullet.y()),
                            d3.extent(markerz, bullet.y()),
                            [d3.sum(measurez, bullet.y())]
                            ])
                    )
                )  // TODO: need to allow forceX and forceY, and xDomain, yDomain
                .range(reverse ? [availableWidth, 0] : [0, availableWidth]);

            // Retrieve the old x-scale, if this is an update.
            var x0 = this.__chart__ || d3.scale.linear()
                .domain([0, Infinity])
                .range(x1.range());

            // Stash the new scale.
            this.__chart__ = x1;

            //var w0 = function(d) { return Math.abs(x0(d) - x0(0)) }, // TODO: could optimize by precalculating x0(0) and x1(0)
            //    w1 = function(d) { return Math.abs(x1(d) - x1(0)) };

            var title = gEnter.select('.nv-titles').append('g')
                .attr('text-anchor', 'end')
                .attr('transform', 'translate(-6,' + (height - margin.top - margin.bottom) / 2 + ')');
            title.append('text')
                .attr('class', 'nv-title')
                .text(function(d) { return d.title; });

            title.append('text')
                .attr('class', 'nv-subtitle')
                .attr('dy', '1em')
                .text(function(d) { return d.subtitle; });

            bullet
                .width(availableWidth)
                .height(availableHeight);

            var bulletWrap = g.select('.nv-bulletWrap');
            d3.transition(bulletWrap).call(bullet);

            // Compute the tick format.
            var format = tickFormat || x1.tickFormat( availableWidth / 100 );

            tooltip.valueFormatter(valueFormat);

            // Update the tick groups.
            var tick = g.selectAll('g.nv-tick')
                .data(x1.ticks( ticks ? ticks : (availableWidth / 100) ), function(d) {
                    return this.textContent || format(d);
                });

            // Initialize the ticks with the old scale, x0.
            var tickEnter = tick.enter().append('g')
                .attr('class', 'nv-tick')
                .attr('transform', function(d) { return 'translate(' + x0(d) + ',0)' })
                .style('opacity', 1e-6);

            tickEnter.append('line')
                .attr('y1', availableHeight)
                .attr('y2', availableHeight + 6);

            tickEnter.append('text')
                .attr('text-anchor', 'middle')
                //.attr('dy', '1em')
                .attr('y', availableHeight + 7)
                .text(format);

            // Transition the updating ticks to the new scale, x1.
            var tickUpdate = /*d3.transition*/(tick)
                .attr('transform', function(d) { return 'translate(' + x1(d) + ',0)' })
                .style('opacity', 1);

            tickUpdate.select('line')
                .attr('y1', availableHeight)
                .attr('y2', availableHeight + 10);

            tickUpdate.select('text')
                .attr('y', availableHeight + 10);

            // Transition the exiting ticks to the new scale, x1.
            /*d3.transition*/(tick.exit())
                .attr('transform', function(d) { return 'translate(' + x1(d) + ',0)' })
                .style('opacity', 1e-6)
                .remove();
        });

        d3.timer.flush();
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    bullet.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.label,
            value: Math.abs(evt.value),
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    bullet.dispatch.on('elementMouseout.tooltip', function(/*evt*/) {
        tooltip.hidden(true);
    });

    bullet.dispatch.on('elementMousemove.tooltip', function(/*evt*/) {
        tooltip();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.bullet = bullet;
    chart.dispatch = dispatch;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        ranges:      {get: function(){return ranges;}, set: function(_){ranges=_;}}, // ranges (bad, satisfactory, good)
        markers:     {get: function(){return markers;}, set: function(_){markers=_;}}, // markers (previous, goal)
        measures: {get: function(){return measures;}, set: function(_){measures=_;}}, // measures (actual, forecast)
        width:    {get: function(){return width;}, set: function(_){width=_;}},
        height:    {get: function(){return height;}, set: function(_){height=_;}},
        tickFormat:    {get: function(){return tickFormat;}, set: function(_){tickFormat=_;}},
        valueFormat:    {get: function(){return valueFormat;}, set: function(_){valueFormat=_;}},
        ticks:    {get: function(){return ticks;}, set: function(_){ticks=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        orient: {get: function(){return orient;}, set: function(_){ // left, right, top, bottom
            orient = _;
            reverse = orient == 'right' || orient == 'bottom';
        }}
    });

    nv.utils.inheritOptions(chart, bullet);
    nv.utils.initOptions(chart);

    return chart;
};



nv.models.candlestickBar = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container
        , x = d3.scale.linear()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , getOpen = function(d) { return d.open }
        , getClose = function(d) { return d.close }
        , getHigh = function(d) { return d.high }
        , getLow = function(d) { return d.low }
        , forceX = []
        , forceY = []
        , padData     = false // If true, adds half a data points width to front and back, for lining up a line chart with a bar chart
        , clipEdge = true
        , color = nv.utils.defaultColor()
        , interactive = false
        , xDomain
        , yDomain
        , xRange
        , yRange
        , dispatch = d3.dispatch('stateChange', 'changeState', 'renderEnd', 'chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove')
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    function chart(selection) {
        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            // Width of the candlestick bars.
            var barWidth = (availableWidth / data[0].values.length) * .45;

            // Setup Scales
            x.domain(xDomain || d3.extent(data[0].values.map(getX).concat(forceX) ));

            if (padData)
                x.range(xRange || [availableWidth * .5 / data[0].values.length, availableWidth * (data[0].values.length - .5)  / data[0].values.length ]);
            else
                x.range(xRange || [5 + barWidth / 2, availableWidth - barWidth / 2 - 5]);

            y.domain(yDomain || [
                    d3.min(data[0].values.map(getLow).concat(forceY)),
                    d3.max(data[0].values.map(getHigh).concat(forceY))
                ]
            ).range(yRange || [availableHeight, 0]);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] + y.domain()[0] * 0.01, y.domain()[1] - y.domain()[1] * 0.01])
                    : y.domain([-1,1]);

            // Setup containers and skeleton of chart
            var wrap = d3.select(this).selectAll('g.nv-wrap.nv-candlestickBar').data([data[0].values]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-candlestickBar');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-ticks');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            container
                .on('click', function(d,i) {
                    dispatch.chartClick({
                        data: d,
                        index: i,
                        pos: d3.event,
                        id: id
                    });
                });

            defsEnter.append('clipPath')
                .attr('id', 'nv-chart-clip-path-' + id)
                .append('rect');

            wrap.select('#nv-chart-clip-path-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            g   .attr('clip-path', clipEdge ? 'url(#nv-chart-clip-path-' + id + ')' : '');

            var ticks = wrap.select('.nv-ticks').selectAll('.nv-tick')
                .data(function(d) { return d });
            ticks.exit().remove();

            var tickGroups = ticks.enter().append('g');

            // The colors are currently controlled by CSS.
            ticks
                .attr('class', function(d, i, j) { return (getOpen(d, i) > getClose(d, i) ? 'nv-tick negative' : 'nv-tick positive') + ' nv-tick-' + j + '-' + i});

            var lines = tickGroups.append('line')
                .attr('class', 'nv-candlestick-lines')
                .attr('transform', function(d, i) { return 'translate(' + x(getX(d, i)) + ',0)'; })
                .attr('x1', 0)
                .attr('y1', function(d, i) { return y(getHigh(d, i)); })
                .attr('x2', 0)
                .attr('y2', function(d, i) { return y(getLow(d, i)); });

            var rects = tickGroups.append('rect')
                .attr('class', 'nv-candlestick-rects nv-bars')
                .attr('transform', function(d, i) {
                    return 'translate(' + (x(getX(d, i)) - barWidth/2) + ','
                    + (y(getY(d, i)) - (getOpen(d, i) > getClose(d, i) ? (y(getClose(d, i)) - y(getOpen(d, i))) : 0))
                    + ')';
                })
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', barWidth)
                .attr('height', function(d, i) {
                    var open = getOpen(d, i);
                    var close = getClose(d, i);
                    return open > close ? y(close) - y(open) : y(open) - y(close);
                });

            ticks.select('.nv-candlestick-lines').transition()
                .attr('transform', function(d, i) { return 'translate(' + x(getX(d, i)) + ',0)'; })
                .attr('x1', 0)
                .attr('y1', function(d, i) { return y(getHigh(d, i)); })
                .attr('x2', 0)
                .attr('y2', function(d, i) { return y(getLow(d, i)); });

            ticks.select('.nv-candlestick-rects').transition()
                .attr('transform', function(d, i) {
                    return 'translate(' + (x(getX(d, i)) - barWidth/2) + ','
                    + (y(getY(d, i)) - (getOpen(d, i) > getClose(d, i) ? (y(getClose(d, i)) - y(getOpen(d, i))) : 0))
                    + ')';
                })
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', barWidth)
                .attr('height', function(d, i) {
                    var open = getOpen(d, i);
                    var close = getClose(d, i);
                    return open > close ? y(close) - y(open) : y(open) - y(close);
                });
        });

        return chart;
    }


    //Create methods to allow outside functions to highlight a specific bar.
    chart.highlightPoint = function(pointIndex, isHoverOver) {
        chart.clearHighlights();
        container.select(".nv-candlestickBar .nv-tick-0-" + pointIndex)
            .classed("hover", isHoverOver)
        ;
    };

    chart.clearHighlights = function() {
        container.select(".nv-candlestickBar .nv-tick.hover")
            .classed("hover", false)
        ;
    };

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:    {get: function(){return width;}, set: function(_){width=_;}},
        height:   {get: function(){return height;}, set: function(_){height=_;}},
        xScale:   {get: function(){return x;}, set: function(_){x=_;}},
        yScale:   {get: function(){return y;}, set: function(_){y=_;}},
        xDomain:  {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain:  {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:   {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:   {get: function(){return yRange;}, set: function(_){yRange=_;}},
        forceX:   {get: function(){return forceX;}, set: function(_){forceX=_;}},
        forceY:   {get: function(){return forceY;}, set: function(_){forceY=_;}},
        padData:  {get: function(){return padData;}, set: function(_){padData=_;}},
        clipEdge: {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},
        id:       {get: function(){return id;}, set: function(_){id=_;}},
        interactive: {get: function(){return interactive;}, set: function(_){interactive=_;}},

        x:     {get: function(){return getX;}, set: function(_){getX=_;}},
        y:     {get: function(){return getY;}, set: function(_){getY=_;}},
        open:  {get: function(){return getOpen();}, set: function(_){getOpen=_;}},
        close: {get: function(){return getClose();}, set: function(_){getClose=_;}},
        high:  {get: function(){return getHigh;}, set: function(_){getHigh=_;}},
        low:   {get: function(){return getLow;}, set: function(_){getLow=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    != undefined ? _.top    : margin.top;
            margin.right  = _.right  != undefined ? _.right  : margin.right;
            margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   != undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};

nv.models.cumulativeLineChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var lines = nv.models.line()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , controls = nv.models.legend()
        , interactiveLayer = nv.interactiveGuideline()
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 30, right: 30, bottom: 50, left: 60}
        , color = nv.utils.defaultColor()
        , width = null
        , height = null
        , showLegend = true
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , showControls = true
        , useInteractiveGuideline = false
        , rescaleY = true
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , id = lines.id()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , average = function(d) { return d.average }
        , dispatch = d3.dispatch('stateChange', 'changeState', 'renderEnd')
        , transitionDuration = 250
        , duration = 250
        , noErrorCheck = false  //if set to TRUE, will bypass an error check in the indexify function.
        ;

    state.index = 0;
    state.rescaleY = rescaleY;

    xAxis.orient('bottom').tickPadding(7);
    yAxis.orient((rightAlignYAxis) ? 'right' : 'left');

    tooltip.valueFormatter(function(d, i) {
        return yAxis.tickFormat()(d, i);
    }).headerFormatter(function(d, i) {
        return xAxis.tickFormat()(d, i);
    });

    controls.updateState(false);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var dx = d3.scale.linear()
        , index = {i: 0, x: 0}
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled }),
                index: index.i,
                rescaleY: rescaleY
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.index !== undefined)
                index.i = state.index;
            if (state.rescaleY !== undefined)
                rescaleY = state.rescaleY;
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(lines);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);
        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);
            container.classed('nv-chart-' + id, true);
            var that = this;

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0)
                    container.call(chart);
                else
                    container.transition().duration(duration).call(chart)
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            var indexDrag = d3.behavior.drag()
                .on('dragstart', dragStart)
                .on('drag', dragMove)
                .on('dragend', dragEnd);


            function dragStart(d,i) {
                d3.select(chart.container)
                    .style('cursor', 'ew-resize');
            }

            function dragMove(d,i) {
                index.x = d3.event.x;
                index.i = Math.round(dx.invert(index.x));
                updateZero();
            }

            function dragEnd(d,i) {
                d3.select(chart.container)
                    .style('cursor', 'auto');

                // update state and send stateChange with new index
                state.index = index.i;
                dispatch.stateChange(state);
            }

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = lines.xScale();
            y = lines.yScale();

            if (!rescaleY) {
                var seriesDomains = data
                    .filter(function(series) { return !series.disabled })
                    .map(function(series,i) {
                        var initialDomain = d3.extent(series.values, lines.y());

                        //account for series being disabled when losing 95% or more
                        if (initialDomain[0] < -.95) initialDomain[0] = -.95;

                        return [
                                (initialDomain[0] - initialDomain[1]) / (1 + initialDomain[1]),
                                (initialDomain[1] - initialDomain[0]) / (1 + initialDomain[0])
                        ];
                    });

                var completeDomain = [
                    d3.min(seriesDomains, function(d) { return d[0] }),
                    d3.max(seriesDomains, function(d) { return d[1] })
                ];

                lines.yDomain(completeDomain);
            } else {
                lines.yDomain(null);
            }

            dx.domain([0, data[0].values.length - 1]) //Assumes all series have same length
                .range([0, availableWidth])
                .clamp(true);

            var data = indexify(index.i, data);

            // Setup containers and skeleton of chart
            var interactivePointerEvents = (useInteractiveGuideline) ? "none" : "all";
            var wrap = container.selectAll('g.nv-wrap.nv-cumulativeLine').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-cumulativeLine').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-interactive');
            gEnter.append('g').attr('class', 'nv-x nv-axis').style("pointer-events","none");
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-background');
            gEnter.append('g').attr('class', 'nv-linesWrap').style("pointer-events",interactivePointerEvents);
            gEnter.append('g').attr('class', 'nv-avgLinesWrap').style("pointer-events","none");
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');

            // Legend
            if (showLegend) {
                legend.width(availableWidth);

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.nv-legendWrap')
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
            }

            // Controls
            if (showControls) {
                var controlsData = [
                    { key: 'Re-scale y-axis', disabled: !rescaleY }
                ];

                controls
                    .width(140)
                    .color(['#444', '#444', '#444'])
                    .rightAlign(false)
                    .margin({top: 5, right: 0, bottom: 5, left: 20})
                ;

                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
                    .call(controls);
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            // Show error if series goes below 100%
            var tempDisabled = data.filter(function(d) { return d.tempDisabled });

            wrap.select('.tempDisabled').remove(); //clean-up and prevent duplicates
            if (tempDisabled.length) {
                wrap.append('text').attr('class', 'tempDisabled')
                    .attr('x', availableWidth / 2)
                    .attr('y', '-.71em')
                    .style('text-anchor', 'end')
                    .text(tempDisabled.map(function(d) { return d.key }).join(', ') + ' values cannot be calculated for this time period.');
            }

            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left:margin.left,top:margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            gEnter.select('.nv-background')
                .append('rect');

            g.select('.nv-background rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            lines
                //.x(function(d) { return d.x })
                .y(function(d) { return d.display.y })
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled && !data[i].tempDisabled; }));

            var linesWrap = g.select('.nv-linesWrap')
                .datum(data.filter(function(d) { return  !d.disabled && !d.tempDisabled }));

            linesWrap.call(lines);

            //Store a series index number in the data array.
            data.forEach(function(d,i) {
                d.seriesIndex = i;
            });

            var avgLineData = data.filter(function(d) {
                return !d.disabled && !!average(d);
            });

            var avgLines = g.select(".nv-avgLinesWrap").selectAll("line")
                .data(avgLineData, function(d) { return d.key; });

            var getAvgLineY = function(d) {
                //If average lines go off the svg element, clamp them to the svg bounds.
                var yVal = y(average(d));
                if (yVal < 0) return 0;
                if (yVal > availableHeight) return availableHeight;
                return yVal;
            };

            avgLines.enter()
                .append('line')
                .style('stroke-width',2)
                .style('stroke-dasharray','10,10')
                .style('stroke',function (d,i) {
                    return lines.color()(d,d.seriesIndex);
                })
                .attr('x1',0)
                .attr('x2',availableWidth)
                .attr('y1', getAvgLineY)
                .attr('y2', getAvgLineY);

            avgLines
                .style('stroke-opacity',function(d){
                    //If average lines go offscreen, make them transparent
                    var yVal = y(average(d));
                    if (yVal < 0 || yVal > availableHeight) return 0;
                    return 1;
                })
                .attr('x1',0)
                .attr('x2',availableWidth)
                .attr('y1', getAvgLineY)
                .attr('y2', getAvgLineY);

            avgLines.exit().remove();

            //Create index line
            var indexLine = linesWrap.selectAll('.nv-indexLine')
                .data([index]);
            indexLine.enter().append('rect').attr('class', 'nv-indexLine')
                .attr('width', 3)
                .attr('x', -2)
                .attr('fill', 'red')
                .attr('fill-opacity', .5)
                .style("pointer-events","all")
                .call(indexDrag);

            indexLine
                .attr('transform', function(d) { return 'translate(' + dx(d.i) + ',0)' })
                .attr('height', availableHeight);

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/70, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')');
                g.select('.nv-x.nv-axis')
                    .call(xAxis);
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .call(yAxis);
            }

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            function updateZero() {
                indexLine
                    .data([index]);

                //When dragging the index line, turn off line transitions.
                // Then turn them back on when done dragging.
                var oldDuration = chart.duration();
                chart.duration(0);
                chart.update();
                chart.duration(oldDuration);
            }

            g.select('.nv-background rect')
                .on('click', function() {
                    index.x = d3.mouse(this)[0];
                    index.i = Math.round(dx.invert(index.x));

                    // update state and send stateChange with new index
                    state.index = index.i;
                    dispatch.stateChange(state);

                    updateZero();
                });

            lines.dispatch.on('elementClick', function(e) {
                index.i = e.pointIndex;
                index.x = dx(index.i);

                // update state and send stateChange with new index
                state.index = index.i;
                dispatch.stateChange(state);

                updateZero();
            });

            controls.dispatch.on('legendClick', function(d,i) {
                d.disabled = !d.disabled;
                rescaleY = !d.disabled;

                state.rescaleY = rescaleY;
                dispatch.stateChange(state);
                chart.update();
            });

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            interactiveLayer.dispatch.on('elementMousemove', function(e) {
                lines.clearHighlights();
                var singlePoint, pointIndex, pointXLocation, allData = [];

                data
                    .filter(function(series, i) {
                        series.seriesIndex = i;
                        return !series.disabled;
                    })
                    .forEach(function(series,i) {
                        pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                        lines.highlightPoint(i, pointIndex, true);
                        var point = series.values[pointIndex];
                        if (typeof point === 'undefined') return;
                        if (typeof singlePoint === 'undefined') singlePoint = point;
                        if (typeof pointXLocation === 'undefined') pointXLocation = chart.xScale()(chart.x()(point,pointIndex));
                        allData.push({
                            key: series.key,
                            value: chart.y()(point, pointIndex),
                            color: color(series,series.seriesIndex)
                        });
                    });

                //Highlight the tooltip entry based on which point the mouse is closest to.
                if (allData.length > 2) {
                    var yValue = chart.yScale().invert(e.mouseY);
                    var domainExtent = Math.abs(chart.yScale().domain()[0] - chart.yScale().domain()[1]);
                    var threshold = 0.03 * domainExtent;
                    var indexToHighlight = nv.nearestValueIndex(allData.map(function(d){return d.value}),yValue,threshold);
                    if (indexToHighlight !== null)
                        allData[indexToHighlight].highlight = true;
                }

                var xValue = xAxis.tickFormat()(chart.x()(singlePoint,pointIndex), pointIndex);
                interactiveLayer.tooltip
                    .chartContainer(that.parentNode)
                    .valueFormatter(function(d,i) {
                        return yAxis.tickFormat()(d);
                    })
                    .data(
                    {
                        value: xValue,
                        series: allData
                    }
                )();

                interactiveLayer.renderGuideLine(pointXLocation);
            });

            interactiveLayer.dispatch.on("elementMouseout",function(e) {
                lines.clearHighlights();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                if (typeof e.index !== 'undefined') {
                    index.i = e.index;
                    index.x = dx(index.i);

                    state.index = e.index;

                    indexLine
                        .data([index]);
                }

                if (typeof e.rescaleY !== 'undefined') {
                    rescaleY = e.rescaleY;
                }

                chart.update();
            });

        });

        renderWatch.renderEnd('cumulativeLineChart immediate');

        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    lines.dispatch.on('elementMouseover.tooltip', function(evt) {
        var point = {
            x: chart.x()(evt.point),
            y: chart.y()(evt.point),
            color: evt.point.color
        };
        evt.point = point;
        tooltip.data(evt).hidden(false);
    });

    lines.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true)
    });

    //============================================================
    // Functions
    //------------------------------------------------------------

    var indexifyYGetter = null;
    /* Normalize the data according to an index point. */
    function indexify(idx, data) {
        if (!indexifyYGetter) indexifyYGetter = lines.y();
        return data.map(function(line, i) {
            if (!line.values) {
                return line;
            }
            var indexValue = line.values[idx];
            if (indexValue == null) {
                return line;
            }
            var v = indexifyYGetter(indexValue, idx);

            //TODO: implement check below, and disable series if series loses 100% or more cause divide by 0 issue
            if (v < -.95 && !noErrorCheck) {
                //if a series loses more than 100%, calculations fail.. anything close can cause major distortion (but is mathematically correct till it hits 100)

                line.tempDisabled = true;
                return line;
            }

            line.tempDisabled = false;

            line.values = line.values.map(function(point, pointIndex) {
                point.display = {'y': (indexifyYGetter(point, pointIndex) - v) / (1 + v) };
                return point;
            });

            return line;
        })
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.lines = lines;
    chart.legend = legend;
    chart.controls = controls;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.interactiveLayer = interactiveLayer;
    chart.state = state;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        rescaleY:     {get: function(){return rescaleY;}, set: function(_){rescaleY=_;}},
        showControls:     {get: function(){return showControls;}, set: function(_){showControls=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        average: {get: function(){return average;}, set: function(_){average=_;}},
        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},
        showXAxis:    {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:    {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        noErrorCheck:    {get: function(){return noErrorCheck;}, set: function(_){noErrorCheck=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
        }},
        useInteractiveGuideline: {get: function(){return useInteractiveGuideline;}, set: function(_){
            useInteractiveGuideline = _;
            if (_ === true) {
                chart.interactive(false);
                chart.useVoronoi(false);
            }
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( (_) ? 'right' : 'left');
        }},
        duration:    {get: function(){return duration;}, set: function(_){
            duration = _;
            lines.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
            renderWatch.reset(duration);
        }}
    });

    nv.utils.inheritOptions(chart, lines);
    nv.utils.initOptions(chart);

    return chart;
};
//TODO: consider deprecating by adding necessary features to multiBar model
nv.models.discreteBar = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container
        , x = d3.scale.ordinal()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , forceY = [0] // 0 is forced by default.. this makes sense for the majority of bar graphs... user can always do chart.forceY([]) to remove
        , color = nv.utils.defaultColor()
        , barWidth = null
        , barColor = null // adding the ability to set the color for each rather than the whole group
        , showValues = false
        , showChecks = false
        , valueFormat = d3.format(',.2f')
        , xDomain
        , yDomain
        , xRange
        , yRange
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        , rectClass = 'discreteBar'
        , duration = 250
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0;
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            //add series index to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                });
            });

            // Setup Scales
            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = (xDomain && yDomain) ? [] : // if we know xDomain and yDomain, no need to calculate
                data.map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: getY(d,i), y0: d.y0 }
                    })
                });

            var categories = xDomain || d3.merge(seriesData).map(function(d) { return d.x });
            var barGap = 25;
            var barOffset;
            var defaultBarWidth;

            x.domain(categories);

            if (xRange) {
                x.rangeBands(xRange, .1);
                barOffset = x.rangeBand() * .05;
                defaultBarWidth = x.rangeBand() * .9 / data.length;
            } else {
                var n = categories.length;
                var bw = barWidth || (n ? Math.max(0, (availableWidth - (n - 1) * barGap) / n) : 0);
                var step = bw + barGap;
                x.rangeBands([0, n * step], barGap / step);
                barOffset = 0;
                defaultBarWidth = x.rangeBand();
            }

            y   .domain(yDomain || d3.extent(d3.merge(seriesData).map(function(d) { return d.y }).concat(forceY)));

            // If showValues, pad the Y axis range to account for label height
            if (showValues) y.range(yRange || [availableHeight - (y.domain()[0] < 0 ? 12 : 0), y.domain()[1] > 0 ? 12 : 0]);
            else y.range(yRange || [availableHeight, 0]);

            //store old scales if they exist
            x0 = x0 || x;
            y0 = y0 || y.copy().range([y(0),y(0)]);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-discretebar').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-discretebar');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-groups');
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            //TODO: by definition, the discrete bar should not have multiple groups, will modify/remove later
            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d) { return d.key });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);
            groups.exit()
                .watchTransition(renderWatch, 'discreteBar: exit groups')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6)
                .remove();
            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover });
            groups
                .watchTransition(renderWatch, 'discreteBar: groups')
                .style('stroke-opacity', 1)
                .style('fill-opacity', .75);

            var bars = groups.selectAll('g.nv-bar')
                .data(function(d) { return d.values });
            bars.exit().remove();

            var barsEnter = bars.enter().append('g')
                .attr('transform', function(d,i,j) {
                    return 'translate(' + (x(getX(d,i)) + barOffset) + ', ' + y(0) + ')'
                })
                .on('mouseover', function(d,i) { //TODO: figure out why j works above, but not here
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mouseout', function(d,i) {
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('click', function(d,i) {
                    var element = this;

                    d.selected = !d.selected;
                    d3.select(this).classed('selected', d.selected);

                    dispatch.elementClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill"),
                        event: d3.event,
                        element: element
                    });
                    d3.event.stopPropagation();
                })
                .on('dblclick', function(d,i) {
                    dispatch.elementDblClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                    d3.event.stopPropagation();
                });

            barsEnter.append('rect')
                .attr('height', 0)
                .attr('width', defaultBarWidth)

            if ( showChecks ) {
                barsEnter.filter(function(d,i,j){
                    return j === 0;
                }).append('path')
                    .attr('class', 'nv-check')
                    .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
            }

            if (showValues) {
                barsEnter.append('text')
                    .attr('text-anchor', 'middle')
                    .classed('nv-bar-value', true)
                ;

                bars.select('text')
                    .text(function(d,i) { return valueFormat(getY(d,i)) })
                    .watchTransition(renderWatch, 'discreteBar: bars text')
                    .attr('x', barWidth ? barWidth/2 : defaultBarWidth / 2)
                    .attr('y', function(d,i) { return getY(d,i) < 0 ? y(getY(d,i)) - y(0) + 12 : /*Math.max(Math.abs(y(getY(d,i)) - y(0)), 1)*/ - 4 })

                ;
            } else {
                bars.selectAll('text').remove();
            }


            bars
                .attr('class', function(d,i) { return getY(d,i) < 0 ? 'nv-bar negative' : 'nv-bar positive' })
                .classed('selected', function(d,i){ return d.selected; })
                .style('fill', function(d,i) { return d.color || color(d,i) })
                .style('stroke', function(d,i) { return d.color || color(d,i) })
                .select('rect')
                .attr('class', rectClass)
                .watchTransition(renderWatch, 'discreteBar: bars rect')
                .attr('width', barWidth || defaultBarWidth);

            if (barColor) {

                bars
                    .style('fill', function(d,i,j) { return d3.rgb(barColor(d,i)).toString(); })
                    .style('stroke', function(d,i,j) { return d3.rgb(barColor(d,i)).toString(); });
            }

            bars.watchTransition(renderWatch, 'discreteBar: bars')
                //.delay(function(d,i) { return i * 1200 / data[0].values.length })
                .attr('transform', function(d,i) {
                    var left = x(getX(d,i)) + barOffset,
                        top = getY(d,i) < 0 ?
                            y(0) :
                                y(0) - y(getY(d,i)) < 1 ?
                            y(0) - 1 : //make 1 px positive bars show up above y=0
                            y(getY(d,i));

                    return 'translate(' + left + ', ' + top + ')'
                })
                .select('rect')
                .attr('height', function(d,i) {
                    return  Math.max(Math.abs(y(getY(d,i)) - y(0)), 1)
                });


            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

        });

        renderWatch.renderEnd('discreteBar immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:   {get: function(){return width;}, set: function(_){width=_;}},
        height:  {get: function(){return height;}, set: function(_){height=_;}},
        forceY:  {get: function(){return forceY;}, set: function(_){forceY=_;}},
        showValues: {get: function(){return showValues;}, set: function(_){showValues=_;}},
        x:       {get: function(){return getX;}, set: function(_){getX=_;}},
        y:       {get: function(){return getY;}, set: function(_){getY=_;}},
        xScale:  {get: function(){return x;}, set: function(_){x=_;}},
        yScale:  {get: function(){return y;}, set: function(_){y=_;}},
        xDomain: {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain: {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:  {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:  {get: function(){return yRange;}, set: function(_){yRange=_;}},
        valueFormat:    {get: function(){return valueFormat;}, set: function(_){valueFormat=_;}},
        id:          {get: function(){return id;}, set: function(_){id=_;}},
        rectClass: {get: function(){return rectClass;}, set: function(_){rectClass=_;}},
        showChecks:    {get: function(){return showChecks;}, set: function(_){showChecks=_;}},
        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        barColor:  {get: function(){return barColor;}, set: function(_){
                barColor = _ ? nv.utils.getColor(_) : null;
            }},
        barWidth: {get: function(){return barWidth;}, set: function(_){ barWidth = _; }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};

nv.models.discreteBarChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var discretebar = nv.models.discreteBar()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
	, legend = nv.models.legend()
        , tooltip = nv.models.tooltip()
        ;

    var legendTooltip = nv.utils.createLegendTooltip(function (d, i) { return d; });

    var margin = {top: 15, right: 10, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.getColor()
	, showLegend = false
        , legendPosition = 'right'
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , staggerLabels = false
        , wrapLabels = false
        , rotateLabels = 0
        , x
        , y
        , noData = null
        , dispatch = d3.dispatch('beforeUpdate','renderEnd', 'selectChange')
        , duration = 250
        , showLegendTooltips = true
        ;

    legend.showNativeTooltip(false);

    xAxis
        .orient('bottom')
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickFormat(d3.format(',.1f'))
    ;

    tooltip
        .duration(0)
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        })
        .keyFormatter(function(d, i) {
            return xAxis.tickFormat()(d, i);
        });

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function buildLegendData(data) {
        var seriesData = data.filter(function(d) { return !d.disabled; });
        var barValues = seriesData.length ? seriesData[0].values : [];

        return barValues.map(function(bar, i) {
            return {
                key: discretebar.x()(bar),
                value: discretebar.y()(bar),
                color: color(bar, i),
                data: bar,
                disabled: false,
                selected: !!bar.selected
            };
        });
    }

    function calcMinBarChartWidth(barCount) {
        var barGap = 25;
        var minBarWidth = 25;

        return barCount > 0 ? barCount * minBarWidth + (barCount - 1) * barGap : 40;
    }

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(discretebar);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                dispatch.beforeUpdate();
                container.transition().duration(duration).call(chart);
            };
            chart.container = this;
            tooltip.chartContainer(chart.container.parentNode);

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = discretebar.xScale();
            y = discretebar.yScale().clamp(true);

            nv.utils.removeExternalLegend(chart.container);

            // Legend
            var newLegend;
            if (showLegend) {
                var legendData = buildLegendData(data);
                var barDataTotal = legendData.reduce(function(acc, d) {
                    return acc + d.value;
                }, 0);

                legend
                    .updateState(!discretebar.showChecks())
                    .key(function(d) { return d.key; })
                    .value(function(d) { return d.value; });

                var legendLayout = nv.utils.renderExternalLegend({
                    legend: legend,
                    data: legendData,
                    containerEl: chart.container,
                    d3Container: container,
                    position: legendPosition,
                    availableWidth: availableWidth,
                    availableHeight: availableHeight,
                    margin: margin,
                    height: height,
                    rightColumnCount: 'adaptive',
                    rightAlign: false,
                    shrinkChartWidth: legendPosition === 'right',
                    minChartWidth: legendPosition === 'right'
                        ? calcMinBarChartWidth(legendData.length)
                        : undefined
                });

                newLegend = legendLayout.legendElement;
                availableWidth = legendLayout.availableWidth;
                availableHeight = legendLayout.availableHeight;
                margin = legendLayout.margin;

                nv.utils.bindLegendScrollHide(newLegend, legendTooltip);

                legend.dispatch
                    .on('legendClick', function(d, i) {
                        d.data.selected = !d.data.selected;
                        d.selected = d.data.selected;
                        dispatch.selectChange({
                            data: d.data,
                            index: i,
                            color: d.color
                        });
                        legendTooltip.hidden(true);
                    })
                    .on('legendMouseover.tooltip', function(d) {
                        if (!showLegendTooltips) return;
                        var percentage = barDataTotal
                            ? d3.format('.0%')(d.data.value / barDataTotal)
                            : d.data.value;

                        nv.utils.showLegendTooltipAt(legendTooltip, d, {
                            key: d.data.key,
                            value: percentage,
                            color: d.color
                        });
                    })
                    .on('legendMouseout.tooltip', function() {
                        if (!showLegendTooltips) return;
                        legendTooltip.hidden(true);
                    });
            }

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-discreteBarWithAxes').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-discreteBarWithAxes').append('g');
            var defsEnter = gEnter.append('defs');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis')
                .append('g').attr('class', 'nv-zeroLine')
                .append('line');

            gEnter.append('g').attr('class', 'nv-barsWrap');

            g.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            // Main Chart Component(s)
            discretebar
                .width(availableWidth)
                .height(availableHeight);

            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }));

            barsWrap.transition().call(discretebar);


            defsEnter.append('clipPath')
                .attr('id', 'nv-x-label-clip-' + discretebar.id())
                .append('rect');

            g.select('#nv-x-label-clip-' + discretebar.id() + ' rect')
                .attr('width', x.rangeBand() * (staggerLabels ? 2 : 1))
                .attr('height', 16)
                .attr('x', -x.rangeBand() / (staggerLabels ? 1 : 2 ));

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + (y.range()[0] + ((discretebar.showValues() && y.domain()[0] < 0) ? 16 : 0)) + ')');
                g.select('.nv-x.nv-axis').call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis').selectAll('g');
                if (staggerLabels) {
                    xTicks
                        .selectAll('text')
                        .attr('transform', function(d,i,j) { return 'translate(0,' + (j % 2 == 0 ? '5' : '17') + ')' })
                }

                if (rotateLabels) {
                    xTicks
                        .selectAll('.tick text')
                        .attr('transform', 'rotate(' + rotateLabels + ' 0,0)')
                        .style('text-anchor', rotateLabels > 0 ? 'start' : 'end');
                }

                if (wrapLabels) {
                    g.selectAll('.tick text')
                        .call(nv.utils.wrapTicks, chart.xAxis.rangeBand())
                }
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis').call(yAxis);
            }

            // Zero line
            g.select(".nv-zeroLine line")
                .attr("x1",0)
                .attr("x2",(rightAlignYAxis) ? -availableWidth : availableWidth)
                .attr("y1", y(0))
                .attr("y2", y(0))
            ;
        });

        renderWatch.renderEnd('discreteBar chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    discretebar.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: chart.x()(evt.data),
            value: chart.y()(evt.data),
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    discretebar.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    discretebar.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    discretebar.dispatch.on('elementClick.select', function(evt) {
        dispatch.selectChange(evt);
    });


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.discretebar = discretebar;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        legendPosition: {get: function(){return legendPosition;}, set: function(_){legendPosition=_;}},
        keyFormat:  {get: function(){return legend.keyFormat();}, set: function(_){legend.keyFormat(_);}},
        showLegendValues: {
            get: function() {
                return legend.showLegendValues();
            },
            set: function(_) {
                legend.showLegendValues(_);
            }
        },
        showLegendTooltips: {
            get: function() {
                return showLegendTooltips;
            },
            set: function(_) {
                showLegendTooltips = _;
            }
        },
        staggerLabels: {get: function(){return staggerLabels;}, set: function(_){staggerLabels=_;}},
        rotateLabels:  {get: function(){return rotateLabels;}, set: function(_){rotateLabels=_;}},
        wrapLabels:  {get: function(){return wrapLabels;}, set: function(_){wrapLabels=!!_;}},
        showXAxis: {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis: {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            discretebar.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            discretebar.color(color);
	    legend.color(color);
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( (_) ? 'right' : 'left');
        }}
    });

    nv.utils.inheritOptions(chart, discretebar);
    nv.utils.initOptions(chart);

    return chart;
}

nv.models.distribution = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 400 //technically width or height depending on x or y....
        , size = 8
        , axis = 'x' // 'x' or 'y'... horizontal or vertical
        , getData = function(d) { return d[axis] }  // defaults d.x or d.y
        , color = nv.utils.defaultColor()
        , scale = d3.scale.linear()
        , domain
        , duration = 250
        , dispatch = d3.dispatch('renderEnd')
        ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var scale0;
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableLength = width - (axis === 'x' ? margin.left + margin.right : margin.top + margin.bottom),
                naxis = axis == 'x' ? 'y' : 'x',
                container = d3.select(this);
            nv.utils.initSVG(container);

            //------------------------------------------------------------
            // Setup Scales

            scale0 = scale0 || scale;

            //------------------------------------------------------------


            //------------------------------------------------------------
            // Setup containers and skeleton of chart

            var wrap = container.selectAll('g.nv-distribution').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-distribution');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')')

            //------------------------------------------------------------


            var distWrap = g.selectAll('g.nv-dist')
                .data(function(d) { return d }, function(d) { return d.key });

            distWrap.enter().append('g');
            distWrap
                .attr('class', function(d,i) { return 'nv-dist nv-series-' + i })
                .style('stroke', function(d,i) { return color(d, i) });

            var dist = distWrap.selectAll('line.nv-dist' + axis)
                .data(function(d) { return d.values })
            dist.enter().append('line')
                .attr(axis + '1', function(d,i) { return scale0(getData(d,i)) })
                .attr(axis + '2', function(d,i) { return scale0(getData(d,i)) })
            renderWatch.transition(distWrap.exit().selectAll('line.nv-dist' + axis), 'dist exit')
                // .transition()
                .attr(axis + '1', function(d,i) { return scale(getData(d,i)) })
                .attr(axis + '2', function(d,i) { return scale(getData(d,i)) })
                .style('stroke-opacity', 0)
                .remove();
            dist
                .attr('class', function(d,i) { return 'nv-dist' + axis + ' nv-dist' + axis + '-' + i })
                .attr(naxis + '1', 0)
                .attr(naxis + '2', size);
            renderWatch.transition(dist, 'dist')
                // .transition()
                .attr(axis + '1', function(d,i) { return scale(getData(d,i)) })
                .attr(axis + '2', function(d,i) { return scale(getData(d,i)) })


            scale0 = scale.copy();

        });
        renderWatch.renderEnd('distribution immediate');
        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------
    chart.options = nv.utils.optionsFunc.bind(chart);
    chart.dispatch = dispatch;

    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
        margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return chart;
    };

    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };

    chart.axis = function(_) {
        if (!arguments.length) return axis;
        axis = _;
        return chart;
    };

    chart.size = function(_) {
        if (!arguments.length) return size;
        size = _;
        return chart;
    };

    chart.getData = function(_) {
        if (!arguments.length) return getData;
        getData = d3.functor(_);
        return chart;
    };

    chart.scale = function(_) {
        if (!arguments.length) return scale;
        scale = _;
        return chart;
    };

    chart.color = function(_) {
        if (!arguments.length) return color;
        color = nv.utils.getColor(_);
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        return chart;
    };
    //============================================================


    return chart;
}

nv.models.funnel = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , x = d3.scale.ordinal()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , getY2 = function(d) {}
        , getYC = function(d) { return 0; }
        , getYerr = function(d) { return d.yErr }
        , forceY = [0] // 0 is forced by default.. this makes sense for the majority of bar graphs... user can always do chart.forceY([]) to remove
        , color = nv.utils.defaultColor()
        , href = null
        , barWidth = 50
        , barColor = null // adding the ability to set the color for each rather than the whole group
        , disabled // used in conjunction with barColor to communicate from funnelChart what series are disabled
        , stacked = false
        , showValues = false
        , showBarLabels = true
        , showChecks = false
        , showDropoff = true
        , valuePadding = 60
        , groupSpacing = 0.1
        , valueFormat = d3.format(',.2f')
        , ratioFormat = d3.format('.1%')
        , delay = 1200
        , xDomain
        , yDomain
        , xRange
        , yRange
        , duration = 250
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0; //used to store previous scales
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            if (stacked)
                data = d3.layout.stack()
                    .offset('zero')
                    .values(function(d){ return d.values })
                    .y(getY)
                (data);

            //add series index and key to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                    point.key = series.key;
                });
            });

            // HACK for negative value stacking
            if (stacked)
                data[0].values.map(function(d,i) {
                    var posBase = 0, negBase = 0;
                    data.map(function(d) {
                        var f = d.values[i]
                        f.size = Math.abs(f.y);
                        if (f.y<0)  {
                            f.y1 = negBase - f.size;
                            negBase = negBase - f.size;
                        } else
                        {
                            f.y1 = posBase;
                            posBase = posBase + f.size;
                        }
                    });
                });

            // Setup Scales
            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = (xDomain && yDomain) ? [] : // if we know xDomain and yDomain, no need to calculate
                data.map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: getY(d,i), y0: d.y0, y1: d.y1 }
                    })
                });

            x.domain(xDomain || d3.merge(seriesData).map(function(d) { return d.x }))
                .rangeBands(xRange || [0, availableHeight], groupSpacing);

            y.domain(yDomain || d3.extent(d3.merge(seriesData).map(function(d) { return stacked ? (d.y > 0 ? d.y1 + d.y : d.y1 ) : d.y }).concat(forceY)))

            if (showValues && !stacked)
                y.range(yRange || [(y.domain()[0] < 0 ? valuePadding : 0), availableWidth - (y.domain()[1] > 0 ? valuePadding : 0) ]);
            else
                y.range(yRange || [showChecks ? 30 : 0, availableWidth-50]);

            x0 = x0 || x;
            y0 = y0 || d3.scale.linear().domain(y.domain()).range([y(0),y(0)]);

            // Setup containers and skeleton of chart
            var wrap = d3.select(this).selectAll('g.nv-wrap.nv-funnel').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-funnel');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-groups');
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d,i) { return i });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);
            groups.exit().watchTransition(renderWatch, 'funnel: exit groups')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6)
                .remove();
            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover })
                .style('fill', function(d,i){ return color(d, i) })
                .style('stroke', function(d,i){ return color(d, i) });
            groups.watchTransition(renderWatch, 'funnel: groups')
                .style('stroke-opacity', 1)
                .style('fill-opacity', .75);

            var bars = groups.selectAll('g.nv-bar')
                .data(function(d) { return d.values });

            bars.exit().remove();

            var barsEnter = bars.enter().append('g')
                .attr('transform', function(d,i,j) {
                    return 'translate(' + y0(stacked ? d.y0 : 0) + ',' + (stacked ? 0 : (j * x.rangeBand() / data.length ) + x(getX(d,i))) + ')'
                });

            function draw_rect(w,w1,h){
                return [
                    'M', 0, 0,
                    'H', w,
                    'L', w-w1, h,
                    'H', 0,
                    'Z'

                ].join(' ');
            }

            barsEnter.append('path')
                .attr('class', 'nv-bar-rect');
                /*.attr('height', barWidth || x.rangeBand() / (stacked ? 1 : data.length) )*/

            barsEnter.append('path')
                .attr('class', 'nv-bar-arrow');

            if ( showDropoff ) {
                var gDropoffEnter = barsEnter.append('g')
                    .attr('class', 'nv-dropoff');

                gDropoffEnter.append('path')
                    .attr('class', 'nv-reducer');
                gDropoffEnter.append('path')
                    .attr('class', 'nv-reducer-arrow');

                if ( showValues ) {
                    gDropoffEnter.append('text')
                        .attr('class', 'nv-reducer-value');
                    gDropoffEnter.append('text')
                        .attr('class', 'nv-reducer-ratio');
                }

                gDropoffEnter.on('click', function(d,i){
                    var reducer = true;
/*
                    d.selected = d.selected === 'reduce' ? '' : 'reduce';
                    d3.select(this.parentNode)
                        .classed('selected', d.selected === 'select')
                        .classed('reduced', d.selected === 'reduce')
                        .select('.nv-check')
                        .attr('d', function (d) {
                            return d.selected === 'select' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' :
                                d.selected === 'reduce' ? 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M17,13H7V11H17V13Z' :
                                    'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z';
                        });
*/

                    dispatch.elementClick({
                        data: d,
                        index: i,
                        reducer: reducer,
                        color: d3.select(this.parentNode).style("fill")
                    });

                    d3.event.stopPropagation();


                });
            }

            if (showChecks) {
                var checks = barsEnter.append('path')
                    .attr('class', 'nv-check')
                    .attr('d', function (d) {
                        return d.selected === 'select' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' :
                            d.selected === 'reduce' ? 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M17,13H7V11H17V13Z' :
                                'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z';
                    });

                checks.on('click', function (d, i) {
                    d.selected = d.selected === 'select' ? 'reduce' : d.selected === 'reduce' ? '' : 'select';

                    d3.select(this.parentNode)
                        .classed('selected', d.selected === 'select')
                        .classed('reduced', d.selected === 'reduce')
                        .select('.nv-check')
                        .attr('d', function (d) {
                            return d.selected === 'select' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' :
                                d.selected === 'reduce' ? 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M17,13H7V11H17V13Z' :
                                    'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z';
                        });

                    dispatch.elementClick({
                        data: d,
                        index: i,
                        selected: d.selected,
                        color: d3.select(this.parentNode).style("fill")
                    });

                    d3.event.stopPropagation();
                });
            }

            bars
                .on('mouseover', function(d,i) { //TODO: figure out why j works above, but not here
                    var reducer = d3.select(d3.event.target.parentNode).classed('nv-dropoff');
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        data: d,
                        index: i,
                        reducer: reducer,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mouseout', function(d,i) {
                    var reducer = d3.select(d3.event.target.parentNode).classed('nv-dropoff');
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        data: d,
                        index: i,
                        reducer: reducer,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mousemove', function(d,i) {
                    var reducer = d3.select(d3.event.target.parentNode).classed('nv-dropoff');
                    dispatch.elementMousemove({
                        data: d,
                        index: i,
                        reducer: reducer,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('dblclick', function (d, i) {
                    var reducer = d3.select(d3.event.target.parentNode).classed('nv-dropoff');
                    dispatch.elementDblClick({
                        data: d,
                        index: i,
                        reducer: reducer,
                        color: d3.select(this).style("fill")
                    });
                    d3.event.stopPropagation();
                })
                .on('click', function (d, i) {
                    var reducer = false;
/*
                    d.selected = d.selected === 'select' ? '' : 'select';

                    d3.select(this)
                        .classed('selected', d.selected === 'select')
                        .classed('reduced', d.selected === 'reduce')
                        .select('.nv-check')
                        .attr('d', function (d) {
                            return d.selected === 'select' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' :
                                d.selected === 'reduce' ? 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M17,13H7V11H17V13Z' :
                                    'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z';
                        });
*/


                    dispatch.elementClick({
                        data: d,
                        index: i,
                        reducer: reducer,
                        color: d3.select(this).style("fill")
                    });

                    d3.event.stopPropagation();
                });


            if (getYerr(data[0],0)) {
                barsEnter.append('polyline');

                bars.select('polyline')
                    .attr('fill', 'none')
                    .attr('points', function(d,i) {
                        var xerr = getYerr(d,i)
                            , mid = 0.8 * x.rangeBand() / ((stacked ? 1 : data.length) * 2);
                        xerr = xerr.length ? xerr : [-Math.abs(xerr), Math.abs(xerr)];
                        xerr = xerr.map(function(e) { return y(e) - y(0); });
                        var a = [[xerr[0],-mid], [xerr[0],mid], [xerr[0],0], [xerr[1],0], [xerr[1],-mid], [xerr[1],mid]];
                        return a.map(function (path) { return path.join(',') }).join(' ');
                    })
                    .attr('transform', function(d,i) {
                        var mid = x.rangeBand() / ((stacked ? 1 : data.length) * 2);
                        return 'translate(' + (getY(d,i) < 0 ? 0 : y(getY(d,i)) - y(0)) + ', ' + mid + ')'
                    });
            }



            if (showValues /*&& !stacked*/) {
                barsEnter.append('text').classed('nv-bar-value', true);

                bars.select('text.nv-bar-value')
                    .attr('text-anchor', 'middle' )
                    .attr('y', 10)
                    .attr('dy', '.32em')
                    .attr('dx', 20)
                    .text(function(d,i) {
                        var t = valueFormat(getY(d,i))
                            , yerr = getYerr(d,i);

                        if (yerr === undefined)
                            return t;
                        if (!yerr.length)
                            return t + '±' + valueFormat(Math.abs(yerr));
                        return t + '+' + valueFormat(Math.abs(yerr[1])) + '-' + valueFormat(Math.abs(yerr[0]));
                    });

                barsEnter.append('text').classed('nv-bar-value2', true);

                bars.select('text.nv-bar-value2')
                    .attr('text-anchor', 'start' )
                    .attr('y', 10)
                    .attr('dy', '.32em')
                    .attr('dx', '4em')
                    .text(function(d,i) {
                        var t = valueFormat(getY2(d,i));

                        return t;
                    });

                barsEnter.append('text').classed('nv-continue-ratio', true);

                bars.select('text.nv-continue-ratio')
                    .attr('text-anchor', 'start' )
                    .attr('y', barWidth)
                    .attr('dy', '1.32em')
                    .attr('dx', '33')
                    .style('fill', 'auto')
                    .text(function(d,i) {
                        var v = getY(d,i),
                            vc = getYC(d,i),
                            t = v > 0 ? ratioFormat(1 - vc/v) : '';
                        return t;
                    });


                /*
                                bars.watchTransition(renderWatch, 'funnel: bars')
                                    .select('text')
                                    .attr('x', function(d,i) { return getY(d,i) < 0 ? y(0) -y(getY(d,i)) - 4 : + 4 })
                */

                bars.select('text.nv-reducer-value')
                    .attr('text-anchor', 'start')
                    .attr('y', 15)
                    .attr('dy', '.32em')
                    .text(function(d,i) {
                        var v = getY(d,i),
                            vc = getYC(d,i),
                            t = vc > 0 ? valueFormat(getYC(d,i)): '';

                        return t;
                    });

                bars.select('text.nv-reducer-ratio')
                    .attr('text-anchor', 'start')
                    .attr('y', barWidth - 15)
                    .attr('dy', '.32em')
                    .text(function(d,i) {
                        var v = getY(d,i),
                            vc = getYC(d,i),
                            t = v > 0 && vc > 0 ? ratioFormat(vc/v) : '';
                        return t;
                    });

                bars.watchTransition(renderWatch, 'funnel: bars')
                    .select('text')
                    .attr('x', function(d,i) { return y(getY(d,i)) - (showChecks ? 30 : 0) - 4 })

                bars.watchTransition(renderWatch, 'funnel: bars')
                    .selectAll('g.nv-dropoff text')
                    .attr('x', function(d,i) { return Math.max(70, y(getY(d,i)) - (showChecks ? 30 : 0)) + 16 })

            } else {
                bars.selectAll('text.nv-bar-value').remove();
                bars.selectAll('text.nv-bar-value2').remove();
                bars.selectAll('text.nv-reducer-value').remove();
                bars.selectAll('text.nv-reducer-ratio').remove();
            }

            if (showBarLabels /*&& !stacked*/) {

                if (href && typeof href === 'function') {
                    var a = barsEnter
                        .append('a').attr('class', 'nv-href').attr('xlink:href', function (d) {
                            return href(d);
                        });

                    a.append('text').classed('nv-bar-label', true);

                    a.on('mouseover', function (d, i) {
                        d3.event.stopPropagation();
                        d3.event.preventDefault();

                        //d3.select(this).classed('hover', true).style('opacity', 0.8);
                        dispatch.elementMouseout({
                            data: d
                        });

                    });

                    /*a.append('path').attr('d', 'M 10 6 L 8.59 7.41 L 13.17 12 l -4.58 4.59 L 10 18 l 6 -6 Z');*/
                }
                else {
                    barsEnter.append('text').classed('nv-bar-label', true);
                }

                bars.select('text.nv-bar-label')
                    .attr('text-anchor', function(d,i) { return (getY(d,i) >= 0) ? 'start' : 'end' })
                    .attr('y', barWidth ? (barWidth-10) : (x.rangeBand() / (data.length * 2)))
                    .attr('dx', '.32em')
                    .attr('dy', '.1em')
                    .text(function(d,i) { return getX(d,i) });

/*
                {
                    bars
                        .watchTransition(renderWatch, 'funnel: bars')
                        .select('text.nv-bar-label')
                        .attr('x', 4);
                }
*/


                if ( stacked ) {
                    bars.filter(function (d) {
                        return d.series > 0;
                    }).select('text.nv-bar-label').remove();
                }
            }
            else {
                bars.selectAll('text.nv-bar-label').remove();
            }

            bars
                .attr('class', function(d,i) { var y = getY(d,i); return y === 0 ? 'nv-bar zero' : (y < 0 ? 'nv-bar negative' : 'nv-bar positive'); });

            bars.classed('selected', function(d,i){ return d.selected === 'select'; })
                .classed('reduced', function(d,i){ return d.selected === 'reduce'; });

            if (barColor) {

                var selected = bars.data().filter(function(d){
                    return !!d.selected;
                });

                if ( selected && selected.length > 0 ){
                    bars.selectAll('.nv-bar-rect')
                        .style('opacity', function(d,i){
                            return d.selected ? 1 : 0.1;
                        });

                    bars.selectAll('.nv-bar-arrow')
                        .style('opacity', function(d,i){
                            return d.selected === 'select' ? 1 : 0.1;
                        });

                    bars.selectAll('.nv-dropoff')
                        .style('opacity', function(d,i){
                            return d.selected === 'reduce' ? 1 : 0.1;
                        });

                    /*bars.style('filter', function(d){
                        return d.selected === 'reduce' || d.selected === 'select' ? 'url(#drop-shadow)' : '';
                    });*/

                    bars.selectAll('text')
                        .style('fill-opacity', function(d){
                            return d.selected === 'reduce' || d.selected === 'select' ? null : 0.1;
                        })
                        .style('stroke-opacity', function(d){
                            return d.selected === 'reduce' || d.selected === 'select' ? null : 0.1;
                        });
                }
                else {
                    bars.selectAll('.nv-bar-rect')
                        .style('opacity', 'auto');

                    bars.selectAll('.nv-bar-arrow')
                        .style('opacity', 'auto');

                    bars.selectAll('.nv-dropoff')
                        .style('opacity', 'auto');

                    // bars.style('filter', '');

                    bars.selectAll('text')
                        .style('fill-opacity', '')
                        .style('stroke-opacity', '');


                }

                if (!disabled) disabled = data.map(function() { return true });
                bars
                    .style('fill', function (d, i, j) {
                        return d3.rgb(barColor(d, i)).darker(disabled.map(function (d, i) {
                            return i
                        }).filter(function (d, i) {
                            return !disabled[i]
                        })[j]).toString();
                    });


                    //.style('stroke', function(d,i,j) { return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString(); });
            }

            var prev = 0;
            bars.data().forEach(function(d,i){
                prev += i > 0 ? getYC(bars.data()[i-1]) : 0;
                d.prev = prev;
            });

            function arrow(x,y){
                x = Math.round(x,1);
                y = Math.round(y,1);

                return [
                    'M',x,y,
                    'V',y+3,
                    'q',1,-6,8,-6,
                    'V',y-8,
                    'L',x+15,y,
                    'L',x+8,y+8,
                    'V',y+3,
                    'q',-7,0,-8,3,
                    'Z'].join(' ');

            }

            function arrow_down(x,y){
                x = Math.round(x,1);
                y = Math.round(y,1);

                return ['M', x, y,
                    'H', x - 3,
                    'V', y + 12,
                    'H', x - 8,
                    'L', x, y + 21,
                    'L', x + 8, y + 12,
                    'H', x + 3,
                    'V', y,
                    'Z'].join(' ');
            }


            function reducer(w, w1, h){
                return ['M', w, 0,
                    'V', h,
                    'H', Math.round(w-w1,1),
                    'Z'].join(' ');
            }

            if (stacked) {
                var watch = bars.watchTransition(renderWatch, 'funnel: bars')
                    .attr('transform', function (d, i) {
                        var x1 = i * (barWidth + 21) + x.range()[0];
                        return 'translate(' + y(d.y1 /*+ d.prev/2*/) + ',' + x1 /*x(getX(d, i))*/ + ')'
                    });

                watch.select('.nv-bar-rect')
                    .attr('d', function (d, i) {
                        var w = Math.abs(y(getY(d, i) + d.y0) - y(d.y0)) || 0,
                            w1 = Math.abs(y(getYC(d,i) + d.y0) - y(d.y0)) || 0,
                            h = barWidth || x.rangeBand();

                        var wf = Math.max(70, w),
                            w1f = w > 0? wf / w * w1 : wf;

                        return draw_rect(wf,w1f,h);

                    });
                    /*.attr('height', barWidth || x.rangeBand());*/

                if ( showChecks ) {
                    watch.select('path.nv-check')
                        .attr('transform', function (d, i) {
                            var width = Math.abs(y(getY(d, i) + d.y0) - y(d.y0)),
                                w1 = Math.abs(y(getYC(d, i) + d.y0) - y(d.y0)),
                                height = barWidth || x.rangeBand();
                            return 'translate(-30,' + (height - 24) / 2 + ' )';
                        })
                        .attr('d', function(d){
                            return d.selected === 'select' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' :
                                d.selected === 'reduce' ? 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M17,13H7V11H17V13Z' :
                                    'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z';
                        });
                }

                watch.select('path.nv-bar-arrow')
                    .attr('d', function (d, i) {

                        var h = barWidth || x.rangeBand();

                        return arrow_down(20,h);
                    });


                watch.select('path.nv-reducer')
                    .attr('d', function (d, i) {

                        var w = Math.abs(y(getY(d, i) + d.y0) - y(d.y0)) || 0,
                            w1 = Math.abs(y(getYC(d, i) + d.y0) - y(d.y0)) || 0,
                            h = barWidth || x.rangeBand();

                        var wf = Math.max(70, w),
                            w1f = w > 0? wf / w * w1 : wf;

                        return reducer(wf, w1f, h);
                    })
                    .attr('opacity', function (d, i) {
                        var v = getYC(d, i);
                        return v > 0 ? 1 : 0;
                    });

                watch.select('path.nv-reducer-arrow')
                    .attr('d', function (d, i) {
                        var w = Math.abs(y(getY(d, i) + d.y0) - y(d.y0)) || 0,
                            h = barWidth || x.rangeBand();

                        w = Math.max(70, w);
                        return arrow(w,h/2);
                    })
                    .style('visibility', function(d,i){
                        var v = getYC(d, i);
                        return v > 0 ? 'visible' : 'hidden';
                    });

            }
            else {

                var watch = bars.watchTransition(renderWatch, 'funnel: bars')
                    .attr('transform', function (d, i) {
                        //TODO: stacked must be all positive or all negative, not both?
                        return 'translate(' +
                            (getY(d, i) < 0 ? y(getY(d, i)) : y(0 /*+ d.prev/2*/) )
                            + ',' +
                            (d.series * x.rangeBand() / data.length
                            +
                            x(getX(d, i)) )
                            + ')'
                    });

                watch
                    .select('.nv-bar-rect')
                    .attr('d', function(d){
                        var h = barWidth || x.rangeBand() / data.length,
                            w1 = Math.max(Math.abs(y(getYC(d, i)) - y(0)), 1) || 0,
                            w = Math.max(Math.abs(y(getY(d, i)) - y(0)), 1) || 0;

                        var wf = Math.max(70, w),
                            w1f = w > 0? wf / w * w1 : wf;

                        return draw_rect(wf,w1f,h);
                    });

/*
                    .attr('height', barWidth || x.rangeBand() / data.length)
                    .attr('width', function (d, i) {
                        return Math.max(Math.abs(y(getY(d, i)) - y(0)), 1) || 0
                    });
*/

                if ( showChecks ) {
                    watch.select('path.nv-check')
                        .attr('transform', function (d, i) {
                            var width = Math.max(Math.abs(y(getY(d, i)) - y(0)), 1),
                                height = barWidth || x.rangeBand() / data.length;
                            return 'translate(' + (width - 20) + ',' + (height - 20) / 2 + ' )';
                        })
                        .attr('d', function (d) {
                            return d.selected === 'select' ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' :
                                d.selected === 'reduce' ? 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M17,13H7V11H17V13Z' :
                                    'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z';
                        });
                }

                watch.select('path.nv-bar-arrow')
                    .attr('d', function (d, i) {

                        var h = barWidth || x.rangeBand();
                        return arrow_down(20,h);
                    });


                watch.select('path.nv-reducer')
                    .attr('d', function (d, i) {

                        var w = Math.abs(y(getY(d, i) + d.y0) - y(d.y0)) || 0,
                            w1 = Math.abs(y(getYC(d, i) + d.y0) - y(d.y0)) || 0,
                            h = barWidth || x.rangeBand();

                        var wf = Math.max(70, w),
                            w1f = w > 0? wf / w * w1 : wf;

                        return reducer(wf,w1f,h);
                    });


            }

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

        });

        renderWatch.renderEnd('funnel immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:   {get: function(){return width;}, set: function(_){width=_;}},
        height:  {get: function(){return height;}, set: function(_){height=_;}},
        x:       {get: function(){return getX;}, set: function(_){getX=_;}},
        y:       {get: function(){return getY;}, set: function(_){getY=_;}},
        y2:       {get: function(){return getY2;}, set: function(_){getY2=_;}},
        yc:       {get: function(){return getYC;}, set: function(_){getYC=_;}},
        yErr:       {get: function(){return getYerr;}, set: function(_){getYerr=_;}},
        xScale:  {get: function(){return x;}, set: function(_){x=_;}},
        yScale:  {get: function(){return y;}, set: function(_){y=_;}},
        xDomain: {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain: {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:  {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:  {get: function(){return yRange;}, set: function(_){yRange=_;}},
        forceY:  {get: function(){return forceY;}, set: function(_){forceY=_;}},
        stacked: {get: function(){return stacked;}, set: function(_){stacked=_;}},
        showValues: {get: function(){return showValues;}, set: function(_){showValues=_;}},
        // this shows the group name, seems pointless?
        showBarLabels:    {get: function(){return showBarLabels;}, set: function(_){showBarLabels=_;}},
        showChecks:    {get: function(){return showChecks;}, set: function(_){showChecks=false;}},
        disabled:     {get: function(){return disabled;}, set: function(_){disabled=_;}},
        id:           {get: function(){return id;}, set: function(_){id=_;}},
        valueFormat:  {get: function(){return valueFormat;}, set: function(_){valueFormat=_;}},
        ratioFormat:  {get: function(){return ratioFormat;}, set: function(_){ratioFormat=_;}},
        valuePadding: {get: function(){return valuePadding;}, set: function(_){valuePadding=_;}},
        groupSpacing:{get: function(){return groupSpacing;}, set: function(_){groupSpacing=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        href:  {get: function(){return href;}, set: function(_){
            href = d3.functor(_);
        }},
        barColor:  {get: function(){return barColor;}, set: function(_){
            barColor = _ ? nv.utils.getColor(_) : null;
        }},
        barWidth: {get: function(){return barWidth;}, set: function(_){ barWidth = _; }}
    });

    nv.utils.initOptions(chart);

    return chart;
};

nv.models.funnelChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var multibar = nv.models.funnel()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend().height(30)
        , controls = nv.models.legend().height(30)
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , showControls = false
        , controlLabels = {}
        , showLegend = true
        , showXAxis = false
        , showYAxis = false
        , stacked = false
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd', 'selectChange', 'activate')
        , controlWidth = function() { return showControls ? 180 : 0 }
        , duration = 250
        ;

    state.stacked = false; // DEPRECATED Maintained for backward compatibility

    multibar.stacked(stacked);

    xAxis
        .orient('left')
        .tickPadding(5)
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient('bottom')
        .tickFormat(d3.format(',.1f'))
    ;

    tooltip
        .duration(0)
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        })
        .headerFormatter(function(d, i) {
            return xAxis.tickFormat()(d, i);
        });

    controls.updateState(false);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled }),
                stacked: stacked
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.stacked !== undefined)
                stacked = state.stacked;
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(multibar);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() { container.transition().duration(duration).call(chart) };
            chart.container = this;

            tooltip.chartContainer(chart.container.parentNode);

            stacked = multibar.stacked();

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values && d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = multibar.xScale();
            y = multibar.yScale();

            nv.utils.dropShadow(container, 1, 1, 1.2);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-funnelChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-funnelChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis')
                .append('g').attr('class', 'nv-zeroLine')
                .append('line');
            gEnter.append('g').attr('class', 'nv-barsWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');

            // Legend
            if (showLegend) {
                legend.width(availableWidth - controlWidth());

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.nv-legendWrap')
                    .attr('transform', 'translate(' + controlWidth() + ',' + (-margin.top) +')');
            }

            // Controls
            if (showControls) {
                var controlsData = [
                    { key: controlLabels.grouped || 'Grouped', disabled: multibar.stacked() },
                    { key: controlLabels.stacked || 'Stacked', disabled: !multibar.stacked() }
                ];

                controls.width(controlWidth()).color(['#444', '#444', '#444']);
                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
                    .call(controls);
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            multibar
                .disabled(data.map(function(series) { return series.disabled }))
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }));

            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }));

            barsWrap.transition().call(multibar);

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksY(availableHeight/24, data) )
                    .tickSize(-availableWidth, 0);

                g.select('.nv-x.nv-axis').call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis').selectAll('g');

                xTicks
                    .selectAll('line, text');
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize( -availableHeight, 0);

                g.select('.nv-y.nv-axis')
                    .attr('transform', 'translate(0,' + availableHeight + ')');
                g.select('.nv-y.nv-axis').call(yAxis);
            }

            // Zero line
            g.select(".nv-zeroLine line")
                .attr("x1", y(0))
                .attr("x2", y(0))
                .attr("y1", 0)
                .attr("y2", -availableHeight)
            ;

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            controls.dispatch.on('legendClick', function(d,i) {
                if (!d.disabled) return;
                controlsData = controlsData.map(function(s) {
                    s.disabled = true;
                    return s;
                });
                d.disabled = false;

                switch (d.key) {
                    case 'Grouped':
                    case controlLabels.grouped:
                        multibar.stacked(false);
                        break;
                    case 'Stacked':
                    case controlLabels.stacked:
                        multibar.stacked(true);
                        break;
                }

                state.stacked = multibar.stacked();
                dispatch.stateChange(state);
                stacked = multibar.stacked();

                chart.update();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {

                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                if (typeof e.stacked !== 'undefined') {
                    multibar.stacked(e.stacked);
                    state.stacked = e.stacked;
                    stacked = e.stacked;
                }

                chart.update();
            });
        });
        renderWatch.renderEnd('multibar horizontal chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------


/*
    multibar.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt.value = chart.x()(evt.data);

        evt['series'] = {
            key: (evt.reducer ? ' abandoned' : ' continued'),
            value: chart.y()(evt.data),
            color: evt.reducer ? '#ccc' : evt.color
        };

        tooltip.data(evt).hidden(false);
    });

    multibar.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });
*/


    multibar.dispatch.on('elementClick.select', function(evt) {
        if ( evt.hasOwnProperty('selected')) {
            dispatch.selectChange(evt);
        }
    });

/*
    multibar.dispatch.on('elementDblClick.activate', function(evt) {
        dispatch.activate(evt);
    });
*/

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.multibar = multibar;
    chart.legend = legend;
    chart.controls = controls;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.state = state;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        showControls: {get: function(){return showControls;}, set: function(_){showControls=_;}},
        controlLabels: {get: function(){return controlLabels;}, set: function(_){controlLabels=_;}},
        showXAxis:      {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:    {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            multibar.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
        }},
        barColor:  {get: function(){return multibar.barColor;}, set: function(_){
            multibar.barColor(_);
            legend.color(function(d,i) {return d3.rgb('#ccc').darker(i * 1.5).toString();})
        }}
    });

    nv.utils.inheritOptions(chart, multibar);
    nv.utils.initOptions(chart);

    return chart;
};
nv.models.furiousLegend = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 5, right: 0, bottom: 5, left: 0}
        , width = 400
        , height = 20
        , getKey = function(d) { return d.key }
        , color = nv.utils.getColor()
        , maxKeyLength = 20 //default value for key lengths
        , align = true
        , padding = 28 //define how much space between legend items. - recommend 32 for furious version
        , rightAlign = true
        , updateState = true   //If true, legend will update data.disabled and trigger a 'stateChange' dispatch.
        , radioButtonMode = false   //If true, clicking legend items will cause it to behave like a radio button. (only one can be selected at a time)
        , expanded = false
        , dispatch = d3.dispatch('legendClick', 'legendDblclick', 'legendMouseover', 'legendMouseout', 'stateChange')
        , vers = 'classic' //Options are "classic" and "furious"
        ;

    function chart(selection) {
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                container = d3.select(this);
            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-legend').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-legend').append('g');
            var g = wrap.select('g');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var series = g.selectAll('.nv-series')
                .data(function(d) {
                    if(vers != 'furious') return d;

                    return d.filter(function(n) {
                        return expanded ? true : !n.disengaged;
                    });
                });
            var seriesEnter = series.enter().append('g').attr('class', 'nv-series')

            var seriesShape;

            if(vers == 'classic') {
                seriesEnter.append('circle')
                    .style('stroke-width', 2)
                    .attr('class','nv-legend-symbol')
                    .attr('r', 5);

                seriesShape = series.select('circle');
            } else if (vers == 'furious') {
                seriesEnter.append('rect')
                    .style('stroke-width', 2)
                    .attr('class','nv-legend-symbol')
                    .attr('rx', 3)
                    .attr('ry', 3);

                seriesShape = series.select('rect');

                seriesEnter.append('g')
                    .attr('class', 'nv-check-box')
                    .property('innerHTML','<path d="M0.5,5 L22.5,5 L22.5,26.5 L0.5,26.5 L0.5,5 Z" class="nv-box"></path><path d="M5.5,12.8618467 L11.9185089,19.2803556 L31,0.198864511" class="nv-check"></path>')
                    .attr('transform', 'translate(-10,-8)scale(0.5)');

                var seriesCheckbox = series.select('.nv-check-box');

                seriesCheckbox.each(function(d,i) {
                    d3.select(this).selectAll('path')
                        .attr('stroke', setTextColor(d,i));
                });
            }

            seriesEnter.append('text')
                .attr('text-anchor', 'start')
                .attr('class','nv-legend-text')
                .attr('dy', '.32em')
                .attr('dx', '8');

            var seriesText = series.select('text.nv-legend-text');

            series
                .on('mouseover', function(d,i) {
                    dispatch.legendMouseover(d,i);  //TODO: Make consistent with other event objects
                })
                .on('mouseout', function(d,i) {
                    dispatch.legendMouseout(d,i);
                })
                .on('click', function(d,i) {
                    dispatch.legendClick(d,i);
                    // make sure we re-get data in case it was modified
                    var data = series.data();
                    if (updateState) {
                        if(vers =='classic') {
                            if (radioButtonMode) {
                                //Radio button mode: set every series to disabled,
                                //  and enable the clicked series.
                                data.forEach(function(series) { series.disabled = true});
                                d.disabled = false;
                            }
                            else {
                                d.disabled = !d.disabled;
                                if (data.every(function(series) { return series.disabled})) {
                                    //the default behavior of NVD3 legends is, if every single series
                                    // is disabled, turn all series' back on.
                                    data.forEach(function(series) { series.disabled = false});
                                }
                            }
                        } else if(vers == 'furious') {
                            if(expanded) {
                                d.disengaged = !d.disengaged;
                                d.userDisabled = d.userDisabled == undefined ? !!d.disabled : d.userDisabled;
                                d.disabled = d.disengaged || d.userDisabled;
                            } else if (!expanded) {
                                d.disabled = !d.disabled;
                                d.userDisabled = d.disabled;
                                var engaged = data.filter(function(d) { return !d.disengaged; });
                                if (engaged.every(function(series) { return series.userDisabled })) {
                                    //the default behavior of NVD3 legends is, if every single series
                                    // is disabled, turn all series' back on.
                                    data.forEach(function(series) {
                                        series.disabled = series.userDisabled = false;
                                    });
                                }
                            }
                        }
                        dispatch.stateChange({
                            disabled: data.map(function(d) { return !!d.disabled }),
                            disengaged: data.map(function(d) { return !!d.disengaged })
                        });

                    }
                })
                .on('dblclick', function(d,i) {
                    if(vers == 'furious' && expanded) return;
                    dispatch.legendDblclick(d,i);
                    if (updateState) {
                        // make sure we re-get data in case it was modified
                        var data = series.data();
                        //the default behavior of NVD3 legends, when double clicking one,
                        // is to set all other series' to false, and make the double clicked series enabled.
                        data.forEach(function(series) {
                            series.disabled = true;
                            if(vers == 'furious') series.userDisabled = series.disabled;
                        });
                        d.disabled = false;
                        if(vers == 'furious') d.userDisabled = d.disabled;
                        dispatch.stateChange({
                            disabled: data.map(function(d) { return !!d.disabled })
                        });
                    }
                });

            series.classed('nv-disabled', function(d) { return d.userDisabled });
            series.exit().remove();

            seriesText
                .attr('fill', setTextColor)
                .text(getKey);

            //TODO: implement fixed-width and max-width options (max-width is especially useful with the align option)
            // NEW ALIGNING CODE, TODO: clean up

            var versPadding;
            switch(vers) {
                case 'furious' :
                    versPadding = 23;
                    break;
                case 'classic' :
                    versPadding = 20;
            }

            if (align) {

                var seriesWidths = [];
                series.each(function(d,i) {
                    var legendText;
                    if (getKey(d).length > maxKeyLength) { 
                        var trimmedKey = getKey(d).substring(0, maxKeyLength);
                        legendText = d3.select(this).select('text').text(trimmedKey + "...");
                        d3.select(this).append("svg:title").text(getKey(d));
                    } else {
                        legendText = d3.select(this).select('text');
                    } 
                    var nodeTextLength;
                    try {
                        nodeTextLength = legendText.node().getComputedTextLength();
                        // If the legendText is display:none'd (nodeTextLength == 0), simulate an error so we approximate, instead
                        if(nodeTextLength <= 0) throw Error();
                    }
                    catch(e) {
                        nodeTextLength = nv.utils.calcApproxTextWidth(legendText);
                    }

                    seriesWidths.push(nodeTextLength + padding);
                });

                var seriesPerRow = 0;
                var legendWidth = 0;
                var columnWidths = [];

                while ( legendWidth < availableWidth && seriesPerRow < seriesWidths.length) {
                    columnWidths[seriesPerRow] = seriesWidths[seriesPerRow];
                    legendWidth += seriesWidths[seriesPerRow++];
                }
                if (seriesPerRow === 0) seriesPerRow = 1; //minimum of one series per row

                while ( legendWidth > availableWidth && seriesPerRow > 1 ) {
                    columnWidths = [];
                    seriesPerRow--;

                    for (var k = 0; k < seriesWidths.length; k++) {
                        if (seriesWidths[k] > (columnWidths[k % seriesPerRow] || 0) )
                            columnWidths[k % seriesPerRow] = seriesWidths[k];
                    }

                    legendWidth = columnWidths.reduce(function(prev, cur, index, array) {
                        return prev + cur;
                    });
                }

                var xPositions = [];
                for (var i = 0, curX = 0; i < seriesPerRow; i++) {
                    xPositions[i] = curX;
                    curX += columnWidths[i];
                }

                series
                    .attr('transform', function(d, i) {
                        return 'translate(' + xPositions[i % seriesPerRow] + ',' + (5 + Math.floor(i / seriesPerRow) * versPadding) + ')';
                    });

                //position legend as far right as possible within the total width
                if (rightAlign) {
                    g.attr('transform', 'translate(' + (width - margin.right - legendWidth) + ',' + margin.top + ')');
                }
                else {
                    g.attr('transform', 'translate(0' + ',' + margin.top + ')');
                }

                height = margin.top + margin.bottom + (Math.ceil(seriesWidths.length / seriesPerRow) * versPadding);

            } else {

                var ypos = 5,
                    newxpos = 5,
                    maxwidth = 0,
                    xpos;
                series
                    .attr('transform', function(d, i) {
                        var length = d3.select(this).select('text').node().getComputedTextLength() + padding;
                        xpos = newxpos;

                        if (width < margin.left + margin.right + xpos + length) {
                            newxpos = xpos = 5;
                            ypos += versPadding;
                        }

                        newxpos += length;
                        if (newxpos > maxwidth) maxwidth = newxpos;

                        return 'translate(' + xpos + ',' + ypos + ')';
                    });

                //position legend as far right as possible within the total width
                g.attr('transform', 'translate(' + (width - margin.right - maxwidth) + ',' + margin.top + ')');

                height = margin.top + margin.bottom + ypos + 15;
            }

            if(vers == 'furious') {
                // Size rectangles after text is placed
                seriesShape
                    .attr('width', function(d,i) {
                        return seriesText[0][i].getComputedTextLength() + 27;
                    })
                    .attr('height', 18)
                    .attr('y', -9)
                    .attr('x', -15)
            }

            seriesShape
                .style('fill', setBGColor)
                .style('stroke', function(d,i) { return d.color || color(d, i) });
        });

        function setTextColor(d,i) {
            if(vers != 'furious') return '#000';
            if(expanded) {
                return d.disengaged ? color(d,i) : '#fff';
            } else if (!expanded) {
                return !!d.disabled ? color(d,i) : '#fff';
            }
        }

        function setBGColor(d,i) {
            if(expanded && vers == 'furious') {
                return d.disengaged ? '#fff' : color(d,i);
            } else {
                return !!d.disabled ? '#fff' : color(d,i);
            }
        }

        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        key:        {get: function(){return getKey;}, set: function(_){getKey=_;}},
        align:      {get: function(){return align;}, set: function(_){align=_;}},
        rightAlign:    {get: function(){return rightAlign;}, set: function(_){rightAlign=_;}},
        maxKeyLength:  {get: function(){return maxKeyLength;}, set: function(_){maxKeyLength=_;}},
        padding:       {get: function(){return padding;}, set: function(_){padding=_;}},
        updateState:   {get: function(){return updateState;}, set: function(_){updateState=_;}},
        radioButtonMode:    {get: function(){return radioButtonMode;}, set: function(_){radioButtonMode=_;}},
        expanded:   {get: function(){return expanded;}, set: function(_){expanded=_;}},
        vers:   {get: function(){return vers;}, set: function(_){vers=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};
nv.models.gauge = function () {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 500
        , height = 500
        , getX = function (d) {
            return d.x
        }
        , getY = function (d) {
            return d.y
        }
        , getThreshold = function (d) {
            return d.threshold;
        }
        , icon = function (d) {
        }
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , tresholds = d3.scale.linear().range(['black', 'darkred', 'orange', 'green', 'darkgreen']).domain([0, 30, 60, 80, 100])
        , valueFormat = d3.format(',.2f')
        , showLabels = true
        , showChecks = false
        , labelsOutside = false
        , labelType = "key"
        , labelThreshold = .02 //if slice percentage is under this, don't show label
        , donut = true
        , title = false
        , growOnHover = true
        , titleOffset = 0
        , labelSunbeamLayout = false
        , startAngle = false
        , padAngle = false
        , endAngle = false
        , cornerRadius = 0
        , donutRatio = 0.5
        , val = {start: 0, end: 0}
        , arcsRadius = []
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        ;

    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function (data) {

            //console.log( data );
            var availableWidth = width - margin.left - margin.right
                , availableHeight = height - margin.top - margin.bottom
                , radius = Math.min(availableWidth, availableHeight) / 2
                ;

            container = d3.select(this);

            var outer = radius - 10;
            var inner = outer - 5;

            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-gauge').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-gauge nv-chart-' + id);
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');
            var g_gauge = gEnter.append('g').attr('class', 'nv-gauge');
            //gEnter.append('g').attr('class', 'nv-gaugeLabels');

            //var gValueEnter = gEnter.append('g').attr('class', 'nv-gaugeValue');
            //gValueEnter.append('path').attr('class', 'nv-gaugeValue-path').each(function(d) {
            //    this._current = d;
            //});;

            var gInfoEnter = gEnter.append('g').attr('class', 'nv-gaugeInfo');
            gInfoEnter.append('g').classed('key', true).append('text');
            gInfoEnter.append('g').classed('value', true).append('text');
            gInfoEnter.append('g').classed('icon', true).append('path');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            g.select('.nv-gauge').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');
            g.select('.nv-gaugeInfo').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            //
            container.on('click', function (d, i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });

            //console.log(data);

            var thresholds = data.filter(function (d) {
                return getThreshold(d);
            }).sort(function (a, b) {
                    return d3.ascending(getY(a), getY(b));
                });

            thresholds
                .forEach(function (d, i) {
                    d.prevValue = i > 0 ? getY(thresholds[i - 1]) : 0;
                });

            //console.log(data);

            var arc = d3.svg.arc().outerRadius(outer);
            var arcOver = d3.svg.arc().outerRadius(outer + 5);

            if (startAngle !== false) {
                arc.startAngle(startAngle);
                arcOver.startAngle(startAngle);
            }

            if (endAngle !== false) {
                arc.endAngle(endAngle);
                arcOver.endAngle(endAngle);
            }
            if (donut) {
                arc.innerRadius(inner);
                arcOver.innerRadius(inner);
            }

            if (arc.cornerRadius && cornerRadius) {
                arc.cornerRadius(cornerRadius);
                arcOver.cornerRadius(cornerRadius);
            }

            // Setup the gauge chart and choose the data element
            var gaugeData = d3.layout.pie()
                .sort(null)
                .value(function (d, i) {
                    return getThreshold(d) ? (getY(d) - d.prevValue) : getY(d);
                });

            // padAngle added in d3 3.5
            if (gaugeData.padAngle && padAngle) {
                gaugeData.padAngle(padAngle);
            }

            // if title is specified and donut, put it in the middle
            if (donut && title) {
                g_gauge.append("text").attr('class', 'nv-gauge-title');

                wrap.select('.nv-gauge-title')
                    .style("text-anchor", "middle")
                    .text(function (d) {
                        return title;
                    })
                    .style("font-size", (Math.min(availableWidth, availableHeight)) * donutRatio * 2 / (title.length + 2) + "px")
                    .attr("dy", "0.35em") // trick to vertically center text
                    .attr('transform', function (d, i) {
                        return 'translate(0, ' + titleOffset + ')';
                    });
            }

            var slices = wrap.select('.nv-gauge').selectAll('.nv-slice').data(gaugeData);
            var gaugeInfo = wrap.select('.nv-gaugeInfo').datum(gaugeData);

            slices.exit().remove();

            var ae = slices.enter().append('g');
            ae.attr('class', 'nv-slice');
            ae.on('mouseover', function (d, i) {

                if (!getThreshold(d.data))
                    return;

                d3.select(this).classed('hover', true);
                if (growOnHover) {
                    d3.select(this).select("path").transition()
                        .duration(70)
                        .attr("d", arcOver);
                }

                if (donut) {
                    gaugeInfo.select('.key text').text(getX(d.data));
                    gaugeInfo.select('.value text').text(valueFormat(getY(d.data)));
                }

                dispatch.elementMouseover({
                    data: d.data,
                    index: i,
                    color: d3.select(this).style("fill"),
                    element: this
                });
            });
            ae.on('mouseout', function (d, i) {
                if (!getThreshold(d.data))
                    return;

                d3.select(this).classed('hover', false);
                if (growOnHover) {
                    d3.select(this).select("path").transition()
                        .duration(50)
                        .attr("d", arc);
                }

                donutInfo();

                dispatch.elementMouseout({data: d.data, index: i, element: this});
            });
            ae.on('mousemove', function (d, i) {
                if (!getThreshold(d.data))
                    return;

                dispatch.elementMousemove({data: d.data, index: i, element: this});
            });

            slices.attr('fill', function (d, i) {
                return color(d.data, i);
            });
            slices.attr('stroke', function (d, i) {
                return color(d.data, i);
            });

            var paths = ae.append('path').attr('class', 'nv-slice-path').each(function (d) {
                this._current = d;
            });

            /*
             if ( showChecks ) {
             ae.append('path').attr('class', 'nv-check')
             .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
             }

             slices.classed('selected', function(d){ return d.value > 0 && d.data.selected; })
             */

            donutInfo();

            function donutInfo() {
                if (donut) {
                    /*
                     var gaugeData = gaugeInfo.datum(),
                     selected = gaugeData.filter(function(d){ return d.data.selected;}),
                     sum = d3.sum( selected, function(d){ return d.value;});

                     */
                    var val = gaugeInfo.datum().filter(function (d) {
                        return !getThreshold(d.data);
                    });

                    val = val && val.length > 0 ? val[0].data : null;

                    if ( val ) {

                        var thresholds = icon(getY(val), data.filter(function (d) {
                            return getThreshold(d);
                        }));

                        gaugeInfo.select('.key text').text(thresholds || getX(val));
                        gaugeInfo.select('.value text').text(valueFormat(getY(val)));

                        if (thresholds) {
                            gaugeInfo.select('.icon path')
                                .attr("d", "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z");
                            //console.log(thresholds)
                            gaugeInfo.select('.icon')
                                .attr('class', 'icon ' + thresholds);
                        }
                    }
                    else {
                        gaugeInfo.select('.key text').text('');
                        gaugeInfo.select('.value text').text(valueFormat(0));

                    }
                }
            }


            var arcValue = d3.svg.arc()
                .innerRadius(inner - 2)
                .outerRadius(inner - 28);

            if (startAngle !== false) {
                arcValue.startAngle(startAngle);
            }
            if (endAngle !== false) {
                arcValue.endAngle(endAngle);
            }
            /*
             if (donut) {
             arcValue.innerRadius(donutRatio * radius);
             }
             */

            /*
             if (arcValue.cornerRadius && cornerRadius) {
             arcValue.cornerRadius(cornerRadius);
             }
             */

            /*
             gaugeValue
             .attr('fill', function(d,i) { return color(d, i); })
             .attr('stroke', function(d,i) { return color(d, i); });
             */

            /*
             gaugeValue.select('path')
             .transition()
             .duration(500)
             .attr("d", function (d, i) { return arcValue(d); })
             .attrTween("d", arcTween);
             */


            slices.select('path.nv-slice-path')
                .filter(function (d) {
                    return getThreshold(d.data);
                })
                .transition()
                .attr("d", arc);

            slices.select('path.nv-slice-path')
                .filter(function (d) {
                    return !getThreshold(d.data);
                })
                .transition()
                .duration(500)
                .attr("d", arcValue)
                .attrTween("d", arcTween);

            function arcTween(a, idx) {
                //console.log('arcTween', a );
                a.endAngle = isNaN(a.endAngle) ? 0 : a.endAngle;
                a.startAngle = 0;

                //if (!donut) a.innerRadius = 0;
                var i = d3.interpolate(this._current, a);
                this._current = i(0);
                return function (t) {
                    return arcValue(i(t));
                };
            }
        });

        renderWatch.renderEnd('gauge immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        arcsRadius: {
            get: function () {
                return arcsRadius;
            }, set: function (_) {
                arcsRadius = _;
            }
        },
        value: {
            get: function () {
                return val;
            }, set: function (_) {
                val = _;
            }
        },
        width: {
            get: function () {
                return width;
            }, set: function (_) {
                width = _;
            }
        },
        height: {
            get: function () {
                return height;
            }, set: function (_) {
                height = _;
            }
        },
        //showChecks: {get: function(){return showChecks;}, set: function(_){showChecks=_;}},
        //showLabels: {get: function(){return showLabels;}, set: function(_){showLabels=_;}},
        title: {
            get: function () {
                return title;
            }, set: function (_) {
                title = _;
            }
        },
        titleOffset: {
            get: function () {
                return titleOffset;
            }, set: function (_) {
                titleOffset = _;
            }
        },
        //labelThreshold: {get: function(){return labelThreshold;}, set: function(_){labelThreshold=_;}},
        valueFormat: {
            get: function () {
                return valueFormat;
            }, set: function (_) {
                valueFormat = _;
            }
        },
        x: {
            get: function () {
                return getX;
            }, set: function (_) {
                getX = _;
            }
        },
        id: {
            get: function () {
                return id;
            }, set: function (_) {
                id = _;
            }
        },
        endAngle: {
            get: function () {
                return endAngle;
            }, set: function (_) {
                endAngle = _;
            }
        },
        startAngle: {
            get: function () {
                return startAngle;
            }, set: function (_) {
                startAngle = _;
            }
        },
        padAngle: {
            get: function () {
                return padAngle;
            }, set: function (_) {
                padAngle = _;
            }
        },
        cornerRadius: {
            get: function () {
                return cornerRadius;
            }, set: function (_) {
                cornerRadius = _;
            }
        },
        donutRatio: {
            get: function () {
                return donutRatio;
            }, set: function (_) {
                donutRatio = _;
            }
        },
        //labelsOutside: {get: function(){return labelsOutside;}, set: function(_){labelsOutside=_;}},
        //labelSunbeamLayout: {get: function(){return labelSunbeamLayout;}, set: function(_){labelSunbeamLayout=_;}},
        //donut:              {get: function(){return donut;}, set: function(_){donut=_;}},
        growOnHover: {
            get: function () {
                return growOnHover;
            }, set: function (_) {
                growOnHover = _;
            }
        },

        // depreciated after 1.7.1
        //gaugeLabelsOutside: {get: function(){return labelsOutside;}, set: function(_){
        //    labelsOutside=_;
        //    nv.deprecated('gaugeLabelsOutside', 'use labelsOutside instead');
        //}},
        //// depreciated after 1.7.1
        //donutLabelsOutside: {get: function(){return labelsOutside;}, set: function(_){
        //    labelsOutside=_;
        //    nv.deprecated('donutLabelsOutside', 'use labelsOutside instead');
        //}},
        // deprecated after 1.7.1
        //labelFormat: {get: function(){ return valueFormat;}, set: function(_) {
        //    valueFormat=_;
        //    nv.deprecated('labelFormat','use valueFormat instead');
        //}},

        // options that require extra logic in the setter
        margin: {
            get: function () {
                return margin;
            }, set: function (_) {
                margin.top = typeof _.top != 'undefined' ? _.top : margin.top;
                margin.right = typeof _.right != 'undefined' ? _.right : margin.right;
                margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
                margin.left = typeof _.left != 'undefined' ? _.left : margin.left;
            }
        },
        y: {
            get: function () {
                return getY;
            }, set: function (_) {
                getY = d3.functor(_);
            }
        },
        threshold: {
            get: function () {
                return getThreshold;
            }, set: function (_) {
                getThreshold = d3.functor(_);
            }
        },
        icon: {
            get: function () {
                return icon;
            }, set: function (_) {
                icon = d3.functor(_);
            }
        },
        color: {
            get: function () {
                return color;
            }, set: function (_) {
                color = nv.utils.getColor(_);
            }
        }/*,
         labelType:          {get: function(){return labelType;}, set: function(_){
         labelType= _ || 'key';
         }}*/
    });

    nv.utils.initOptions(chart);
    return chart;
};
nv.models.gaugeChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var gauge = nv.models.gauge();
    var legend = nv.models.legend();
    var tooltip = nv.models.tooltip();

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , showLegend = false
        , showTooltips = false
        , legendPosition = "top"
        , color = nv.utils.defaultColor()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , duration = 250
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd', 'selectChange')
        ;

    tooltip
        .duration(0)
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return gauge.valueFormat()(d, i);
        });

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled })
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined) {
                data.forEach(function (series, i) {
                    series.disabled = !state.active[i];
                });
            }
        }
    };

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(gauge);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() { container.transition().call(chart); };
            chart.container = this;

            state.setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            //set state.disabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display No Data message if there's nothing to show.
            if (!data || !data.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-gaugeChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-gaugeChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-gaugeWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');

            // Legend
            if (showLegend) {
                if (legendPosition === "top") {
                    legend.width( availableWidth ).key(gauge.x());

                    wrap.select('.nv-legendWrap')
                        .datum(data)
                        .call(legend);

                    if ( margin.top != legend.height()) {
                        margin.top = legend.height();
                        availableHeight = nv.utils.availableHeight(height, container, margin);
                    }

                    wrap.select('.nv-legendWrap')
                        .attr('transform', 'translate(0,' + (-margin.top) +')');
                } else if (legendPosition === "right") {
                    var legendWidth = nv.models.legend().width();
                    if (availableWidth / 2 < legendWidth) {
                        legendWidth = (availableWidth / 2)
                    }
                    legend.height(availableHeight).key(gauge.x());
                    legend.width(legendWidth);
                    availableWidth -= legend.width();

                    wrap.select('.nv-legendWrap')
                        .datum(data)
                        .call(legend)
                        .attr('transform', 'translate(' + (availableWidth) +',0)');
                }
            }
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            gauge.width(availableWidth).height(availableHeight);
            var gaugeWrap = g.select('.nv-gaugeWrap').datum(data);
            d3.transition(gaugeWrap).call(gauge);

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState) {
                    state[key] = newState[key];
                }
                dispatch.stateChange(state);
                chart.update();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });
                    state.disabled = e.disabled;
                }
                chart.update();
            });
        });

        renderWatch.renderEnd('gaugeChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    gauge.dispatch.on('elementMouseover.tooltip', function(evt) {
        if (!showTooltips)
            return;
        evt['series'] = {
            key: chart.x()(evt.data),
            value: chart.y()(evt.data),
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    gauge.dispatch.on('elementMouseout.tooltip', function(evt) {
        if (!showTooltips)
            return;
        tooltip.hidden(true);
    });

    gauge.dispatch.on('elementMousemove.tooltip', function(evt) {
        if (!showTooltips)
            return;
        tooltip();
    });

    gauge.dispatch.on('elementClick.select', function(evt){
        dispatch.selectChange(evt);
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.legend = legend;
    chart.dispatch = dispatch;
    chart.gauge = gauge;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
        showLegend:     {get: function(){return showLegend;},     set: function(_){showLegend=_;}},
        legendPosition: {get: function(){return legendPosition;}, set: function(_){legendPosition=_;}},
        defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},

        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            legend.color(color);
            gauge.color(color);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }},
        showTooltips:  {get: function(){return showTooltips;},     set: function(_){showTooltips=_;}},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });
    nv.utils.inheritOptions(chart, gauge);
    nv.utils.initOptions(chart);
    return chart;
};
//TODO: consider deprecating and using multibar with single series for this
nv.models.historicalBar = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , x = d3.scale.linear()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , forceX = []
        , forceY = [0]
        , padData = false
        , clipEdge = true
        , color = nv.utils.defaultColor()
        , xDomain
        , yDomain
        , xRange
        , yRange
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        , interactive = true
        ;

    var renderWatch = nv.utils.renderWatch(dispatch, 0);

    function chart(selection) {
        selection.each(function(data) {
            renderWatch.reset();

            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            // Setup Scales
            x.domain(xDomain || d3.extent(data[0].values.map(getX).concat(forceX) ));

            if (padData)
                x.range(xRange || [availableWidth * .5 / data[0].values.length, availableWidth * (data[0].values.length - .5)  / data[0].values.length ]);
            else
                x.range(xRange || [0, availableWidth]);

            y.domain(yDomain || d3.extent(data[0].values.map(getY).concat(forceY) ))
                .range(yRange || [availableHeight, 0]);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] + y.domain()[0] * 0.01, y.domain()[1] - y.domain()[1] * 0.01])
                    : y.domain([-1,1]);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-historicalBar-' + id).data([data[0].values]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-historicalBar-' + id);
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-bars');
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            container
                .on('click', function(d,i) {
                    dispatch.chartClick({
                        data: d,
                        index: i,
                        pos: d3.event,
                        id: id
                    });
                });

            defsEnter.append('clipPath')
                .attr('id', 'nv-chart-clip-path-' + id)
                .append('rect');

            wrap.select('#nv-chart-clip-path-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            g.attr('clip-path', clipEdge ? 'url(#nv-chart-clip-path-' + id + ')' : '');

            var bars = wrap.select('.nv-bars').selectAll('.nv-bar')
                .data(function(d) { return d }, function(d,i) {return getX(d,i)});
            bars.exit().remove();

            bars.enter().append('rect')
                .attr('x', 0 )
                .attr('y', function(d,i) {  return nv.utils.NaNtoZero(y(Math.max(0, getY(d,i)))) })
                .attr('height', function(d,i) { return nv.utils.NaNtoZero(Math.abs(y(getY(d,i)) - y(0))) })
                .attr('transform', function(d,i) { return 'translate(' + (x(getX(d,i)) - availableWidth / data[0].values.length * .45) + ',0)'; })
                .on('mouseover', function(d,i) {
                    if (!interactive) return;
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });

                })
                .on('mouseout', function(d,i) {
                    if (!interactive) return;
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mousemove', function(d,i) {
                    if (!interactive) return;
                    dispatch.elementMousemove({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('click', function(d,i) {
                    if (!interactive) return;
                    dispatch.elementClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                    d3.event.stopPropagation();
                })
                .on('dblclick', function(d,i) {
                    if (!interactive) return;
                    dispatch.elementDblClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                    d3.event.stopPropagation();
                });

            bars
                .attr('fill', function(d,i) { return color(d, i); })
                .attr('class', function(d,i,j) { return (getY(d,i) < 0 ? 'nv-bar negative' : 'nv-bar positive') + ' nv-bar-' + j + '-' + i })
                .watchTransition(renderWatch, 'bars')
                .attr('transform', function(d,i) { return 'translate(' + (x(getX(d,i)) - availableWidth / data[0].values.length * .45) + ',0)'; })
                //TODO: better width calculations that don't assume always uniform data spacing;w
                .attr('width', (availableWidth / data[0].values.length) * .9 );

            bars.watchTransition(renderWatch, 'bars')
                .attr('y', function(d,i) {
                    var rval = getY(d,i) < 0 ?
                        y(0) :
                            y(0) - y(getY(d,i)) < 1 ?
                        y(0) - 1 :
                        y(getY(d,i));
                    return nv.utils.NaNtoZero(rval);
                })
                .attr('height', function(d,i) { return nv.utils.NaNtoZero(Math.max(Math.abs(y(getY(d,i)) - y(0)),1)) });

        });

        renderWatch.renderEnd('historicalBar immediate');
        return chart;
    }

    //Create methods to allow outside functions to highlight a specific bar.
    chart.highlightPoint = function(pointIndex, isHoverOver) {
        container
            .select(".nv-bars .nv-bar-0-" + pointIndex)
            .classed("hover", isHoverOver)
        ;
    };

    chart.clearHighlights = function() {
        container
            .select(".nv-bars .nv-bar.hover")
            .classed("hover", false)
        ;
    };

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:   {get: function(){return width;}, set: function(_){width=_;}},
        height:  {get: function(){return height;}, set: function(_){height=_;}},
        forceX:  {get: function(){return forceX;}, set: function(_){forceX=_;}},
        forceY:  {get: function(){return forceY;}, set: function(_){forceY=_;}},
        padData: {get: function(){return padData;}, set: function(_){padData=_;}},
        x:       {get: function(){return getX;}, set: function(_){getX=_;}},
        y:       {get: function(){return getY;}, set: function(_){getY=_;}},
        xScale:  {get: function(){return x;}, set: function(_){x=_;}},
        yScale:  {get: function(){return y;}, set: function(_){y=_;}},
        xDomain: {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain: {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:  {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:  {get: function(){return yRange;}, set: function(_){yRange=_;}},
        clipEdge:    {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},
        id:          {get: function(){return id;}, set: function(_){id=_;}},
        interactive: {get: function(){return interactive;}, set: function(_){interactive=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};

nv.models.historicalBarChart = function(bar_model, bar2_model) {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var bars = bar_model || nv.models.historicalBar()
        , bars2 = bar2_model || nv.models.historicalBar()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , interactiveLayer = nv.interactiveGuideline()
        , tooltip = nv.models.tooltip()
        , brush = d3.svg.brush()
        , hasBar2 = false
        ;


    var margin = {top: 30, right: 90, bottom: 50, left: 90}
        , color = nv.utils.defaultColor()
        , width = null
        , height = null
        , showLegend = false
        , showChecks = true
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , useInteractiveGuideline = false
        , x
        , y
        , focusEnable = false
        , negateTrend = false
        , brushExtent = null
        , state = {}
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'brush', 'stateChange', 'changeState', 'renderEnd', 'selectChange', 'drill')
        , transitionDuration = 0
        , headerFormat = function(d){ return d3.time.format('%b %d %H:%M')(new Date(d)); }
        , footerFormat = function(d){ }
        ;

    xAxis.orient('bottom').tickPadding(7);
    yAxis.orient( (rightAlignYAxis) ? 'right' : 'left');
    tooltip
        .duration(0)
        .headerEnabled(true)
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        })
        .headerFormatter(function(d, i) {
            return headerFormat(chart.x()(d.data), d, i);
        });


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch, 0);

    function chart(selection) {
        selection.each(function(data) {
            renderWatch.reset();
            renderWatch.models(bars);
            renderWatch.models(bars2);

            if (showXAxis) renderWatch.models(xAxis);
            if (showYAxis) renderWatch.models(yAxis);

            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (transitionDuration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(transitionDuration).call(chart);
                }
            };
            chart.container = this;

            //set state.disabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display noData message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = bars.xScale();

            var xDomain = d3.extent(d3.merge(data.map(function(d, idx) {
                return d.values.map(function(d,i) {
                    return chart.x()(d,i);
                });
            })));

            var yDomain = d3.extent(d3.merge(data.map(function(d, idx) {
                return d.values.map(function(d,i) {
                    return Math.max(chart.y()(d,i) || 0, chart.y2()(d,i) || 0.0);
                }).concat(chart.forceY());
            })));

            bars.xDomain(xDomain).yDomain(yDomain);
            bars2.xDomain(xDomain).yDomain(yDomain);

            y = bars.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-historicalBarChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-historicalBarChart').append('g');
            var g = wrap.select('g');

            var focusEnter = gEnter.append('g').attr('class', 'nv-focus');
            focusEnter.append('g').attr('class', 'nv-background').append('rect');
            focusEnter.append('g').attr('class', 'nv-x nv-axis');
            focusEnter.append('g').attr('class', 'nv-y nv-axis');
            focusEnter.append('g').attr('class', 'nv-bars2Wrap');
            focusEnter.append('g').attr('class', 'nv-barsWrap');
            focusEnter.append('g').attr('class', 'nv-legendWrap');
            focusEnter.append('g').attr('class', 'nv-interactive');

            var contextEnter = gEnter.append('g').attr('class', 'nv-context');

            // Legend
            if (showLegend) {
                legend.width(availableWidth)
                    .updateState(!showChecks);

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                wrap.select('.nv-legendWrap')
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
            }
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left:margin.left, top:margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            g.select('.nv-focus .nv-background rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            bars
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }));

            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }));
            barsWrap.transition().call(bars);

            if ( hasBar2 ) {
                bars2
                    .width(availableWidth)
                    .height(availableHeight)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled }));

                var bars2Wrap = g.select('.nv-bars2Wrap')
                    .datum(data.filter(function (d) {
                        return !d.disabled
                    }));
                bars2Wrap.transition().call(bars2);
            }

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')');
                g.select('.nv-x.nv-axis')
                    .transition()
                    .call(xAxis);
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .transition()
                    .call(yAxis);
            }

            if (focusEnable) {
                // Setup Brush
                brush
                    .x(x)
                    .clear()
                    .on('brushend', function () {
                        onBrushEnd();
                    });

                var gBrush = g.select('.nv-context')
                    .call(brush)
                    .selectAll('rect')
                    .attr('height', availableHeight);

                onBrush();
            }

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            interactiveLayer.dispatch.on('elementMousemove', function(e) {
                bars.clearHighlights();

                var singlePoint, pointIndex, pointXLocation, allData = [];
                data
                    .filter(function(series, i) {
                        series.seriesIndex = i;
                        return !series.disabled;
                    })
                    .forEach(function(series,i) {
                        pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                        bars.highlightPoint(pointIndex,true);
                        var point = series.values[pointIndex];
                        if (point === undefined) return;
                        if (singlePoint === undefined) singlePoint = point;
                        if (pointXLocation === undefined) pointXLocation = chart.xScale()(chart.x()(point,pointIndex));
                        allData.push({
                            key: series.key,
                            value: chart.y()(point, pointIndex),
                            color: color(series,series.seriesIndex),
                            data: series.values[pointIndex]
                        });
                    });

                var xValue = xAxis.tickFormat()(chart.x()(singlePoint,pointIndex));
                interactiveLayer.tooltip
                    .chartContainer(that.parentNode)
                    .valueFormatter(function(d,i) {
                        return yAxis.tickFormat()(d);
                    })
                    .data({
                        negateTrend: chart.negateTrend && chart.negateTrend(),
                        value: xValue,
                        index: pointIndex,
                        series: allData
                    })();

                interactiveLayer.renderGuideLine(pointXLocation);

            });

            interactiveLayer.dispatch.on("elementMouseout",function(e) {
                dispatch.tooltipHide();
                bars.clearHighlights();
            });

            legend.dispatch
                .on('stateChange', function (newState) {
                    for (var key in newState)
                        state[key] = newState[key];
                    dispatch.stateChange(state);
                    chart.update();
                })
                .on('legendClick', function (d, i) {
                    d.selected = !d.selected;
                    dispatch.selectChange(d);
                    // chart.update();
                });


            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                chart.update();
            });

            //============================================================
            // Functions
            //------------------------------------------------------------

            function onBrushEnd() {
                if (brush.empty()) {
                    dispatch.brush({extent: null, brush: brush});
                }
                else {
                    dispatch.brush({extent: brush.extent(), brush: brush});
                }
            }

            function onBrush() {

            }

        });

        renderWatch.renderEnd('historicalBarChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    bars.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.data.key,
            value: chart.y()(evt.data),
            refValue: hasBar2 ? chart.y2()(evt.data) : null,
            color: evt.color
        };

        evt.negateTrend = chart.negateTrend && chart.negateTrend();

        tooltip.data(evt)
            .footerFormatter(footerFormat)
            .chartContainer(chart.container.parentNode)
            .hidden(false);
    });

    bars.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    bars.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    bars2.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            y2: true,
            key: evt.data.key,
            value: chart.y2()(evt.data),
            color: evt.color
        };

        tooltip.data(evt)
            .footerFormatter(function () {})
            .chartContainer(chart.container.parentNode)
            .hidden(false);
    });

    bars2.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    bars2.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });


    bars.dispatch.on('elementClick.drill', function(evt) {
        dispatch.drill({drill: [evt.data[0], evt.data[0] + evt.step], result: evt.series});
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.bars = bars;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.interactiveLayer = interactiveLayer;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        negateTrend: {get: function(){return negateTrend;}, set: function(_){negateTrend=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        showChecks: {get: function(){return showChecks;}, set: function(_){showChecks=_;}},
        showXAxis: {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis: {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        focusEnable: { get: function () { return focusEnable; }, set: function (_) { focusEnable = _; }},
        brushExtent: { get: function () { return brushExtent; }, set: function (_) { brushExtent = _; }},

        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
            bars.color(color);
        }},
        duration:    {get: function(){return transitionDuration;}, set: function(_){
            transitionDuration=_;
            renderWatch.reset(transitionDuration);
            bars.duration(transitionDuration);
            yAxis.duration(transitionDuration);
            xAxis.duration(transitionDuration);
        }},
        xTickFormat: {
            get: function () {
                return xAxis.tickFormat();
            }, set: function (_) {
                xAxis.tickFormat(_);
                //x2Axis.tickFormat(_);
            }
        },
        yTickFormat: {
            get: function () {
                return yAxis.tickFormat();
            }, set: function (_) {
                yAxis.tickFormat(_);
                //y2Axis.tickFormat(_);
            }
        },
        headerFormat: {
            get: function () {
                return headerFormat;
            }, set: function (_) {
                headerFormat = d3.functor(_);
            }
        },
        footerFormat: {
            get: function () {
                return tooltip.footerFormatter();
            }, set: function (_) {
                footerFormat = d3.functor(_);
                tooltip.footerFormatter(_);
            }
        },
        valueFormat: {
            get: function () {
                return interactiveLayer.tooltip.valueFormatter();
            }, set: function (_) {
                interactiveLayer.tooltip.valueFormatter(_);
                tooltip.valueFormatter(_);
            }
        },
        keyFormat: {
            get: function () {
                return legend.keyFormat();
            }, set: function (_) {
                legend.keyFormat(_);
            }
        },

        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( (_) ? 'right' : 'left');
        }},
        useInteractiveGuideline: {get: function(){return useInteractiveGuideline;}, set: function(_){
            useInteractiveGuideline = _;
            bars.interactive(!useInteractiveGuideline);
            bars2.interactive(!useInteractiveGuideline);
        }},
        x: {
            get: function () {
                return bars.x();
            }, set: function (_) {
                bars.x(_);
                bars2.x(_);
            }
        },
        y: {
            get: function () {
                return bars.y();
            }, set: function (_) {
                bars.y(_);
            }
        },
        y2: {
            get: function () {
                return bars2.y();
            }, set: function (_) {
                hasBar2 = !!_;
                bars2.y(_);
            }
        }

    });

    nv.utils.inheritOptions(chart, bars);
    nv.utils.initOptions(chart);

    return chart;
};


// ohlcChart is just a historical chart with ohlc bars and some tweaks
nv.models.ohlcBarChart = function() {
    var chart = nv.models.historicalBarChart(nv.models.ohlcBar());

    // special default tooltip since we show multiple values per x
    chart.useInteractiveGuideline(true);
    chart.interactiveLayer.tooltip.contentGenerator(function(data) {
        // we assume only one series exists for this chart
        var d = data.series[0].data;
        // match line colors as defined in nv.d3.css
        var color = d.open < d.close ? "2ca02c" : "d62728";
        return '' +
            '<h3 style="color: #' + color + '">' + data.value + '</h3>' +
            '<table>' +
            '<tr><td>open:</td><td>' + chart.yAxis.tickFormat()(d.open) + '</td></tr>' +
            '<tr><td>close:</td><td>' + chart.yAxis.tickFormat()(d.close) + '</td></tr>' +
            '<tr><td>high</td><td>' + chart.yAxis.tickFormat()(d.high) + '</td></tr>' +
            '<tr><td>low:</td><td>' + chart.yAxis.tickFormat()(d.low) + '</td></tr>' +
            '</table>';
    });
    return chart;
};

// candlestickChart is just a historical chart with candlestick bars and some tweaks
nv.models.candlestickBarChart = function() {
    var chart = nv.models.historicalBarChart(nv.models.candlestickBar());

    // special default tooltip since we show multiple values per x
    chart.useInteractiveGuideline(true);
    chart.interactiveLayer.tooltip.contentGenerator(function(data) {
        // we assume only one series exists for this chart
        var d = data.series[0].data;
        // match line colors as defined in nv.d3.css
        var color = d.open < d.close ? "2ca02c" : "d62728";
        return '' +
            '<h3 style="color: #' + color + '">' + data.value + '</h3>' +
            '<table>' +
            '<tr><td>open:</td><td>' + chart.yAxis.tickFormat()(d.open) + '</td></tr>' +
            '<tr><td>close:</td><td>' + chart.yAxis.tickFormat()(d.close) + '</td></tr>' +
            '<tr><td>high</td><td>' + chart.yAxis.tickFormat()(d.high) + '</td></tr>' +
            '<tr><td>low:</td><td>' + chart.yAxis.tickFormat()(d.low) + '</td></tr>' +
            '</table>';
    });
    return chart;
};

nv.models.multiHistoricalBarChart = function () {
    var chart = nv.models.historicalBarChart(
        nv.models.multiBar().xScale(d3.scale.linear()).stacked(false),
        nv.models.multiBar().xScale(d3.scale.linear()).stacked(false).refBars(true).barColor(function(){ return '#c4ced4'})
    );

    // special default tooltip since we show multiple values per x
    chart.useInteractiveGuideline(false);

    return chart;
};
nv.models.legend = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 5, right: 0, bottom: 5, left: 0}
        , width = 400
        , height = 20
        , getKey = function(d) { return d.name || d.key }
        , keyFormat = function(d){ return d; }
        , color = nv.utils.getColor()
        , maxKeyLength = 20 //default value for key lengths
        , align = true
        , href = null
        , padding = 32 //define how much space between legend items. - recommend 32 for furious version
        , rightAlign = true
        , updateState = true   //If true, legend will update data.disabled and trigger a 'stateChange' dispatch.
        , radioButtonMode = false   //If true, clicking legend items will cause it to behave like a radio button. (only one can be selected at a time)
        , expanded = false
        , dispatch = d3.dispatch('legendClick', 'legendDblclick', 'legendMouseover', 'legendMouseout', 'stateChange')
        , vers = 'classic' //Options are "classic" and "furious"
        , getValue = function (d) {
            return d.value;
        }
        , showLegendValues = false
        , showNativeTooltip = true
        , columnCount = 'auto'
        , lastLayoutWidth = 0;

    function chart(selection) {
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                container = d3.select(this);
            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-legend').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-legend').append('g');
            var g = wrap.select('g');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var series = g.selectAll('.nv-series')
                .data(function(d) {
                    if(vers != 'furious') return d;

                    return d.filter(function(n) {
                        return expanded ? true : !n.disengaged;
                    });
                });

            var seriesEnter = series.enter().append('g').attr('class', 'nv-series');
            var seriesShape;

            var versPadding;
            switch(vers) {
                case 'furious' :
                    versPadding = 23;
                    break;
                case 'classic' :
                    versPadding = 20;
            }

            if(vers == 'classic') {
                seriesEnter.append('circle')
                    .style('stroke-width', 2)
                    .attr('class','nv-legend-symbol')
                    .attr('r', 5);

                if (!updateState) {
                    seriesEnter.append('path')
                        .attr('class', 'nv-check')
                        .attr('transform', 'translate(-12, -12)scale(0.9)')
                        .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
                }

                seriesShape = series.select('circle');
            } else if (vers == 'furious') {
                seriesEnter.append('rect')
                    .style('stroke-width', 2)
                    .attr('class','nv-legend-symbol')
                    .attr('rx', 3)
                    .attr('ry', 3);
                seriesShape = series.select('.nv-legend-symbol');

                seriesEnter.append('g')
                    .attr('class', 'nv-check-box')
                    .property('innerHTML','<path d="M0.5,5 L22.5,5 L22.5,26.5 L0.5,26.5 L0.5,5 Z" class="nv-box"></path><path d="M5.5,12.8618467 L11.9185089,19.2803556 L31,0.198864511" class="nv-check"></path>')
                    .attr('transform', 'translate(-10,-8)scale(0.5)');

                var seriesCheckbox = series.select('.nv-check-box');

                seriesCheckbox.each(function(d,i) {
                    d3.select(this).selectAll('path')
                        .attr('stroke', setTextColor(d,i));
                });
            }

            var isHrefDefined = href && typeof href === 'function';

            if (isHrefDefined) {
                var a = seriesEnter
                    .append('a').attr('class', 'nv-href').attr('xlink:href', function (d) {
                        return href(d);
                    });

                a.append('text')
                    .attr('class','nv-legend-text');

/*
                a.on('mouseover', function (d, i) {
                    d3.event.stopPropagation();
                    d3.event.preventDefault();

                    //d3.select(this).classed('hover', true).style('opacity', 0.8);
                    dispatch.elementMouseout({
                        data: d
                    });
                });
*/
            }
            else {
                seriesEnter.append('text')
                    .attr('class','nv-legend-text');
            }

            var seriesText = series.select('text.nv-legend-text');

            seriesText
                .attr('text-anchor', 'start')
                .attr('dy', '.32em')
                .attr('dx', '8');

            (isHrefDefined ? seriesShape : series)
                .on('mouseover', function(d,i) {
                    dispatch.legendMouseover({
                        data: d,
                        index: i,
                        color: setBGColor(d, i),
                        element: this
                    });
                })
                .on('mouseout', function(d,i) {
                    dispatch.legendMouseout({
                        data: d,
                        index: i,
                        color: setBGColor(d, i),
                        element: this
                    });
                })
                .on('click', function(d,i) {
                    dispatch.legendClick(d,i);
                    // make sure we re-get data in case it was modified
                    var data = series.data();
                    if (updateState) {
                        if(vers =='classic') {
                            if (radioButtonMode) {
                                //Radio button mode: set every series to disabled,
                                //  and enable the clicked series.
                                data.forEach(function(series) { series.disabled = true});
                                d.disabled = false;
                            }
                            else {
                                d.disabled = !d.disabled;
                                if (data.every(function(series) { return series.disabled})) {
                                    //the default behavior of NVD3 legends is, if every single series
                                    // is disabled, turn all series' back on.
                                    data.forEach(function(series) { series.disabled = false});
                                }
                            }
                        } else if(vers == 'furious') {
                            if(expanded) {
                                d.disengaged = !d.disengaged;
                                d.userDisabled = d.userDisabled == undefined ? !!d.disabled : d.userDisabled;
                                d.disabled = d.disengaged || d.userDisabled;
                            } else if (!expanded) {
                                d.disabled = !d.disabled;
                                d.userDisabled = d.disabled;
                                var engaged = data.filter(function(d) { return !d.disengaged; });
                                if (engaged.every(function(series) { return series.userDisabled })) {
                                    //the default behavior of NVD3 legends is, if every single series
                                    // is disabled, turn all series' back on.
                                    data.forEach(function(series) {
                                        series.disabled = series.userDisabled = false;
                                    });
                                }
                            }
                        }
                        dispatch.stateChange({
                            disabled: data.map(function(d) { return !!d.disabled }),
                            disengaged: data.map(function(d) { return !!d.disengaged })
                        });

                    }
                })
                .on('dblclick', function(d,i) {
                    if(vers == 'furious' && expanded) return;
                    dispatch.legendDblclick(d,i);
                    if (updateState) {
                        // make sure we re-get data in case it was modified
                        var data = series.data();
                        //the default behavior of NVD3 legends, when double clicking one,
                        // is to set all other series' to false, and make the double clicked series enabled.
                        data.forEach(function(series) {
                            series.disabled = true;
                            if(vers == 'furious') series.userDisabled = series.disabled;
                        });
                        d.disabled = false;
                        if(vers == 'furious') d.userDisabled = d.disabled;
                        dispatch.stateChange({
                            disabled: data.map(function(d) { return !!d.disabled })
                        });
                    }
                });

            series
                .classed('nv-disabled', function(d) { return d.userDisabled })
                .classed('selected', function(d) { return d.selected });
            series.exit().remove();

            seriesText.attr('fill', setTextColor).text(function (d, i) {
                return keyFormat(getKey(d));
            });

            if(showLegendValues) {
                series.each(function(d) {
                    var legendTextLength = d3.select(this).select('text.nv-legend-text').node().getComputedTextLength();
                    var valueText = d3.select(this).select('text.nv-legend-text-value');

                    if (valueText.empty()) {
                        valueText = d3.select(this)
                            .append('text')
                            .attr('class', 'nv-legend-text-value');
                    }

                    valueText
                        .attr('fill', '#6A7379')
                        .attr('text-anchor', 'start')
                        .attr('dy', '.32em')
                        .attr('dx', Math.ceil(legendTextLength) + 12)
                        .text(' (' + getPercentageValue(d, data) + ')');
                })
            }

            //TODO: implement fixed-width and max-width options (max-width is especially useful with the align option)
            // NEW ALIGNING CODE, TODO: clean up
            var legendWidth = 0;
            var maxwidth = 0;
            if (align) {
                seriesShape;
                var seriesWidths = [];
                series.each(function(d,i) {
                    var legendText;
                    var k = getKey(d),
                        fk = keyFormat(k);

                    var keyLength = showLegendValues ? maxKeyLength - 6 : maxKeyLength;

                    if (fk && fk.length > keyLength) {
                        var trimmedKey = fk.substring(0, keyLength);
                        var trimmedText = trimmedKey + '...';

                        legendText = d3.select(this).select('text.nv-legend-text').text(trimmedText);

                        if(showLegendValues) {
                            var legendTextLength = d3.select(this).select('text.nv-legend-text').node().getComputedTextLength();
        
                            d3.select(this)
                                .select('.nv-legend-text-value')
                                .attr('dy', '.32em')
                                .attr('dx', Math.ceil(legendTextLength) + 12)
                                .text(' (' + getPercentageValue(d, data) + ')');
                        }

                    } else {
                        legendText = d3.select(this).select('text.nv-legend-text');
                    }

                    if (showNativeTooltip) {
                        var titleEl = d3.select(this).select('title');
                        if (titleEl.empty()) {
                            titleEl = d3.select(this).append('svg:title');
                        }
                        titleEl.text(k);
                    }

                    var nodeTextLength;
                    try {
                        nodeTextLength = legendText.node().getComputedTextLength();
                        // If the legendText is display:none'd (nodeTextLength == 0), simulate an error so we approximate, instead
                        if(nodeTextLength <= 0) throw Error();
                    }
                    catch(e) {
                        nodeTextLength = nv.utils.calcApproxTextWidth(legendText);
                    }

                    var entryWidth = nodeTextLength + padding + 18;

                    if (showLegendValues) {
                        var valueNode = d3.select(this).select('text.nv-legend-text-value').node();
                        if (valueNode) {
                            entryWidth += valueNode.getComputedTextLength() + 12;
                        }
                    }

                    seriesWidths.push(entryWidth);
                });

                var seriesPerRow = 0;
                var columnWidths = [];
                legendWidth = 0;

                var buildFixedColumnLayout = function (perRow) {
                    var widths = [];
                    for (var k = 0; k < seriesWidths.length; k++) {
                        if (seriesWidths[k] > (widths[k % perRow] || 0))
                            widths[k % perRow] = seriesWidths[k];
                    }
                    return {
                        seriesPerRow: perRow,
                        columnWidths: widths,
                        legendWidth: widths.reduce(function(prev, cur) { return prev + cur; }, 0)
                    };
                };

                if (columnCount === 'adaptive' || columnCount === 'adaptive-fit' || (typeof columnCount === 'number' && columnCount > 0)) {
                    var perRow;

                    if (columnCount === 'adaptive' || columnCount === 'adaptive-fit') {
                        var singleColHeight = margin.top + margin.bottom + seriesWidths.length * versPadding;
                        perRow = (seriesWidths.length <= 1 || singleColHeight <= height) ? 1 : 2;
                        if (perRow === 2) {
                            var twoColLayout = buildFixedColumnLayout(2);
                            if (twoColLayout.legendWidth > availableWidth) {
                                perRow = 1;
                            }
                        }
                    } else {
                        perRow = Math.min(columnCount, seriesWidths.length) || 1;
                    }

                    var layout = buildFixedColumnLayout(perRow);
                    seriesPerRow = layout.seriesPerRow;
                    columnWidths = layout.columnWidths;
                    legendWidth = layout.legendWidth;
                } else {
                    while ( legendWidth < availableWidth && seriesPerRow < seriesWidths.length) {
                        columnWidths[seriesPerRow] = seriesWidths[seriesPerRow];
                        legendWidth += seriesWidths[seriesPerRow++];
                    }
                    if (seriesPerRow === 0) seriesPerRow = 1; //minimum of one series per row

                    while ( legendWidth > availableWidth && seriesPerRow > 1 ) {
                        seriesPerRow--;
                        var shrunkLayout = buildFixedColumnLayout(seriesPerRow);
                        columnWidths = shrunkLayout.columnWidths;
                        legendWidth = shrunkLayout.legendWidth;
                    }
                }

                var xPositions = [];
                for (var i = 0, curX = 0; i < seriesPerRow; i++) {
                    xPositions[i] = curX;
                    curX += columnWidths[i];
                }

                series
                    .attr('transform', function(d, i) {
                        return 'translate(' + xPositions[i % seriesPerRow] + ',' + (5 + Math.floor(i / seriesPerRow) * versPadding) + ')';
                    });

                //position legend as far right as possible within the total width
                if (rightAlign) {
                    g.attr('transform', 'translate(' + Math.max(0, (width - margin.right - legendWidth) / 2) + ',' + margin.top + ')');
                }
                else {
                    g.attr('transform', 'translate(0' + ',' + margin.top + ')');
                }

                height = margin.top + margin.bottom + (Math.ceil(seriesWidths.length / seriesPerRow) * versPadding);

            } else {

                var ypos = 5,
                    newxpos = 5,
                    xpos;
                series
                    .attr('transform', function(d, i) {
                        var length = d3.select(this).select('text').node().getComputedTextLength() + padding;
                        xpos = newxpos;

                        if (width < margin.left + margin.right + xpos + length) {
                            newxpos = xpos = 5;
                            ypos += versPadding;
                        }

                        newxpos += length;
                        if (newxpos > maxwidth) maxwidth = newxpos;

                        if(legendWidth < xpos + maxwidth) {
                            legendWidth = xpos + maxwidth;
                        }
                        return 'translate(' + xpos + ',' + ypos + ')';
                    });

                //position legend as far right as possible within the total width
                g.attr('transform', 'translate(' + (width - margin.right - maxwidth) + ',' + margin.top + ')');

                height = margin.top + margin.bottom + ypos + 15;
            }

            if(vers == 'furious') {
                // Size rectangles after text is placed
                seriesShape
                    .attr('width', function(d,i) {
                        return seriesText[0][i].getComputedTextLength() + 27;
                    })
                    .attr('height', 18)
                    .attr('y', -9)
                    .attr('x', -15);

                // The background for the expanded legend (UI)
                gEnter.insert('rect',':first-child')
                    .attr('class', 'nv-legend-bg')
                    .attr('fill', '#eee')
                    // .attr('stroke', '#444')
                    .attr('opacity',0);

                var seriesBG = g.select('.nv-legend-bg');

                seriesBG
                .transition().duration(300)
                    .attr('x', -versPadding )
                    .attr('width', legendWidth + versPadding - 12)
                    .attr('height', height + 10)
                    .attr('y', -margin.top - 10)
                    .attr('opacity', expanded ? 1 : 0);


            }

            seriesShape
                .style('fill', setBGColor)
                .style('fill-opacity', setBGOpacity)
                .style('stroke', setBGColor);

            lastLayoutWidth = align ? legendWidth : maxwidth;
        });

        function getPercentageValue(d, series) {
            var total = d3.sum(series, function (d) {
                return getValue(d);
            });

            var v = getValue(d) / total;

            return d3.format('.0%')(v);
        }

        function setTextColor(d,i) {
            if(vers != 'furious') return '#000';
            if(expanded) {
                return d.disengaged ? '#000' : '#fff';
            } else if (!expanded) {
                if(!d.color) d.color = color(d,i);
                return !!d.disabled ? d.color : '#fff';
            }
        }

        function setBGColor(d,i) {
            if(expanded && vers == 'furious') {
                return d.disengaged ? '#eee' : d.color || color(d,i);
            } else {
                return d.color || color(d,i);
            }
        }


        function setBGOpacity(d,i) {
            if(expanded && vers == 'furious') {
                return 1;
            } else {
                return !!d.disabled ? 0 : 1;
            }
        }

        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);
    chart.layoutWidth = function() { return lastLayoutWidth; };

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        key:        {get: function(){return getKey;}, set: function(_){getKey=_;}},
        href:      {get: function(){return href;}, set: function(_){href=d3.functor(_);}},
        align:      {get: function(){return align;}, set: function(_){align=_;}},
        maxKeyLength:   {get: function(){return maxKeyLength;}, set: function(_){maxKeyLength=_;}},
        rightAlign:    {get: function(){return rightAlign;}, set: function(_){rightAlign=_;}},
        padding:       {get: function(){return padding;}, set: function(_){padding=_;}},
        updateState:   {get: function(){return updateState;}, set: function(_){updateState=_;}},
        radioButtonMode:    {get: function(){return radioButtonMode;}, set: function(_){radioButtonMode=_;}},
        expanded:   {get: function(){return expanded;}, set: function(_){expanded=_;}},
        vers:   {get: function(){return vers;}, set: function(_){vers=_;}},
        value: {
            get: function () {
                return getValue;
            },
            set: function (_) {
                getValue = _;
            }
        },
        showLegendValues: {
            get: function () {
                return showLegendValues;
            },
            set: function (_) {
                showLegendValues = _;
            }
        },
        showNativeTooltip: {
            get: function () {
                return showNativeTooltip;
            },
            set: function (_) {
                showNativeTooltip = _;
            }
        },
        columnCount: {
            get: function () {
                return columnCount;
            },
            set: function (_) {
                columnCount = _;
            }
        },
        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        keyFormat:  {get: function(){return keyFormat}, set: function(_){
            keyFormat = _;
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};

nv.models.line = function() {
    "use strict";
    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var  scatter = nv.models.scatter()
        ;

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , container = null
        , strokeWidth = 1.5
        , negateTrend = false
        , color = nv.utils.defaultColor() // a function that returns a color
        , getX = function(d) { return d.x } // accessor to get the x value from a data point
        , getY = function(d) { return d.y } // accessor to get the y value from a data point
        , getLowBound = function(d) { return d.low } // accessor to get the low bound value from a data point
        , getHighBound = function(d) { return d.high } // accessor to get the high bound value from a data point
        , defined = function(d,i) { return !isNaN(getY(d,i)) && getY(d,i) !== null } // allows a line to be not continuous when it is not defined
        , forceY = [0, 1]
        , isArea = function(d) { return d.area } // decides if a line is an area or just a line
        , isBand = function(d) { return d.band  } // decides if a line is band
        , clipEdge = false // if true, masks lines within x and y scale
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , threshold = null // the threshold
        , active_since = null // active since
        , interpolate = "linear" // controls the line interpolation
        , duration = 0
        , dispatch = d3.dispatch('elementClick', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;

    scatter
        .pointSize(16) // default size
        .pointDomain([16,256]) //set to speed up calculation, needs to be unset if there is a custom size accessor
    ;

    //============================================================


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0 //used to store previous scales
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;

    //============================================================


    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(scatter);
        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);
            nv.utils.initSVG(container);

            var bandsForceY = data.reduce(function(res, d) {

                if (isBand(d)) {
                    return d3.extent(
                        d3.merge([res, d.values.reduce(function (rc, d) {
                            return d3.extent(d3.merge([rc, [getY(d), getLowBound(d), getHighBound(d)]]));
                        }, [])]));
                }

                return res;
            }, []);

            if (bandsForceY.length === 0) {
                bandsForceY = [0, 1];
            }

            // console.log('line chart', bandsForceY);
            scatter.forceY(d3.merge([bandsForceY, forceY || [0,1], [threshold]]));


            // Setup Scales
            x = scatter.xScale();
            y = scatter.yScale();

            x0 = x0 || x;
            y0 = y0 || y;

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-line').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-line');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-groups');
            gEnter.append('g').attr('class', 'nv-scatterWrap');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            scatter
                .width(availableWidth)
                .height(availableHeight);

            var scatterWrap = wrap.select('.nv-scatterWrap');
            scatterWrap.call(scatter);

            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + scatter.id())
                .append('rect');

            wrap.select('#nv-edge-clip-' + scatter.id() + ' rect')
                .attr('width', availableWidth)
                .attr('height', (availableHeight > 0) ? availableHeight+50 : 0)
                .attr('y', (availableHeight > 0) ? -50 : 0);

            g   .attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + scatter.id() + ')' : '');
            scatterWrap
                .attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + scatter.id() + ')' : '');

            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d) { return d.key });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('stroke-width', function(d) { return d.strokeWidth || strokeWidth })
                .style('fill-opacity', 1e-6);

            groups.exit().remove();

            groups
                .attr('class', function(d,i) {
                    return (d.classed || '') + ' nv-group nv-series-' + i;
                })
                .classed('hover', function(d) { return d.hover })
                .style('fill', function(d,i){ return color(d, i) })
                .style('stroke', function(d,i){ return color(d, i)});
            groups.watchTransition(renderWatch, 'line: groups')
                .style('stroke-opacity', 1)
                .style('fill-opacity', function(d) { return d.fillOpacity || .5});

            var areaPaths = groups.selectAll('path.nv-area')
                .data(function(d) { return isArea(d) ? [d] : [] }); // this is done differently than lines because I need to check if series is an area
            areaPaths.enter().append('path')
                .attr('class', 'nv-area')
                .attr('d', function(d) {
                    return d3.svg.area()
                        .interpolate(interpolate)
                        .defined(defined)
                        .x(function(d,i) { return nv.utils.NaNtoZero(x0(getX(d,i))) })
                        .y0(function(d,i) { return nv.utils.NaNtoZero(y0(getY(d,i))) })
                        .y1(function(d,i) { return y0( y.domain()[0] <= 0 ? y.domain()[1] >= 0 ? 0 : y.domain()[1] : y.domain()[0] ) })
                        //.y1(function(d,i) { return y0(0) }) //assuming 0 is within y domain.. may need to tweak this
                        .apply(this, [d.values])
                });
            groups.exit().selectAll('path.nv-area')
                .remove();

            areaPaths.watchTransition(renderWatch, 'line: areaPaths')
                .attr('d', function(d) {
                    return d3.svg.area()
                        .interpolate(interpolate)
                        .defined(defined)
                        .x(function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                        .y0(function(d,i) { return nv.utils.NaNtoZero(y(getY(d,i))) })
                        .y1(function(d,i) { return y( y.domain()[0] <= 0 ? y.domain()[1] >= 0 ? 0 : y.domain()[1] : y.domain()[0] ) })
                        //.y1(function(d,i) { return y0(0) }) //assuming 0 is within y domain.. may need to tweak this
                        .apply(this, [d.values])
                });

            var bandPaths = groups.selectAll('path.nv-band')
                .data(function(d) { return isBand(d) ? [d] : [] }); // this is done differently than lines because I need to check if series has bounds
            bandPaths.enter().append('path')
                .attr('class', 'nv-band')
                .attr('d', function(d) {
                    return d3.svg.area()
                        .interpolate(interpolate)
                        .defined(defined)
                        .x(function(d,i) { return nv.utils.NaNtoZero(x0(getX(d,i))) })
                        .y0(function(d,i) { return nv.utils.NaNtoZero(y0(getLowBound(d,i))) })
                        .y1(function(d,i) { return nv.utils.NaNtoZero(y0(getHighBound(d,i))) })
                        .apply(this, [d.values])
                });
            groups.exit().selectAll('path.nv-band')
                .remove();

            bandPaths.watchTransition(renderWatch, 'line: bandPaths')
                .attr('d', function(d) {
                    return d3.svg.area()
                        .interpolate(interpolate)
                        .defined(defined)
                        .x(function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                        .y0(function(d,i) { return nv.utils.NaNtoZero(y(getLowBound(d,i))) })
                        .y1(function(d,i) { return nv.utils.NaNtoZero(y(getHighBound(d,i))) })
                        .apply(this, [d.values])
                });

            var linePaths = groups.selectAll('path.nv-line')
                .data(function(d) { return [d.values] });

            linePaths.enter().append('path')
                .attr('class', 'nv-line')
                .attr('d',
                    d3.svg.line()
                    .interpolate(interpolate)
                    .defined(defined)
                    .x(function(d,i) { return nv.utils.NaNtoZero(x0(getX(d,i))) })
                    .y(function(d,i) { return nv.utils.NaNtoZero(y0(getY(d,i))) })
            );

            linePaths.watchTransition(renderWatch, 'line: linePaths')
                .attr('d',
                    d3.svg.line()
                    .interpolate(interpolate)
                    .defined(defined)
                    .x(function(d,i) { return nv.utils.NaNtoZero(x(getX(d,i))) })
                    .y(function(d,i) { return nv.utils.NaNtoZero(y(getY(d,i))) })
            );

            var thresholdPaths = groups.selectAll('line.nv-threshold')
                .data( threshold ? [threshold] : [] );

            thresholdPaths.enter().append('line')
                .attr('class', 'nv-threshold');

            thresholdPaths
                .attr('x1', x.range()[0])
                .attr('y1', nv.utils.NaNtoZero(y(threshold)))
                .attr('x2', x.range()[1])
                .attr('y2', nv.utils.NaNtoZero(y(threshold)));

            thresholdPaths.exit().remove();
/*
        <text x="0" y="338.85825396825396" transform="" style="
            fill: lightsteelblue;
            fill-opacity: 1;
            stroke-opacity: .2;
            transform: rotate(270deg );
            text-anchor: end;
            stroke: lightsteelblue;
            font-size: 11px;
            ">Created</text>*/

            var activeMarker = groups.selectAll('g.nv-activeMarker')
                .data( active_since ? [active_since] : [] );

            var activeMarkerEnter = activeMarker.enter().append('g')
                .attr('class', 'nv-activeMarker');

            activeMarkerEnter.append('line');
            activeMarkerEnter.append('text');

            activeMarker.selectAll('line')
                .attr('x1', nv.utils.NaNtoZero(x(active_since)))
                .attr('y1', y.range()[0])
                .attr('x2', nv.utils.NaNtoZero(x(active_since)))
                .attr('y2', y.range()[1] );

            activeMarker.selectAll('text')
                .text('Created'/*function(d){
                    return 'create on ' + d3.time.format('%b %d %H:%M')(new Date(+d));
                }*/)
                .attr('transform', 'rotate(270)')
                .attr('y', nv.utils.NaNtoZero(x(active_since)) - 5)
                .attr('x', -availableHeight / 2);

            activeMarker.exit().remove();

        //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();
        });
        renderWatch.renderEnd('line immediate');
        return chart;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.scatter = scatter;
    // Pass through events
    scatter.dispatch.on('elementClick', function(){ dispatch.elementClick.apply(this, arguments); });
    scatter.dispatch.on('elementMouseover', function(){ dispatch.elementMouseover.apply(this, arguments); });
    scatter.dispatch.on('elementMouseout', function(){ dispatch.elementMouseout.apply(this, arguments); });

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        defined: {get: function(){return defined;}, set: function(_){defined=_;}},
        negateTrend: {get: function(){return negateTrend;}, set: function(_){negateTrend=_;}},
        forceY: {
            get: function () {
                return forceY;
            }, set: function (_) {
                forceY = _;
            }
        },
        interpolate:      {get: function(){return interpolate;}, set: function(_){interpolate=_;}},
        threshold:      {get: function(){return threshold;}, set: function(_){threshold=_;}},
        activeSince:      {get: function(){return active_since;}, set: function(_){active_since=_;}},
        clipEdge:    {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            scatter.duration(duration);
        }},
        isArea: {get: function(){return isArea;}, set: function(_){
                isArea = d3.functor(_);
            }},
        isBand: {get: function(){return isBand;}, set: function(_){
                isBand = d3.functor(_);
            }},
        x: {get: function(){return getX;}, set: function(_){
            getX = _;
            scatter.x(_);
        }},
        y: {get: function(){return getY;}, set: function(_){
                getY = _;
                scatter.y(_);
            }},
        low: {get: function(){return getLowBound;}, set: function(_){
                getLowBound = _;
                scatter.low(_);
            }},
        high: {get: function(){return getHighBound;}, set: function(_){
                getHighBound = _;
                scatter.high(_);
            }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            scatter.color(color);
        }}
    });

    nv.utils.inheritOptions(chart, scatter);
    nv.utils.initOptions(chart);

    return chart;
};
nv.models.lineChart = function () {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var lines = nv.models.line()
        , lines2 = nv.models.line()
        , hasLine2 = false
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , interactiveLayer = nv.interactiveGuideline()
        , tooltip = nv.models.tooltip()
        , brush = d3.svg.brush()
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , color = nv.utils.defaultColor()
        , width = null
        , height = null
        , showLegend = true
        , showChecks = false
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , useInteractiveGuideline = false
        , x
        , y
        , focusEnable = false
        , negateTrend = false
        , brushExtent = null
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'brush', 'stateChange', 'changeState', 'renderEnd', 'selectChange')
        , transitionDuration = 250
        , headerFormat = function(d){ return d3.time.format('%b %d %H:%M')(new Date(lines.x(d))); }
        ;

    // set options on sub-objects for this chart
    xAxis.orient('bottom')/*.tickValues()*/;
    yAxis.orient(rightAlignYAxis ? 'right' : 'left');

    lines.clipEdge(true).duration(0);
    lines2.isArea(true);
    // We don't want any points emitted for the focus chart's scatter graph.


    tooltip.valueFormatter(function (d, i) {
        return yAxis.tickFormat()(d, i);
    }).headerFormatter(function (d, i) {
        return headerFormat/* xAxis.tickFormat()*/(d, i);
    });

    interactiveLayer.tooltip.valueFormatter(function (d, i) {
        return yAxis.tickFormat()(d, i);
    }).headerFormatter(function (d, i) {
        return headerFormat/* xAxis.tickFormat()*/(d, i);
    });


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch, transitionDuration);

    var stateGetter = function (data) {
        return function () {
            return {
                active: data.map(function (d) {
                    return !d.disabled;
                })
            };
        };
    };

    var stateSetter = function (data) {
        return function (state) {
            if (state.active !== undefined)
                data.forEach(function (series, i) {
                    series.disabled = !state.active[i];
                });
        };
    };

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(lines);
        renderWatch.models(lines2);

        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function (data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function () {
                if (transitionDuration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(transitionDuration).call(chart);
                }
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disabled
            state.disabled = data.map(function (d) {
                return !!d.disabled;
            });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display noData message if there's nothing to show.
            if (!data || !data.length || !data.filter(function (d) {
                    return d.values && d.values.length;
                }).length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();

                if ( hasLine2) {
                    var forceY = d3.extent(
                        d3.merge(
                            [ data[0].values.map(lines.y()), data[0].values.map(lines2.y())])
                    );

                    lines.forceY(forceY);
                    lines2.forceY(forceY);
                }
            }


            // Setup Scales
            x = lines.xScale();
            y = lines.yScale();


            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-lineChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-lineChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-legendWrap');

            var focusEnter = gEnter.append('g').attr('class', 'nv-focus');
            focusEnter.append('g').attr('class', 'nv-background').append('rect');
            focusEnter.append('g').attr('class', 'nv-x nv-axis');
            focusEnter.append('g').attr('class', 'nv-y nv-axis');
            focusEnter.append('g').attr('class', 'nv-lines2Wrap');
            focusEnter.append('g').attr('class', 'nv-linesWrap');
            focusEnter.append('g').attr('class', 'nv-interactive');

            var contextEnter = gEnter.append('g').attr('class', 'nv-context');

            // Legend
            if (showLegend) {
                legend
                    .width(availableWidth)
                    .updateState(!showChecks);

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if (margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                wrap.select('.nv-legendWrap')
                    .attr('transform', 'translate(0,' + (-margin.top) + ')');
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left: margin.left, top: margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            g.select('.nv-focus .nv-background rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            lines
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function (d, i) {
                    return d.color || color(d, i);

                }).filter(function (d, i) {
                    return !data[i].disabled;
                }));

            if ( hasLine2 ) {
                lines2
                    .interpolate('cardinal')
                    .clipEdge(true)
                    .width(availableWidth)
                    .height(availableHeight)
                    .color(data.map(function (d, i) {
                        return d.color || color(d, i);

                    }).filter(function (d, i) {
                        return !data[i].disabled;
                    }));
            }

            var linesWrap = g.select('.nv-linesWrap')
                .datum(data.filter(function (d) {
                    return !d.disabled;
                }));

            var lines2Wrap;

            if ( hasLine2 ) {
                lines2Wrap = g.select('.nv-lines2Wrap')
                    .datum(data.filter(function (d) {
                        return !d.disabled;
                    }));
            }

            // Setup Main (Focus) Axes
            if (showXAxis) {

                xAxis
                    .scale(x)
                    ._ticks(nv.utils.calcTicksX(availableWidth / 100, data))
                    .tickSize(-availableHeight, 0);

            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks(nv.utils.calcTicksY(availableHeight / 36, data))
                    .tickSize(-availableWidth, 0);
            }

            //============================================================
            // Update Axes
            //============================================================
            function updateXAxis() {
                if (showXAxis) {
                    g.select('.nv-focus .nv-x.nv-axis')
                        .transition()
                        .duration(transitionDuration)
                        .call(xAxis)
                    ;
                }
            }

            function updateYAxis() {
                if (showYAxis) {
                    g.select('.nv-focus .nv-y.nv-axis')
                        .transition()
                        .duration(transitionDuration)
                        .call(yAxis)
                    ;
                }
            }

            g.select('.nv-focus .nv-x.nv-axis')
                .attr('transform', 'translate(0,' + availableHeight + ')');

            if ( hasLine2 ) {
                lines2Wrap.call(lines2);
            }
            linesWrap.call(lines);
            updateXAxis();
            updateYAxis();

            if (focusEnable) {
                // Setup Brush
                brush
                    .x(x)
                    .clear()
                    .on('brushend', function () {
                        onBrushEnd();
                    });

                var gBrush = g.select('.nv-context')
                    .call(brush)
                    .selectAll('rect')
                    .attr('height', availableHeight);

                onBrush();
            }

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch
                .on('stateChange', function (newState) {
                    for (var key in newState)
                        state[key] = newState[key];
                    dispatch.stateChange(state);
                    chart.update();
                })
                .on('legendClick', function (d, i) {
                    d.selected = !d.selected;
                    dispatch.selectChange(d);
                    // chart.update();
                });

            interactiveLayer.dispatch.on('elementMousemove', function (e) {
                lines.clearHighlights();
                var singlePoint, pointIndex, pointXLocation, allData = [];
                data
                    .filter(function (series, i) {
                        series.seriesIndex = i;
                        return !series.disabled && !series.disableTooltip;
                    })
                    .forEach(function (series, i) {
                        var extent = x.domain();
                        var currentValues = series.values.filter(function (d, i) {
                            return lines.x()(d, i) >= extent[0] && lines.x()(d, i) <= extent[1];
                        });

                        pointIndex = nv.interactiveBisect(currentValues, e.pointXValue, lines.x());
                        var point = currentValues[pointIndex];
                        var pointYValue = chart.y()(point, pointIndex);
                        var pointYRefValue = chart.y2()(point, pointIndex);
                        if (pointYValue !== null) {
                            lines.highlightPoint(series.seriesIndex, pointIndex, true);
                        }
                        if (point === undefined) return;
                        if (singlePoint === undefined) singlePoint = point;
                        if (pointXLocation === undefined) pointXLocation = chart.xScale()(chart.x()(point, pointIndex));
                        allData.push({
                            key: series.key,
                            value: pointYValue,
                            refValue: pointYRefValue,
                            pointAlert: chart.pointAlert && chart.pointAlert(),
                            pointAlertGroup: chart.pointAlertGroup && chart.pointAlertGroup(),
                            isLowConfidence:  chart.isLowConfidence && chart.isLowConfidence(),
                            color: (function (d, i) {
                                return d.color || color(d, i);
                            })(series, series.seriesIndex),
                            data: point
                        });
                    });
                //Highlight the tooltip entry based on which point the mouse is closest to.
                if (allData.length > 2) {
                    var yValue = chart.yScale().invert(e.mouseY);
                    var domainExtent = Math.abs(chart.yScale().domain()[0] - chart.yScale().domain()[1]);
                    var threshold = 0.03 * domainExtent;
                    var indexToHighlight = nv.nearestValueIndex(allData.map(function (d) {
                        return d.value;
                    }), yValue, threshold);
                    if (indexToHighlight !== null)
                        allData[indexToHighlight].highlight = true;
                }

                interactiveLayer.tooltip
                    .chartContainer(chart.container.parentNode)
                    .data({
                        negateTrend: chart.negateTrend && chart.negateTrend(),
                        value: chart.x()(singlePoint, pointIndex),
                        index: pointIndex,
                        series: allData
                    })();

                interactiveLayer.renderGuideLine(pointXLocation);

            });

            interactiveLayer.dispatch.on('elementClick', function (e) {
                var pointXLocation, allData = [];

                data.filter(function (series, i) {
                    series.seriesIndex = i;
                    return !series.disabled;
                }).forEach(function (series) {
                    var pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                    var point = series.values[pointIndex];
                    if (typeof point === 'undefined') return;
                    if (typeof pointXLocation === 'undefined') pointXLocation = chart.xScale()(chart.x()(point, pointIndex));
                    var yPos = chart.yScale()(chart.y()(point, pointIndex));
                    allData.push({
                        point: point,
                        pointIndex: pointIndex,
                        pos: [pointXLocation, yPos],
                        seriesIndex: series.seriesIndex,
                        series: series
                    });
                });

                lines.dispatch.elementClick(allData);
            });

            interactiveLayer.dispatch.on("elementMouseout", function (e) {
                lines.clearHighlights();
            });

            dispatch.on('changeState', function (e) {
                if (typeof e.disabled !== 'undefined' && data.length === e.disabled.length) {
                    data.forEach(function (series, i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                chart.update();
            });

            //============================================================
            // Functions
            //------------------------------------------------------------

            function onBrushEnd() {
                if (brush.empty()) {
                    dispatch.brush({extent: null, brush: brush});
                }
                else {
                    dispatch.brush({extent: brush.extent(), brush: brush});
                }
            }

            function onBrush() {

            }


        });

        renderWatch.renderEnd('lineChart immediate');
        return chart;
    }


    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    lines.dispatch.on('elementMouseover.tooltip', function (evt) {
        if (!evt.series.disableTooltip) {
            tooltip.data(evt).hidden(false);
        }
    });

    lines.dispatch.on('elementMouseout.tooltip', function (evt) {
        tooltip.hidden(true);
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.lines = lines;
    chart.lines2 = lines2;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.interactiveLayer = interactiveLayer;
    chart.tooltip = tooltip;
    chart.state = state;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width: {
            get: function () {
                return width;
            }, set: function (_) {
                width = _;
            }
        },
        height: {
            get: function () {
                return height;
            }, set: function (_) {
                height = _;
            }
        },
        showChecks: {
            get: function () {
                return showChecks;
            }, set: function (_) {
                showChecks = _;
            }
        },
        showLegend: {
            get: function () {
                return showLegend;
            }, set: function (_) {
                showLegend = _;
            }
        },
        showXAxis: {
            get: function () {
                return showXAxis;
            }, set: function (_) {
                showXAxis = _;
            }
        },
        showYAxis: {
            get: function () {
                return showYAxis;
            }, set: function (_) {
                showYAxis = _;
            }
        },
        focusEnable: {
            get: function () {
                return focusEnable;
            }, set: function (_) {
                focusEnable = _;
            }
        },
        brushExtent: {
            get: function () {
                return brushExtent;
            }, set: function (_) {
                brushExtent = _;
            }
        },
        defaultState: {
            get: function () {
                return defaultState;
            }, set: function (_) {
                defaultState = _;
            }
        },
        noData: {
            get: function () {
                return noData;
            }, set: function (_) {
                noData = _;
            }
        },

        // options that require extra logic in the setter
        margin: {
            get: function () {
                return margin;
            }, set: function (_) {
                margin.top = _.top !== undefined ? _.top : margin.top;
                margin.right = _.right !== undefined ? _.right : margin.right;
                margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
                margin.left = _.left !== undefined ? _.left : margin.left;
            }
        },
        duration: {
            get: function () {
                return transitionDuration;
            }, set: function (_) {
                transitionDuration = _;
                renderWatch.reset(transitionDuration);
                lines.duration(transitionDuration);
                xAxis.duration(transitionDuration);
                yAxis.duration(transitionDuration);
            }
        },
        color: {
            get: function () {
                return color;
            }, set: function (_) {
                color = nv.utils.getColor(_);
                legend.color(color);
                lines.color(color);
                lines2.color(color);
            }
        },
        interpolate: {
            get: function () {
                return lines.interpolate();
            }, set: function (_) {
                lines.interpolate(_);
            }
        },
        xTickFormat: {
            get: function () {
                return xAxis.tickFormat();
            }, set: function (_) {
                xAxis.tickFormat(_);
                //x2Axis.tickFormat(_);
            }
        },
        yTickFormat: {
            get: function () {
                return yAxis.tickFormat();
            }, set: function (_) {
                yAxis.tickFormat(_);
                //y2Axis.tickFormat(_);
            }
        },
        headerFormat: {
            get: function () {
                return headerFormat;
            }, set: function (_) {
                headerFormat = d3.functor(_);
            }
        },
        valueFormat: {
            get: function () {
                return interactiveLayer.tooltip.valueFormatter();
            }, set: function (_) {
                interactiveLayer.tooltip.valueFormatter(_);
            }
        },
        keyFormat: {
            get: function () {
                return legend.keyFormat();
            }, set: function (_) {
                legend.keyFormat(_);
            }
        },
        x: {
            get: function () {
                return lines.x();
            }, set: function (_) {
                lines.x(_);
                lines2.x(_);
            }
        },
        y: {
            get: function () {
                return lines.y();
            }, set: function (_) {
                lines.y(_);
            }
        },
        y2: {
            get: function () {
                return lines2.y();
            }, set: function (_) {
                hasLine2 = !!_;
                lines2.y(_);
            }
        },
        threshold: {
            get: function () {
                return lines.threshold();
            }, set: function (_) {
                lines.threshold(_);
            }
        },
        pointAlert: {
            get: function () {
                return lines.scatter.pointAlert();
            }, set: function (_) {
                lines.scatter.pointAlert(_);
            }
        },
        pointAlertGroup: {
            get: function () {
                return lines.scatter.pointAlertGroup();
            }, set: function (_) {
                lines.scatter.pointAlertGroup(_);
            }
        },
        isLowConfidence: {
            get: function () {
                return lines.scatter.isLowConfidence();
            }, set: function (_) {
                lines.scatter.isLowConfidence(_);
            }
        },
        activeSince: {
            get: function () {
                return lines.activeSince();
            }, set: function (_) {
                lines.activeSince(_);
            }
        },
        rightAlignYAxis: {
            get: function () {
                return rightAlignYAxis;
            }, set: function (_) {
                rightAlignYAxis = _;
                yAxis.orient(rightAlignYAxis ? 'right' : 'left');
            }
        },
        useInteractiveGuideline: {
            get: function () {
                return useInteractiveGuideline;
            }, set: function (_) {
                useInteractiveGuideline = _;
                if (useInteractiveGuideline) {
                    lines.interactive(false);
                    lines.useVoronoi(false);
                }
            }
        }
    });

    nv.utils.inheritOptions(chart, lines);
    nv.utils.initOptions(chart);

    return chart;
};
nv.models.linePlusBarChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var lines = nv.models.line()
        , lines2 = nv.models.line()
        , bars = nv.models.historicalBar()
        , bars2 = nv.models.historicalBar()
        , xAxis = nv.models.axis()
        , x2Axis = nv.models.axis()
        , y1Axis = nv.models.axis()
        , y2Axis = nv.models.axis()
        , y3Axis = nv.models.axis()
        , y4Axis = nv.models.axis()
        , legend = nv.models.legend()
        , brush = d3.svg.brush()
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 30, right: 30, bottom: 30, left: 60}
        , margin2 = {top: 0, right: 30, bottom: 20, left: 60}
        , width = null
        , height = null
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , color = nv.utils.defaultColor()
        , showLegend = true
        , focusEnable = true
        , focusShowAxisY = false
        , focusShowAxisX = true
        , focusHeight = 50
        , extent
        , brushExtent = null
        , x
        , x2
        , y1
        , y2
        , y3
        , y4
        , noData = null
        , dispatch = d3.dispatch('brush', 'stateChange', 'changeState')
        , transitionDuration = 0
        , state = nv.utils.state()
        , defaultState = null
        , legendLeftAxisHint = ' (left axis)'
        , legendRightAxisHint = ' (right axis)'
        , switchYAxisOrder = false
        ;

    lines.clipEdge(true);
    lines2.interactive(false);
    // We don't want any points emitted for the focus chart's scatter graph.
    lines2.pointActive(function(d) { return false });
    xAxis.orient('bottom').tickPadding(5);
    y1Axis.orient('left');
    y2Axis.orient('right');
    x2Axis.orient('bottom').tickPadding(5);
    y3Axis.orient('left');
    y4Axis.orient('right');

    tooltip.headerEnabled(true).headerFormatter(function(d, i) {
        return xAxis.tickFormat()(d, i);
    });

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var getBarsAxis = function() {
        return switchYAxisOrder
            ? { main: y1Axis, focus: y3Axis }
            : { main: y2Axis, focus: y4Axis }
    }

    var getLinesAxis = function() {
        return switchYAxisOrder
            ? { main: y2Axis, focus: y4Axis }
            : { main: y1Axis, focus: y3Axis }
    }

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled })
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    var allDisabled = function(data) {
      return data.every(function(series) {
        return series.disabled;
      });
    }

    function chart(selection) {
        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight1 = nv.utils.availableHeight(height, container, margin)
                    - (focusEnable ? focusHeight : 0),
                availableHeight2 = focusHeight - margin2.top - margin2.bottom;

            chart.update = function() { container.transition().duration(transitionDuration).call(chart); };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            var dataBars = data.filter(function(d) { return !d.disabled && d.bar });
            var dataLines = data.filter(function(d) { return !d.bar }); // removed the !d.disabled clause here to fix Issue #240

            x = bars.xScale();
            x2 = x2Axis.scale();

            // select the scales and series based on the position of the yAxis
            y1 = switchYAxisOrder ? lines.yScale() : bars.yScale();
            y2 = switchYAxisOrder ? bars.yScale() : lines.yScale();
            y3 = switchYAxisOrder ? lines2.yScale() : bars2.yScale();
            y4 = switchYAxisOrder ? bars2.yScale() : lines2.yScale();

            var series1 = data
                .filter(function(d) { return !d.disabled && (switchYAxisOrder ? !d.bar : d.bar) })
                .map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: getY(d,i) }
                    })
                });

            var series2 = data
                .filter(function(d) { return !d.disabled && (switchYAxisOrder ? d.bar : !d.bar) })
                .map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: getY(d,i) }
                    })
                });

            x.range([0, availableWidth]);

            x2  .domain(d3.extent(d3.merge(series1.concat(series2)), function(d) { return d.x } ))
                .range([0, availableWidth]);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-linePlusBar').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-linePlusBar').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-legendWrap');

            // this is the main chart
            var focusEnter = gEnter.append('g').attr('class', 'nv-focus');
            focusEnter.append('g').attr('class', 'nv-x nv-axis');
            focusEnter.append('g').attr('class', 'nv-y1 nv-axis');
            focusEnter.append('g').attr('class', 'nv-y2 nv-axis');
            focusEnter.append('g').attr('class', 'nv-barsWrap');
            focusEnter.append('g').attr('class', 'nv-linesWrap');

            // context chart is where you can focus in
            var contextEnter = gEnter.append('g').attr('class', 'nv-context');
            contextEnter.append('g').attr('class', 'nv-x nv-axis');
            contextEnter.append('g').attr('class', 'nv-y1 nv-axis');
            contextEnter.append('g').attr('class', 'nv-y2 nv-axis');
            contextEnter.append('g').attr('class', 'nv-barsWrap');
            contextEnter.append('g').attr('class', 'nv-linesWrap');
            contextEnter.append('g').attr('class', 'nv-brushBackground');
            contextEnter.append('g').attr('class', 'nv-x nv-brush');

            //============================================================
            // Legend
            //------------------------------------------------------------

            if (showLegend) {
                var legendWidth = legend.align() ? availableWidth / 2 : availableWidth;
                var legendXPosition = legend.align() ? legendWidth : 0;

                legend.width(legendWidth);

                g.select('.nv-legendWrap')
                    .datum(data.map(function(series) {
                        series.originalKey = series.originalKey === undefined ? series.key : series.originalKey;
                        if(switchYAxisOrder) {
                            series.key = series.originalKey + (series.bar ? legendRightAxisHint : legendLeftAxisHint);
                        } else {
                            series.key = series.originalKey + (series.bar ? legendLeftAxisHint : legendRightAxisHint);
                        }
                        return series;
                    }))
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    // FIXME: shouldn't this be "- (focusEnabled ? focusHeight : 0)"?
                    availableHeight1 = nv.utils.availableHeight(height, container, margin) - focusHeight;
                }

                g.select('.nv-legendWrap')
                    .attr('transform', 'translate(' + legendXPosition + ',' + (-margin.top) +')');
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            //============================================================
            // Context chart (focus chart) components
            //------------------------------------------------------------

            // hide or show the focus context chart
            g.select('.nv-context').style('display', focusEnable ? 'initial' : 'none');

            bars2
                .width(availableWidth)
                .height(availableHeight2)
                .color(data.map(function (d, i) {
                    return d.color || color(d, i);
                }).filter(function (d, i) {
                    return !data[i].disabled && data[i].bar
                }));
            lines2
                .width(availableWidth)
                .height(availableHeight2)
                .color(data.map(function (d, i) {
                    return d.color || color(d, i);
                }).filter(function (d, i) {
                    return !data[i].disabled && !data[i].bar
                }));

            var bars2Wrap = g.select('.nv-context .nv-barsWrap')
                .datum(dataBars.length ? dataBars : [
                    {values: []}
                ]);
            var lines2Wrap = g.select('.nv-context .nv-linesWrap')
                .datum(allDisabled(dataLines) ?
                       [{values: []}] :
                       dataLines.filter(function(dataLine) {
                         return !dataLine.disabled;
                       }));

            g.select('.nv-context')
                .attr('transform', 'translate(0,' + ( availableHeight1 + margin.bottom + margin2.top) + ')');

            bars2Wrap.transition().call(bars2);
            lines2Wrap.transition().call(lines2);

            // context (focus chart) axis controls
            if (focusShowAxisX) {
                x2Axis
                    ._ticks( nv.utils.calcTicksX(availableWidth / 100, data))
                    .tickSize(-availableHeight2, 0);
                g.select('.nv-context .nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y3.range()[0] + ')');
                g.select('.nv-context .nv-x.nv-axis').transition()
                    .call(x2Axis);
            }

            if (focusShowAxisY) {
                y3Axis
                    .scale(y3)
                    ._ticks( availableHeight2 / 36 )
                    .tickSize( -availableWidth, 0);
                y4Axis
                    .scale(y4)
                    ._ticks( availableHeight2 / 36 )
                    .tickSize(dataBars.length ? 0 : -availableWidth, 0); // Show the y2 rules only if y1 has none

                g.select('.nv-context .nv-y3.nv-axis')
                    .style('opacity', dataBars.length ? 1 : 0)
                    .attr('transform', 'translate(0,' + x2.range()[0] + ')');
                g.select('.nv-context .nv-y2.nv-axis')
                    .style('opacity', dataLines.length ? 1 : 0)
                    .attr('transform', 'translate(' + x2.range()[1] + ',0)');

                g.select('.nv-context .nv-y1.nv-axis').transition()
                    .call(y3Axis);
                g.select('.nv-context .nv-y2.nv-axis').transition()
                    .call(y4Axis);
            }

            // Setup Brush
            brush.x(x2).on('brush', onBrush);

            if (brushExtent) brush.extent(brushExtent);

            var brushBG = g.select('.nv-brushBackground').selectAll('g')
                .data([brushExtent || brush.extent()]);

            var brushBGenter = brushBG.enter()
                .append('g');

            brushBGenter.append('rect')
                .attr('class', 'left')
                .attr('x', 0)
                .attr('y', 0)
                .attr('height', availableHeight2);

            brushBGenter.append('rect')
                .attr('class', 'right')
                .attr('x', 0)
                .attr('y', 0)
                .attr('height', availableHeight2);

            var gBrush = g.select('.nv-x.nv-brush')
                .call(brush);
            gBrush.selectAll('rect')
                //.attr('y', -5)
                .attr('height', availableHeight2);
            gBrush.selectAll('.resize').append('path').attr('d', resizePath);

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });
                    state.disabled = e.disabled;
                }
                chart.update();
            });

            //============================================================
            // Functions
            //------------------------------------------------------------

            // Taken from crossfilter (http://square.github.com/crossfilter/)
            function resizePath(d) {
                var e = +(d == 'e'),
                    x = e ? 1 : -1,
                    y = availableHeight2 / 3;
                return 'M' + (.5 * x) + ',' + y
                    + 'A6,6 0 0 ' + e + ' ' + (6.5 * x) + ',' + (y + 6)
                    + 'V' + (2 * y - 6)
                    + 'A6,6 0 0 ' + e + ' ' + (.5 * x) + ',' + (2 * y)
                    + 'Z'
                    + 'M' + (2.5 * x) + ',' + (y + 8)
                    + 'V' + (2 * y - 8)
                    + 'M' + (4.5 * x) + ',' + (y + 8)
                    + 'V' + (2 * y - 8);
            }


            function updateBrushBG() {
                if (!brush.empty()) brush.extent(brushExtent);
                brushBG
                    .data([brush.empty() ? x2.domain() : brushExtent])
                    .each(function(d,i) {
                        var leftWidth = x2(d[0]) - x2.range()[0],
                            rightWidth = x2.range()[1] - x2(d[1]);
                        d3.select(this).select('.left')
                            .attr('width',  leftWidth < 0 ? 0 : leftWidth);

                        d3.select(this).select('.right')
                            .attr('x', x2(d[1]))
                            .attr('width', rightWidth < 0 ? 0 : rightWidth);
                    });
            }

            function onBrush() {
                brushExtent = brush.empty() ? null : brush.extent();
                extent = brush.empty() ? x2.domain() : brush.extent();
                dispatch.brush({extent: extent, brush: brush});
                updateBrushBG();

                // Prepare Main (Focus) Bars and Lines
                bars
                    .width(availableWidth)
                    .height(availableHeight1)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled && data[i].bar }));

                lines
                    .width(availableWidth)
                    .height(availableHeight1)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled && !data[i].bar }));

                var focusBarsWrap = g.select('.nv-focus .nv-barsWrap')
                    .datum(!dataBars.length ? [{values:[]}] :
                        dataBars
                            .map(function(d,i) {
                                return {
                                    key: d.key,
                                    values: d.values.filter(function(d,i) {
                                        return bars.x()(d,i) >= extent[0] && bars.x()(d,i) <= extent[1];
                                    })
                                }
                            })
                );

                var focusLinesWrap = g.select('.nv-focus .nv-linesWrap')
                    .datum(allDisabled(dataLines) ? [{values:[]}] :
                           dataLines
                           .filter(function(dataLine) { return !dataLine.disabled; })
                           .map(function(d,i) {
                                return {
                                    area: d.area,
                                    fillOpacity: d.fillOpacity,
                                    key: d.key,
                                    values: d.values.filter(function(d,i) {
                                        return lines.x()(d,i) >= extent[0] && lines.x()(d,i) <= extent[1];
                                    })
                                }
                            })
                );

                // Update Main (Focus) X Axis
                if (dataBars.length && !switchYAxisOrder) {
                    x = bars.xScale();
                } else {
                    x = lines.xScale();
                }

                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight1, 0);

                xAxis.domain([Math.ceil(extent[0]), Math.floor(extent[1])]);

                g.select('.nv-x.nv-axis').transition().duration(transitionDuration)
                    .call(xAxis);

                // Update Main (Focus) Bars and Lines
                focusBarsWrap.transition().duration(transitionDuration).call(bars);
                focusLinesWrap.transition().duration(transitionDuration).call(lines);

                // Setup and Update Main (Focus) Y Axes
                g.select('.nv-focus .nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y1.range()[0] + ')');

                y1Axis
                    .scale(y1)
                    ._ticks( nv.utils.calcTicksY(availableHeight1/36, data) )
                    .tickSize(-availableWidth, 0);
                y2Axis
                    .scale(y2)
                    ._ticks( nv.utils.calcTicksY(availableHeight1/36, data) )
                    .tickSize(dataBars.length ? 0 : -availableWidth, 0); // Show the y2 rules only if y1 has none

                // Calculate opacity of the axis
                var barsOpacity = dataBars.length ? 1 : 0;
                var linesOpacity = dataLines.length && !allDisabled(dataLines) ? 1 : 0;

                var y1Opacity = switchYAxisOrder ? linesOpacity : barsOpacity;
                var y2Opacity = switchYAxisOrder ? barsOpacity : linesOpacity;

                g.select('.nv-focus .nv-y1.nv-axis')
                    .style('opacity', y1Opacity);
                g.select('.nv-focus .nv-y2.nv-axis')
                    .style('opacity', y2Opacity)
                    .attr('transform', 'translate(' + x.range()[1] + ',0)');

                g.select('.nv-focus .nv-y1.nv-axis').transition().duration(transitionDuration)
                    .call(y1Axis);
                g.select('.nv-focus .nv-y2.nv-axis').transition().duration(transitionDuration)
                    .call(y2Axis);
            }

            onBrush();

        });

        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    lines.dispatch.on('elementMouseover.tooltip', function(evt) {
        tooltip
            .duration(100)
            .valueFormatter(function(d, i) {
                return getLinesAxis().main.tickFormat()(d, i);
            })
            .data(evt)
            .hidden(false);
    });

    lines.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true)
    });

    bars.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt.value = chart.x()(evt.data);
        evt['series'] = {
            value: chart.y()(evt.data),
            color: evt.color
        };
        tooltip
            .duration(0)
            .valueFormatter(function(d, i) {
                return getBarsAxis().main.tickFormat()(d, i);
            })
            .data(evt)
            .hidden(false);
    });

    bars.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    bars.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    //============================================================


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.legend = legend;
    chart.lines = lines;
    chart.lines2 = lines2;
    chart.bars = bars;
    chart.bars2 = bars2;
    chart.xAxis = xAxis;
    chart.x2Axis = x2Axis;
    chart.y1Axis = y1Axis;
    chart.y2Axis = y2Axis;
    chart.y3Axis = y3Axis;
    chart.y4Axis = y4Axis;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        brushExtent:    {get: function(){return brushExtent;}, set: function(_){brushExtent=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},
        focusEnable:    {get: function(){return focusEnable;}, set: function(_){focusEnable=_;}},
        focusHeight:    {get: function(){return focusHeight;}, set: function(_){focusHeight=_;}},
        focusShowAxisX:    {get: function(){return focusShowAxisX;}, set: function(_){focusShowAxisX=_;}},
        focusShowAxisY:    {get: function(){return focusShowAxisY;}, set: function(_){focusShowAxisY=_;}},
        legendLeftAxisHint:    {get: function(){return legendLeftAxisHint;}, set: function(_){legendLeftAxisHint=_;}},
        legendRightAxisHint:    {get: function(){return legendRightAxisHint;}, set: function(_){legendRightAxisHint=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        focusMargin: {get: function(){return margin2;}, set: function(_){
            margin2.top    = _.top    !== undefined ? _.top    : margin2.top;
            margin2.right  = _.right  !== undefined ? _.right  : margin2.right;
            margin2.bottom = _.bottom !== undefined ? _.bottom : margin2.bottom;
            margin2.left   = _.left   !== undefined ? _.left   : margin2.left;
        }},
        duration: {get: function(){return transitionDuration;}, set: function(_){
            transitionDuration = _;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
        }},
        x: {get: function(){return getX;}, set: function(_){
            getX = _;
            lines.x(_);
            lines2.x(_);
            bars.x(_);
            bars2.x(_);
        }},
        y: {get: function(){return getY;}, set: function(_){
            getY = _;
            lines.y(_);
            lines2.y(_);
            bars.y(_);
            bars2.y(_);
        }},
        switchYAxisOrder:    {get: function(){return switchYAxisOrder;}, set: function(_){
            // Switch the tick format for the yAxis
            if(switchYAxisOrder !== _) {
                var tickFormat = y1Axis.tickFormat();
                y1Axis.tickFormat(y2Axis.tickFormat());
                y2Axis.tickFormat(tickFormat);
            }
            switchYAxisOrder=_;
        }}
    });

    nv.utils.inheritOptions(chart, lines);
    nv.utils.initOptions(chart);

    return chart;
};

nv.models.multiBar = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , x = d3.scale.ordinal()
        , y = d3.scale.linear()
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , forceY = [0] // 0 is forced by default.. this makes sense for the majority of bar graphs... user can always do chart.forceY([]) to remove
        , clipEdge = true
        , stacked = false
        , stackOffset = 'zero' // options include 'silhouette', 'wiggle', 'expand', 'zero', or a custom function
        , color = nv.utils.defaultColor()
        , hideable = false
        , barColor = null // adding the ability to set the color for each rather than the whole group
        , disabled // used in conjunction with barColor to communicate from multiBarHorizontalChart what series are disabled
        , duration = 0
        , xDomain
        , yDomain
        , xRange
        , yRange
        , groupSpacing = 0.2
        , barWidth = 30
        , refBars = false
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        , interactive = true
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0 //used to store previous scales
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        ;

    var last_datalength = 0;

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);
            var nonStackableCount = 0;
            // This function defines the requirements for render complete
            var endFn = function(d, i) {
                if (d.series === data.length - 1 && i === data[0].values.length - 1)
                    return true;
                return false;
            };

            if(hideable && data.length) hideable = [{
                values: data[0].values.map(function(d) {
                        return {
                            x: d.x,
                            y: 0,
                            series: d.series,
                            size: 0.01
                        };}
                )}];

            if (stacked) {
                var parsed = d3.layout.stack()
                    .offset(stackOffset)
                    .values(function(d){ return d.values })
                    .y(getY)
                (!data.length && hideable ? hideable : data);

                parsed.forEach(function(series, i){
                    // if series is non-stackable, use un-parsed data
                    if (series.nonStackable) {
                        data[i].nonStackableSeries = nonStackableCount++;
                        parsed[i] = data[i];
                    } else {
                        // don't stack this seires on top of the nonStackable seriees
                        if (i > 0 && parsed[i - 1].nonStackable){
                            parsed[i].values.map(function(d,j){
                                d.y0 -= parsed[i - 1].values[j].y;
                                d.y1 = d.y0 + d.y;
                            });
                        }
                    }
                });
                data = parsed;
            }
            //add series index and key to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                    point.key = series.key;
                });
            });

            // HACK for negative value stacking
            if (stacked) {
                data[0].values.map(function(d,i) {
                    var posBase = 0, negBase = 0;
                    data.map(function(d, idx) {
                        if (!data[idx].nonStackable) {
                            var f = d.values[i]
                            f.size = Math.abs(f.y);
                            if (f.y<0)  {
                                f.y1 = negBase;
                                negBase = negBase - f.size;
                            } else
                            {
                                f.y1 = f.size + posBase;
                                posBase = posBase + f.size;
                            }
                        }

                    });
                });
            }
            // Setup Scales
            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = /*(xDomain && yDomain) ? [] :*/ // if we know xDomain and yDomain, no need to calculate
                data.map(function(d, idx) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: getY(d,i), y0: d.y0, y1: d.y1, idx:idx }
                    })
                });

            var dps = (seriesData && seriesData.length > 0 ? seriesData[0].map(function(d){ return d.x;}) : []).sort(),
                threshold = 0;

            for ( var i = 1 ; i < dps.length ; i++ ){
                if ( i === 1 ){
                    threshold = dps[i] - dps[i-1];
                }
                else {
                    threshold = Math.min(threshold, dps[i] - dps[i - 1]);
                }
            }

            x.domain(xDomain || dps );
            x.rangeBands ? x.rangeBands(xRange || [0, availableWidth], groupSpacing) : x.range(xRange || [0, availableWidth]);

            var availableBarsWidth = x.rangeBand ? x.rangeBand() : (1.0 - (groupSpacing > 0 && groupSpacing < 1.0 ? groupSpacing : 0.0 )) * Math.min(x(x.domain()[0] + threshold) - x(x.domain()[0]), barWidth*seriesData.length);

            y.domain(yDomain || d3.extent(d3.merge(seriesData).map(function(d) {
                var domain = d.y;
                // increase the domain range if this series is stackable
                if (stacked && !data[d.idx].nonStackable) {
                    if (d.y > 0){
                        domain = d.y1
                    } else {
                        domain = d.y1 + d.y
                    }
                }
                return domain;
            }).concat(forceY)))
            .range(yRange || [availableHeight, 0]);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] + y.domain()[0] * 0.01, y.domain()[1] - y.domain()[1] * 0.01])
                    : y.domain([-1,1]);

            x0 = x0 || x;
            y0 = y0 || y;

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-multibar').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-multibar');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-groups');
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + id)
                .append('rect');
            wrap.select('#nv-edge-clip-' + id + ' rect')
                .attr('width', availableWidth + availableBarsWidth)
                .attr('height', availableHeight > 0 ? availableHeight+50 : 0)
                .attr('y', (availableHeight > 0) ? -50 : 0);

            g.attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + id + ')' : '');

            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d,i) { return i });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);

            var exitTransition = renderWatch
                .transition(groups.exit().selectAll('rect.nv-bar'), 'multibarExit', Math.min(100, duration))
                .attr('y', function(d, i, j) {
                    var yVal = y0(0) || 0;
                    if (stacked) {
                        if (data[d.series] && !data[d.series].nonStackable) {
                            yVal = y0(d.y0);
                        }
                    }
                    return yVal;
                })
                .attr('height', 0)
                .remove();
            if (exitTransition.delay)
                exitTransition.delay(function(d,i) {
                    var delay = i * (duration / (last_datalength + 1)) - i;
                    return delay;
                });
            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover })
                .style('fill', function(d,i){ return color(d, i) })
                .style('stroke', function(d,i){ return color(d, i) });
            groups
                .style('stroke-opacity', 1)
                .style('fill-opacity', 0.75);

            var bars = groups.selectAll('rect.nv-bar')
                .data(function(d) { return (hideable && !data.length) ? hideable.values : d.values });
            bars.exit().remove();

            // i'm here
            var step = dps.length > 0 ? dps[1] - dps[0] : 0;

            var barsEnter = bars.enter().append('rect')
                    .attr('class', function(d,i) { return getY(d,i) < 0 ? 'nv-bar negative' : 'nv-bar positive'})
                    .attr('x', function(d,i,j) {
                        return stacked && !data[j].nonStackable ? 0 : (j * availableWidth / data.length )
                    })
                    .attr('y', function(d,i,j) { return y0(stacked && !data[j].nonStackable ? d.y0 : 0) || 0 })
                    .attr('height', 0)
                    .attr('width', function(d,i,j) { return availableBarsWidth / (stacked && !data[j].nonStackable ? 1 : data.length)})
                    .attr('transform', function(d,i) { return 'translate(' + x(getX(d,i)) + ',0)'; })
                ;
            bars
                .style('fill', function(d,i,j){ return color(d, j, i);  })
                .style('stroke', function(d,i,j){ return color(d, j, i); })
                .on('mouseover', function(d,i) { //TODO: figure out why j works above, but not here
                    if (!interactive) return;
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mouseout', function(d,i) {
                    if (!interactive) return;
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mousemove', function(d,i) {
                    if (!interactive) return;
                    dispatch.elementMousemove({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('click', function(d,i) {
                    if (!interactive) return;
                    var element = this;
                    dispatch.elementClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill"),
                        event: d3.event,
                        element: element,
                        step: step,
                        series: data[d.series]
                    });
                    d3.event.stopPropagation();
                })
                .on('dblclick', function(d,i) {
                    if (!interactive) return;
                    dispatch.elementDblClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill"),
                        step: step,
                        series: data[d.series]
                    });
                    d3.event.stopPropagation();
                });

            bars
                .attr('class', function(d,i) { return getY(d,i) < 0 ? 'nv-bar negative' : 'nv-bar positive'})
                .attr('transform', function(d,i) { return 'translate(' + x(getX(d,i)) + ',0)'; })
                .classed('nv-bar-ref', refBars);

            if (barColor) {
                if (!disabled) disabled = data.map(function() { return true });

                bars
                    .style('fill', function (d, i, j) {
                        return d3.rgb(barColor(d, i))/*.darker(disabled.map(function (d, i) {
                            return i
                        }).filter(function (d, i) {
                            return !disabled[i]
                        })[j])*/.toString();
                    })
                    .style('stroke', function (d, i, j) {
                        return d3.rgb(barColor(d, i))/*.darker(disabled.map(function (d, i) {
                            return i
                        }).filter(function (d, i) {
                            return !disabled[i]
                        })[j])*/.toString();
                    });
            }

            var barSelection =
                bars.watchTransition(renderWatch, 'multibar', Math.min(250, duration))
                    /*.delay(function(d,i) {
                        return i * duration / data[0].values.length;
                    })*/;

            if (stacked){
                barSelection
                    .attr('y', function(d,i,j) {
                        var yVal = 0;
                        // if stackable, stack it on top of the previous series
                        if (!data[j].nonStackable) {
                            yVal = y(d.y1);
                        } else {
                            if (getY(d,i) < 0){
                                yVal = y(0);
                            } else {
                                if (y(0) - y(getY(d,i)) < -1){
                                    yVal = y(0) - 1;
                                } else {
                                    yVal = y(getY(d, i)) || 0;
                                }
                            }
                        }
                        return yVal;
                    })
                    .attr('height', function(d,i,j) {
                        if (!data[j].nonStackable) {
                            return Math.max(Math.abs(y(d.y+d.y0) - y(d.y0)), 0);
                        } else {
                            return Math.max(Math.abs(y(getY(d,i)) - y(0)), 0) || 0;
                        }
                    })
                    .attr('x', function(d,i,j) {
                        var width = 0;
                        if (data[j].nonStackable) {
                            width = d.series * barWidth / data.length;
                            if (data.length !== nonStackableCount){
                                width = data[j].nonStackableSeries * barWidth /(nonStackableCount*2);
                            }
                        }
                        return width;
                    })
                    .attr('width', function(d,i,j){
                        if (!data[j].nonStackable) {
                            return barWidth;
                        } else {
                            // if all series are nonStacable, take the full width
                            var width = (barWidth / nonStackableCount);
                            // otherwise, nonStackable graph will be only taking the half-width of the x rangeBand
                            if (data.length !== nonStackableCount) {
                                width = barWidth/(nonStackableCount*2);
                            }
                            return width;
                        }
                    });
            }
            else {

                barSelection
                    .attr('x', function(d,i) {
                        return d.series * availableBarsWidth / data.length;
                    })
                    .attr('width', refBars ? 6 : availableBarsWidth / data.length)
                    .attr('y', function(d,i) {
                        return getY(d,i) < 0 ?
                            y(0) :
                            y(0) - y(getY(d,i)) < 1 ? y(0) - 1 : y(getY(d,i)) || 0;
                    })
                    .attr('height', function(d,i) {
                        return Math.max(Math.abs(y(getY(d,i)) - y(0)),1) || 0;
                    });
            }

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

            // keep track of the last data value length for transition calculations
            if (data[0] && data[0].values) {
                last_datalength = data[0].values.length;
            }

        });

        renderWatch.renderEnd('multibar immediate');

        return chart;
    }

    //Create methods to allow outside functions to highlight a specific bar.
    chart.highlightPoint = function(pointIndex, isHoverOver) {
        container
            .select(".nv-bars .nv-bar-0-" + pointIndex)
            .classed("hover", isHoverOver)
        ;
    };

    chart.clearHighlights = function() {
        container
            .select(".nv-bars .nv-bar.hover")
            .classed("hover", false)
        ;
    };

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:   {get: function(){return width;}, set: function(_){width=_;}},
        height:  {get: function(){return height;}, set: function(_){height=_;}},
        x:       {get: function(){return getX;}, set: function(_){getX=_;}},
        y:       {get: function(){return getY;}, set: function(_){getY=_;}},
        xScale:  {get: function(){return x;}, set: function(_){x=_;}},
        yScale:  {get: function(){return y;}, set: function(_){y=_;}},
        xDomain: {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain: {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:  {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:  {get: function(){return yRange;}, set: function(_){yRange=_;}},
        forceY:  {get: function(){return forceY;}, set: function(_){forceY=_;}},
        stacked: {get: function(){return stacked;}, set: function(_){stacked=_;}},
        stackOffset: {get: function(){return stackOffset;}, set: function(_){stackOffset=_;}},
        clipEdge:    {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},
        disabled:    {get: function(){return disabled;}, set: function(_){disabled=_;}},
        id:          {get: function(){return id;}, set: function(_){id=_;}},
        hideable:    {get: function(){return hideable;}, set: function(_){hideable=_;}},
        groupSpacing:{get: function(){return groupSpacing;}, set: function(_){groupSpacing=_;}},
        barWidth:{get: function(){return barWidth;}, set: function(_){barWidth=_;}},
        refBars:{get: function(){return refBars;}, set: function(_){refBars=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        barColor:  {get: function(){return barColor;}, set: function(_){
            barColor = _ ? nv.utils.getColor(_) : null;
        }},
        interactive: {get: function(){return interactive;}, set: function(_){interactive=_;}},
    });

    nv.utils.initOptions(chart);

    return chart;
};nv.models.multiBarChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var multibar = nv.models.multiBar()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , interactiveLayer = nv.interactiveGuideline()
        , legend = nv.models.legend()
        , controls = nv.models.legend()
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , showControls = true
        , controlLabels = {}
        , showLegend = true
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , reduceXTicks = true // if false a tick will show for every data point
        , staggerLabels = false
        , wrapLabels = false
        , rotateLabels = 0
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('stateChange', 'changeState', 'renderEnd')
        , controlWidth = function() { return showControls ? 180 : 0 }
        , duration = 250
        , useInteractiveGuideline = false
        ;

    state.stacked = false // DEPRECATED Maintained for backward compatibility

    multibar.stacked(false);
    xAxis
        .orient('bottom')
        .tickPadding(7)
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickFormat(d3.format(',.1f'))
    ;

    tooltip
        .duration(0)
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        })
        .headerFormatter(function(d, i) {
            return xAxis.tickFormat()(d, i);
        });

    controls.updateState(false);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    var stacked = false;

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled }),
                stacked: stacked
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.stacked !== undefined)
                stacked = state.stacked;
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(multibar);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0)
                    container.call(chart);
                else
                    container.transition()
                        .duration(duration)
                        .call(chart);
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display noData message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = multibar.xScale();
            y = multibar.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-multiBarWithLegend').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-multiBarWithLegend').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-barsWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');
            gEnter.append('g').attr('class', 'nv-interactive');

            // Legend
            if (showLegend) {
                legend.width(availableWidth - controlWidth());

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.nv-legendWrap')
                    .attr('transform', 'translate(' + controlWidth() + ',' + (-margin.top) +')');
            }

            // Controls
            if (showControls) {
                var controlsData = [
                    { key: controlLabels.grouped || 'Grouped', disabled: multibar.stacked() },
                    { key: controlLabels.stacked || 'Stacked', disabled: !multibar.stacked() }
                ];

                controls.width(controlWidth()).color(['#444', '#444', '#444']);
                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
                    .call(controls);
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            // Main Chart Component(s)
            multibar
                .disabled(data.map(function(series) { return series.disabled }))
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }));


            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }));

            barsWrap.call(multibar);

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')');
                g.select('.nv-x.nv-axis')
                    .call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis > g').selectAll('g');

                xTicks
                    .selectAll('line, text')
                    .style('opacity', 1)

                if (staggerLabels) {
                    var getTranslate = function(x,y) {
                        return "translate(" + x + "," + y + ")";
                    };

                    var staggerUp = 5, staggerDown = 17;  //pixels to stagger by
                    // Issue #140
                    xTicks
                        .selectAll("text")
                        .attr('transform', function(d,i,j) {
                            return  getTranslate(0, (j % 2 == 0 ? staggerUp : staggerDown));
                        });

                    var totalInBetweenTicks = d3.selectAll(".nv-x.nv-axis .nv-wrap g g text")[0].length;
                    g.selectAll(".nv-x.nv-axis .nv-axisMaxMin text")
                        .attr("transform", function(d,i) {
                            return getTranslate(0, (i === 0 || totalInBetweenTicks % 2 !== 0) ? staggerDown : staggerUp);
                        });
                }

                if (wrapLabels) {
                    g.selectAll('.tick text')
                        .call(nv.utils.wrapTicks, chart.xAxis.rangeBand())
                }

                if (reduceXTicks)
                    xTicks
                        .filter(function(d,i) {
                            return i % Math.ceil(data[0].values.length / (availableWidth / 100)) !== 0;
                        })
                        .selectAll('text, line')
                        .style('opacity', 0);

                if(rotateLabels)
                    xTicks
                        .selectAll('.tick text')
                        .attr('transform', 'rotate(' + rotateLabels + ' 0,0)')
                        .style('text-anchor', rotateLabels > 0 ? 'start' : 'end');

                g.select('.nv-x.nv-axis').selectAll('g.nv-axisMaxMin text')
                    .style('opacity', 1);
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .call(yAxis);
            }

            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left:margin.left, top:margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            controls.dispatch.on('legendClick', function(d,i) {
                if (!d.disabled) return;
                controlsData = controlsData.map(function(s) {
                    s.disabled = true;
                    return s;
                });
                d.disabled = false;

                switch (d.key) {
                    case 'Grouped':
                    case controlLabels.grouped:
                        multibar.stacked(false);
                        break;
                    case 'Stacked':
                    case controlLabels.stacked:
                        multibar.stacked(true);
                        break;
                }

                state.stacked = multibar.stacked();
                dispatch.stateChange(state);
                chart.update();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });
                    state.disabled = e.disabled;
                }
                if (typeof e.stacked !== 'undefined') {
                    multibar.stacked(e.stacked);
                    state.stacked = e.stacked;
                    stacked = e.stacked;
                }
                chart.update();
            });

            if (useInteractiveGuideline) {
                interactiveLayer.dispatch.on('elementMousemove', function(e) {
                    if (e.pointXValue == undefined) return;

                    var singlePoint, pointIndex, pointXLocation, xValue, allData = [];
                    data
                        .filter(function(series, i) {
                            series.seriesIndex = i;
                            return !series.disabled;
                        })
                        .forEach(function(series,i) {
                            pointIndex = x.domain().indexOf(e.pointXValue)

                            var point = series.values[pointIndex];
                            if (point === undefined) return;

                            xValue = point.x;
                            if (singlePoint === undefined) singlePoint = point;
                            if (pointXLocation === undefined) pointXLocation = e.mouseX
                            allData.push({
                                key: series.key,
                                value: chart.y()(point, pointIndex),
                                color: color(series,series.seriesIndex),
                                data: series.values[pointIndex]
                            });
                        });

                    interactiveLayer.tooltip
                        .chartContainer(that.parentNode)
                        .data({
                            value: xValue,
                            index: pointIndex,
                            series: allData
                        })();

                    interactiveLayer.renderGuideLine(pointXLocation);
                });

                interactiveLayer.dispatch.on("elementMouseout",function(e) {
                    interactiveLayer.tooltip.hidden(true);
                });
            }
            else {
                multibar.dispatch.on('elementMouseover.tooltip', function(evt) {
                    evt.value = chart.x()(evt.data);
                    evt['series'] = {
                        key: evt.data.key,
                        value: chart.y()(evt.data),
                        color: evt.color
                    };
                    tooltip.data(evt).hidden(false);
                });

                multibar.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true);
                });

                multibar.dispatch.on('elementMousemove.tooltip', function(evt) {
                    tooltip();
                });
            }
        });

        renderWatch.renderEnd('multibarchart immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.multibar = multibar;
    chart.legend = legend;
    chart.controls = controls;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.state = state;
    chart.tooltip = tooltip;
    chart.interactiveLayer = interactiveLayer;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        showControls: {get: function(){return showControls;}, set: function(_){showControls=_;}},
        controlLabels: {get: function(){return controlLabels;}, set: function(_){controlLabels=_;}},
        showXAxis:      {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:    {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},
        reduceXTicks:    {get: function(){return reduceXTicks;}, set: function(_){reduceXTicks=_;}},
        rotateLabels:    {get: function(){return rotateLabels;}, set: function(_){rotateLabels=_;}},
        staggerLabels:    {get: function(){return staggerLabels;}, set: function(_){staggerLabels=_;}},
        wrapLabels:   {get: function(){return wrapLabels;}, set: function(_){wrapLabels=!!_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            multibar.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
            renderWatch.reset(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( rightAlignYAxis ? 'right' : 'left');
        }},
        useInteractiveGuideline: {get: function(){return useInteractiveGuideline;}, set: function(_){
            useInteractiveGuideline = _;
        }},
        barColor:  {get: function(){return multibar.barColor;}, set: function(_){
            multibar.barColor(_);
            legend.color(function(d,i) {return d3.rgb('#ccc').darker(i * 1.5).toString();})
        }}
    });

    nv.utils.inheritOptions(chart, multibar);
    nv.utils.initOptions(chart);

    return chart;
};

nv.models.multiBarHorizontal = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , rectWidthMin = 50
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , x = d3.scale.ordinal()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , getYerr = function(d) { return d.yErr }
        , forceY = [0] // 0 is forced by default.. this makes sense for the majority of bar graphs... user can always do chart.forceY([]) to remove
        , color = nv.utils.defaultColor()
        , href = null
        , barWidth = null
        , barColor = null // adding the ability to set the color for each rather than the whole group
        , disabled // used in conjunction with barColor to communicate from multiBarHorizontalChart what series are disabled
        , stacked = false
        , showValues = false
        , negateTrend = false
        , showBarLabels = true
        , showChecks = false
        , valuePadding = 60
        , groupSpacing = 0.1
        , valueFormat = d3.format(',.2f')
        , refFormat = function(v){ return v ? d3.format('.1f')(100.0 * v) + '%' : ''; }
        , keyFormat = function(d){ return d; }
        , delay = 1200
        , xDomain
        , yDomain
        , xRange
        , yRange
        , duration = 250
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0; //used to store previous scales
    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            if (stacked)
                data = d3.layout.stack()
                    .offset('zero')
                    .values(function(d){ return d.values })
                    .y(getY)
                (data);

            //add series index and key to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                    point.key = series.key;
                });
            });

            // HACK for negative value stacking
            if (stacked)
                data[0].values.map(function(d,i) {
                    var posBase = 0, negBase = 0;
                    data.map(function(d) {
                        var f = d.values[i]
                        f.size = Math.abs(f.y);
                        if (f.y<0)  {
                            f.y1 = negBase - f.size;
                            negBase = negBase - f.size;
                        } else
                        {
                            f.y1 = posBase;
                            posBase = posBase + f.size;
                        }
                    });
                });

            // Setup Scales
            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = (xDomain && yDomain) ? [] : // if we know xDomain and yDomain, no need to calculate
                data.map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d,i), y: Math.max(getY(d,i), d.previous ? getY(d.previous,i) : 0), y0: d.y0, y1: d.y1 }
                    })
                });

            x.domain(xDomain || d3.merge(seriesData).map(function(d) { return d.x }))
                .rangeBands(xRange || [0, availableHeight], groupSpacing, 0);

            y.domain(yDomain || d3.extent(d3.merge(seriesData).map(function(d) { return stacked ? (d.y > 0 ? d.y1 + d.y : d.y1 ) : d.y }).concat(forceY)))

            if (showValues && !stacked)
                y.range(yRange || [(y.domain()[0] < 0 ? valuePadding : 0), availableWidth - (y.domain()[1] > 0 ? valuePadding : 0) ]);
            else
                y.range(yRange || [0, availableWidth]);

            x0 = x0 || x;
            y0 = y0 || d3.scale.linear().domain(y.domain()).range([y(0),y(0)]);

            // Setup containers and skeleton of chart
            var wrap = d3.select(this).selectAll('g.nv-wrap.nv-multibarHorizontal').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-multibarHorizontal');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-groups');
            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d,i) { return i });
            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);
            groups.exit().watchTransition(renderWatch, 'multibarhorizontal: exit groups')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6)
                .remove();
            groups
                .attr('class', function(d,i) { return 'nv-group nv-series-' + i })
                .classed('hover', function(d) { return d.hover })
                .style('fill', function(d,i){ return color(d, i) })
                .style('stroke', function(d,i){ return color(d, i) });
            groups.watchTransition(renderWatch, 'multibarhorizontal: groups')
                .style('stroke-opacity', 1)
                .style('fill-opacity', .75);

            var barRefs = groups.selectAll('g.nv-bar-ref')
                .data(function(d) { return d.values });
            barRefs.exit().remove();

            var barRefsEnter = barRefs.enter()
                .append('g')
                .classed('nv-bar-ref', true)
                .attr('transform', function(d,i,j) {
                    return 'translate(' + y0(stacked ? d.y0 : 0) + ',' + (stacked ? 0 : ((j) * barWidth )/* + x(getX(d,i))*/) + ')'
                });

            barRefsEnter
                .filter(function(d){ return d.previous; })
                .append('rect')
                .attr('width', 0)
                .attr('y', barWidth - 6 )
                .attr('height', 6 );

            barRefsEnter
                .filter(function(d){ return d.previous; })
                .append('svg:title')
                .text(function(d,i) { return getY(d.previous,i); });

            if (barColor) {
                if (!disabled) disabled = data.map(function() { return true });
                barRefs
                    .style('fill', function(d,i,j) {
                        // return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString();
                        return '#c4ced4';
                    })
                    .style('stroke', function(d,i,j) {
                        // return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString();
                        return '#c4ced4';
                    });
            }

            if (showValues) {
                barRefsEnter.filter(function (d) { return d.previous; })
                    .append('text').classed('nv-bar-ref-value', true);

                barRefs.select('text.nv-bar-ref-value')
                    .attr('text-anchor', function (d, i) {
                        return getY(d, i) < 0 ? 'end' : 'start'
                    })
                    .attr('y', barWidth && barWidth/2 || 15)
                    .attr('dy', '0.32em')
                    .classed('positive', function (d, i) {
                        var v = getY(d, i),
                            b = getY(d.previous, i);

                        return negateTrend ? v < b : v > b;
                    })
                    .classed('negative', function (d, i) {
                        var v = getY(d, i),
                            b = getY(d.previous, i);

                        return negateTrend ? v > b : v < b;
                    })
                    .text(function (d, i) {
                        var v = getY(d, i),
                            b = getY(d.previous, i);

                        var t = refFormat(b > 0 ? (v - b) / b : null)
                            , yerr = getYerr(d, i);
                        if (yerr === undefined)
                            return t;
                        if (!yerr.length)
                            return t + '±' + valueFormat(Math.abs(yerr));
                        return t + '+' + valueFormat(Math.abs(yerr[1])) + '-' + valueFormat(Math.abs(yerr[0]));
                    });

                barRefs.watchTransition(renderWatch, 'multibarhorizontal: bars')
                    .select('text.nv-bar-ref-value')
                    .attr('x', function (d, i) {
                        return Math.max(50, y(getY(d, i))) + 4
                    });

            }


            var watch2 = barRefs.watchTransition(renderWatch, 'multibarhorizontal: bars')
                .filter(function(d){ return d.previous; })
                .attr('transform', function (d, i) {
                    //TODO: stacked must be all positive or all negative, not both?
                    return 'translate(' +
                        (getY(d.previous, i) < 0 ? y(getY(d.previous, i)) : y(0))
                        + ',' +
                        ((d.series) * barWidth + x(getX(d, i)) )
                        + ')'
                });

            watch2
                .select('rect')
                /*.attr('height', barWidth /!*|| x.rangeBand() / data.length*!/)*/
                .attr('width', function (d, i) {
                    return Math.max(Math.abs(y(getY(d.previous, i)) - y(0)), 1) || 0
                });


            var bars = groups.selectAll('g.nv-bar')
                .data(function(d) { return d.values });
            bars.exit().remove();

            var barsEnter = bars.enter().append('g')
                .attr('transform', function(d,i,j) {
                    return 'translate(' + y0(stacked ? d.y0 : 0) + ',' + (stacked ? 0 : (j * 3.33 * barWidth )/* + x(getX(d,i))*/) + ')'
                });

            barsEnter.append('rect')
                .attr('width', 0)
                .attr('height', barWidth || x.rangeBand() / (stacked ? 1 : data.length) );

            barsEnter.append('svg:title')
                .text(function(d,i) { return getX(d,i); });

            if ( showChecks ) {
                barsEnter.filter(function(d,i,j){
                    return j === 0;
                }).append('path')
                    .attr('class', 'nv-check')
                    .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
            }

            bars
                .on('mouseover', function(d,i) { //TODO: figure out why j works above, but not here
                    d3.select(this).classed('hover', true);
                    dispatch.elementMouseover({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mouseout', function(d,i) {
                    d3.select(this).classed('hover', false);
                    dispatch.elementMouseout({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mouseout', function(d,i) {
                    dispatch.elementMouseout({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mousemove', function(d,i) {
                    dispatch.elementMousemove({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('click', function(d,i) {
                    d.selected = !d.selected;
                    d3.select(this).classed('selected', d.selected);
                    dispatch.elementClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                    d3.event.stopPropagation();
                })
                .on('dblclick', function(d,i) {
                    dispatch.elementDblClick({
                        data: d,
                        index: i,
                        color: d3.select(this).style("fill")
                    });
                    d3.event.stopPropagation();
                });

            if (getYerr(data[0],0)) {
                barsEnter.append('polyline');

                bars.select('polyline')
                    .attr('fill', 'none')
                    .attr('points', function(d,i) {
                        var xerr = getYerr(d,i)
                            , mid = 0.8 * x.rangeBand() / ((stacked ? 1 : data.length) * 2);
                        xerr = xerr.length ? xerr : [-Math.abs(xerr), Math.abs(xerr)];
                        xerr = xerr.map(function(e) { return y(e) - y(0); });
                        var a = [[xerr[0],-mid], [xerr[0],mid], [xerr[0],0], [xerr[1],0], [xerr[1],-mid], [xerr[1],mid]];
                        return a.map(function (path) { return path.join(',') }).join(' ');
                    })
                    .attr('transform', function(d,i) {
                        var mid = x.rangeBand() / ((stacked ? 1 : data.length) * 2);
                        return 'translate(' + (getY(d,i) < 0 ? 0 : y(getY(d,i)) - y(0)) + ', ' + mid + ')'
                    });
            }



            if (showValues /*&& !stacked*/) {
                barsEnter.append('text').classed('nv-bar-value', true);
                bars.select('text.nv-bar-value')
                    .attr('text-anchor', function(d,i) { return getY(d,i) < 0 ? 'end' : 'start' })
                    .attr('y', barWidth && barWidth/2 || x.rangeBand() / (data.length * 2))
                    .attr('dy', '.32em')
                    .text(function(d,i) {
                        var t = valueFormat(getY(d,i))
                            , yerr = getYerr(d,i);
                        if (yerr === undefined)
                            return t;
                        if (!yerr.length)
                            return t + '±' + valueFormat(Math.abs(yerr));
                        return t + '+' + valueFormat(Math.abs(yerr[1])) + '-' + valueFormat(Math.abs(yerr[0]));
                    });
                bars.watchTransition(renderWatch, 'multibarhorizontal: bars')
                    .select('text.nv-bar-value')
                    .attr('x', function(d,i) { return getY(d,i) < 0 ? y(0) -y(getY(d,i)) - 4 : + 4 });



            } else {
                bars.selectAll('text.nv-bar-value').remove();
                bars.selectAll('text.nv-bar-ref-value').remove();
            }

            if (showBarLabels /*&& !stacked*/) {

                if (href && typeof href === 'function') {
                    var a = barsEnter.filter(function(d,i,j){
                        return j === 0;
                    }).append('a').attr('class', 'nv-href').attr('xlink:href', function (d) {
                            return href(d);
                        });

                    a.append('text').classed('nv-bar-label', true);

                    a.on('mouseover', function (d, i) {
                        d3.event.stopPropagation();
                        d3.event.preventDefault();

                        //d3.select(this).classed('hover', true).style('opacity', 0.8);
                        dispatch.elementMouseout({
                            data: d
                        });

                    });

                    /*a.append('path').attr('d', 'M 10 6 L 8.59 7.41 L 13.17 12 l -4.58 4.59 L 10 18 l 6 -6 Z');*/
                }
                else {
                    barsEnter.filter(function(d,i,j){
                        return j === 0;
                    }).append('text').classed('nv-bar-label', true);
                }

                bars.select('text.nv-bar-label')
                    .attr('text-anchor', function(d,i) { return (getY(d,i) > 0) ? 'start' : 'end' })
                    .attr('y', /*(stacked? 1.33 : 0.5)*/ (data.length + 0.33) * barWidth /*|| x.rangeBand() / (data.length * 2)*/)
                    .attr('dy', '.32em')
                    .text(function(d,i) { return keyFormat(getX(d,i)) });

                {
                    bars
                        .watchTransition(renderWatch, 'multibarhorizontal: bars')
                        .select('text.nv-bar-label')
                        .attr('x', function (d, i) {
                            if ( stacked ) {
                                return getY(d, i) < 0 ? Math.abs(y(getY(d,i) + d.y0) - y(d.y0)) || 0 : 0;
                            }

                            return 0; // getY(d, i) < 0 ? y(0) - y(getY(d, i)) + 4 : -4;
                        });
                }


                if ( stacked ) {
                    bars.filter(function (d) {
                        return d.series > 0;
                    }).select('text.nv-bar-label').remove();
                }
            }
            else {
                bars.selectAll('text.nv-bar-label').remove();
            }

            bars
                .attr('class', function(d,i) { return (negateTrend ? getY(d,i) > 0 : getY(d,i) < 0)  ? 'nv-bar negative' : 'nv-bar positive'});

            bars.classed('selected', function(d,i){ return d.selected; });

            if (barColor) {
                if (!disabled) disabled = data.map(function() { return true });
                bars
                    .style('fill', function(d,i,j) { return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString(); })
                    .style('stroke', function(d,i,j) { return d3.rgb(barColor(d,i)).darker(  disabled.map(function(d,i) { return i }).filter(function(d,i){ return !disabled[i]  })[j]   ).toString(); });
            }

            if (stacked) {
                var watch = bars.watchTransition(renderWatch, 'multibarhorizontal: bars')
                    .attr('transform', function (d, i) {
                        return 'translate(' + y(d.y1) + ',' + x(getX(d, i)) + ')'
                    });

                watch.select('rect')
                    .attr('width', _rectWidthStacked)
                    .attr('height', barWidth || x.rangeBand());

                watch.select('rect.nv-ref')
                    .attr('width', _rectWidthStacked)
                    .attr('height', barWidth || x.rangeBand());

                if ( showChecks ) {
                    watch.select('path.nv-check')
                        .attr('transform', function (d, i) {
                            var width = Math.abs(y(getY(d, i) + d.y0) - y(d.y0)),
                                height = barWidth || x.rangeBand();
                            return 'translate(' + (width - 27) + ',' + (height - 24) / 2 + ' )';
                        });
                }
            }
            else {

                var watch = bars.watchTransition(renderWatch, 'multibarhorizontal: bars')
                    .attr('transform', function (d, i) {
                        //TODO: stacked must be all positive or all negative, not both?
                        return 'translate(' +
                            (getY(d, i) < 0 ? y(getY(d, i)) : y(0))
                            + ',' +
                            (d.series * barWidth + x(getX(d, i)) )
                            + ')'
                    });

                watch
                    .select('rect')
                    .attr('height', barWidth /*|| x.rangeBand() / data.length*/)
                    .attr('width', _rectWidth);

                if ( showChecks ) {
                    watch.select('path.nv-check')
                        .attr('transform', function (d, i) {
                            var width = _rectWidth(d,i),
                                height = barWidth || x.rangeBand() / data.length;
                            return 'translate(' + (width - 20) + ',' + (height - 20) / 2 + ' )';
                        });
                }

            }

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

        });

        renderWatch.renderEnd('multibarHorizontal immediate');
        return chart;
    }

    function _rectWidth(d, i) {
        return Math.max(Math.abs(y(getY(d, i)) - y(0)), rectWidthMin) || 0;
    }

    function _rectWidthStacked(d, i) {
        return Math.max(Math.abs(y(getY(d, i) + d.y0) - y(d.y0)), rectWidthMin) || 0;
    }


    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:   {get: function(){return width;}, set: function(_){width=_;}},
        height:  {get: function(){return height;}, set: function(_){height=_;}},
        x:       {get: function(){return getX;}, set: function(_){getX=_;}},
        y:       {get: function(){return getY;}, set: function(_){getY=_;}},
        yErr:       {get: function(){return getYerr;}, set: function(_){getYerr=_;}},
        xScale:  {get: function(){return x;}, set: function(_){x=_;}},
        yScale:  {get: function(){return y;}, set: function(_){y=_;}},
        xDomain: {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain: {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:  {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:  {get: function(){return yRange;}, set: function(_){yRange=_;}},
        forceY:  {get: function(){return forceY;}, set: function(_){forceY=_;}},
        stacked: {get: function(){return stacked;}, set: function(_){stacked=_;}},
        showValues: {get: function(){return showValues;}, set: function(_){showValues=_;}},
        negateTrend: {get: function(){return negateTrend;}, set: function(_){negateTrend=_;}},
        // this shows the group name, seems pointless?
        showBarLabels:    {get: function(){return showBarLabels;}, set: function(_){showBarLabels=_;}},
        showChecks:    {get: function(){return showChecks;}, set: function(_){showChecks=_;}},
        disabled:     {get: function(){return disabled;}, set: function(_){disabled=_;}},
        id:           {get: function(){return id;}, set: function(_){id=_;}},
        valueFormat:  {get: function(){return valueFormat;}, set: function(_){valueFormat=_;}},
        keyFormat:  {get: function(){return keyFormat;}, set: function(_){keyFormat=_;}},
        valuePadding: {get: function(){return valuePadding;}, set: function(_){valuePadding=_;}},
        groupSpacing:{get: function(){return groupSpacing;}, set: function(_){groupSpacing=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        href:  {get: function(){return href;}, set: function(_){
            href = d3.functor(_);
        }},
        barColor:  {get: function(){return barColor;}, set: function(_){
            barColor = _ ? nv.utils.getColor(_) : null;
        }},
        barWidth: {get: function(){return barWidth;}, set: function(_){ barWidth = _; }}
    });

    nv.utils.initOptions(chart);

    return chart;
};

nv.models.multiBarHorizontalChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var multibar = nv.models.multiBarHorizontal()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend().height(30)
        , controls = nv.models.legend().height(30)
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , showControls = false
        , controlLabels = {}
        , showLegend = true
        , showXAxis = false
        , showYAxis = false
        , stacked = false
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd', 'selectChange')
        , controlWidth = function() { return showControls ? 180 : 0 }
        , duration = 250
        ;

    state.stacked = false; // DEPRECATED Maintained for backward compatibility

    multibar.stacked(stacked);

    xAxis
        .orient('left')
        .tickPadding(5)
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient('bottom')
        .tickFormat(d3.format(',.1f'))
    ;

    tooltip
        .duration(0)
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        })
        .headerFormatter(function(d, i) {
            return xAxis.tickFormat()(d, i);
        });

    controls.updateState(false);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled }),
                stacked: stacked
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.stacked !== undefined)
                stacked = state.stacked;
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(multibar);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() { container.transition().duration(duration).call(chart) };
            chart.container = this;

            stacked = multibar.stacked();

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values && d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = multibar.xScale();
            y = multibar.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-multiBarHorizontalChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-multiBarHorizontalChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis')
                .append('g').attr('class', 'nv-zeroLine')
                .append('line');
            gEnter.append('g').attr('class', 'nv-barsWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');

            // Legend
            if (showLegend) {
                legend.width(availableWidth - controlWidth());

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.nv-legendWrap')
                    .attr('transform', 'translate(' + controlWidth() + ',' + (-margin.top) +')');
            }

            // Controls
            if (showControls) {
                var controlsData = [
                    { key: controlLabels.grouped || 'Grouped', disabled: multibar.stacked() },
                    { key: controlLabels.stacked || 'Stacked', disabled: !multibar.stacked() }
                ];

                controls.width(controlWidth()).color(['#444', '#444', '#444']);
                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
                    .call(controls);
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            multibar
                .disabled(data.map(function(series) { return series.disabled }))
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled }));

            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }));

            barsWrap.transition().call(multibar);

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksY(availableHeight/24, data) )
                    .tickSize(-availableWidth, 0);

                g.select('.nv-x.nv-axis').call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis').selectAll('g');

                xTicks
                    .selectAll('line, text');
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize( -availableHeight, 0);

                g.select('.nv-y.nv-axis')
                    .attr('transform', 'translate(0,' + availableHeight + ')');
                g.select('.nv-y.nv-axis').call(yAxis);
            }

            // Zero line
            g.select(".nv-zeroLine line")
                .attr("x1", y(0))
                .attr("x2", y(0))
                .attr("y1", 0)
                .attr("y2", -availableHeight)
            ;

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            controls.dispatch.on('legendClick', function(d,i) {
                if (!d.disabled) return;
                controlsData = controlsData.map(function(s) {
                    s.disabled = true;
                    return s;
                });
                d.disabled = false;

                switch (d.key) {
                    case 'Grouped':
                    case controlLabels.grouped:
                        multibar.stacked(false);
                        break;
                    case 'Stacked':
                    case controlLabels.stacked:
                        multibar.stacked(true);
                        break;
                }

                state.stacked = multibar.stacked();
                dispatch.stateChange(state);
                stacked = multibar.stacked();

                chart.update();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {

                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                if (typeof e.stacked !== 'undefined') {
                    multibar.stacked(e.stacked);
                    state.stacked = e.stacked;
                    stacked = e.stacked;
                }

                chart.update();
            });
        });
        renderWatch.renderEnd('multibar horizontal chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

/*
    multibar.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt.value = chart.x()(evt.data);
        evt['series'] = {
            key: evt.data.key,
            value: chart.y()(evt.data),
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    multibar.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });
*/

    multibar.dispatch.on('elementClick.select', function(evt) {
        dispatch.selectChange(evt);
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.multibar = multibar;
    chart.legend = legend;
    chart.controls = controls;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.state = state;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        showControls: {get: function(){return showControls;}, set: function(_){showControls=_;}},
        controlLabels: {get: function(){return controlLabels;}, set: function(_){controlLabels=_;}},
        showXAxis:      {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:    {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            multibar.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
        }},
        barColor:  {get: function(){return multibar.barColor;}, set: function(_){
            multibar.barColor(_);
            legend.color(function(d,i) {return d3.rgb('#ccc').darker(i * 1.5).toString();})
        }},
        keyFormat:  {get: function(){return multibar.keyFormat;}, set: function(_){
            multibar.keyFormat(_);
        }}
    });

    nv.utils.inheritOptions(chart, multibar);
    nv.utils.initOptions(chart);

    return chart;
};
nv.models.multiChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 30, right: 20, bottom: 50, left: 60},
        color = nv.utils.defaultColor(),
        width = null,
        height = null,
        showLegend = true,
        noData = null,
        yDomain1,
        yDomain2,
        getX = function(d) { return d.x },
        getY = function(d) { return d.y},
        interpolate = 'monotone',
        useVoronoi = true,
        interactiveLayer = nv.interactiveGuideline(),
        useInteractiveGuideline = false,
        legendRightAxisHint = ' (right axis)'
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x = d3.scale.linear(),
        yScale1 = d3.scale.linear(),
        yScale2 = d3.scale.linear(),

        lines1 = nv.models.line().yScale(yScale1),
        lines2 = nv.models.line().yScale(yScale2),

        scatters1 = nv.models.scatter().yScale(yScale1),
        scatters2 = nv.models.scatter().yScale(yScale2),

        bars1 = nv.models.multiBar().stacked(false).yScale(yScale1),
        bars2 = nv.models.multiBar().stacked(false).yScale(yScale2),

        stack1 = nv.models.stackedArea().yScale(yScale1),
        stack2 = nv.models.stackedArea().yScale(yScale2),

        xAxis = nv.models.axis().scale(x).orient('bottom').tickPadding(5),
        yAxis1 = nv.models.axis().scale(yScale1).orient('left'),
        yAxis2 = nv.models.axis().scale(yScale2).orient('right'),

        legend = nv.models.legend().height(30),
        tooltip = nv.models.tooltip(),
        dispatch = d3.dispatch();

    var charts = [lines1, lines2, scatters1, scatters2, bars1, bars2, stack1, stack2];

    function chart(selection) {
        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);

            chart.update = function() { container.transition().call(chart); };
            chart.container = this;

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            var dataLines1 = data.filter(function(d) {return d.type == 'line' && d.yAxis == 1});
            var dataLines2 = data.filter(function(d) {return d.type == 'line' && d.yAxis == 2});
            var dataScatters1 = data.filter(function(d) {return d.type == 'scatter' && d.yAxis == 1});
            var dataScatters2 = data.filter(function(d) {return d.type == 'scatter' && d.yAxis == 2});
            var dataBars1 =  data.filter(function(d) {return d.type == 'bar'  && d.yAxis == 1});
            var dataBars2 =  data.filter(function(d) {return d.type == 'bar'  && d.yAxis == 2});
            var dataStack1 = data.filter(function(d) {return d.type == 'area' && d.yAxis == 1});
            var dataStack2 = data.filter(function(d) {return d.type == 'area' && d.yAxis == 2});

            // Display noData message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            var series1 = data.filter(function(d) {return !d.disabled && d.yAxis == 1})
                .map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d), y: getY(d) }
                    })
                });

            var series2 = data.filter(function(d) {return !d.disabled && d.yAxis == 2})
                .map(function(d) {
                    return d.values.map(function(d,i) {
                        return { x: getX(d), y: getY(d) }
                    })
                });

            x   .domain(d3.extent(d3.merge(series1.concat(series2)), function(d) { return getX(d) }))
                .range([0, availableWidth]);

            var wrap = container.selectAll('g.wrap.multiChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'wrap nvd3 multiChart').append('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y1 nv-axis');
            gEnter.append('g').attr('class', 'nv-y2 nv-axis');
            gEnter.append('g').attr('class', 'stack1Wrap');
            gEnter.append('g').attr('class', 'stack2Wrap');
            gEnter.append('g').attr('class', 'bars1Wrap');
            gEnter.append('g').attr('class', 'bars2Wrap');
            gEnter.append('g').attr('class', 'scatters1Wrap');
            gEnter.append('g').attr('class', 'scatters2Wrap');
            gEnter.append('g').attr('class', 'lines1Wrap');
            gEnter.append('g').attr('class', 'lines2Wrap');
            gEnter.append('g').attr('class', 'legendWrap');
            gEnter.append('g').attr('class', 'nv-interactive');

            var g = wrap.select('g');

            var color_array = data.map(function(d,i) {
                return data[i].color || color(d, i);
            });

            if (showLegend) {
                var legendWidth = legend.align() ? availableWidth / 2 : availableWidth;
                var legendXPosition = legend.align() ? legendWidth : 0;

                legend.width(legendWidth);
                legend.color(color_array);

                g.select('.legendWrap')
                    .datum(data.map(function(series) {
                        series.originalKey = series.originalKey === undefined ? series.key : series.originalKey;
                        series.key = series.originalKey + (series.yAxis == 1 ? '' : legendRightAxisHint);
                        return series;
                    }))
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.legendWrap')
                    .attr('transform', 'translate(' + legendXPosition + ',' + (-margin.top) +')');
            }

            lines1
                .width(availableWidth)
                .height(availableHeight)
                .interpolate(interpolate)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 1 && data[i].type == 'line'}));
            lines2
                .width(availableWidth)
                .height(availableHeight)
                .interpolate(interpolate)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 2 && data[i].type == 'line'}));
            scatters1
                .width(availableWidth)
                .height(availableHeight)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 1 && data[i].type == 'scatter'}));
            scatters2
                .width(availableWidth)
                .height(availableHeight)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 2 && data[i].type == 'scatter'}));
            bars1
                .width(availableWidth)
                .height(availableHeight)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 1 && data[i].type == 'bar'}));
            bars2
                .width(availableWidth)
                .height(availableHeight)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 2 && data[i].type == 'bar'}));
            stack1
                .width(availableWidth)
                .height(availableHeight)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 1 && data[i].type == 'area'}));
            stack2
                .width(availableWidth)
                .height(availableHeight)
                .color(color_array.filter(function(d,i) { return !data[i].disabled && data[i].yAxis == 2 && data[i].type == 'area'}));

            g.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var lines1Wrap = g.select('.lines1Wrap')
                .datum(dataLines1.filter(function(d){return !d.disabled}));
            var scatters1Wrap = g.select('.scatters1Wrap')
                .datum(dataScatters1.filter(function(d){return !d.disabled}));
            var bars1Wrap = g.select('.bars1Wrap')
                .datum(dataBars1.filter(function(d){return !d.disabled}));
            var stack1Wrap = g.select('.stack1Wrap')
                .datum(dataStack1.filter(function(d){return !d.disabled}));
            var lines2Wrap = g.select('.lines2Wrap')
                .datum(dataLines2.filter(function(d){return !d.disabled}));
            var scatters2Wrap = g.select('.scatters2Wrap')
                .datum(dataScatters2.filter(function(d){return !d.disabled}));
            var bars2Wrap = g.select('.bars2Wrap')
                .datum(dataBars2.filter(function(d){return !d.disabled}));
            var stack2Wrap = g.select('.stack2Wrap')
                .datum(dataStack2.filter(function(d){return !d.disabled}));

            var extraValue1 = dataStack1.length ? dataStack1.map(function(a){return a.values}).reduce(function(a,b){
                return a.map(function(aVal,i){return {x: aVal.x, y: aVal.y + b[i].y}})
            }).concat([{x:0, y:0}]) : [];
            var extraValue2 = dataStack2.length ? dataStack2.map(function(a){return a.values}).reduce(function(a,b){
                return a.map(function(aVal,i){return {x: aVal.x, y: aVal.y + b[i].y}})
            }).concat([{x:0, y:0}]) : [];

            yScale1 .domain(yDomain1 || d3.extent(d3.merge(series1).concat(extraValue1), function(d) { return d.y } ))
                .range([0, availableHeight]);

            yScale2 .domain(yDomain2 || d3.extent(d3.merge(series2).concat(extraValue2), function(d) { return d.y } ))
                .range([0, availableHeight]);

            lines1.yDomain(yScale1.domain());
            scatters1.yDomain(yScale1.domain());
            bars1.yDomain(yScale1.domain());
            stack1.yDomain(yScale1.domain());

            lines2.yDomain(yScale2.domain());
            scatters2.yDomain(yScale2.domain());
            bars2.yDomain(yScale2.domain());
            stack2.yDomain(yScale2.domain());

            if(dataStack1.length){d3.transition(stack1Wrap).call(stack1);}
            if(dataStack2.length){d3.transition(stack2Wrap).call(stack2);}

            if(dataBars1.length){d3.transition(bars1Wrap).call(bars1);}
            if(dataBars2.length){d3.transition(bars2Wrap).call(bars2);}

            if(dataLines1.length){d3.transition(lines1Wrap).call(lines1);}
            if(dataLines2.length){d3.transition(lines2Wrap).call(lines2);}

            if(dataScatters1.length){d3.transition(scatters1Wrap).call(scatters1);}
            if(dataScatters2.length){d3.transition(scatters2Wrap).call(scatters2);}

            xAxis
                ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                .tickSize(-availableHeight, 0);

            g.select('.nv-x.nv-axis')
                .attr('transform', 'translate(0,' + availableHeight + ')');
            d3.transition(g.select('.nv-x.nv-axis'))
                .call(xAxis);

            yAxis1
                ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                .tickSize( -availableWidth, 0);


            d3.transition(g.select('.nv-y1.nv-axis'))
                .call(yAxis1);

            yAxis2
                ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                .tickSize( -availableWidth, 0);

            d3.transition(g.select('.nv-y2.nv-axis'))
                .call(yAxis2);

            g.select('.nv-y1.nv-axis')
                .classed('nv-disabled', series1.length ? false : true)
                .attr('transform', 'translate(' + x.range()[0] + ',0)');

            g.select('.nv-y2.nv-axis')
                .classed('nv-disabled', series2.length ? false : true)
                .attr('transform', 'translate(' + x.range()[1] + ',0)');

            legend.dispatch.on('stateChange', function(newState) {
                chart.update();
            });

            if(useInteractiveGuideline){
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left:margin.left, top:margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            //============================================================
            // Event Handling/Dispatching
            //------------------------------------------------------------

            function mouseover_line(evt) {
                var yaxis = data[evt.seriesIndex].yAxis === 2 ? yAxis2 : yAxis1;
                evt.value = evt.point.x;
                evt.series = {
                    value: evt.point.y,
                    color: evt.point.color,
                    key: evt.series.key
                };
                tooltip
                    .duration(0)
                    .valueFormatter(function(d, i) {
                        return yaxis.tickFormat()(d, i);
                    })
                    .data(evt)
                    .hidden(false);
            }

            function mouseover_scatter(evt) {
                var yaxis = data[evt.seriesIndex].yAxis === 2 ? yAxis2 : yAxis1;
                evt.value = evt.point.x;
                evt.series = {
                    value: evt.point.y,
                    color: evt.point.color,
                    key: evt.series.key
                };
                tooltip
                    .duration(100)
                    .valueFormatter(function(d, i) {
                        return yaxis.tickFormat()(d, i);
                    })
                    .data(evt)
                    .hidden(false);
            }

            function mouseover_stack(evt) {
                var yaxis = data[evt.seriesIndex].yAxis === 2 ? yAxis2 : yAxis1;
                evt.point['x'] = stack1.x()(evt.point);
                evt.point['y'] = stack1.y()(evt.point);
                tooltip
                    .duration(0)
                    .valueFormatter(function(d, i) {
                        return yaxis.tickFormat()(d, i);
                    })
                    .data(evt)
                    .hidden(false);
            }

            function mouseover_bar(evt) {
                var yaxis = data[evt.data.series].yAxis === 2 ? yAxis2 : yAxis1;

                evt.value = bars1.x()(evt.data);
                evt['series'] = {
                    value: bars1.y()(evt.data),
                    color: evt.color,
                    key: evt.data.key
                };
                tooltip
                    .duration(0)
                    .valueFormatter(function(d, i) {
                        return yaxis.tickFormat()(d, i);
                    })
                    .data(evt)
                    .hidden(false);
            }



            function clearHighlights() {
              for(var i=0, il=charts.length; i < il; i++){
                var chart = charts[i];
                try {
                  chart.clearHighlights();
                } catch(e){}
              }
            }

            function highlightPoint(serieIndex, pointIndex, b){
              for(var i=0, il=charts.length; i < il; i++){
                var chart = charts[i];
                try {
                  chart.highlightPoint(serieIndex, pointIndex, b);
                } catch(e){}
              }
            }

            if(useInteractiveGuideline){
                interactiveLayer.dispatch.on('elementMousemove', function(e) {
                    clearHighlights();
                    var singlePoint, pointIndex, pointXLocation, allData = [];
                    data
                    .filter(function(series, i) {
                        series.seriesIndex = i;
                        return !series.disabled;
                    })
                    .forEach(function(series,i) {
                        var extent = x.domain();
                        var currentValues = series.values.filter(function(d,i) {
                            return chart.x()(d,i) >= extent[0] && chart.x()(d,i) <= extent[1];
                        });

                        pointIndex = nv.interactiveBisect(currentValues, e.pointXValue, chart.x());
                        var point = currentValues[pointIndex];
                        var pointYValue = chart.y()(point, pointIndex);
                        if (pointYValue !== null) {
                            highlightPoint(i, pointIndex, true);
                        }
                        if (point === undefined) return;
                        if (singlePoint === undefined) singlePoint = point;
                        if (pointXLocation === undefined) pointXLocation = x(chart.x()(point,pointIndex));
                        allData.push({
                            key: series.key,
                            value: pointYValue,
                            color: color(series,series.seriesIndex),
                            data: point,
                            yAxis: series.yAxis == 2 ? yAxis2 : yAxis1
                        });
                    });

                    interactiveLayer.tooltip
                    .chartContainer(chart.container.parentNode)
                    .valueFormatter(function(d,i) {
                        var yAxis = allData[i].yAxis;
                        return d === null ? "N/A" : yAxis.tickFormat()(d);
                    })
                    .data({
                        value: chart.x()( singlePoint,pointIndex ),
                        index: pointIndex,
                        series: allData
                    })();

                    interactiveLayer.renderGuideLine(pointXLocation);
                });

                interactiveLayer.dispatch.on("elementMouseout",function(e) {
                    clearHighlights();
                });
            } else {
                lines1.dispatch.on('elementMouseover.tooltip', mouseover_line);
                lines2.dispatch.on('elementMouseover.tooltip', mouseover_line);
                lines1.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true)
                });
                lines2.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true)
                });

                scatters1.dispatch.on('elementMouseover.tooltip', mouseover_scatter);
                scatters2.dispatch.on('elementMouseover.tooltip', mouseover_scatter);
                scatters1.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true)
                });
                scatters2.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true)
                });

                stack1.dispatch.on('elementMouseover.tooltip', mouseover_stack);
                stack2.dispatch.on('elementMouseover.tooltip', mouseover_stack);
                stack1.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true)
                });
                stack2.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true)
                });

                bars1.dispatch.on('elementMouseover.tooltip', mouseover_bar);
                bars2.dispatch.on('elementMouseover.tooltip', mouseover_bar);

                bars1.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true);
                });
                bars2.dispatch.on('elementMouseout.tooltip', function(evt) {
                    tooltip.hidden(true);
                });
                bars1.dispatch.on('elementMousemove.tooltip', function(evt) {
                    tooltip();
                });
                bars2.dispatch.on('elementMousemove.tooltip', function(evt) {
                    tooltip();
                });
            }
        });

        return chart;
    }

    //============================================================
    // Global getters and setters
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.legend = legend;
    chart.lines1 = lines1;
    chart.lines2 = lines2;
    chart.scatters1 = scatters1;
    chart.scatters2 = scatters2;
    chart.bars1 = bars1;
    chart.bars2 = bars2;
    chart.stack1 = stack1;
    chart.stack2 = stack2;
    chart.xAxis = xAxis;
    chart.yAxis1 = yAxis1;
    chart.yAxis2 = yAxis2;
    chart.tooltip = tooltip;
    chart.interactiveLayer = interactiveLayer;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        yDomain1:      {get: function(){return yDomain1;}, set: function(_){yDomain1=_;}},
        yDomain2:    {get: function(){return yDomain2;}, set: function(_){yDomain2=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},
        interpolate:    {get: function(){return interpolate;}, set: function(_){interpolate=_;}},
        legendRightAxisHint:    {get: function(){return legendRightAxisHint;}, set: function(_){legendRightAxisHint=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        x: {get: function(){return getX;}, set: function(_){
            getX = _;
            lines1.x(_);
            lines2.x(_);
            scatters1.x(_);
            scatters2.x(_);
            bars1.x(_);
            bars2.x(_);
            stack1.x(_);
            stack2.x(_);
        }},
        y: {get: function(){return getY;}, set: function(_){
            getY = _;
            lines1.y(_);
            lines2.y(_);
            scatters1.y(_);
            scatters2.y(_);
            stack1.y(_);
            stack2.y(_);
            bars1.y(_);
            bars2.y(_);
        }},
        useVoronoi: {get: function(){return useVoronoi;}, set: function(_){
            useVoronoi=_;
            lines1.useVoronoi(_);
            lines2.useVoronoi(_);
            stack1.useVoronoi(_);
            stack2.useVoronoi(_);
        }},

        useInteractiveGuideline: {get: function(){return useInteractiveGuideline;}, set: function(_){
            useInteractiveGuideline = _;
            if (useInteractiveGuideline) {
                lines1.interactive(false);
                lines1.useVoronoi(false);
                lines2.interactive(false);
                lines2.useVoronoi(false);
                stack1.interactive(false);
                stack1.useVoronoi(false);
                stack2.interactive(false);
                stack2.useVoronoi(false);
                scatters1.interactive(false);
                scatters2.interactive(false);
            }
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};

nv.models.ohlcBar = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , x = d3.scale.linear()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , getOpen = function(d) { return d.open }
        , getClose = function(d) { return d.close }
        , getHigh = function(d) { return d.high }
        , getLow = function(d) { return d.low }
        , forceX = []
        , forceY = []
        , padData     = false // If true, adds half a data points width to front and back, for lining up a line chart with a bar chart
        , clipEdge = true
        , color = nv.utils.defaultColor()
        , interactive = false
        , xDomain
        , yDomain
        , xRange
        , yRange
        , dispatch = d3.dispatch('stateChange', 'changeState', 'renderEnd', 'chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove')
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    function chart(selection) {
        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            // ohlc bar width.
            var w = (availableWidth / data[0].values.length) * .9;

            // Setup Scales
            x.domain(xDomain || d3.extent(data[0].values.map(getX).concat(forceX) ));

            if (padData)
                x.range(xRange || [availableWidth * .5 / data[0].values.length, availableWidth * (data[0].values.length - .5)  / data[0].values.length ]);
            else
                x.range(xRange || [5 + w/2, availableWidth - w/2 - 5]);

            y.domain(yDomain || [
                    d3.min(data[0].values.map(getLow).concat(forceY)),
                    d3.max(data[0].values.map(getHigh).concat(forceY))
                ]
            ).range(yRange || [availableHeight, 0]);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] + y.domain()[0] * 0.01, y.domain()[1] - y.domain()[1] * 0.01])
                    : y.domain([-1,1]);

            // Setup containers and skeleton of chart
            var wrap = d3.select(this).selectAll('g.nv-wrap.nv-ohlcBar').data([data[0].values]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-ohlcBar');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-ticks');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            container
                .on('click', function(d,i) {
                    dispatch.chartClick({
                        data: d,
                        index: i,
                        pos: d3.event,
                        id: id
                    });
                });

            defsEnter.append('clipPath')
                .attr('id', 'nv-chart-clip-path-' + id)
                .append('rect');

            wrap.select('#nv-chart-clip-path-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            g   .attr('clip-path', clipEdge ? 'url(#nv-chart-clip-path-' + id + ')' : '');

            var ticks = wrap.select('.nv-ticks').selectAll('.nv-tick')
                .data(function(d) { return d });
            ticks.exit().remove();

            ticks.enter().append('path')
                .attr('class', function(d,i,j) { return (getOpen(d,i) > getClose(d,i) ? 'nv-tick negative' : 'nv-tick positive') + ' nv-tick-' + j + '-' + i })
                .attr('d', function(d,i) {
                    return 'm0,0l0,'
                        + (y(getOpen(d,i))
                            - y(getHigh(d,i)))
                        + 'l'
                        + (-w/2)
                        + ',0l'
                        + (w/2)
                        + ',0l0,'
                        + (y(getLow(d,i)) - y(getOpen(d,i)))
                        + 'l0,'
                        + (y(getClose(d,i))
                            - y(getLow(d,i)))
                        + 'l'
                        + (w/2)
                        + ',0l'
                        + (-w/2)
                        + ',0z';
                })
                .attr('transform', function(d,i) { return 'translate(' + x(getX(d,i)) + ',' + y(getHigh(d,i)) + ')'; })
                .attr('fill', function(d,i) { return color[0]; })
                .attr('stroke', function(d,i) { return color[0]; })
                .attr('x', 0 )
                .attr('y', function(d,i) {  return y(Math.max(0, getY(d,i))) })
                .attr('height', function(d,i) { return Math.abs(y(getY(d,i)) - y(0)) });

            // the bar colors are controlled by CSS currently
            ticks.attr('class', function(d,i,j) {
                return (getOpen(d,i) > getClose(d,i) ? 'nv-tick negative' : 'nv-tick positive') + ' nv-tick-' + j + '-' + i;
            });

            d3.transition(ticks)
                .attr('transform', function(d,i) { return 'translate(' + x(getX(d,i)) + ',' + y(getHigh(d,i)) + ')'; })
                .attr('d', function(d,i) {
                    var w = (availableWidth / data[0].values.length) * .9;
                    return 'm0,0l0,'
                        + (y(getOpen(d,i))
                            - y(getHigh(d,i)))
                        + 'l'
                        + (-w/2)
                        + ',0l'
                        + (w/2)
                        + ',0l0,'
                        + (y(getLow(d,i))
                            - y(getOpen(d,i)))
                        + 'l0,'
                        + (y(getClose(d,i))
                            - y(getLow(d,i)))
                        + 'l'
                        + (w/2)
                        + ',0l'
                        + (-w/2)
                        + ',0z';
                });
        });

        return chart;
    }


    //Create methods to allow outside functions to highlight a specific bar.
    chart.highlightPoint = function(pointIndex, isHoverOver) {
        chart.clearHighlights();
        container.select(".nv-ohlcBar .nv-tick-0-" + pointIndex)
            .classed("hover", isHoverOver)
        ;
    };

    chart.clearHighlights = function() {
        container.select(".nv-ohlcBar .nv-tick.hover")
            .classed("hover", false)
        ;
    };

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:    {get: function(){return width;}, set: function(_){width=_;}},
        height:   {get: function(){return height;}, set: function(_){height=_;}},
        xScale:   {get: function(){return x;}, set: function(_){x=_;}},
        yScale:   {get: function(){return y;}, set: function(_){y=_;}},
        xDomain:  {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain:  {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:   {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:   {get: function(){return yRange;}, set: function(_){yRange=_;}},
        forceX:   {get: function(){return forceX;}, set: function(_){forceX=_;}},
        forceY:   {get: function(){return forceY;}, set: function(_){forceY=_;}},
        padData:  {get: function(){return padData;}, set: function(_){padData=_;}},
        clipEdge: {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},
        id:       {get: function(){return id;}, set: function(_){id=_;}},
        interactive: {get: function(){return interactive;}, set: function(_){interactive=_;}},

        x:     {get: function(){return getX;}, set: function(_){getX=_;}},
        y:     {get: function(){return getY;}, set: function(_){getY=_;}},
        open:  {get: function(){return getOpen();}, set: function(_){getOpen=_;}},
        close: {get: function(){return getClose();}, set: function(_){getClose=_;}},
        high:  {get: function(){return getHigh;}, set: function(_){getHigh=_;}},
        low:   {get: function(){return getLow;}, set: function(_){getLow=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    != undefined ? _.top    : margin.top;
            margin.right  = _.right  != undefined ? _.right  : margin.right;
            margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   != undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};
// Code adapted from Jason Davies' "Parallel Coordinates"
// http://bl.ocks.org/jasondavies/1341281
nv.models.parallelCoordinates = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 30, right: 0, bottom: 10, left: 0}
        , width = null
        , height = null
        , x = d3.scale.ordinal()
        , y = {}
        , dimensionData = []
        , enabledDimensions = []
        , dimensionNames = []
        , displayBrush = true
        , color = nv.utils.defaultColor()
        , filters = []
        , active = []
        , dragging = []
        , axisWithUndefinedValues = []
        , lineTension = 1
        , foreground
        , background
        , dimensions
        , line = d3.svg.line()
        , axis = d3.svg.axis()
        , dispatch = d3.dispatch('brushstart', 'brush', 'brushEnd', 'dimensionsOrder', "stateChange", 'elementClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd', 'activeChanged')
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------


    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);


           //Convert old data to new format (name, values)
            if (data[0].values === undefined) {
                var newData = [];
                data.forEach(function (d) {
                        var val = {};
                        var key = Object.keys(d);
                        key.forEach(function (k) { if (k !== "name") val[k] = d[k] });
                        newData.push({ key: d.name, values: val });
                });
                data = newData;
            }

            var dataValues = data.map(function (d) {return d.values});
            if (active.length === 0) {
                active = data;
            }; //set all active before first brush call
            
            dimensionNames = dimensionData.sort(function (a, b) { return a.currentPosition - b.currentPosition; }).map(function (d) { return d.key });
            enabledDimensions = dimensionData.filter(function (d) { return !d.disabled; });
            

            // Setup Scales
            x.rangePoints([0, availableWidth], 1).domain(enabledDimensions.map(function (d) { return d.key; }));

            //Set as true if all values on an axis are missing.
            // Extract the list of dimensions and create a scale for each.
            var oldDomainMaxValue = {};
            var displayMissingValuesline = false;

            dimensionNames.forEach(function(d) {
                var extent = d3.extent(dataValues, function (p) { return +p[d]; });
                var min = extent[0];
                var max = extent[1];
                var onlyUndefinedValues = false;
                //If there is no values to display on an axis, set the extent to 0
                if (isNaN(min) || isNaN(max)) {
                    onlyUndefinedValues = true;
                    min = 0;
                    max = 0;
                }
                //Scale axis if there is only one value
                if (min === max) {
                    min = min - 1;
                    max = max + 1;
                }
                var f = filters.filter(function (k) { return k.dimension == d; });
                if (f.length !== 0) {
                    //If there is only NaN values, keep the existing domain.
                    if (onlyUndefinedValues) {
                        min = y[d].domain()[0];
                        max = y[d].domain()[1];
                    }
                        //If the brush extent is > max (< min), keep the extent value.
                    else if (!f[0].hasOnlyNaN && displayBrush) {
                        min = min > f[0].extent[0] ? f[0].extent[0] : min;
                        max = max < f[0].extent[1] ? f[0].extent[1] : max;
                    }
                        //If there is NaN values brushed be sure the brush extent is on the domain.
                    else if (f[0].hasNaN) {
                        max = max < f[0].extent[1] ? f[0].extent[1] : max;
                        oldDomainMaxValue[d] = y[d].domain()[1];
                        displayMissingValuesline = true;
                    }
                }
                //Use 90% of (availableHeight - 12) for the axis range, 12 reprensenting the space necessary to display "undefined values" text.
                //The remaining 10% are used to display the missingValue line.
                y[d] = d3.scale.linear()
                    .domain([min, max])
                    .range([(availableHeight - 12) * 0.9, 0]);

                axisWithUndefinedValues = [];

                y[d].brush = d3.svg.brush().y(y[d]).on('brushstart', brushstart).on('brush', brush).on('brushend', brushend);
            });

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-parallelCoordinates').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-parallelCoordinates');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-parallelCoordinates background');
            gEnter.append('g').attr('class', 'nv-parallelCoordinates foreground');
            gEnter.append('g').attr('class', 'nv-parallelCoordinates missingValuesline');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            line.interpolate('cardinal').tension(lineTension);
            axis.orient('left');
            var axisDrag = d3.behavior.drag()
                        .on('dragstart', dragStart)
                        .on('drag', dragMove)
                        .on('dragend', dragEnd);

            //Add missing value line at the bottom of the chart
            var missingValuesline, missingValueslineText;
            var step = x.range()[1] - x.range()[0];
            if (!isNaN(step)) {
                var lineData = [0 + step / 2, availableHeight - 12, availableWidth - step / 2, availableHeight - 12];
                missingValuesline = wrap.select('.missingValuesline').selectAll('line').data([lineData]);
                missingValuesline.enter().append('line');
                missingValuesline.exit().remove();
                missingValuesline.attr("x1", function(d) { return d[0]; })
                        .attr("y1", function(d) { return d[1]; })
                        .attr("x2", function(d) { return d[2]; })
                        .attr("y2", function(d) { return d[3]; });
    
                //Add the text "undefined values" under the missing value line
                missingValueslineText = wrap.select('.missingValuesline').selectAll('text').data(["undefined values"]);
                missingValueslineText.append('text').data(["undefined values"]);
                missingValueslineText.enter().append('text');
                missingValueslineText.exit().remove();
                missingValueslineText.attr("y", availableHeight)
                        //To have the text right align with the missingValues line, substract 92 representing the text size.
                        .attr("x", availableWidth - 92 - step / 2)
                        .text(function(d) { return d; });
            }
            // Add grey background lines for context.
            background = wrap.select('.background').selectAll('path').data(data);
            background.enter().append('path');
            background.exit().remove();
            background.attr('d', path);

            // Add blue foreground lines for focus.
            foreground = wrap.select('.foreground').selectAll('path').data(data);
            foreground.enter().append('path')
            foreground.exit().remove();
            foreground.attr('d', path)
                .style("stroke-width", function (d, i) {
                if (isNaN(d.strokeWidth)) { d.strokeWidth = 1;} return d.strokeWidth;})
                .attr('stroke', function (d, i) { return d.color || color(d, i); });
            foreground.on("mouseover", function (d, i) {
                d3.select(this).classed('hover', true).style("stroke-width", d.strokeWidth + 2 + "px").style("stroke-opacity", 1);
                dispatch.elementMouseover({
                    label: d.name,
                    color: d.color || color(d, i)
                });

            });
            foreground.on("mouseout", function (d, i) {
                d3.select(this).classed('hover', false).style("stroke-width", d.strokeWidth + "px").style("stroke-opacity", 0.7);
                dispatch.elementMouseout({
                    label: d.name,
                    index: i
                });
            });
            foreground.on('mousemove', function (d, i) {
                dispatch.elementMousemove();
            });
            foreground.on('click', function (d) {
                dispatch.elementClick({
                    id: d.id
                });
            });
            // Add a group element for each dimension.
            dimensions = g.selectAll('.dimension').data(enabledDimensions);
            var dimensionsEnter = dimensions.enter().append('g').attr('class', 'nv-parallelCoordinates dimension');

            dimensions.attr('transform', function(d) { return 'translate(' + x(d.key) + ',0)'; });
            dimensionsEnter.append('g').attr('class', 'nv-axis');

            // Add an axis and title.
            dimensionsEnter.append('text')
                    .attr('class', 'nv-label')
                .style("cursor", "move")
                .attr('dy', '-1em')
                .attr('text-anchor', 'middle')
                .on("mouseover", function(d, i) {
                    dispatch.elementMouseover({
                        label: d.tooltip || d.key
                    });
                })
                .on("mouseout", function(d, i) {
                    dispatch.elementMouseout({
                        label: d.tooltip
                    });
                })
                .on('mousemove', function (d, i) {
                    dispatch.elementMousemove();
                })
                .call(axisDrag);

            dimensionsEnter.append('g').attr('class', 'nv-brushBackground');
            dimensions.exit().remove();
            dimensions.select('.nv-label').text(function (d) { return d.key });
            dimensions.select('.nv-axis')
                .each(function (d, i) {
                    d3.select(this).call(axis.scale(y[d.key]).tickFormat(d3.format(d.format)));
                });

            // Add and store a brush for each axis.
            restoreBrush(displayBrush);

            var actives = dimensionNames.filter(function (p) { return !y[p].brush.empty(); }),
                    extents = actives.map(function (p) { return y[p].brush.extent(); });
            var formerActive = active.slice(0);

            //Restore active values
            active = [];
            foreground.style("display", function (d) {
                var isActive = actives.every(function (p, i) {
                    if ((isNaN(d.values[p]) || isNaN(parseFloat(d.values[p]))) && extents[i][0] == y[p].brush.y().domain()[0]) {
                        return true;
                    }
                    return (extents[i][0] <= d.values[p] && d.values[p] <= extents[i][1]) && !isNaN(parseFloat(d.values[p]));
                });
                if (isActive)
                    active.push(d);
                return !isActive ? "none" : null;

            });

            if (filters.length > 0 || !nv.utils.arrayEquals(active, formerActive)) {
               dispatch.activeChanged(active);
            }

            // Returns the path for a given data point.
            function path(d) {
                return line(enabledDimensions.map(function (p) {
                    //If value if missing, put the value on the missing value line
                    if (isNaN(d.values[p.key]) || isNaN(parseFloat(d.values[p.key])) || displayMissingValuesline) {
                        var domain = y[p.key].domain();
                        var range = y[p.key].range();
                        var min = domain[0] - (domain[1] - domain[0]) / 9;

                        //If it's not already the case, allow brush to select undefined values
                        if (axisWithUndefinedValues.indexOf(p.key) < 0) {

                            var newscale = d3.scale.linear().domain([min, domain[1]]).range([availableHeight - 12, range[1]]);
                            y[p.key].brush.y(newscale);
                            axisWithUndefinedValues.push(p.key);
                        }
                        if (isNaN(d.values[p.key]) || isNaN(parseFloat(d.values[p.key]))) {
                            return [x(p.key), y[p.key](min)];
                        }
                    }

                    //If parallelCoordinate contain missing values show the missing values line otherwise, hide it.
                    if (missingValuesline !== undefined) {
                        if (axisWithUndefinedValues.length > 0 || displayMissingValuesline) {
                            missingValuesline.style("display", "inline");
                            missingValueslineText.style("display", "inline");
                        } else {
                            missingValuesline.style("display", "none");
                            missingValueslineText.style("display", "none");
                        }
                    }
                    return [x(p.key), y[p.key](d.values[p.key])];
                }));
            }

            function restoreBrush(visible) {
                filters.forEach(function (f) {
                    //If filter brushed NaN values, keep the brush on the bottom of the axis.
                    var brushDomain = y[f.dimension].brush.y().domain();
                    if (f.hasOnlyNaN) {
                        f.extent[1] = (y[f.dimension].domain()[1] - brushDomain[0]) * (f.extent[1] - f.extent[0]) / (oldDomainMaxValue[f.dimension] - f.extent[0]) + brushDomain[0];
                    }
                    if (f.hasNaN) {
                        f.extent[0] = brushDomain[0];
                    }
                    if (visible)
                        y[f.dimension].brush.extent(f.extent);
                });
                
                dimensions.select('.nv-brushBackground')
                .each(function (d) {
                    d3.select(this).call(y[d.key].brush);

                })
                .selectAll('rect')
                .attr('x', -8)
                .attr('width', 16);
            }
            
            // Handles a brush event, toggling the display of foreground lines.
            function brushstart() {
                //If brush aren't visible, show it before brushing again.
                if (displayBrush === false) {
                    restoreBrush(true);
                }
            }
            
            // Handles a brush event, toggling the display of foreground lines.
            function brush() {
                actives = dimensionNames.filter(function (p) { return !y[p].brush.empty(); }),
                    extents = actives.map(function(p) { return y[p].brush.extent(); });

                filters = []; //erase current filters
                actives.forEach(function(d,i) {
                    filters[i] = {
                        dimension: d,
                        extent: extents[i],
                        hasNaN: false,
                        hasOnlyNaN: false
                    }
                });

                active = []; //erase current active list
                foreground.style('display', function(d) {
                    var isActive = actives.every(function(p, i) {
                        if ((isNaN(d.values[p]) || isNaN(parseFloat(d.values[p]))) && extents[i][0] == y[p].brush.y().domain()[0]) return true;
                        return (extents[i][0] <= d.values[p] && d.values[p] <= extents[i][1]) && !isNaN(parseFloat(d.values[p]));
                    });
                    if (isActive) active.push(d);
                    return isActive ? null : 'none';
                });

                dispatch.brush({
                    filters: filters,
                    active: active
                });
            }
            function brushend() {
                var hasActiveBrush = actives.length > 0 ? true : false;
                filters.forEach(function (f) {
                    if (f.extent[0] === y[f.dimension].brush.y().domain()[0] && axisWithUndefinedValues.indexOf(f.dimension) >= 0)
                        f.hasNaN = true;
                    if (f.extent[1] < y[f.dimension].domain()[0])
                        f.hasOnlyNaN = true;
                });
                dispatch.brushEnd(active, hasActiveBrush);
            }
            function dragStart(d) {
                dragging[d.key] = this.parentNode.__origin__ = x(d.key);
                background.attr("visibility", "hidden");

            }

            function dragMove(d) {
                dragging[d.key] = Math.min(availableWidth, Math.max(0, this.parentNode.__origin__ += d3.event.x));
                foreground.attr("d", path);
                enabledDimensions.sort(function (a, b) { return dimensionPosition(a.key) - dimensionPosition(b.key); });
                enabledDimensions.forEach(function (d, i) { return d.currentPosition = i; });
                x.domain(enabledDimensions.map(function (d) { return d.key; }));
                dimensions.attr("transform", function(d) { return "translate(" + dimensionPosition(d.key) + ")"; });
            }

            function dragEnd(d, i) {
                delete this.parentNode.__origin__;
                delete dragging[d.key];
                d3.select(this.parentNode).attr("transform", "translate(" + x(d.key) + ")");
                foreground
                  .attr("d", path);
                background
                  .attr("d", path)
                  .attr("visibility", null);

                dispatch.dimensionsOrder(enabledDimensions);
            }
            function resetBrush() {
                filters = [];
                active = [];
                dispatch.stateChange();
            }
            function resetDrag() {
                dimensionName.map(function (d, i) { return d.currentPosition = d.originalPosition; });
                dispatch.stateChange();
            }

            function dimensionPosition(d) {
                var v = dragging[d];
                return v == null ? x(d) : v;
            }
        });

        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:         {get: function(){return width;},           set: function(_){width= _;}},
        height:        {get: function(){return height;},          set: function(_){height= _;}},
        dimensionData: { get: function () { return dimensionData; }, set: function (_) { dimensionData = _; } },
        displayBrush: { get: function () { return displayBrush; }, set: function (_) { displayBrush = _; } },
        filters: { get: function () { return filters; }, set: function (_) { filters = _; } },
        active: { get: function () { return active; }, set: function (_) { active = _; } },
        lineTension:   {get: function(){return lineTension;},     set: function(_){lineTension = _;}},

        // deprecated options
        dimensions: {get: function () { return dimensionData.map(function (d){return d.key}); }, set: function (_) {
            // deprecated after 1.8.1
            nv.deprecated('dimensions', 'use dimensionData instead');
            if (dimensionData.length === 0) {
                _.forEach(function (k) { dimensionData.push({ key: k }) })
            } else {
                _.forEach(function (k, i) { dimensionData[i].key= k })
            }
        }
        },
        dimensionNames: {get: function () { return dimensionData.map(function (d){return d.key}); }, set: function (_) {
            // deprecated after 1.8.1
            nv.deprecated('dimensionNames', 'use dimensionData instead');
            dimensionNames = [];
            if (dimensionData.length === 0) {
                _.forEach(function (k) { dimensionData.push({ key: k }) })
            } else {
                _.forEach(function (k, i) { dimensionData[i].key = k })
            }
 
        }},
        dimensionFormats: {get: function () { return dimensionData.map(function (d) { return d.format }); }, set: function (_) {
            // deprecated after 1.8.1
            nv.deprecated('dimensionFormats', 'use dimensionData instead');
            if (dimensionData.length === 0) {
                _.forEach(function (f) { dimensionData.push({ format: f }) })
            } else {
                _.forEach(function (f, i) { dimensionData[i].format = f })
            }

        }},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    =  _.top    !== undefined ? _.top    : margin.top;
            margin.right  =  _.right  !== undefined ? _.right  : margin.right;
            margin.bottom =  _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   =  _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};
nv.models.parallelCoordinatesChart = function () {
        "use strict";
        //============================================================
        // Public Variables with Default Settings
        //------------------------------------------------------------

        var parallelCoordinates = nv.models.parallelCoordinates()
        var legend = nv.models.legend()
        var tooltip = nv.models.tooltip();
        var dimensionTooltip = nv.models.tooltip();

        var margin = { top: 0, right: 0, bottom: 0, left: 0 }
        , width = null
		, height = null
        , showLegend = true
		, color = nv.utils.defaultColor()
        , state = nv.utils.state()
        , dimensionData = []
        , dimensionNames = []
        , displayBrush = true
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('dimensionsOrder', 'brushEnd', 'stateChange', 'changeState', 'renderEnd')
        , controlWidth = function () { return showControls ? 180 : 0 }
        ;

	    //============================================================
	
		//============================================================
        // Private Variables
        //------------------------------------------------------------

        var renderWatch = nv.utils.renderWatch(dispatch);

        var stateGetter = function(data) {
            return function() {
                return {
                    active: data.map(function(d) { return !d.disabled })
                };
            }
        };

        var stateSetter = function(data) {
            return function(state) {
                if(state.active !== undefined) {
                    data.forEach(function(series, i) {
                        series.disabled = !state.active[i];
                    });
                }
            }
        };

        //============================================================
        // Chart function
        //------------------------------------------------------------

        function chart(selection) {
            renderWatch.reset();
            renderWatch.models(parallelCoordinates);

            selection.each(function(data) {
                var container = d3.select(this);
                nv.utils.initSVG(container);

                var that = this;

                var availableWidth = nv.utils.availableWidth(width, container, margin),
                    availableHeight = nv.utils.availableHeight(height, container, margin);

                chart.update = function() { container.call(chart); };
                chart.container = this;

                state.setter(stateSetter(dimensionData), chart.update)
                    .getter(stateGetter(dimensionData))
                    .update();

                //set state.disabled
                state.disabled = dimensionData.map(function (d) { return !!d.disabled });

                //Keep dimensions position in memory
                dimensionData = dimensionData.map(function (d) {d.disabled = !!d.disabled; return d});
                dimensionData.forEach(function (d, i) {
                    d.originalPosition = isNaN(d.originalPosition) ? i : d.originalPosition;
                    d.currentPosition = isNaN(d.currentPosition) ? i : d.currentPosition;
                });

                var currentDimensions = dimensionNames.map(function (d) { return d.key; });
                var newDimensions = dimensionData.map(function (d) { return d.key; });
                dimensionData.forEach(function (k, i) {
                    var idx = currentDimensions.indexOf(k.key);
                        if (idx < 0) {
                            dimensionNames.splice(i, 0, k);
                        } else {
                            var gap = dimensionNames[idx].currentPosition - dimensionNames[idx].originalPosition;
                            dimensionNames[idx].originalPosition = k.originalPosition;
                            dimensionNames[idx].currentPosition = k.originalPosition + gap;
                        }
                });
                //Remove old dimensions
                dimensionNames = dimensionNames.filter(function (d) { return newDimensions.indexOf(d.key) >= 0; });

               if (!defaultState) {
                    var key;
                    defaultState = {};
                    for(key in state) {
                        if(state[key] instanceof Array)
                            defaultState[key] = state[key].slice(0);
                        else
                            defaultState[key] = state[key];
                    }
                }

                // Display No Data message if there's nothing to show.
                if(!data || !data.length) {
                    nv.utils.noData(chart, container);
                    return chart;
                } else {
                    container.selectAll('.nv-noData').remove();
                }
                
                //------------------------------------------------------------
                // Setup containers and skeleton of chart

                var wrap = container.selectAll('g.nv-wrap.nv-parallelCoordinatesChart').data([data]);
                var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-parallelCoordinatesChart').append('g');

                var g = wrap.select('g');
                
                gEnter.append('g').attr('class', 'nv-parallelCoordinatesWrap');
                gEnter.append('g').attr('class', 'nv-legendWrap');

                g.select("rect")
                    .attr("width", availableWidth)
                    .attr("height", (availableHeight > 0) ? availableHeight : 0);

                // Legend
                if (showLegend) {
                    legend.width(availableWidth)
                        .color(function (d) { return "rgb(188,190,192)"; });

                    g.select('.nv-legendWrap')
                        .datum(dimensionNames.sort(function (a, b) { return a.originalPosition - b.originalPosition; }))
                        .call(legend);

                    if (margin.top != legend.height()) {
                        margin.top = legend.height();
                        availableHeight = nv.utils.availableHeight(height, container, margin);
                    }
                    wrap.select('.nv-legendWrap')
                       .attr('transform', 'translate( 0 ,' + (-margin.top) + ')');
                }
                wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

                
               

                // Main Chart Component(s)
                parallelCoordinates
                    .width(availableWidth)
                    .height(availableHeight)
                    .dimensionData(dimensionNames)
                    .displayBrush(displayBrush);
		
		        var parallelCoordinatesWrap = g.select('.nv-parallelCoordinatesWrap ')
                  .datum(data);

		        parallelCoordinatesWrap.transition().call(parallelCoordinates);
		  
				//============================================================
                // Event Handling/Dispatching (in chart's scope)
                //------------------------------------------------------------
                //Display reset brush button
		        parallelCoordinates.dispatch.on('brushEnd', function (active, hasActiveBrush) {
		            if (hasActiveBrush) {
		                displayBrush = true;
		                dispatch.brushEnd(active);
		            } else {

		                displayBrush = false;
		            }
		        });

		        legend.dispatch.on('stateChange', function(newState) {
		            for(var key in newState) {
		                state[key] = newState[key];
		            }
		            dispatch.stateChange(state);
		            chart.update();
		        });

                //Update dimensions order and display reset sorting button
		        parallelCoordinates.dispatch.on('dimensionsOrder', function (e) {
		            dimensionNames.sort(function (a, b) { return a.currentPosition - b.currentPosition; });
		            var isSorted = false;
		            dimensionNames.forEach(function (d, i) {
		                d.currentPosition = i;
		                if (d.currentPosition !== d.originalPosition)
		                    isSorted = true;
		            });
		            dispatch.dimensionsOrder(dimensionNames, isSorted);
		        });

				// Update chart from a state object passed to event handler
                dispatch.on('changeState', function (e) {

                    if (typeof e.disabled !== 'undefined') {
                        dimensionNames.forEach(function (series, i) {
                            series.disabled = e.disabled[i];
                        });
                        state.disabled = e.disabled;
                    }
                    chart.update();
                });
            });

            renderWatch.renderEnd('parraleleCoordinateChart immediate');
            return chart;
        }

		//============================================================
        // Event Handling/Dispatching (out of chart's scope)
        //------------------------------------------------------------

        parallelCoordinates.dispatch.on('elementMouseover.tooltip', function (evt) {
            evt['series'] = {
                key: evt.label,
                color: evt.color
            };
            tooltip.data(evt).hidden(false);
        });

        parallelCoordinates.dispatch.on('elementMouseout.tooltip', function(evt) {
            tooltip.hidden(true)
        });

        parallelCoordinates.dispatch.on('elementMousemove.tooltip', function () {
            tooltip();
        });
		 //============================================================
        // Expose Public Variables
        //------------------------------------------------------------
		
		// expose chart's sub-components
        chart.dispatch = dispatch;
        chart.parallelCoordinates = parallelCoordinates;
        chart.legend = legend;
        chart.tooltip = tooltip;

        chart.options = nv.utils.optionsFunc.bind(chart);

        chart._options = Object.create({}, {
            // simple options, just get/set the necessary values
            width: { get: function () { return width; }, set: function (_) { width = _; } },
            height: { get: function () { return height; }, set: function (_) { height = _; } },
            showLegend: { get: function () { return showLegend; }, set: function (_) { showLegend = _; } },
            defaultState: { get: function () { return defaultState; }, set: function (_) { defaultState = _; } },
            dimensionData: { get: function () { return dimensionData; }, set: function (_) { dimensionData = _; } },
            displayBrush: { get: function () { return displayBrush; }, set: function (_) { displayBrush = _; } },
            noData: { get: function () { return noData; }, set: function (_) { noData = _; } },

            // options that require extra logic in the setter
            margin: {
                get: function () { return margin; },
                set: function (_) {
                    margin.top = _.top !== undefined ? _.top : margin.top;
                    margin.right = _.right !== undefined ? _.right : margin.right;
                    margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
                    margin.left = _.left !== undefined ? _.left : margin.left;
                }
            },
            color: {get: function(){return color;}, set: function(_){
                    color = nv.utils.getColor(_);
                    legend.color(color);
                    parallelCoordinates.color(color);
                }}
        });

        nv.utils.inheritOptions(chart, parallelCoordinates);
        nv.utils.initOptions(chart);

        return chart;
    };nv.models.pie = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 500
        , height = 500
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , valueFormat = d3.format(',.2f')
        , refFormat = function(v){ return v ? d3.format('.1f')(100.0 * v) + '%' : ''; }
        , showLabels = true
        , showChecks = false
        , labelsOutside = false
        , labelType = "key"
        , labelThreshold = .02 //if slice percentage is under this, don't show label
        , donut = false
        , title = false
        , growOnHover = true
        , titleOffset = 0
        , labelSunbeamLayout = false
        , startAngle = false
        , padAngle = false
        , endAngle = false
        , negateTrend = false
        , cornerRadius = 0
        , donutRatio = 0.5
        , arcsRadius = []
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'elementMousemove', 'renderEnd')
        , showTotal = false;

    var arcs = [];
    var arcsOver = [];
    var pieInfo;
    var dispatchElementMouseover = true;

    var slicePathByData = function (data) {
        return d3.selectAll('.nv-slice').filter(function (sd) {
            return sd.data === data;
        });
    };

    var sliceExplode = function (data) {
        var slice = slicePathByData(data.data);
        if (slice.length && slice[0][0] === undefined) return;

        dispatchElementMouseover = !data.explode;

        slice[0][0].dispatchEvent(new MouseEvent(data.explode ? 'mouseover' : 'mouseout', {emitEvent: false}));
    }

    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right
                , availableHeight = height - margin.top - margin.bottom
                , radius = Math.min(availableWidth, availableHeight) / 2
                , arcsRadiusOuter = []
                , arcsRadiusInner = []
                ;

            container = d3.select(this)
            if (arcsRadius.length === 0) {
                var outer = radius - radius / 5;
                var inner = donutRatio * radius;
                for (var i = 0; i < data[0].length; i++) {
                    arcsRadiusOuter.push(outer);
                    arcsRadiusInner.push(inner);
                }
            } else {
                arcsRadiusOuter = arcsRadius.map(function (d) { return (d.outer - d.outer / 5) * radius; });
                arcsRadiusInner = arcsRadius.map(function (d) { return (d.inner - d.inner / 5) * radius; });
                donutRatio = d3.min(arcsRadius.map(function (d) { return (d.inner - d.inner / 5); }));
            }
            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-pie').data(data);
            var wrapEnter = wrap.enter().append('g').attr('class','nvd3 nv-wrap nv-pie nv-chart-' + id);
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');
            var g_pie = gEnter.append('g').attr('class', 'nv-pie');
            gEnter.append('g').attr('class', 'nv-pieLabels');

            var gInfoEnter = gEnter.append('g').attr('class', 'nv-pieInfo');
            gInfoEnter.append('g').classed('key', true).append('text');
            gInfoEnter.append('g').classed('value', true)
                .attr('transform', 'translate(' + 0 + ',' + 18 + ')')
                .append('text');
            gInfoEnter.append('g').classed('ref', true).append('text');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            g.select('.nv-pie').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');
            g.select('.nv-pieLabels').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');
            g.select('.nv-pieInfo').attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            //
            container.on('click', function(d,i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });

            arcs = [];
            arcsOver = [];
            for (var i = 0; i < data[0].length; i++) {

                var arc = d3.svg.arc().outerRadius(arcsRadiusOuter[i]);
                var arcOver = d3.svg.arc().outerRadius(arcsRadiusOuter[i] + 5);

                if (startAngle !== false) {
                    arc.startAngle(startAngle);
                    arcOver.startAngle(startAngle);
                }
                if (endAngle !== false) {
                    arc.endAngle(endAngle);
                    arcOver.endAngle(endAngle);
                }
                if (donut) {
                    arc.innerRadius(arcsRadiusInner[i]);
                    arcOver.innerRadius(arcsRadiusInner[i]);
                }

                if (arc.cornerRadius && cornerRadius) {
                    arc.cornerRadius(cornerRadius);
                    arcOver.cornerRadius(cornerRadius);
                }

                arcs.push(arc);
                arcsOver.push(arcOver);
            }

            // Setup the Pie chart and choose the data element
            var pieData = d3.layout.pie()
                .sort(null)
                .value(function(d) { return d.disabled ? 0 : getY(d) });

            // padAngle added in d3 3.5
            if (pieData.padAngle && padAngle) {
                pieData.padAngle(padAngle);
            }

            // if title is specified and donut, put it in the middle
            if (donut && title) {
                g_pie.append("text").attr('class', 'nv-pie-title');

                wrap.select('.nv-pie-title')
                    .style("text-anchor", "middle")
                    .text(function (d) {
                        return title;
                    })
                    .style("font-size", (Math.min(availableWidth, availableHeight)) * donutRatio * 2 / (title.length + 2) + "px")
                    .attr("dy", "0.35em") // trick to vertically center text
                    .attr('transform', function(d, i) {
                        return 'translate(0, '+ titleOffset + ')';
                    });
            }

            var slices = wrap.select('.nv-pie').selectAll('.nv-slice').data(pieData);
            var pieLabels = wrap.select('.nv-pieLabels').selectAll('.nv-label').data(pieData);
            pieInfo = wrap.select('.nv-pieInfo').datum(pieData);

            slices.exit().remove();
            pieLabels.exit().remove();

            var ae = slices.enter().append('g');
            ae.attr('class', 'nv-slice');
            ae.on('mouseover', function(d, i) {
                d3.select(this).classed('hover', true);
                if (growOnHover) {
                    d3.select(this).select("path").transition()
                        .duration(70)
                        .attr("d", arcsOver[i]);
                }

                if ( donut ){
                    pieInfo.select('.key text').text(getX(d.data)).each(pieInfoTextWrap);
                    pieInfo.select('.value text').text( valueFormat(d.value) );

                    if ( d.data.previous ) {
                        var b = getY(d.data.previous, i);
                        var t = refFormat(b > 0 ? (d.value - b) / b : null)
                        pieInfo.select('.ref text').text(t);
                        pieInfo.select('.ref').classed('positive', negateTrend ? d.value < b : d.value > b );
                        pieInfo.select('.ref').classed('negative', negateTrend ? d.value > b : d.value < b );
                    }
     
                    var selectedData = getSelectedData();
                    if (!d.data.previous && !selectedData.length) {
                        var width = chart.width();
                        var height = chart.height();

                        pieInfo
                            .select('.ref text')
                            .text('Click to filter');

                        if((Math.min(width, height)) * donutRatio < 100) {
                            pieInfo
                                .select('.ref text')
                                .attr('transform', 'translate(0, -4)')
                                .style("font-size", "10px")
                        }

                        pieInfo.attr('transform', 'translate(' + width / 2 + ',' + height / 2 + ')');
                    }
                }

                if (dispatchElementMouseover) {
                    dispatch.elementMouseover({
                        data: d.data,
                        index: i,
                        color: d3.select(this).style('fill'),
                        element: this
                    });
                }
            });

            ae.on('mouseout', function(d, i) {
                d3.select(this).classed('hover', false);
                if (growOnHover) {
                    d3.select(this).select("path").transition()
                        .duration(50)
                        .attr("d", arcs[i]);
                }

                donutInfo();
                pieInfo.attr('transform', 'translate(' + chart.width() / 2 + ',' + chart.height() / 2 + ')');
                dispatch.elementMouseout({data: d.data, index: i, element: this});
            });
            ae.on('mousemove', function(d, i) {
                dispatch.elementMousemove({data: d.data, index: i, element: this});
            });
            ae.on('click', function(d, i) {
                var element = this;

                d.data.selected = !d.data.selected;
                d3.select(this).classed('selected', d.data.selected);

                donutInfo();

                dispatch.elementClick({
                    data: d.data,
                    index: i,
                    color: d3.select(this).style("fill"),
                    event: d3.event,
                    element: element
                });

            });
            ae.on('dblclick', function(d, i) {
                dispatch.elementDblClick({
                    data: d.data,
                    index: i,
                    color: d3.select(this).style("fill")
                });
            });

            slices.attr('fill', function(d,i) { return color(d.data, i); });
            slices.attr('stroke', function(d,i) { return color(d.data, i); });

            var paths = ae.append('path').attr('class', 'nv-slice-path').each(function(d) {
                this._current = d;
            });

            if ( showChecks ) {
                ae.append('path').attr('class', 'nv-check')
                    .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
            }

            slices.classed('selected', function(d){ return d.value > 0 && d.data.selected; })

            donutInfo();

            function pieInfoTextWrap() {
                var self = d3.select(this),
                    textLength = self.node().getComputedTextLength(),
                    text = self.text(),
                    radius = Math.min(chart.width(), chart.height()) / 2;
                while (textLength > radius - 8 && text.length > 0) {
                    text = text.slice(0, -1);
                    self.text(text + '...');
                    textLength = self.node().getComputedTextLength();
                }
            }

            function getTotalOfData(pieData) {
                return d3.sum(pieData, function (d) {
                    return d.value;
                });
            }

            function getSelectedData() {
                var pieData = pieInfo.datum(),
                    selected =
                        pieData.length > 1
                            ? pieData.filter(function (d) {
                                  return d.data.selected;
                              })
                            : pieData;

                return selected;
            }

            function donutInfo(){
                if ( donut) {
                    var pieData = pieInfo.datum(),
                        selected = pieData.length > 1 ? pieData.filter(function(d){ return d.data.selected;}) : pieData,
                        num = selected.length,
                        sum = d3.sum( selected, function(d){ return d.value;});

                    var keyText = showTotal ? 'Total' : 'Click to filter...';
                    var valueText = showTotal ? valueFormat(getTotalOfData(pieData)) : '';

                    pieInfo
                        .select('.key text')
                        .text(num > 0 ? (num === 1 ? getX(selected[0].data) : num + ' selected') : keyText)
                        .each(pieInfoTextWrap);

                    pieInfo.select('.value text').text(num > 0 ? valueFormat(sum) : valueText);

                    if ( num === 1 && selected.length > 0) {
                        var d = selected[0];

                        if ( d.data.previous ) {
                            var b = getY(d.data.previous);
                            var t = refFormat(b > 0 ? (d.value - b) / b : null)
                            pieInfo.select('.ref text').text(t);
                            pieInfo.select('.ref').classed('positive', negateTrend ? d.value < b : d.value > b );
                            pieInfo.select('.ref').classed('negative', negateTrend ? d.value > b : d.value < b );
                        }
                        else {
                            pieInfo.select('.ref text').text('');
                        }
                    }
                    else {
                        pieInfo.select('.ref text').text('');
                    }
                }
            }



            slices.select('path.nv-slice-path')
                .transition()
                .attr('d', function (d, i) { return arcs[i](d); })
                .attrTween('d', arcTween);

            if ( showChecks ) {
                slices.select('path.nv-check')
                    .attr('transform', function (d, i) {
                        var center = arcs[i].centroid(d).map(function (v) {
                            return isNaN(v) ? 0 : v - 10;
                        });
                        return 'translate(' + center + ')';
                    });
            }

            if (showLabels) {
                // This does the normal label
                var labelsArc = [];
                for (var i = 0; i < data[0].length; i++) {
                    labelsArc.push(arcs[i]);

                    if (labelsOutside) {
                        if (donut) {
                            labelsArc[i] = d3.svg.arc().outerRadius(arcs[i].outerRadius());
                            if (startAngle !== false) labelsArc[i].startAngle(startAngle);
                            if (endAngle !== false) labelsArc[i].endAngle(endAngle);
                        }
                    } else if (!donut) {
                            labelsArc[i].innerRadius(0);
                    }
                }

                pieLabels.enter().append("g").classed("nv-label",true).each(function(d,i) {
                    var group = d3.select(this);

                    group.attr('transform', function (d, i) {
                        if (labelSunbeamLayout) {
                            d.outerRadius = arcsRadiusOuter[i] + 10; // Set Outer Coordinate
                            d.innerRadius = arcsRadiusOuter[i] + 15; // Set Inner Coordinate
                            var rotateAngle = (d.startAngle + d.endAngle) / 2 * (180 / Math.PI);
                            if ((d.startAngle + d.endAngle) / 2 < Math.PI) {
                                rotateAngle -= 90;
                            } else {
                                rotateAngle += 90;
                            }
                            return 'translate(' + labelsArc[i].centroid(d) + ') rotate(' + rotateAngle + ')';
                        } else {
                            d.outerRadius = radius + 10; // Set Outer Coordinate
                            d.innerRadius = radius + 15; // Set Inner Coordinate
                            return 'translate(' + labelsArc[i].centroid(d) + ')'
                        }
                    });

                    group.append('rect')
                        .style('stroke', '#fff')
                        .style('fill', '#fff')
                        .attr("rx", 3)
                        .attr("ry", 3);

                    group.append('text')
                        .style('text-anchor', labelSunbeamLayout ? ((d.startAngle + d.endAngle) / 2 < Math.PI ? 'start' : 'end') : 'middle') //center the text on it's origin or begin/end if orthogonal aligned
                        .style('fill', '#000')
                });

                var labelLocationHash = {};
                var avgHeight = 14;
                var avgWidth = 140;
                var createHashKey = function(coordinates) {
                    return Math.floor(coordinates[0]/avgWidth) * avgWidth + ',' + Math.floor(coordinates[1]/avgHeight) * avgHeight;
                };
                var getSlicePercentage = function(d) {
                    return (d.endAngle - d.startAngle) / (2 * Math.PI);
                };

                pieLabels.watchTransition(renderWatch, 'pie labels').attr('transform', function (d, i) {
                    if (labelSunbeamLayout) {
                        d.outerRadius = arcsRadiusOuter[i] + 10; // Set Outer Coordinate
                        d.innerRadius = arcsRadiusOuter[i] + 15; // Set Inner Coordinate
                        var rotateAngle = (d.startAngle + d.endAngle) / 2 * (180 / Math.PI);
                        if ((d.startAngle + d.endAngle) / 2 < Math.PI) {
                            rotateAngle -= 90;
                        } else {
                            rotateAngle += 90;
                        }
                        return 'translate(' + labelsArc[i].centroid(d) + ') rotate(' + rotateAngle + ')';
                    } else {
                        d.outerRadius = radius + 10; // Set Outer Coordinate
                        d.innerRadius = radius + 15; // Set Inner Coordinate

                        /*
                        Overlapping pie labels are not good. What this attempts to do is, prevent overlapping.
                        Each label location is hashed, and if a hash collision occurs, we assume an overlap.
                        Adjust the label's y-position to remove the overlap.
                        */
                        var center = labelsArc[i].centroid(d);
                        var percent = getSlicePercentage(d);
                        if (d.value && percent >= labelThreshold) {
                            var hashKey = createHashKey(center);
                            if (labelLocationHash[hashKey]) {
                                center[1] -= avgHeight;
                            }
                            labelLocationHash[createHashKey(center)] = true;
                        }
                        return 'translate(' + center + ')'
                    }
                });

                pieLabels.select(".nv-label text")
                    .style('text-anchor', function(d,i) {
                        //center the text on it's origin or begin/end if orthogonal aligned
                        return labelSunbeamLayout ? ((d.startAngle + d.endAngle) / 2 < Math.PI ? 'start' : 'end') : 'middle';
                    })
                    .text(function(d, i) {
                        var percent = getSlicePercentage(d);
                        var label = '';
                        if (!d.value || percent < labelThreshold) return '';

                        if(typeof labelType === 'function') {
                            label = labelType(d, i, {
                                'key': getX(d.data),
                                'value': getY(d.data),
                                'percent': valueFormat(percent)
                            });
                        } else {
                            switch (labelType) {
                                case 'key':
                                    label = getX(d.data);
                                    break;
                                case 'value':
                                    label = valueFormat(getY(d.data));
                                    break;
                                case 'percent':
                                    label = d3.format('%')(percent);
                                    break;
                            }
                        }
                        return label;
                    })
                ;
            }


            // Computes the angle of an arc, converting from radians to degrees.
            function angle(d) {
                var a = (d.startAngle + d.endAngle) * 90 / Math.PI - 90;
                return a > 90 ? a - 180 : a;
            }

            function arcTween(a, idx) {
                a.endAngle = isNaN(a.endAngle) ? 0 : a.endAngle;
                a.startAngle = isNaN(a.startAngle) ? 0 : a.startAngle;
                if (!donut) a.innerRadius = 0;
                var i = d3.interpolate(this._current, a);
                this._current = i(0);
                return function (t) {
                    return arcs[idx](i(t));
                };
            }
        });

        renderWatch.renderEnd('pie immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        arcsRadius: { get: function () { return arcsRadius; }, set: function (_) { arcsRadius = _; } },
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showChecks: {get: function(){return showChecks;}, set: function(_){showChecks=_;}},
        showLabels: {get: function(){return showLabels;}, set: function(_){showLabels=_;}},
        title:      {get: function(){return title;}, set: function(_){title=_;}},
        titleOffset:    {get: function(){return titleOffset;}, set: function(_){titleOffset=_;}},
        labelThreshold: {get: function(){return labelThreshold;}, set: function(_){labelThreshold=_;}},
        valueFormat:    {get: function(){return valueFormat;}, set: function(_){valueFormat=_;}},
        x:          {get: function(){return getX;}, set: function(_){getX=_;}},
        id:         {get: function(){return id;}, set: function(_){id=_;}},
        endAngle:   {get: function(){return endAngle;}, set: function(_){endAngle=_;}},
        startAngle: {get: function(){return startAngle;}, set: function(_){startAngle=_;}},
        padAngle:   {get: function(){return padAngle;}, set: function(_){padAngle=_;}},
        cornerRadius: {get: function(){return cornerRadius;}, set: function(_){cornerRadius=_;}},
        negateTrend: {get: function(){return negateTrend;}, set: function(_){negateTrend=_;}},
        donutRatio:   {get: function(){return donutRatio;}, set: function(_){donutRatio=_;}},
        labelsOutside: {get: function(){return labelsOutside;}, set: function(_){labelsOutside=_;}},
        labelSunbeamLayout: {get: function(){return labelSunbeamLayout;}, set: function(_){labelSunbeamLayout=_;}},
        donut:              {get: function(){return donut;}, set: function(_){donut=_;}},
        growOnHover:        {get: function(){return growOnHover;}, set: function(_){growOnHover=_;}},
        sliceExplode: {
            get: function () {
                return sliceExplode;
            },
            set: function (_) {
                sliceExplode(_);
            }
        },
        showTotal: {
            get: function () {
                return showTotal;
            },
            set: function (_) {
                showTotal = _;
            }
        },
        // depreciated after 1.7.1
        pieLabelsOutside: {get: function(){return labelsOutside;}, set: function(_){
            labelsOutside=_;
            nv.deprecated('pieLabelsOutside', 'use labelsOutside instead');
        }},
        // depreciated after 1.7.1
        donutLabelsOutside: {get: function(){return labelsOutside;}, set: function(_){
            labelsOutside=_;
            nv.deprecated('donutLabelsOutside', 'use labelsOutside instead');
        }},
        // deprecated after 1.7.1
        labelFormat: {get: function(){ return valueFormat;}, set: function(_) {
            valueFormat=_;
            nv.deprecated('labelFormat','use valueFormat instead');
        }},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
            margin.right  = typeof _.right  != 'undefined' ? _.right  : margin.right;
            margin.bottom = typeof _.bottom != 'undefined' ? _.bottom : margin.bottom;
            margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        }},
        y: {get: function(){return getY;}, set: function(_){
            getY=d3.functor(_);
        }},
        color: {get: function(){return color;}, set: function(_){
            color=nv.utils.getColor(_);
        }},
        labelType:          {get: function(){return labelType;}, set: function(_){
            labelType= _ || 'key';
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};
nv.models.pieChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var pie = nv.models.pie();
    var legend = nv.models.legend();
    var tooltip = nv.models
        .tooltip()
        .duration(0)
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return d;
        });

    var legendTooltip = nv.utils.createLegendTooltip(function (d, i) {
        return pie.valueFormat()(d, i);
    });

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , showLegend = true
        , showTooltips = false
        , legendPosition = "top"
        , color = nv.utils.defaultColor()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , duration = 250
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd', 'selectChange')
        , showLegendTooltips = true
        , pieDataTotal = 0;

    legend.showNativeTooltip(false);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled })
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined) {
                data.forEach(function (series, i) {
                    series.disabled = !state.active[i];
                });
            }
        }
    };

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(pie);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.container = this;
            tooltip.chartContainer(chart.container.parentNode);

            state.setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            //set state.disabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            data = data.filter( function(d){
                return pie.y()(d) > 0.0;
            });

            pieDataTotal = data.reduce(function (acc, d) {
                return (acc += pie.y()(d));
            }, 0);

            // Display No Data message if there's nothing to show.
            if (!data || !data.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-pieChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-pieChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-pieWrap');

            nv.utils.removeExternalLegend(chart.container);

            // Legend
            var newLegend;
            if (showLegend) {
                legend
                    .updateState(!pie.showChecks())
                    .key(pie.x())
                    .value(pie.y());

                var legendLayout = nv.utils.renderExternalLegend({
                    legend: legend,
                    data: data,
                    containerEl: chart.container,
                    d3Container: container,
                    position: legendPosition,
                    availableWidth: availableWidth,
                    availableHeight: availableHeight,
                    margin: margin,
                    height: height,
                    rightColumnCount: 'adaptive-fit',
                    rightAlign: false,
                    shrinkChartWidth: true
                });

                newLegend = legendLayout.legendElement;
                availableWidth = legendLayout.availableWidth;
                availableHeight = legendLayout.availableHeight;
                margin = legendLayout.margin;

                nv.utils.bindLegendScrollHide(newLegend, legendTooltip);
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            pie.width(availableWidth).height(availableHeight);
            var pieWrap = g.select('.nv-pieWrap').datum([data]);
            d3.transition(pieWrap).call(pie);

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch
                .on('stateChange', function (newState) {
                    for (var key in newState)
                        state[key] = newState[key];
                    dispatch.stateChange(state);
                    chart.update();
                })
                .on('legendClick', function (d, i) {
                    d.selected = !d.selected;
                    dispatch.selectChange(d);
                    legendTooltip.hidden(true);
                    // chart.update();
                })
                .on('legendMouseover.tooltip', function (d) {
                    if (!showLegendTooltips) return;

                    nv.utils.showLegendTooltipAt(legendTooltip, d, {
                        key: d.data[0],
                        value: d.data[1],
                        color: d.color
                    });

                    pie.sliceExplode({
                        data: d.data,
                        explode: true
                    });
                })
                .on('legendMouseout.tooltip', function (d) {
                    if (!showLegendTooltips) return;
                    legendTooltip.hidden(true);
                    pie.sliceExplode({
                        data: d.data,
                        explode: false
                    });
                });


            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });
                    state.disabled = e.disabled;
                }
                chart.update();
            });
        });

        renderWatch.renderEnd('pieChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    pie.dispatch.on('elementMouseover.tooltip', function(evt) {
        if (!showTooltips) return;
        var percentage = d3.format('.0%')(chart.y()(evt.data) / pieDataTotal);

        evt['series'] = {
            key: chart.x()(evt.data),
            value: percentage,
            color: evt.color
        };

        tooltip.data(evt).hidden(false);
    });

    pie.dispatch.on('elementMouseout.tooltip', function(evt) {
        if (!showTooltips)
            return;
        tooltip.hidden(true);
    });

    pie.dispatch.on('elementMousemove.tooltip', function(evt) {
        if (!showTooltips)
            return;
        tooltip();
    });

    pie.dispatch.on('elementClick.select', function(evt){
        dispatch.selectChange(evt);
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.legend = legend;
    chart.dispatch = dispatch;
    chart.pie = pie;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
        showLegend:     {get: function(){return showLegend;},     set: function(_){showLegend=_;}},
        showChecks:     {get: function(){return pie.showChecks();},     set: function(_){pie.showChecks(_);}},
        legendPosition: {get: function(){return legendPosition;}, set: function(_){legendPosition=_;}},
        defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},
        keyFormat:      {get: function(){return legend.keyFormat();}, set: function(_){legend.keyFormat(_);}},
        showLegendValues: {
            get: function () {
                return legend.showLegendValues();
            },
            set: function (_) {
                legend.showLegendValues(_);
            }
        },
        showLegendTooltips: {
            get: function () {
                return showLegendTooltips;
            },
            set: function (_) {
                showLegendTooltips = _;
            }
        },
        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            legend.color(color);
            pie.color(color);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }},
        showTooltips:  {get: function(){return showTooltips;},     set: function(_){showTooltips=_;}},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });
    nv.utils.inheritOptions(chart, pie);
    nv.utils.initOptions(chart);
    return chart;
};
// based on http://bl.ocks.org/kerryrodden/477c1bfb081b783f80ad
nv.models.sankey = function () {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , font = 'serif'
    //, groupColorByParent = true
        , duration = 500
        , meterWidth = 7
        , x = d3.scale.linear()
        , y = d3.scale.linear()
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'nodeClick', 'linkClick', 'nodeDblClick', 'elementMousemove', 'elementMouseover', 'elementMouseout', 'renderEnd')
        , formatName = function (d) {
            return d.name;
        }
        , format = function (d) {
            return d3.format(",.1f")(d);
        }
        , labels = false
        , meters = false
        ;

    var sankey = d3.sankey()
        .nodeWidth(30)
        .nodePadding(10);


    var path = sankey.link();

    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();

        selection.each(function (data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin);
            var availableHeight = nv.utils.availableHeight(height, container, margin);

            x.range([0, availableWidth - sankey.nodeWidth()]);

            y.range([0, availableHeight]);

            x.domain([0, availableWidth]);
            y.domain([0, availableHeight]);

/*
            var zoom = d3.behavior.zoom()
                .scaleExtent([1, 4])
                .on("zoom", function () {
                    container.selectAll('.node')
                        .attr("transform", function (d) {
                            return "translate(" + x(d.x) + "," + d.y + ")";
                        });

                    container.selectAll('.link')
                        .attr("d", linkPath);
                }).x(x);
*/

            var linkPath = (function () {
                var curvature = .5;

                function link(d) {
                    var x0 = x(d.sourceNode.x) + d.sourceNode.dx,
                        x1 = x(d.targetNode.x) ,
                        xi = d3.interpolateNumber(x0, x1),
                        x2 = xi(curvature),
                        x3 = xi(1 - curvature),
                        y0 = (d.sourceNode.y) + d.sy + d.dy / 2,
                        y1 = (d.targetNode.y) + d.ty + d.dy / 2;
                    return "M" + x0 + "," + y0
                        + "C" + x2 + "," + y0
                        + " " + x3 + "," + y1
                        + " " + x1 + "," + y1;
                }

                link.curvature = function (_) {
                    if (!arguments.length) return curvature;
                    curvature = +_;
                    return link;
                };
                return link;
            })();

            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-sankey').data([data], function () {
                return data;
            });
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sankey nv-chart-' + id);

            wrapEnter
                .append("clipPath")
                .attr("id", "clip-" + id)
                .append("rect")
                .attr("x", 0)
                .attr("y", 0);

            wrap
                .select("clipPath#clip-" + id)
                .select("rect")
                .attr("width", availableWidth)
                .attr("height", availableHeight);

/*
            wrapEnter.append("rect")
                .attr("class", "pane")
                .attr("x", 0)
                .attr("y", 0);
*/

            var g = container.select('.nv-wrap.nv-sankey');

/*
            g.select("rect.pane")
                .attr("width", availableWidth)
                .attr("height", availableHeight)
                .call(zoom);
*/

            if (data.nodes && data.nodes.length) {
                sankey
                    .size([availableWidth, availableHeight])
                    .nodes(data.nodes)
                    .links(data.links.filter(function (l) {
                        return l.disabled !== true;
                    }))
                    .layout(32);

                var linkWrap = g.selectAll('g.linkWrap')
                    .data([data.links])
                    .enter()
                    .append('g')
                    .attr('class', 'linkWrap')
                    .attr("clip-path", "url(#clip-" + id + ")");

                linkWrap = g.selectAll('g.linkWrap');

                var link = linkWrap.selectAll(".link")
                    .data(data.links.filter(function (l) {
                        return l.disabled !== true;
                    }), function (d) {
                        return d.source + "::" + d.target;
                    });

                var linkEnter = link.enter().append("path")
                    .attr("class", "link")
                    .on('click', function (d, i) {
                        dispatch.linkClick({
                            data: d,
                            i: i
                        });
                    });

                linkEnter.append("title")
                    .text(function (d) {
                        return formatName(d.sourceNode) + "=" + formatName(d.targetNode) + ":" + format(d.value);
                    });

                link
                    .style('opacity', 0.1)
                    .attr("d", linkPath)
                    .sort(function (a, b) {
                        return b.dy - a.dy; // so that the lighter link will be hover-able
                    });

                var nodeWrap = g.selectAll('g.nodeWrap')
                    .data([data.nodes])
                    .enter()
                    .append('g')
                    .attr('class', 'nodeWrap')
                    .attr("clip-path", "url(#clip-" + id + ")");

                nodeWrap = g.selectAll('g.nodeWrap');

                var dataNodes = data.nodes.filter(function (n) {
                    return n.value > 0;
                });

                var node = nodeWrap.selectAll(".node")
                    .data(dataNodes, function (d) {
                        return d.name;
                    });

                var nodeEnter = node
                    .enter().append("g")
                    .attr("class", "node")
                    /*
                     .call(d3.behavior.drag()
                        .origin(function (d) {
                            return d;
                        })
                        .on("dragstart", function () {
                            this.parentNode.appendChild(this);
                        })
                     .on("drag", dragmove))
                     */
                    .on('mouseover', function (d, i) {
                        d3.select(this)
                            .classed('hover', true)
                            .style('opacity', 0.8);

                        dispatch.elementMouseover({
                            data: d,
                            i: i
                        });

                    })
                    .on('mouseout', function (d, i) {
                        d3.select(this).classed('hover', false).style('opacity', 1);

                        dispatch.elementMouseout({
                            data: d,
                            i: i
                        });

                    })
                    /*.on('click', function (d, i) {
                        d.selected = !d.selected;
                        d3.select(this).classed('selected', d.selected);
                        dispatch.nodeClick({
                            data: d,
                            i: i
                        });
                    })*/;
                    /*
                     .on('dblclick', function (d, i) {
                     //d3.select(this).classed('hover', false).style('opacity', 1);
                     dispatch.nodeDblClick({
                     data: d,
                     i: i
                     });
                     })
                     */


                nodeEnter.append("rect")
                    .attr("width", sankey.nodeWidth())
                    .on('click', function (d, i) {
                        dispatch.nodeClick({
                            data: d,
                            i: i
                        });
                    });

                if ( meters ) {
                    nodeEnter.append('line')
                        .attr('class', 'meter')
                        .attr('x1', sankey.nodeWidth() - meterWidth/2)
                        .attr('x2', sankey.nodeWidth() - meterWidth/2)
                        .attr('y1', 0)
                        .attr('y2', 0)
/*                        .append("title")
                        .text(function (d) {
                            return "leak ratio " + format(100 - d.ratio) + "%";
                        })*/;
                }

                nodeEnter.append('path')
                    .attr('class', 'check')
                    .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z')
                    .attr('transform', function(d){ return "translate(" + (sankey.nodeWidth()/2-12) + ",3)" })
/*                    .on('click', function (d, i) {
                        //d3.select(this).classed('hover', false).style('opacity', 1);
                        dispatch.nodeClick({
                            data: d,
                            i: i,
                            action: 'check'
                        });
                    })
                    .append("title")
                    .text(function (d) {
                        return "mark flow-through";
                    })*/;

/*
                nodeEnter.append('path')
                    .attr('class', 'flow-down')
                    .attr('d', 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z')
                    .attr('transform', function(d){ return "translate(" + (sankey.nodeWidth()/2) + "," + (d.dy/2 + 8) + ")" })
                    .on('click', function (d, i) {
                        //d3.select(this).classed('hover', false).style('opacity', 1);
                        dispatch.nodeClick({
                            data: d,
                            i: i,
                            action: 'down'
                        });
                    })
                    .append("title")
                    .text(function (d) {
                        return "mark downstream flows";
                    });
*/

/*
                nodeEnter.append('path')
                    .attr('class', 'flow-up')
                    .attr('d', 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z')
                    .attr('transform', function(d){ return "translate(" + (sankey.nodeWidth()/2) + "," + (d.dy /2 - 8) + ")" })
                    .on('click', function (d, i) {
                        //d3.select(this).classed('hover', false).style('opacity', 1);
                        dispatch.nodeClick({
                            data: d,
                            i: i,
                            action: 'up'
                        });
                    })
                    .append("title")
                    .text(function (d) {
                        return "mark upstream flows";
                    });
*/

                if (labels) {
                    nodeEnter.append("text")
                        .attr("x", -6 + sankey.nodeWidth())
                        .attr("y", function (d) {
                            return d.dy / 2;
                        })
                        .attr("dy", ".35em")
                        .attr("text-anchor", "end")
                        .attr("transform", null)
                        .text(function (d) {
                            return formatName(d);
                        })
                        .filter(function (d) {
                            return d.x < width / 2;
                        })
                        .attr("x", 6 )
                        .attr("text-anchor", "start");
                }

                node
                    .transition().duration(duration)
                    .attr("transform", function (d) {
                        return "translate(" + x(d.x) + "," + d.y + ")";
                    })
                    .each('end', function () {

                        d3.select(this)
                            .select('line.meter')
                            .style("stroke", function (d) {
                                return color(d.ratio);
                            })
                            .style("stroke-width", meterWidth)
                            .attr("y1", function (d) {
                                return d.dy;
                            })
                            .attr("y2", function (d) {
                                return d.dy;
                            })
                            .transition()
                            .attr("y2", function (d) {
                                return Math.round(d.ratio * d.dy / 100);
                            });

/*
                        d3.select(this)
                            .select('title')
                            .text(function (d) {
                                return d.name + "\n" + format(d.value) + "\n" + format(d.ratio) + "%";
                            })
*/

                    })
                    .selectAll('rect')
                    .attr('height', function (d) {
                        return d.dy;
                    })
                    /*                    .style("fill", function (d) {
                     return d.color = color(d.ratio); /!*color(d.name.replace(/ .*!/, ""));*!/
                     })*/;

                /*
                 node
                 .selectAll('line')
                 .attr("stroke", function( d){ return color(d.ratio); } )
                 .attr("stroke-width", 2 )
                 .attr("x1", function( d){ return d.dx - 2; } )
                 .attr("x2", function( d){ return d.dx - 2; } )
                 .attr("y2", function( d){ return Math.round(d.ratio * d.dy / 100); } )
                 .attr("y1", function( d){ return d.dy; } );
                 */

                link.transition().duration(duration).delay(duration)
                    .style('opacity', 1)
                    .style("stroke-width", function (d) {
                        return Math.max(1, d.dy);
                    });

                node.each(function (d) {
                    d3.select(this).classed('selected', d.selected);
                });

                link.each(function (d) {
                    d3.select(this).classed('selected', d.selected);
                });

                node.exit().remove();
                link.exit().remove();
            }

            function dragmove(d) {


                var delta = d3.event.y - d.y;

                d.y = Math.max(0, Math.min(height - d.dy, d3.event.y));
                console.log(delta < 0 ? 'UP' : 'DOWN', d.y);


                d3.select(this).attr("transform", "translate(" + d.x + "," + d.y + ")");

                // this logic should be contained within d3.sankey
                /*
                 function _symetric(d){ return d.y + d.dy/2; }
                 g.selectAll('.node').filter(function(n){ return n.x === d.x; }).sort( function( a, b){ return _symetric(a) - _symetric(b)});
                 */

                sankey.relayout();
                g.selectAll('.link').attr("d", path);

                g.selectAll(".node")
                    .attr("transform", function (d) {
                        return "translate(" + d.x + "," + d.y + ")";
                    })

            }

            chart.update = function () {

                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };

            chart.container = this;

            container.on('click', function (d, i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });

        });

        renderWatch.renderEnd('sankey immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width: {
            get: function () {
                return width;
            }, set: function (_) {
                width = _;
            }
        },
        height: {
            get: function () {
                return height;
            }, set: function (_) {
                height = _;
            }
        },
        font: {
            get: function () {
                return font;
            }, set: function (_) {
                font = _;
            }
        },
        id: {
            get: function () {
                return id;
            }, set: function (_) {
                id = _;
            }
        },
        duration: {
            get: function () {
                return duration;
            }, set: function (_) {
                duration = _;
            }
        },
        groupColorByParent: {
            get: function () {
                return groupColorByParent;
            }, set: function (_) {
                groupColorByParent = !!_;
            }
        },

        // options that require extra logic in the setter
        margin: {
            get: function () {
                return margin;
            }, set: function (_) {
                margin.top = _.top != undefined ? _.top : margin.top;
                margin.right = _.right != undefined ? _.right : margin.right;
                margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
                margin.left = _.left != undefined ? _.left : margin.left;
            }
        },
        color: {
            get: function () {
                return color;
            }, set: function (_) {
                color = nv.utils.getColor(_);
            }
        },
        format: {
            get: function () {
                return format;
            }, set: function (_) {
                format = d3.functor(_);
            }
        },
        formatName: {
            get: function () {
                return formatName;
            }, set: function (_) {
                formatName = d3.functor(_);
            }
        },
        labels: {
            get: function () {
                return labels;
            }, set: function (_) {
                labels = _;
            }
        },
        meters: {
            get: function () {
                return meters;
            }, set: function (_) {
                meters = _;
            }
        }
    });

    nv.utils.initOptions(chart);

    return chart;
};
nv.models.sankeyChart = function () {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var sankey = nv.models.sankey();
    var tooltip = nv.models.tooltip();

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , font = 'serif'
        , id = Math.round(Math.random() * 100000)
        , defaultState = null
        , noData = null
        , duration = 250
        , dispatch = d3.dispatch('stateChange', 'changeState', 'renderEnd', 'selectChange')
        , tipContent = function(){}
        ;

    tooltip.duration(0);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    tooltip
        .headerEnabled(true)
        .headerFormatter(function(d){
            return d.name;
        })
        .valueFormatter(function (d, i) {
            return d;
        });

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(sankey);

        selection.each(function (data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function () {
                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;

            tooltip
                .chartContainer(chart.container.parentNode);

            // Display No Data message if there's nothing to show.
            if (!data || !data.nodes || !data.nodes.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var gChart = container.selectAll('g.nv-wrap.nv-sankeyChart').data([data]);
            var gChartEnter = gChart.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sankeyChart');
            //var g = gChart.select('g');

            gChartEnter.append('g').attr('class', 'nv-sankeyWrap');

            gChart.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            sankey.width(availableWidth).height(availableHeight);

            var wrap = gChart.select('.nv-sankeyWrap').datum(data);
            wrap.call(sankey);

        });

        renderWatch.renderEnd('sankeyChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    sankey.dispatch.on('elementMouseover.tooltip', function (evt) {
        //console.log(evt);

        evt['series'] = [
        /*    {
                key: evt.data.name,
                value: d3.format(",.0f")(evt.data.value || 0),
                color: evt.data.color
            }
        */
        ].concat( tipContent(evt.data) || [] );

        tooltip.data(evt).hidden(false);
    });

    sankey.dispatch.on('elementMouseout.tooltip', function (evt) {
        tooltip.hidden(true);
    });

    sankey.dispatch.on('elementMousemove.tooltip', function (evt) {
        tooltip();
    });

    sankey.dispatch.on('nodeClick.node', function (evt) {

        var d = evt.data;

        d.selected = !d.selected;

        d3.select(sankey.container).selectAll('.node').each(function(d,i){
            d3.select(this).classed('selected', d.selected );
        });

        d3.select(sankey.container).selectAll('.link').each(function(l){
            l.selected = l.sourceNode.selected && l.targetNode.selected;
            d3.select(this).classed('selected', l.selected );
        });

        dispatch.selectChange([d]);
    });

    function hasSelected( links ){
        return links && links.filter( function(l){ return l.selected; }).length > 0;
    }


    sankey.dispatch.on('linkClick.link', function (evt) {

        var link = evt.data;

        if (link.hasOwnProperty('source') && link.hasOwnProperty('target')) {

            link.selected = !link.selected;

            if ( link.selected ) {

                var idxS = link.sourceNode.selected;
                var idxT = link.targetNode.selected;

                if (!idxS || !idxT) {
                    if (!idxS) {
                        link.sourceNode.selected = true;
                    }
                    if (!idxT) {
                        link.targetNode.selected = true;
                    }
                }
            }
            else {
                delete link.selected;
                link.sourceNode.selected = hasSelected(link.sourceNode.targetLinks) || hasSelected(link.sourceNode.sourceLinks);
                link.targetNode.selected = hasSelected(link.targetNode.targetLinks) || hasSelected(link.targetNode.sourceLinks);
            }

            d3.select(sankey.container).selectAll('.link').each(function(d,i){
                d3.select(this).classed('selected', d.selected );
            });

            d3.select(sankey.container).selectAll('.node').each(function(d,i){
                d3.select(this).classed('selected', d.selected );
            });

        }

        dispatch.selectChange([link.sourceNode, link.targetNode]);
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.sankey = sankey;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData: {
            get: function () {
                return noData;
            }, set: function (_) {
                noData = _;
            }
        },
        defaultState: {
            get: function () {
                return defaultState;
            }, set: function (_) {
                defaultState = _;
            }
        },

        // options that require extra logic in the setter
        color: {
            get: function () {
                return color;
            }, set: function (_) {
                color = _;
                sankey.color(color);
            }
        },
        font: {
            get: function () {
                return font;
            }, set: function (_) {
                font = _;
                sankey.font(font);
            }
        },
        tipContent: {
            get: function () {
                return tipContent;
            }, set: function (_) {
                tipContent = d3.functor(_);
            }
        },
        duration: {
            get: function () {
                return duration;
            }, set: function (_) {
                duration = _;
                renderWatch.reset(duration);
                sankey.duration(duration);
            }
        },
        margin: {
            get: function () {
                return margin;
            }, set: function (_) {
                margin.top = _.top !== undefined ? _.top : margin.top;
                margin.right = _.right !== undefined ? _.right : margin.right;
                margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
                margin.left = _.left !== undefined ? _.left : margin.left;
            }
        }
    });
    nv.utils.inheritOptions(chart, sankey);
    nv.utils.initOptions(chart);
    return chart;
};

nv.models.scatter = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin       = {top: 0, right: 0, bottom: 0, left: 0}
        , width        = null
        , height       = null
        , color        = nv.utils.defaultColor() // chooses color
        , id           = Math.floor(Math.random() * 100000) //Create semi-unique ID incase user doesn't select one
        , container    = null
        , x            = d3.scale.linear()
        , y            = d3.scale.linear()
        , z            = d3.scale.linear() //linear because d3.svg.shape.size is treated as area
        , getX         = function(d) { return d.x } // accessor to get the x value
        , getY         = function(d) { return d.y } // accessor to get the y value
        , getLowBound  = function(d) { return nv.utils.NaNtoZero(d.low) } // accessor to get the low y value
        , getHighBound = function(d) { return nv.utils.NaNtoZero(d.high) } // accessor to get the high y value
        , getSize      = function(d) { return d.size || 1} // accessor to get the point size
        , getShape     = function(d) { return d.shape || 'circle' } // accessor to get point shape
        , forceX       = [] // List of numbers to Force into the X scale (ie. 0, or a max / min, etc.)
        , forceY       = [] // List of numbers to Force into the Y scale
        , forceSize    = [] // List of numbers to Force into the Size scale
        , interactive  = true // If true, plots a voronoi overlay for advanced point intersection
        , pointActive  = function(d) { return !d.notActive } // any points that return false will be filtered out
        , pointAlert  = function(d) { return d.alert } // any points that return true will be popped out
        , pointAlertGroup  = function(d) { return d.alertGroup } // any points that return true will be popped out
        , isLowConfidence  = function(d) { return false }
        , padData      = false // If true, adds half a data points width to front and back, for lining up a line chart with a bar chart
        , padDataOuter = .1 //outerPadding to imitate ordinal scale outer padding
        , clipEdge     = false // if true, masks points within x and y scale
        , clipVoronoi  = true // if true, masks each point with a circle... can turn off to slightly increase performance
        , showVoronoi  = false // display the voronoi areas
        , clipRadius   = function() { return 25 } // function to get the radius for voronoi point clips
        , xDomain      = null // Override x domain (skips the calculation from data)
        , yDomain      = null // Override y domain
        , xRange       = null // Override x range
        , yRange       = null // Override y range
        , sizeDomain   = null // Override point size domain
        , sizeRange    = null
        , singlePoint  = false
        , dispatch     = d3.dispatch('elementClick', 'elementDblClick', 'elementMouseover', 'elementMouseout', 'renderEnd')
        , useVoronoi   = true
        , duration     = 250
        , interactiveUpdateDelay = 300
        ;


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0, z0 // used to store previous scales
        , timeoutID
        , needsUpdate = false // Flag for when the points are visually updating, but the interactive layer is behind, to disable tooltips
        , renderWatch = nv.utils.renderWatch(dispatch, duration)
        , _sizeRange_def = [16, 256]
        ;

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            //add series index to each data point for reference
            data.forEach(function(series, i) {
                series.values.forEach(function(point) {
                    point.series = i;
                });
            });

            // Setup Scales
            // remap and flatten the data for use in calculating the scales' domains
            var seriesData = (xDomain && yDomain && sizeDomain) ? [] : // if we know xDomain and yDomain and sizeDomain, no need to calculate.... if Size is constant remember to set sizeDomain to speed up performance
                d3.merge(
                    data.map(function(d) {
                        return d.values.map(function(d,i) {
                            return { x: getX(d,i), y: getY(d,i), low: getLowBound(d, i), high: getHighBound(d, i), size: getSize(d,i) };
                        });
                    })
                );

            x   .domain(xDomain || d3.extent(seriesData.map(function(d) { return d.x; }).concat(forceX)))

            if (padData && data[0])
                x.range(xRange || [(availableWidth * padDataOuter +  availableWidth) / (2 *data[0].values.length), availableWidth - availableWidth * (1 + padDataOuter) / (2 * data[0].values.length)  ]);
            //x.range([availableWidth * .5 / data[0].values.length, availableWidth * (data[0].values.length - .5)  / data[0].values.length ]);
            else
                x.range(xRange || [0, availableWidth]);

            if (chart.yScale().name === "o") {
                var min = d3.min(seriesData.map(function (d) {
                    if (d.y !== 0) return d.y;
                }));
                y.clamp(true)
                    .domain(yDomain || d3.extent(seriesData.map(function (d) {
                        if (d.y !== 0) return d.y;
                        else return min * 0.1;
                    }).concat(forceY)))
                    .range(yRange || [availableHeight, 0]);
            } else {
                y.domain(yDomain || d3.extent(seriesData.map(function (d) {
                    return Math.max(d.y, d.high );
                }).concat(forceY)))
                    .range(yRange || [availableHeight, 0]);
            }

            z   .domain(sizeDomain || d3.extent(seriesData.map(function(d) { return d.size }).concat(forceSize)))
                .range(sizeRange || _sizeRange_def);

            // If scale's domain don't have a range, slightly adjust to make one... so a chart can show a single data point
            singlePoint = x.domain()[0] === x.domain()[1] || y.domain()[0] === y.domain()[1];

            if (x.domain()[0] === x.domain()[1])
                x.domain()[0] ?
                    x.domain([x.domain()[0] - x.domain()[0] * 0.01, x.domain()[1] + x.domain()[1] * 0.01])
                    : x.domain([-1,1]);

            if (y.domain()[0] === y.domain()[1])
                y.domain()[0] ?
                    y.domain([y.domain()[0] - y.domain()[0] * 0.01, y.domain()[1] + y.domain()[1] * 0.01])
                    : y.domain([-1,1]);

            if ( isNaN(x.domain()[0])) {
                x.domain([-1,1]);
            }

            if ( isNaN(y.domain()[0])) {
                y.domain([-1,1]);
            }

            x0 = x0 || x;
            y0 = y0 || y;
            z0 = z0 || z;

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-scatter').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-scatter nv-chart-' + id);
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            wrap.classed('nv-single-point', singlePoint);
            gEnter.append('g').attr('class', 'nv-groups');
            gEnter.append('g').attr('class', 'nv-point-paths');
            wrapEnter.append('g').attr('class', 'nv-point-clips');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + id)
                .append('rect');

            wrap.select('#nv-edge-clip-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', (availableHeight > 0) ? availableHeight+50 : 0)
                .attr('y', (availableHeight > 0) ? -50 : 0);

            g.attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + id + ')' : '');

            function updateInteractiveLayer() {
                // Always clear needs-update flag regardless of whether or not
                // we will actually do anything (avoids needless invocations).
                needsUpdate = false;

                if (!interactive) return false;

                // inject series and point index for reference into voronoi
                if (useVoronoi === true) {
                    var vertices = d3.merge(data.map(function(group, groupIndex) {
                            return group.values
                                .map(function(point, pointIndex) {
                                    // *Adding noise to make duplicates very unlikely
                                    // *Injecting series and point index for reference
                                    /* *Adding a 'jitter' to the points, because there's an issue in d3.geom.voronoi.
                                     */
                                    var pX = getX(point,pointIndex);
                                    var pY = getY(point,pointIndex);

                                    return [x(pX)+ Math.random() * 1e-4,
                                            y(pY)+ Math.random() * 1e-4,
                                        groupIndex,
                                        pointIndex, point]; //temp hack to add noise until I think of a better way so there are no duplicates
                                })
                                .filter(function(pointArray, pointIndex) {
                                    return pointActive(pointArray[4], pointIndex); // Issue #237.. move filter to after map, so pointIndex is correct!
                                })
                        })
                    );

                    if (vertices.length == 0) return false;  // No active points, we're done
                    if (vertices.length < 3) {
                        // Issue #283 - Adding 2 dummy points to the voronoi b/c voronoi requires min 3 points to work
                        vertices.push([x.range()[0] - 20, y.range()[0] - 20, null, null]);
                        vertices.push([x.range()[1] + 20, y.range()[1] + 20, null, null]);
                        vertices.push([x.range()[0] - 20, y.range()[0] + 20, null, null]);
                        vertices.push([x.range()[1] + 20, y.range()[1] - 20, null, null]);
                    }

                    // keep voronoi sections from going more than 10 outside of graph
                    // to avoid overlap with other things like legend etc
                    var bounds = d3.geom.polygon([
                        [-10,-10],
                        [-10,height + 10],
                        [width + 10,height + 10],
                        [width + 10,-10]
                    ]);

                    var voronoi = d3.geom.voronoi(vertices).map(function(d, i) {
                        return {
                            'data': bounds.clip(d),
                            'series': vertices[i][2],
                            'point': vertices[i][3]
                        }
                    });

                    // nuke all voronoi paths on reload and recreate them
                    wrap.select('.nv-point-paths').selectAll('path').remove();
                    var pointPaths = wrap.select('.nv-point-paths').selectAll('path').data(voronoi);
                    var vPointPaths = pointPaths
                        .enter().append("svg:path")
                        .attr("d", function(d) {
                            if (!d || !d.data || d.data.length === 0)
                                return 'M 0 0';
                            else
                                return "M" + d.data.join(",") + "Z";
                        })
                        .attr("id", function(d,i) {
                            return "nv-path-"+i; })
                        .attr("clip-path", function(d,i) { return "url(#nv-clip-"+id+"-"+i+")"; })
                        ;

                    // good for debugging point hover issues
                    if (showVoronoi) {
                        vPointPaths.style("fill", d3.rgb(230, 230, 230))
                            .style('fill-opacity', 0.4)
                            .style('stroke-opacity', 1)
                            .style("stroke", d3.rgb(200,200,200));
                    }

                    if (clipVoronoi) {
                        // voronoi sections are already set to clip,
                        // just create the circles with the IDs they expect
                        wrap.select('.nv-point-clips').selectAll('*').remove(); // must do * since it has sub-dom
                        var pointClips = wrap.select('.nv-point-clips').selectAll('clipPath').data(vertices);
                        var vPointClips = pointClips
                            .enter().append("svg:clipPath")
                            .attr("id", function(d, i) { return "nv-clip-"+id+"-"+i;})
                            .append("svg:circle")
                            .attr('cx', function(d) { return d[0]; })
                            .attr('cy', function(d) { return d[1]; })
                            .attr('r', clipRadius);
                    }

                    var mouseEventCallback = function(d, mDispatch) {
                        if (needsUpdate) return 0;
                        var series = data[d.series];
                        if (series === undefined) return;
                        var point  = series.values[d.point];
                        point['color'] = color(series, d.series);

                        // standardize attributes for tooltip.
                        point['x'] = getX(point);
                        point['y'] = getY(point);

                        // can't just get box of event node since it's actually a voronoi polygon
                        var box = container.node().getBoundingClientRect();
                        var scrollTop  = window.pageYOffset || document.documentElement.scrollTop;
                        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

                        var pos = {
                            left: x(getX(point, d.point)) + box.left + scrollLeft + margin.left + 10,
                            top: y(getY(point, d.point)) + box.top + scrollTop + margin.top + 10
                        };

                        mDispatch({
                            point: point,
                            series: series,
                            pos: pos,
                            relativePos: [x(getX(point, d.point)) + margin.left, y(getY(point, d.point)) + margin.top],
                            seriesIndex: d.series,
                            pointIndex: d.point
                        });
                    };

                    pointPaths
                        .on('click', function(d) {
                            mouseEventCallback(d, dispatch.elementClick);
                        })
                        .on('dblclick', function(d) {
                            mouseEventCallback(d, dispatch.elementDblClick);
                        })
                        .on('mouseover', function(d) {
                            mouseEventCallback(d, dispatch.elementMouseover);
                        })
                        .on('mouseout', function(d, i) {
                            mouseEventCallback(d, dispatch.elementMouseout);
                        });

                } else {
                    // add event handlers to points instead voronoi paths
                    wrap.select('.nv-groups').selectAll('.nv-group')
                        .selectAll('.nv-point')
                        //.data(dataWithPoints)
                        //.style('pointer-events', 'auto') // recativate events, disabled by css
                        .on('click', function(d,i) {
                            //nv.log('test', d, i);
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementClick({
                                point: point,
                                series: series,
                                pos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top], //TODO: make this pos base on the page
                                relativePos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],
                                seriesIndex: d.series,
                                pointIndex: i
                            });
                        })
                        .on('dblclick', function(d,i) {
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementDblClick({
                                point: point,
                                series: series,
                                pos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],//TODO: make this pos base on the page
                                relativePos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],
                                seriesIndex: d.series,
                                pointIndex: i
                            });
                        })
                        .on('mouseover', function(d,i) {
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementMouseover({
                                point: point,
                                series: series,
                                pos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],//TODO: make this pos base on the page
                                relativePos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],
                                seriesIndex: d.series,
                                pointIndex: i,
                                color: color(d, i)
                            });
                        })
                        .on('mouseout', function(d,i) {
                            if (needsUpdate || !data[d.series]) return 0; //check if this is a dummy point
                            var series = data[d.series],
                                point  = series.values[i];

                            dispatch.elementMouseout({
                                point: point,
                                series: series,
                                pos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],//TODO: make this pos base on the page
                                relativePos: [x(getX(point, i)) + margin.left, y(getY(point, i)) + margin.top],
                                seriesIndex: d.series,
                                pointIndex: i,
                                color: color(d, i)
                            });
                        });
                }
            }

            needsUpdate = true;

            var groups = wrap.select('.nv-groups').selectAll('.nv-group')
                .data(function(d) { return d }, function(d) { return d.key });

            groups.forEach(function(g){
                d3.selectAll(g).selectAll('.nv-alert,.nv-alert-group').remove();
            });

            groups.enter().append('g')
                .style('stroke-opacity', 1e-6)
                .style('fill-opacity', 1e-6);
            groups.exit()
                .remove();
            groups
                .attr('class', function(d,i) {
                    return (d.classed || '') + ' nv-group nv-series-' + i;
                })
                .classed('hover', function(d) { return d.hover });
            groups.watchTransition(renderWatch, 'scatter: groups')
                .style('fill', function(d,i) { return color(d, i) })
                .style('stroke', function(d,i) { return color(d, i) })
                .style('stroke-opacity', 1)
                .style('fill-opacity', .5);

            // create the points, maintaining their IDs from the original data set
            var points = groups.selectAll('path.nv-point')
                .data(function(d) {
                    return d.values.map(
                        function (point, pointIndex) {
                            return [point, pointIndex]
                        }).filter(
                            function(pointArray, pointIndex) {
                                return pointActive(pointArray[0], pointIndex)
                            })
                    });
            points.enter().append('path')
                .style('fill', function (d) { return d.color })
                .style('stroke', function (d) { return d.color })
                .attr('transform', function(d) {
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x0(getX(d[0],d[1]))) + ',' + nv.utils.NaNtoZero(y0(getY(d[0],d[1])) + yOffset) + ')'
                })
                .attr('d',
                    nv.utils.symbol()
                    .type(function(d) { return getShape(d[0]); })
                    .size(function(d) { return z(getSize(d[0],d[1])) })
            );
            points.exit().remove();
            groups.exit().selectAll('path.nv-point')
                .watchTransition(renderWatch, 'scatter exit')
                .attr('transform', function(d) {

                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + ')'
                })
                .remove();
            points.each(function(d) {
                d3.select(this)
                    .classed('nv-point', true)
                    .classed('nv-single-point', d[0].singlePoint)
                    .classed('nv-point-' + d[1], true)
                    .classed('nv-noninteractive', !interactive)
                    .classed('hover',false)
                ;
            });
            points
                .watchTransition(renderWatch, 'scatter points')
                .attr('transform', function(d) {
                    //nv.log(d, getX(d[0],d[1]), x(getX(d[0],d[1])));
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + (nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + yOffset) + ')'
                })
                .attr('d',
                    nv.utils.symbol()
                    .type(function(d) { return getShape(d[0]); })
                    .size(function(d) { return z(getSize(d[0],d[1])) })
            );


            var alerts = groups.selectAll('circle.nv-point')
                .data(function(d) {
                    return d.values.map(
                        function (point, pointIndex) {
                            return [point, pointIndex]
                        }).filter(
                        function(pointArray, pointIndex) {
                            return pointAlert(pointArray[0], pointIndex)
                        })
                });

            var alertsGroups = groups.selectAll('circle.nv-point')
                .data(function(d) {
                    return d.values.map(
                        function (point, pointIndex) {
                            return [point, pointIndex]
                        }).filter(
                        function(pointArray, pointIndex) {
                            return pointAlertGroup(pointArray[0], pointIndex)
                        })
                });
            alertsGroups.exit().remove();

            alerts.enter().append('circle')
                .classed('nv-alert', true)
                .classed('low-confident', function(d) {
                    return isLowConfidence(d[0]);
                })
                .attr('transform', function(d) {
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x0(getX(d[0],d[1]))) + ',' + nv.utils.NaNtoZero(y0(getY(d[0],d[1])) + yOffset) + ')'
                })
                .attr('r', 0);
            alerts.exit().remove();

            alertsGroups.enter()
                .append('circle')
                .classed('nv-alert-group', true)
                .classed('low-confident', function(d) {
                    return isLowConfidence(d[0]);
                })
                .attr('r', 6)                
                .attr('transform', function(d) {
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + (nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + yOffset) + ')'
                });

            alertsGroups.enter()
                .append('circle')
                .classed('nv-alert-group', true)
                .classed('low-confident', function(d) {
                    return isLowConfidence(d[0]);
                })
                .attr('r', 3)                
                .attr('transform', function(d) {
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + (nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + yOffset) + ')'
                });

            groups.exit().selectAll('circle.nv-alert,circle.nv-alert-group')
                .watchTransition(renderWatch, 'scatter exit')
                .attr('transform', function(d) {
                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + ')'
                })
                .remove();

            alerts
                .watchTransition(renderWatch, 'scatter alerts')
                .attr('transform', function(d) {
                    //nv.log(d, getX(d[0],d[1]), x(getX(d[0],d[1])));
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + (nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + yOffset) + ')'
                })
                .attr('r', 6 );

            alertsGroups
                .watchTransition(renderWatch, 'scatter alertsGroups')
                .attr('transform', function(d) {
                    var yOffset = d[0].singlePoint ? 5 : 0;
                    return 'translate(' + nv.utils.NaNtoZero(x(getX(d[0],d[1]))) + ',' + (nv.utils.NaNtoZero(y(getY(d[0],d[1]))) + yOffset) + ')'
                });

            // Delay updating the invisible interactive layer for smoother animation
            nv.utils.debounce(updateInteractiveLayer, interactiveUpdateDelay);
/*
            if( interactiveUpdateDelay )
            {
                clearTimeout(timeoutID); // stop repeat calls to updateInteractiveLayer
                timeoutID = setTimeout(updateInteractiveLayer, interactiveUpdateDelay );
            }
            else
            {
                updateInteractiveLayer();
            }
*/

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();
            z0 = z.copy();

        });
        renderWatch.renderEnd('scatter immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // utility function calls provided by this chart
    chart._calls = new function() {
        this.clearHighlights = function () {
            nv.dom.write(function() {
                container.selectAll(".nv-point.hover").classed("hover", false);
            });
            return null;
        };
        this.highlightPoint = function (seriesIndex, pointIndex, isHoverOver) {
            nv.dom.write(function() {
                container.select('.nv-groups')
                  .selectAll(".nv-series-" + seriesIndex)
                  .selectAll(".nv-point-" + pointIndex)
                  .classed("hover", isHoverOver);
            });
        };
    };

    // trigger calls from events too
    dispatch.on('elementMouseover.point', function(d) {
        if (interactive) chart._calls.highlightPoint(d.seriesIndex,d.pointIndex,true);
    });

    dispatch.on('elementMouseout.point', function(d) {
        if (interactive) chart._calls.highlightPoint(d.seriesIndex,d.pointIndex,false);
    });

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:        {get: function(){return width;}, set: function(_){width=_;}},
        height:       {get: function(){return height;}, set: function(_){height=_;}},
        xScale:       {get: function(){return x;}, set: function(_){x=_;}},
        yScale:       {get: function(){return y;}, set: function(_){y=_;}},
        pointScale:   {get: function(){return z;}, set: function(_){z=_;}},
        xDomain:      {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain:      {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        pointDomain:  {get: function(){return sizeDomain;}, set: function(_){sizeDomain=_;}},
        xRange:       {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:       {get: function(){return yRange;}, set: function(_){yRange=_;}},
        pointRange:   {get: function(){return sizeRange;}, set: function(_){sizeRange=_;}},
        forceX:       {get: function(){return forceX;}, set: function(_){forceX=_;}},
        forceY:       {get: function(){return forceY;}, set: function(_){forceY=_;}},
        forcePoint:   {get: function(){return forceSize;}, set: function(_){forceSize=_;}},
        interactive:  {get: function(){return interactive;}, set: function(_){interactive=_;}},
        pointActive:  {get: function(){return pointActive;}, set: function(_){pointActive=_;}},
        pointAlert:  {get: function(){return pointAlert;}, set: function(_){pointAlert=_;}},
        pointAlertGroup:  {get: function(){return pointAlertGroup;}, set: function(_){pointAlertGroup=_;}},
        isLowConfidence:  {get: function(){return isLowConfidence;}, set: function(_){isLowConfidence=_;}},
        padDataOuter: {get: function(){return padDataOuter;}, set: function(_){padDataOuter=_;}},
        padData:      {get: function(){return padData;}, set: function(_){padData=_;}},
        clipEdge:     {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},
        clipVoronoi:  {get: function(){return clipVoronoi;}, set: function(_){clipVoronoi=_;}},
        clipRadius:   {get: function(){return clipRadius;}, set: function(_){clipRadius=_;}},
        showVoronoi:   {get: function(){return showVoronoi;}, set: function(_){showVoronoi=_;}},
        id:           {get: function(){return id;}, set: function(_){id=_;}},
        interactiveUpdateDelay: {get:function(){return interactiveUpdateDelay;}, set: function(_){interactiveUpdateDelay=_;}},


        // simple functor options
        x:     {get: function(){return getX;}, set: function(_){getX = d3.functor(_);}},
        y:     {get: function(){return getY;}, set: function(_){getY = d3.functor(_);}},
        low:     {get: function(){return getLowBound;}, set: function(_){getLowBound = d3.functor(_);}},
        high:     {get: function(){return getHighBound;}, set: function(_){getHighBound = d3.functor(_);}},
        pointSize: {get: function(){return getSize;}, set: function(_){getSize = d3.functor(_);}},
        pointShape: {get: function(){return getShape;}, set: function(_){getShape = d3.functor(_);}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
        }},
        color: {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        useVoronoi: {get: function(){return useVoronoi;}, set: function(_){
            useVoronoi = _;
            if (useVoronoi === false) {
                clipVoronoi = false;
            }
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};

nv.models.scatterChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var scatter      = nv.models.scatter()
        , xAxis        = nv.models.axis()
        , yAxis        = nv.models.axis()
        , legend       = nv.models.legend()
        , distX        = nv.models.distribution()
        , distY        = nv.models.distribution()
        , tooltip      = nv.models.tooltip()
        ;

    var margin       = {top: 30, right: 20, bottom: 50, left: 75}
        , width        = null
        , height       = null
        , container    = null
        , color        = nv.utils.defaultColor()
        , x            = scatter.xScale()
        , y            = scatter.yScale()
        , showDistX    = false
        , showDistY    = false
        , showLegend   = true
        , showXAxis    = true
        , showYAxis    = true
        , rightAlignYAxis = false
        , state = nv.utils.state()
        , defaultState = null
        , dispatch = d3.dispatch('stateChange', 'changeState', 'renderEnd')
        , noData       = null
        , duration = 250
        ;

    scatter.xScale(x).yScale(y);
    xAxis.orient('bottom').tickPadding(10);
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickPadding(10)
    ;
    distX.axis('x');
    distY.axis('y');
    tooltip
        .headerFormatter(function(d, i) {
            return xAxis.tickFormat()(d, i);
        })
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        });

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var x0, y0
        , renderWatch = nv.utils.renderWatch(dispatch, duration);

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled })
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(scatter);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);
        if (showDistX) renderWatch.models(distX);
        if (showDistY) renderWatch.models(distY);

        selection.each(function(data) {
            var that = this;

            container = d3.select(this);
            nv.utils.initSVG(container);

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0)
                    container.call(chart);
                else
                    container.transition().duration(duration).call(chart);
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disableddisabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display noData message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container);
                renderWatch.renderEnd('scatter immediate');
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = scatter.xScale();
            y = scatter.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-scatterChart').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-scatterChart nv-chart-' + scatter.id());
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            // background for pointer events
            gEnter.append('rect').attr('class', 'nvd3 nv-background').style("pointer-events","none");

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-scatterWrap');
            gEnter.append('g').attr('class', 'nv-regressionLinesWrap');
            gEnter.append('g').attr('class', 'nv-distWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            // Legend
            if (showLegend) {
                var legendWidth = availableWidth;
                legend.width(legendWidth);

                wrap.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                wrap.select('.nv-legendWrap')
                    .attr('transform', 'translate(0' + ',' + (-margin.top) +')');
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            scatter
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    d.color = d.color || color(d, i);
                    return d.color;
                }).filter(function(d,i) { return !data[i].disabled }));

            wrap.select('.nv-scatterWrap')
                .datum(data.filter(function(d) { return !d.disabled }))
                .call(scatter);


            wrap.select('.nv-regressionLinesWrap')
                .attr('clip-path', 'url(#nv-edge-clip-' + scatter.id() + ')');

            var regWrap = wrap.select('.nv-regressionLinesWrap').selectAll('.nv-regLines')
                .data(function (d) {
                    return d;
                });

            regWrap.enter().append('g').attr('class', 'nv-regLines');

            var regLine = regWrap.selectAll('.nv-regLine')
                .data(function (d) {
                    return [d]
                });

            regLine.enter()
                .append('line').attr('class', 'nv-regLine')
                .style('stroke-opacity', 0);

            // don't add lines unless we have slope and intercept to use
            regLine.filter(function(d) {
                return d.intercept && d.slope;
            })
                .watchTransition(renderWatch, 'scatterPlusLineChart: regline')
                .attr('x1', x.range()[0])
                .attr('x2', x.range()[1])
                .attr('y1', function (d, i) {
                    return y(x.domain()[0] * d.slope + d.intercept)
                })
                .attr('y2', function (d, i) {
                    return y(x.domain()[1] * d.slope + d.intercept)
                })
                .style('stroke', function (d, i, j) {
                    return color(d, j)
                })
                .style('stroke-opacity', function (d, i) {
                    return (d.disabled || typeof d.slope === 'undefined' || typeof d.intercept === 'undefined') ? 0 : 1
                });

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize( -availableHeight , 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')')
                    .call(xAxis);
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis')
                    .call(yAxis);
            }

            // Setup Distribution
            if (showDistX) {
                distX
                    .getData(scatter.x())
                    .scale(x)
                    .width(availableWidth)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled }));
                gEnter.select('.nv-distWrap').append('g')
                    .attr('class', 'nv-distributionX');
                g.select('.nv-distributionX')
                    .attr('transform', 'translate(0,' + y.range()[0] + ')')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(distX);
            }

            if (showDistY) {
                distY
                    .getData(scatter.y())
                    .scale(y)
                    .width(availableHeight)
                    .color(data.map(function(d,i) {
                        return d.color || color(d, i);
                    }).filter(function(d,i) { return !data[i].disabled }));
                gEnter.select('.nv-distWrap').append('g')
                    .attr('class', 'nv-distributionY');
                g.select('.nv-distributionY')
                    .attr('transform', 'translate(' + (rightAlignYAxis ? availableWidth : -distY.size() ) + ',0)')
                    .datum(data.filter(function(d) { return !d.disabled }))
                    .call(distY);
            }

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined') {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });
                    state.disabled = e.disabled;
                }
                chart.update();
            });

            // mouseover needs availableHeight so we just keep scatter mouse events inside the chart block
            scatter.dispatch.on('elementMouseout.tooltip', function(evt) {
                tooltip.hidden(true);
                container.select('.nv-chart-' + scatter.id() + ' .nv-series-' + evt.seriesIndex + ' .nv-distx-' + evt.pointIndex)
                    .attr('y1', 0);
                container.select('.nv-chart-' + scatter.id() + ' .nv-series-' + evt.seriesIndex + ' .nv-disty-' + evt.pointIndex)
                    .attr('x2', distY.size());
            });

            scatter.dispatch.on('elementMouseover.tooltip', function(evt) {
                container.select('.nv-series-' + evt.seriesIndex + ' .nv-distx-' + evt.pointIndex)
                    .attr('y1', evt.relativePos[1] - availableHeight);
                container.select('.nv-series-' + evt.seriesIndex + ' .nv-disty-' + evt.pointIndex)
                    .attr('x2', evt.relativePos[0] + distX.size());
                tooltip.data(evt).hidden(false);
            });

            //store old scales for use in transitions on update
            x0 = x.copy();
            y0 = y.copy();

        });

        renderWatch.renderEnd('scatter with line immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.scatter = scatter;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.distX = distX;
    chart.distY = distY;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        container:  {get: function(){return container;}, set: function(_){container=_;}},
        showDistX:  {get: function(){return showDistX;}, set: function(_){showDistX=_;}},
        showDistY:  {get: function(){return showDistY;}, set: function(_){showDistY=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        showXAxis:  {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:  {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        defaultState:     {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:     {get: function(){return noData;}, set: function(_){noData=_;}},
        duration:   {get: function(){return duration;}, set: function(_){duration=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( (_) ? 'right' : 'left');
        }},
        color: {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
            distX.color(color);
            distY.color(color);
        }}
    });

    nv.utils.inheritOptions(chart, scatter);
    nv.utils.initOptions(chart);
    return chart;
};

nv.models.sparkline = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 2, right: 0, bottom: 2, left: 0}
        , width = 400
        , height = 32
        , container = null
        , animate = true
        , x = d3.scale.linear()
        , y = d3.scale.linear()
        , getX = function(d) { return d.x }
        , getY = function(d) { return d.y }
        , color = nv.utils.getColor(['#000'])
        , xDomain
        , yDomain
        , xRange
        , yRange
        , dispatch = d3.dispatch('renderEnd')
        ;

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    
    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            // Setup Scales
            x   .domain(xDomain || d3.extent(data, getX ))
                .range(xRange || [0, availableWidth]);

            y   .domain(yDomain || d3.extent(data, getY ))
                .range(yRange || [availableHeight, 0]);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-sparkline').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sparkline');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')')

            var paths = wrap.selectAll('path')
                .data(function(d) { return [d] });
            paths.enter().append('path');
            paths.exit().remove();
            paths
                .style('stroke', function(d,i) { return d.color || color(d, i) })
                .attr('d', d3.svg.line()
                    .x(function(d,i) { return x(getX(d,i)) })
                    .y(function(d,i) { return y(getY(d,i)) })
            );

            // TODO: Add CURRENT data point (Need Min, Mac, Current / Most recent)
            var points = wrap.selectAll('circle.nv-point')
                .data(function(data) {
                    var yValues = data.map(function(d, i) { return getY(d,i); });
                    function pointIndex(index) {
                        if (index != -1) {
                            var result = data[index];
                            result.pointIndex = index;
                            return result;
                        } else {
                            return null;
                        }
                    }
                    var maxPoint = pointIndex(yValues.lastIndexOf(y.domain()[1])),
                        minPoint = pointIndex(yValues.indexOf(y.domain()[0])),
                        currentPoint = pointIndex(yValues.length - 1);
                    return [minPoint, maxPoint, currentPoint].filter(function (d) {return d != null;});
                });
            points.enter().append('circle');
            points.exit().remove();
            points
                .attr('cx', function(d,i) { return x(getX(d,d.pointIndex)) })
                .attr('cy', function(d,i) { return y(getY(d,d.pointIndex)) })
                .attr('r', 2)
                .attr('class', function(d,i) {
                    return getX(d, d.pointIndex) == x.domain()[1] ? 'nv-point nv-currentValue' :
                            getY(d, d.pointIndex) == y.domain()[0] ? 'nv-point nv-minValue' : 'nv-point nv-maxValue'
                });
        });
        
        renderWatch.renderEnd('sparkline immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:     {get: function(){return width;}, set: function(_){width=_;}},
        height:    {get: function(){return height;}, set: function(_){height=_;}},
        xDomain:   {get: function(){return xDomain;}, set: function(_){xDomain=_;}},
        yDomain:   {get: function(){return yDomain;}, set: function(_){yDomain=_;}},
        xRange:    {get: function(){return xRange;}, set: function(_){xRange=_;}},
        yRange:    {get: function(){return yRange;}, set: function(_){yRange=_;}},
        xScale:    {get: function(){return x;}, set: function(_){x=_;}},
        yScale:    {get: function(){return y;}, set: function(_){y=_;}},
        animate:   {get: function(){return animate;}, set: function(_){animate=_;}},

        //functor options
        x: {get: function(){return getX;}, set: function(_){getX=d3.functor(_);}},
        y: {get: function(){return getY;}, set: function(_){getY=d3.functor(_);}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }}
    });

    chart.dispatch = dispatch;
    nv.utils.initOptions(chart);
    return chart;
};

nv.models.sparklinePlus = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var sparkline = nv.models.sparkline();

    var margin = {top: 15, right: 100, bottom: 10, left: 50}
        , width = null
        , height = null
        , x
        , y
        , index = []
        , paused = false
        , xTickFormat = d3.format(',r')
        , yTickFormat = d3.format(',.2f')
        , showLastValue = true
        , alignValue = true
        , rightAlignValue = false
        , noData = null
        , dispatch = d3.dispatch('renderEnd')
        ;
        
    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(sparkline);
        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() { container.call(chart); };
            chart.container = this;

            // Display No Data message if there's nothing to show.
            if (!data || !data.length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            var currentValue = sparkline.y()(data[data.length-1], data.length-1);

            // Setup Scales
            x = sparkline.xScale();
            y = sparkline.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-sparklineplus').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sparklineplus');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-sparklineWrap');
            gEnter.append('g').attr('class', 'nv-valueWrap');
            gEnter.append('g').attr('class', 'nv-hoverArea');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            var sparklineWrap = g.select('.nv-sparklineWrap');

            sparkline.width(availableWidth).height(availableHeight);
            sparklineWrap.call(sparkline);

            if (showLastValue) {
                var valueWrap = g.select('.nv-valueWrap');
                var value = valueWrap.selectAll('.nv-currentValue')
                    .data([currentValue]);

                value.enter().append('text').attr('class', 'nv-currentValue')
                    .attr('dx', rightAlignValue ? -8 : 8)
                    .attr('dy', '.9em')
                    .style('text-anchor', rightAlignValue ? 'end' : 'start');

                value
                    .attr('x', availableWidth + (rightAlignValue ? margin.right : 0))
                    .attr('y', alignValue ? function (d) {
                        return y(d)
                    } : 0)
                    .style('fill', sparkline.color()(data[data.length - 1], data.length - 1))
                    .text(yTickFormat(currentValue));
            }

            gEnter.select('.nv-hoverArea').append('rect')
                .on('mousemove', sparklineHover)
                .on('click', function() { paused = !paused })
                .on('mouseout', function() { index = []; updateValueLine(); });

            g.select('.nv-hoverArea rect')
                .attr('transform', function(d) { return 'translate(' + -margin.left + ',' + -margin.top + ')' })
                .attr('width', availableWidth + margin.left + margin.right)
                .attr('height', availableHeight + margin.top);

            //index is currently global (within the chart), may or may not keep it that way
            function updateValueLine() {
                if (paused) return;

                var hoverValue = g.selectAll('.nv-hoverValue').data(index);

                var hoverEnter = hoverValue.enter()
                    .append('g').attr('class', 'nv-hoverValue')
                    .style('stroke-opacity', 0)
                    .style('fill-opacity', 0);

                hoverValue.exit()
                    .transition().duration(250)
                    .style('stroke-opacity', 0)
                    .style('fill-opacity', 0)
                    .remove();

                hoverValue
                    .attr('transform', function(d) { return 'translate(' + x(sparkline.x()(data[d],d)) + ',0)' })
                    .transition().duration(250)
                    .style('stroke-opacity', 1)
                    .style('fill-opacity', 1);

                if (!index.length) return;

                hoverEnter.append('line')
                    .attr('x1', 0)
                    .attr('y1', -margin.top)
                    .attr('x2', 0)
                    .attr('y2', availableHeight);

                hoverEnter.append('text').attr('class', 'nv-xValue')
                    .attr('x', -6)
                    .attr('y', -margin.top)
                    .attr('text-anchor', 'end')
                    .attr('dy', '.9em');

                g.select('.nv-hoverValue .nv-xValue')
                    .text(xTickFormat(sparkline.x()(data[index[0]], index[0])));

                hoverEnter.append('text').attr('class', 'nv-yValue')
                    .attr('x', 6)
                    .attr('y', -margin.top)
                    .attr('text-anchor', 'start')
                    .attr('dy', '.9em');

                g.select('.nv-hoverValue .nv-yValue')
                    .text(yTickFormat(sparkline.y()(data[index[0]], index[0])));
            }

            function sparklineHover() {
                if (paused) return;

                var pos = d3.mouse(this)[0] - margin.left;

                function getClosestIndex(data, x) {
                    var distance = Math.abs(sparkline.x()(data[0], 0) - x);
                    var closestIndex = 0;
                    for (var i = 0; i < data.length; i++){
                        if (Math.abs(sparkline.x()(data[i], i) - x) < distance) {
                            distance = Math.abs(sparkline.x()(data[i], i) - x);
                            closestIndex = i;
                        }
                    }
                    return closestIndex;
                }

                index = [getClosestIndex(data, Math.round(x.invert(pos)))];
                updateValueLine();
            }

        });
        renderWatch.renderEnd('sparklinePlus immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.sparkline = sparkline;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:           {get: function(){return width;}, set: function(_){width=_;}},
        height:          {get: function(){return height;}, set: function(_){height=_;}},
        xTickFormat:     {get: function(){return xTickFormat;}, set: function(_){xTickFormat=_;}},
        yTickFormat:     {get: function(){return yTickFormat;}, set: function(_){yTickFormat=_;}},
        showLastValue:   {get: function(){return showLastValue;}, set: function(_){showLastValue=_;}},
        alignValue:      {get: function(){return alignValue;}, set: function(_){alignValue=_;}},
        rightAlignValue: {get: function(){return rightAlignValue;}, set: function(_){rightAlignValue=_;}},
        noData:          {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });

    nv.utils.inheritOptions(chart, sparkline);
    nv.utils.initOptions(chart);

    return chart;
};

nv.models.stackedArea = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = 960
        , height = 500
        , color = nv.utils.defaultColor() // a function that computes the color
        , id = Math.floor(Math.random() * 100000) //Create semi-unique ID incase user doesn't selet one
        , container = null
        , getX = function(d) { return d.x } // accessor to get the x value from a data point
        , getY = function(d) { return d.y } // accessor to get the y value from a data point
        , defined = function(d,i) { return !isNaN(getY(d,i)) && getY(d,i) !== null } // allows a line to be not continuous when it is not defined
        , style = 'stack'
        , offset = 'zero'
        , order = 'default'
        , interpolate = 'linear'  // controls the line interpolation
        , clipEdge = false // if true, masks lines within x and y scale
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , scatter = nv.models.scatter()
        , duration = 250
        , dispatch =  d3.dispatch('areaClick', 'areaMouseover', 'areaMouseout','renderEnd', 'elementClick', 'elementMouseover', 'elementMouseout')
        ;

    scatter
        .pointSize(2.2) // default size
        .pointDomain([2.2, 2.2]) // all the same size by default
    ;

    /************************************
     * offset:
     *   'wiggle' (stream)
     *   'zero' (stacked)
     *   'expand' (normalize to 100%)
     *   'silhouette' (simple centered)
     *
     * order:
     *   'inside-out' (stream)
     *   'default' (input order)
     ************************************/

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(scatter);
        selection.each(function(data) {
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;

            container = d3.select(this);
            nv.utils.initSVG(container);

            // Setup Scales
            x = scatter.xScale();
            y = scatter.yScale();

            var dataRaw = data;
            // Injecting point index into each point because d3.layout.stack().out does not give index
            data.forEach(function(aseries, i) {
                aseries.seriesIndex = i;
                aseries.values = aseries.values.map(function(d, j) {
                    d.index = j;
                    d.seriesIndex = i;
                    return d;
                });
            });

            var dataFiltered = data.filter(function(series) {
                return !series.disabled;
            });

            data = d3.layout.stack()
                .order(order)
                .offset(offset)
                .values(function(d) { return d.values })  //TODO: make values customizeable in EVERY model in this fashion
                .x(getX)
                .y(getY)
                .out(function(d, y0, y) {
                    d.display = {
                        y: y,
                        y0: y0
                    };
                })
            (dataFiltered);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-stackedarea').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-stackedarea');
            var defsEnter = wrapEnter.append('defs');
            var gEnter = wrapEnter.append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-areaWrap');
            gEnter.append('g').attr('class', 'nv-scatterWrap');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            
            // If the user has not specified forceY, make sure 0 is included in the domain
            // Otherwise, use user-specified values for forceY
            if (scatter.forceY().length == 0) {
                scatter.forceY().push(0);
            }
            
            scatter
                .width(availableWidth)
                .height(availableHeight)
                .x(getX)
                .y(function(d) {
                    if (d.display !== undefined) { return d.display.y + d.display.y0; }
                })
                .forceY([0])
                .color(data.map(function(d,i) {
                    d.color = d.color || color(d, d.seriesIndex);
                    return d.color;
                }));

            var scatterWrap = g.select('.nv-scatterWrap')
                .datum(data);

            scatterWrap.call(scatter);

            defsEnter.append('clipPath')
                .attr('id', 'nv-edge-clip-' + id)
                .append('rect');

            wrap.select('#nv-edge-clip-' + id + ' rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight > 0 ? availableHeight+50 : 0)
                .attr('y', availableHeight > 0 ? -50 : 0)
            ;

            g.attr('clip-path', clipEdge ? 'url(#nv-edge-clip-' + id + ')' : '');

            var area = d3.svg.area()
                .defined(defined)
                .x(function(d,i)  { return x(getX(d,i)) })
                .y0(function(d) {
                    return y(d.display.y0)
                })
                .y1(function(d) {
                    return y(d.display.y + d.display.y0)
                })
                .interpolate(interpolate);

            var zeroArea = d3.svg.area()
                .defined(defined)
                .x(function(d,i)  { return x(getX(d,i)) })
                .y0(function(d) { return y(d.display.y0) })
                .y1(function(d) { return y(d.display.y0) });

            var path = g.select('.nv-areaWrap').selectAll('path.nv-area')
                .data(function(d) { return d });

            path.enter().append('path').attr('class', function(d,i) { return 'nv-area nv-area-' + i })
                .attr('d', function(d,i){
                    return zeroArea(d.values, d.seriesIndex);
                })
                .on('mouseover', function(d,i) {
                    d3.select(this).classed('hover', true);
                    dispatch.areaMouseover({
                        point: d,
                        series: d.key,
                        pos: [d3.event.pageX, d3.event.pageY],
                        seriesIndex: d.seriesIndex
                    });
                })
                .on('mouseout', function(d,i) {
                    d3.select(this).classed('hover', false);
                    dispatch.areaMouseout({
                        point: d,
                        series: d.key,
                        pos: [d3.event.pageX, d3.event.pageY],
                        seriesIndex: d.seriesIndex
                    });
                })
                .on('click', function(d,i) {
                    d3.select(this).classed('hover', false);
                    dispatch.areaClick({
                        point: d,
                        series: d.key,
                        pos: [d3.event.pageX, d3.event.pageY],
                        seriesIndex: d.seriesIndex
                    });
                });

            path.exit().remove();
            path.style('fill', function(d,i){
                    return d.color || color(d, d.seriesIndex)
                })
                .style('stroke', function(d,i){ return d.color || color(d, d.seriesIndex) });
            path.watchTransition(renderWatch,'stackedArea path')
                .attr('d', function(d,i) {
                    return area(d.values,i)
                });

            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            scatter.dispatch.on('elementMouseover.area', function(e) {
                g.select('.nv-chart-' + id + ' .nv-area-' + e.seriesIndex).classed('hover', true);
            });
            scatter.dispatch.on('elementMouseout.area', function(e) {
                g.select('.nv-chart-' + id + ' .nv-area-' + e.seriesIndex).classed('hover', false);
            });

            //Special offset functions
            chart.d3_stackedOffset_stackPercent = function(stackData) {
                var n = stackData.length,    //How many series
                    m = stackData[0].length,     //how many points per series
                    i,
                    j,
                    o,
                    y0 = [];

                for (j = 0; j < m; ++j) { //Looping through all points
                    for (i = 0, o = 0; i < dataRaw.length; i++) { //looping through all series
                        o += getY(dataRaw[i].values[j]); //total y value of all series at a certian point in time.
                    }

                    if (o) for (i = 0; i < n; i++) { //(total y value of all series at point in time i) != 0
                        stackData[i][j][1] /= o;
                    } else { //(total y value of all series at point in time i) == 0
                        for (i = 0; i < n; i++) {
                            stackData[i][j][1] = 0;
                        }
                    }
                }
                for (j = 0; j < m; ++j) y0[j] = 0;
                return y0;
            };

        });

        renderWatch.renderEnd('stackedArea immediate');
        return chart;
    }

    //============================================================
    // Global getters and setters
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.scatter = scatter;

    scatter.dispatch.on('elementClick', function(){ dispatch.elementClick.apply(this, arguments); });
    scatter.dispatch.on('elementMouseover', function(){ dispatch.elementMouseover.apply(this, arguments); });
    scatter.dispatch.on('elementMouseout', function(){ dispatch.elementMouseout.apply(this, arguments); });

    chart.interpolate = function(_) {
        if (!arguments.length) return interpolate;
        interpolate = _;
        return chart;
    };

    chart.duration = function(_) {
        if (!arguments.length) return duration;
        duration = _;
        renderWatch.reset(duration);
        scatter.duration(duration);
        return chart;
    };

    chart.dispatch = dispatch;
    chart.scatter = scatter;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        defined: {get: function(){return defined;}, set: function(_){defined=_;}},
        clipEdge: {get: function(){return clipEdge;}, set: function(_){clipEdge=_;}},
        offset:      {get: function(){return offset;}, set: function(_){offset=_;}},
        order:    {get: function(){return order;}, set: function(_){order=_;}},
        interpolate:    {get: function(){return interpolate;}, set: function(_){interpolate=_;}},

        // simple functor options
        x:     {get: function(){return getX;}, set: function(_){getX = d3.functor(_);}},
        y:     {get: function(){return getY;}, set: function(_){getY = d3.functor(_);}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
        }},
        style: {get: function(){return style;}, set: function(_){
            style = _;
            switch (style) {
                case 'stack':
                    chart.offset('zero');
                    chart.order('default');
                    break;
                case 'stream':
                    chart.offset('wiggle');
                    chart.order('inside-out');
                    break;
                case 'stream-center':
                    chart.offset('silhouette');
                    chart.order('inside-out');
                    break;
                case 'expand':
                    chart.offset('expand');
                    chart.order('default');
                    break;
                case 'stack_percent':
                    chart.offset(chart.d3_stackedOffset_stackPercent);
                    chart.order('default');
                    break;
            }
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            scatter.duration(duration);
        }}
    });

    nv.utils.inheritOptions(chart, scatter);
    nv.utils.initOptions(chart);

    return chart;
};

nv.models.stackedAreaChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var stacked = nv.models.stackedArea()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , controls = nv.models.legend()
        , interactiveLayer = nv.interactiveGuideline()
        , tooltip = nv.models.tooltip()
        , brush = d3.svg.brush()
        ;

    var margin = {top: 30, right: 25, bottom: 50, left: 60}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , showControls = true
        , showLegend = true
        , showChecks = false
        , showXAxis = true
        , showYAxis = true
        , focusEnable = false
        , rightAlignYAxis = false
        , useInteractiveGuideline = false
        , showTotalInTooltip = true
        , totalLabel = 'TOTAL'
        , x //can be accessed via chart.xScale()
        , y //can be accessed via chart.yScale()
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd', 'brush', 'selectChange')
        , controlWidth = 250
        , controlOptions = ['Stacked','Stream','Expanded']
        , controlLabels = {}
        , duration = 250
        , headerFormat = function(d){ return d3.time.format('%b %d %H:%M')(new Date(d)); }
        ;

    state.style = stacked.style();
    xAxis.orient('bottom').tickPadding(7);
    yAxis.orient((rightAlignYAxis) ? 'right' : 'left');

    tooltip
        .headerFormatter(function(d, i) {
            return headerFormat(d, i);
        })
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        });

    interactiveLayer.tooltip
        .headerFormatter(function(d, i) {
            return headerFormat(d, i);
        })
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        });

    var oldYTickFormat = null,
        oldValueFormatter = null;

    controls.updateState(false);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    var style = stacked.style();

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled }),
                style: stacked.style()
            };
        }
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.style !== undefined)
                style = state.style;
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        }
    };

    var percentFormatter = d3.format('%');

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(stacked);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() { container.transition().duration(duration).call(chart); };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disabled
            state.disabled = data.map(function(d) { return !!d.disabled });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values && d.values.length }).length) {
                nv.utils.noData(chart, container)
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = stacked.xScale();
            y = stacked.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-stackedAreaChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-stackedAreaChart').append('g');
            var g = wrap.select('g');

            gEnter.append("rect").style("opacity",0);
            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis');
            gEnter.append('g').attr('class', 'nv-stackedWrap');
            gEnter.append('g').attr('class', 'nv-legendWrap');
            gEnter.append('g').attr('class', 'nv-controlsWrap');
            gEnter.append('g').attr('class', 'nv-interactive');

            g.select("rect").attr("width",availableWidth).attr("height",availableHeight);

            var contextEnter = gEnter.append('g').attr('class', 'nv-context');


            // Legend
            if (showLegend) {
                var legendWidth = (showControls) ? availableWidth - controlWidth : availableWidth;

                legend
                    .width(legendWidth)
                    .updateState(!showLegend);

                g.select('.nv-legendWrap').datum(data).call(legend);

                if ( margin.top != legend.height()) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.nv-legendWrap')
                    .attr('transform', 'translate(' + (availableWidth-legendWidth) + ',' + (-margin.top) +')');
            }

            // Controls
            if (showControls) {
                var controlsData = [
                    {
                        key: controlLabels.stacked || 'Stacked',
                        metaKey: 'Stacked',
                        disabled: stacked.style() != 'stack',
                        style: 'stack'
                    },
                    {
                        key: controlLabels.stream || 'Stream',
                        metaKey: 'Stream',
                        disabled: stacked.style() != 'stream',
                        style: 'stream'
                    },
                    {
                        key: controlLabels.expanded || 'Expanded',
                        metaKey: 'Expanded',
                        disabled: stacked.style() != 'expand',
                        style: 'expand'
                    },
                    {
                        key: controlLabels.stack_percent || 'Stack %',
                        metaKey: 'Stack_Percent',
                        disabled: stacked.style() != 'stack_percent',
                        style: 'stack_percent'
                    }
                ];

                controlWidth = (controlOptions.length/3) * 260;
                controlsData = controlsData.filter(function(d) {
                    return controlOptions.indexOf(d.metaKey) !== -1;
                });

                controls
                    .width( controlWidth )
                    .color(['#444', '#444', '#444']);

                g.select('.nv-controlsWrap')
                    .datum(controlsData)
                    .call(controls);

                if ( margin.top != Math.max(controls.height(), legend.height()) ) {
                    margin.top = Math.max(controls.height(), legend.height());
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                g.select('.nv-controlsWrap')
                    .attr('transform', 'translate(0,' + (-margin.top) +')');
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left: margin.left, top: margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            stacked
                .width(availableWidth)
                .height(availableHeight);

            var stackedWrap = g.select('.nv-stackedWrap')
                .datum(data);

            stackedWrap.transition().call(stacked);

            // Setup Axes
            if (showXAxis) {
                xAxis.scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize( -availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + availableHeight + ')');

                g.select('.nv-x.nv-axis')
                    .transition().duration(0)
                    .call(xAxis);
            }

            if (showYAxis) {
                var ticks;
                if (stacked.offset() === 'wiggle') {
                    ticks = 0;
                }
                else {
                    ticks = nv.utils.calcTicksY(availableHeight/36, data);
                }
                yAxis.scale(y)
                    ._ticks(ticks)
                    .tickSize(-availableWidth, 0);

                    if (stacked.style() === 'expand' || stacked.style() === 'stack_percent') {
                        var currentFormat = yAxis.tickFormat();

                        if ( !oldYTickFormat || currentFormat !== percentFormatter )
                            oldYTickFormat = currentFormat;

                        //Forces the yAxis to use percentage in 'expand' mode.
                        yAxis.tickFormat(percentFormatter);
                    }
                    else {
                        if (oldYTickFormat) {
                            yAxis.tickFormat(oldYTickFormat);
                            oldYTickFormat = null;
                        }
                    }

                g.select('.nv-y.nv-axis')
                    .transition().duration(0)
                    .call(yAxis);
            }

            if( focusEnable )
            {
                // Setup Brush
                brush
                    .x(x)
                    .clear()
                    .on('brushend', function() {
                        onBrushEnd();
                    });

                var gBrush = g.select('.nv-context')
                    .call(brush)
                    .selectAll('rect')
                    .attr('height', availableHeight);

                onBrush();
            }



            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            stacked.dispatch.on('areaClick.toggle', function(e) {
                if (data.filter(function(d) { return !d.disabled }).length === 1)
                    data.forEach(function(d) {
                        d.disabled = false;
                    });
                else
                    data.forEach(function(d,i) {
                        d.disabled = (i != e.seriesIndex);
                    });

                state.disabled = data.map(function(d) { return !!d.disabled });
                dispatch.stateChange(state);

                chart.update();
            });

            legend.dispatch
                .on('stateChange', function (newState) {
                    for (var key in newState)
                        state[key] = newState[key];
                    dispatch.stateChange(state);
                    chart.update();
                }).on('legendClick', function (d, i) {
                d.selected = !d.selected;
                dispatch.selectChange(d);
                // chart.update();
            });

            controls.dispatch.on('legendClick', function(d,i) {
                if (!d.disabled) return;

                controlsData = controlsData.map(function(s) {
                    s.disabled = true;
                    return s;
                });
                d.disabled = false;

                stacked.style(d.style);


                state.style = stacked.style();
                dispatch.stateChange(state);

                chart.update();
            });

            interactiveLayer.dispatch.on('elementMousemove', function(e) {
                stacked.clearHighlights();
                var singlePoint, pointIndex, pointXLocation, allData = [], valueSum = 0;
                data
                    .filter(function(series, i) {
                        series.seriesIndex = i;
                        return !series.disabled;
                    })
                    .forEach(function(series,i) {
                        pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                        var point = series.values[pointIndex];
                        var pointYValue = chart.y()(point, pointIndex);
                        if (pointYValue != null) {
                            stacked.highlightPoint(i, pointIndex, true);
                        }
                        if (typeof point === 'undefined') return;
                        if (typeof singlePoint === 'undefined') singlePoint = point;
                        if (typeof pointXLocation === 'undefined') pointXLocation = chart.xScale()(chart.x()(point,pointIndex));

                        //If we are in 'expand' mode, use the stacked percent value instead of raw value.
                        var tooltipValue = (stacked.style() == 'expand') ? point.display.y : chart.y()(point,pointIndex);
                        allData.push({
                            key: series.key,
                            value: tooltipValue,
                            color: (function(d,i) {
                                return d.color || color(d, i);
                            })(series,series.seriesIndex),
                            stackedValue: point.display
                        });

                        if (showTotalInTooltip && stacked.style() != 'expand') {
                          valueSum += tooltipValue;
                        };
                    });

                allData.reverse();

                //Highlight the tooltip entry based on which stack the mouse is closest to.
                if (allData.length > 2) {
                    var yValue = chart.yScale().invert(e.mouseY);
                    var yDistMax = Infinity, indexToHighlight = null;
                    allData.forEach(function(series,i) {

                        //To handle situation where the stacked area chart is negative, we need to use absolute values
                        //when checking if the mouse Y value is within the stack area.
                        yValue = Math.abs(yValue);
                        var stackedY0 = Math.abs(series.stackedValue.y0);
                        var stackedY = Math.abs(series.stackedValue.y);
                        if ( yValue >= stackedY0 && yValue <= (stackedY + stackedY0))
                        {
                            indexToHighlight = i;
                            return;
                        }
                    });
                    if (indexToHighlight != null)
                        allData[indexToHighlight].highlight = true;
                }

                //If we are not in 'expand' mode, add a 'Total' row to the tooltip.
                if (showTotalInTooltip && stacked.style() != 'expand' && allData.length >= 2) {
                    allData.push({
                        key: totalLabel,
                        value: valueSum,
                        total: true
                    });
                }

                var xValue = chart.x()(singlePoint,pointIndex);

                var valueFormatter = interactiveLayer.tooltip.valueFormatter();

                // Keeps track of the tooltip valueFormatter if the chart changes to expanded view
                if (stacked.style() === 'expand' || stacked.style() === 'stack_percent') {
                    if ( !oldValueFormatter ) {
                        oldValueFormatter = valueFormatter;
                    }
                    //Forces the tooltip to use percentage in 'expand' mode.
                    valueFormatter = d3.format(".1%");
                }
                else {
                    if (oldValueFormatter) {
                        valueFormatter = oldValueFormatter;
                        oldValueFormatter = null;
                    }
                }

                interactiveLayer.tooltip
                    .chartContainer(that.parentNode)
                    .valueFormatter(valueFormatter)
                    .data(
                    {
                        value: xValue,
                        series: allData
                    }
                )();

                interactiveLayer.renderGuideLine(pointXLocation);

            });

            interactiveLayer.dispatch.on("elementMouseout",function(e) {
                stacked.clearHighlights();
            });

            // Update chart from a state object passed to event handler
            dispatch.on('changeState', function(e) {

                if (typeof e.disabled !== 'undefined' && data.length === e.disabled.length) {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }

                if (typeof e.style !== 'undefined') {
                    stacked.style(e.style);
                    style = e.style;
                }

                chart.update();
            });

            function onBrushEnd() {
                if ( brush.empty() ) {
                    dispatch.brush({extent: null, brush: brush});
                }
                else {
                    dispatch.brush({extent: brush.extent(), brush: brush});
                }
            }

            function onBrush() {

            }

        });

        renderWatch.renderEnd('stacked Area chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    stacked.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt.point['x'] = stacked.x()(evt.point);
        evt.point['y'] = stacked.y()(evt.point);
        tooltip.data(evt).hidden(false);
    });

    stacked.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true)
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.stacked = stacked;
    chart.legend = legend;
    chart.controls = controls;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.interactiveLayer = interactiveLayer;
    chart.tooltip = tooltip;

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showChecks: {get: function(){return showChecks;}, set: function(_){showChecks=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        showXAxis:      {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:    {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        focusEnable:    {get: function(){return focusEnable;}, set: function(_){focusEnable=_;}},
        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},
        showControls:    {get: function(){return showControls;}, set: function(_){showControls=_;}},
        controlLabels:    {get: function(){return controlLabels;}, set: function(_){controlLabels=_;}},
        controlOptions:    {get: function(){return controlOptions;}, set: function(_){controlOptions=_;}},
        showTotalInTooltip:      {get: function(){return showTotalInTooltip;}, set: function(_){showTotalInTooltip=_;}},
        totalLabel:      {get: function(){return totalLabel;}, set: function(_){totalLabel=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            stacked.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
            stacked.color(color);
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( rightAlignYAxis ? 'right' : 'left');
        }},
        useInteractiveGuideline: {get: function(){return useInteractiveGuideline;}, set: function(_){
            useInteractiveGuideline = !!_;
            chart.interactive(!_);
            chart.useVoronoi(!_);
            stacked.scatter.interactive(!_);
        }},
        xTickFormat: {
            get: function () {
                return xAxis.tickFormat();
            }, set: function (_) {
                xAxis.tickFormat(_);
                //x2Axis.tickFormat(_);
            }
        },
        yTickFormat: {
            get: function () {
                return yAxis.tickFormat();
            }, set: function (_) {
                yAxis.tickFormat(_);
                //y2Axis.tickFormat(_);
            }
        },
        headerFormat: {
            get: function () {
                return headerFormat;
            }, set: function (_) {
                headerFormat = d3.functor(_);
            }
        },
        valueFormat: {
            get: function () {
                return interactiveLayer.tooltip.valueFormatter();
            }, set: function (_) {
                interactiveLayer.tooltip.valueFormatter(_);
            }
        },
        keyFormat: {
            get: function () {
                return legend.keyFormat();
            }, set: function (_) {
                legend.keyFormat(_);
            }
        }
    });

    nv.utils.inheritOptions(chart, stacked);
    nv.utils.initOptions(chart);

    return chart;
};
// based on http://bl.ocks.org/kerryrodden/477c1bfb081b783f80ad
nv.models.sunburst = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , mode = "count"
        , modes = {count: function(d) { return 1; }, size: function(d) { return d.size }}
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , groupColorByParent = true
        , duration = 500
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMousemove', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;

    var x = d3.scale.linear().range([0, 2 * Math.PI]);
    var y = d3.scale.sqrt();

    var partition = d3.layout.partition()
        .sort(null)
        .value(function(d) { return 1; });

    var arc = d3.svg.arc()
        .startAngle(function(d) { return Math.max(0, Math.min(2 * Math.PI, x(d.x))); })
        .endAngle(function(d) { return Math.max(0, Math.min(2 * Math.PI, x(d.x + d.dx))); })
        .innerRadius(function(d) { return Math.max(0, y(d.y)); })
        .outerRadius(function(d) { return Math.max(0, y(d.y + d.dy)); });

    // Keep track of the current and previous node being displayed as the root.
    var node, prevNode;
    // Keep track of the root node
    var rootNode;

    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin);
            var availableHeight = nv.utils.availableHeight(height, container, margin);
            var radius = Math.min(availableWidth, availableHeight) / 2;
            var path;

            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-sunburst').data(data);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sunburst nv-chart-' + id);

            var g = wrapEnter.selectAll('nv-sunburst');

            chart.update = function() { 
                if ( duration === 0 ) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;


            wrap.attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            container.on('click', function (d, i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });

            y.range([0, radius]);

            node = node || data;
            rootNode = data[0];
            partition.value(modes[mode] || modes["count"]);
            path = g.data(partition.nodes).enter()
                .append("path")
                .attr("d", arc)
                .style("fill", function (d) {
                    if (d.color) {
                        return d.color;
                    }
                    else if (groupColorByParent) {
                        return color((d.children ? d : d.parent).name);
                    }
                    else {
                        return color(d.name);
                    }
                })
                .style("stroke", "#FFF")
                .on("click", function(d) {
                    if (prevNode !== node && node !== d) prevNode = node;
                    node = d;
                    path.transition()
                        .duration(duration)
                        .attrTween("d", arcTweenZoom(d));
                })
                .each(stash)
                .on("dblclick", function(d) {
                    if (prevNode.parent == d) {
                        path.transition()
                            .duration(duration)
                            .attrTween("d", arcTweenZoom(rootNode));
                    }
                })
                .each(stash)
                .on('mouseover', function(d,i){
                    d3.select(this).classed('hover', true).style('opacity', 0.8);
                    dispatch.elementMouseover({
                        data: d,
                        color: d3.select(this).style("fill")
                    });
                })
                .on('mouseout', function(d,i){
                    d3.select(this).classed('hover', false).style('opacity', 1);
                    dispatch.elementMouseout({
                        data: d
                    });
                })
                .on('mousemove', function(d,i){
                    dispatch.elementMousemove({
                        data: d
                    });
                });



            // Setup for switching data: stash the old values for transition.
            function stash(d) {
                d.x0 = d.x;
                d.dx0 = d.dx;
            }

            // When switching data: interpolate the arcs in data space.
            function arcTweenData(a, i) {
                var oi = d3.interpolate({x: a.x0, dx: a.dx0}, a);

                function tween(t) {
                    var b = oi(t);
                    a.x0 = b.x;
                    a.dx0 = b.dx;
                    return arc(b);
                }

                if (i == 0) {
                    // If we are on the first arc, adjust the x domain to match the root node
                    // at the current zoom level. (We only need to do this once.)
                    var xd = d3.interpolate(x.domain(), [node.x, node.x + node.dx]);
                    return function (t) {
                        x.domain(xd(t));
                        return tween(t);
                    };
                } else {
                    return tween;
                }
            }

            // When zooming: interpolate the scales.
            function arcTweenZoom(d) {
                var xd = d3.interpolate(x.domain(), [d.x, d.x + d.dx]),
                    yd = d3.interpolate(y.domain(), [d.y, 1]),
                    yr = d3.interpolate(y.range(), [d.y ? 20 : 0, radius]);
                return function (d, i) {
                    return i
                        ? function (t) {
                        return arc(d);
                    }
                        : function (t) {
                        x.domain(xd(t));
                        y.domain(yd(t)).range(yr(t));
                        return arc(d);
                    };
                };
            }

        });

        renderWatch.renderEnd('sunburst immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        mode:       {get: function(){return mode;}, set: function(_){mode=_;}},
        id:         {get: function(){return id;}, set: function(_){id=_;}},
        duration:   {get: function(){return duration;}, set: function(_){duration=_;}},
        groupColorByParent: {get: function(){return groupColorByParent;}, set: function(_){groupColorByParent=!!_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    != undefined ? _.top    : margin.top;
            margin.right  = _.right  != undefined ? _.right  : margin.right;
            margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   != undefined ? _.left   : margin.left;
        }},
        color: {get: function(){return color;}, set: function(_){
            color=nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);
    return chart;
};
nv.models.sunburstChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var sunburst = nv.models.sunburst();
    var tooltip = nv.models.tooltip();

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , id = Math.round(Math.random() * 100000)
        , defaultState = null
        , noData = null
        , duration = 250
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd')
        ;

    tooltip.duration(0);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    tooltip
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return d;
        });

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(sunburst);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;

            // Display No Data message if there's nothing to show.
            if (!data || !data.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-sunburstChart').data(data);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-sunburstChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-sunburstWrap');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            sunburst.width(availableWidth).height(availableHeight);
            var sunWrap = g.select('.nv-sunburstWrap').datum(data);
            d3.transition(sunWrap).call(sunburst);

        });

        renderWatch.renderEnd('sunburstChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    sunburst.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.data.name,
            value: evt.data.size,
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    sunburst.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    sunburst.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.sunburst = sunburst;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
        defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},

        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            sunburst.color(color);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            sunburst.duration(duration);
        }},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });
    nv.utils.inheritOptions(chart, sunburst);
    nv.utils.initOptions(chart);
    return chart;
};
// based on http://bl.ocks.org/kerryrodden/477c1bfb081b783f80ad
nv.models.treemap = function () {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , mode = "count"
        , modes = {
            count: function (d) {
                return 1;
            }, size: function (d) {
                return d.size
            }
        }
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , href = null
        , groupColorByParent = false
        , showChecks = false
        , duration = 500
        , keyFormat = function (d) { return d; }
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMousemove', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;

    var partition = d3.layout.treemap()
        .sort(null);

    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        selection.each(function (data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin);
            var availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-treemap').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-treemap nv-chart-' + id);

            chart.update = function () {
                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;


            //wrap.attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            container.on('click', function (d, i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });


            partition.value(function (d) {
                    return d.value;
                })
                .size([availableWidth, availableHeight])
                .nodes({children: data});

            var nodes = wrap.selectAll('.node')
                .data(data);

            var nodesEnter = nodes.enter()
                .append("g")
                .attr("class", "node")
                .on('mouseover', function (d, i) {
                    d3.select(this).classed('hover', true).style('opacity', 0.8);
                    dispatch.elementMouseover({
                        data: d,
                        color: d3.select(this).select('rect').style("fill")
                    });
                })
                .on('mouseout', function (d, i) {
                    d3.select(this).classed('hover', false).style('opacity', 1);
                    dispatch.elementMouseout({
                        data: d
                    });
                })
                .on('mousemove', function (d, i) {
                    dispatch.elementMousemove({
                        data: d
                    });
                })
                .on('click', function (d, i) {
                    var element = this;

                    d.selected = !d.selected;
                    d3.select(this).classed('selected', d.selected);

                    dispatch.elementClick({
                        data: d,
                        index: i,
                        color: d3.select(this).select('rect').style("fill"),
                        event: d3.event,
                        element: element
                    });
                });

            nodesEnter
                .append("rect");

            nodesEnter
                .append("clipPath").attr('id', function(d,i){ return 'clip-node-' + id + '-' + i ; })
                .append("rect");


            if (href && typeof href === 'function') {
                var a = nodesEnter
                    .append('a').attr('class', 'nv-href').attr('xlink:href', function (d) {
                        return href(d);
                    });

                a.append("text").text(function (d) {
                        return keyFormat(d.name);
                    })
                    .attr("clip-path", function(d,i){return 'url(#clip-node-' + id + '-' + i + ')'})
                    .attr("dx", ".3em")
                    .attr("dy", "1em");

                a.on('mouseover', function (d, i) {
                    d3.event.stopPropagation();
                    d3.event.preventDefault();

                    //d3.select(this).classed('hover', true).style('opacity', 0.8);
                    dispatch.elementMouseout({
                        data: d
                    });

                });

                /*a.append('path').attr('d', 'M 10 6 L 8.59 7.41 L 13.17 12 l -4.58 4.59 L 10 18 l 6 -6 Z');*/
            }
            else {
                nodesEnter
                    .append("text").text(function (d) {
                        return keyFormat(d.name);
                    })
                    .attr("clip-path", function(d, i){return 'url(#clip-node-' + id + '-' + i + ')'})
                    .attr("dx", ".3em")
                    .attr("dy", "1em");
            }

            if ( showChecks ) {
                nodesEnter.append('path').attr('class', 'nv-check')
                    .attr('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
            }

            nodes.attr("transform", function (d) {
                return "translate(" + d.x + ", " + d.y + ")";
            });

            nodes.selectAll('rect')
/*
                .transition()
                .duration(duration)
*/
                .attr("width", function (d) {
                    return d.dx;
                })
                .attr("height", function (d) {
                    return d.dy;
                })
                .style("fill", function (d, i) {
                    if (d.color) {
                        return d.color;
                    }
                    else if (groupColorByParent) {
                        return color((d.children ? d : d.parent));
                    }
                    else {
                        return color(d, d.name);
                    }
                })
                .style("stroke", "#FFF");

            if ( showChecks ) {
                nodes.select('path.nv-check')
                    .attr('transform', function (d, i) {
                        var center = [d.dx / 2 - 10, d.dy / 2 - 10];
                        return 'translate(' + center[0] + ', ' + center[1] + ')';
                    });
            }

            nodes.classed('selected', function (d) {
                return d.value > 0 && d.selected;
            });

            nodes.exit().remove();
        });

        renderWatch.renderEnd('treemap immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width: {
            get: function () {
                return width;
            }, set: function (_) {
                width = _;
            }
        },
        height: {
            get: function () {
                return height;
            }, set: function (_) {
                height = _;
            }
        },
        mode: {
            get: function () {
                return mode;
            }, set: function (_) {
                mode = _;
            }
        },
        id: {
            get: function () {
                return id;
            }, set: function (_) {
                id = _;
            }
        },
        duration: {
            get: function () {
                return duration;
            }, set: function (_) {
                duration = _;
            }
        },
        showChecks: {
            get: function () {
                return showChecks;
            }, set: function (_) {
                showChecks = _;
            }
        },
        groupColorByParent: {
            get: function () {
                return groupColorByParent;
            }, set: function (_) {
                groupColorByParent = !!_;
            }
        },

        // options that require extra logic in the setter
        margin: {
            get: function () {
                return margin;
            }, set: function (_) {
                margin.top = _.top != undefined ? _.top : margin.top;
                margin.right = _.right != undefined ? _.right : margin.right;
                margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
                margin.left = _.left != undefined ? _.left : margin.left;
            }
        },
        color: {
            get: function () {
                return color;
            }, set: function (_) {
                color = nv.utils.getColor(_);
            }
        },
        href: {
            get: function () {
                return href;
            }, set: function (_) {
                href = d3.functor(_);
            }
        },
        keyFormat: {
            get: function () {
                return keyFormat;
            }, set: function (_) {
                keyFormat = d3.functor(_);
            }
        }
    });

    nv.utils.initOptions(chart);
    return chart;
};
nv.models.treemapChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var treemap = nv.models.treemap();
    var tooltip = nv.models.tooltip();

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , id = Math.round(Math.random() * 100000)
        , defaultState = null
        , noData = null
        , duration = 250
        , valueFormat = function(d){ return d; }
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd', 'selectChange')
        ;

    tooltip.duration(0);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    tooltip
        .headerEnabled(false)
        .valueFormatter( valueFormat);

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(treemap);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;
            tooltip
                .chartContainer(chart.container.parentNode);


            // Display No Data message if there's nothing to show.
            if (!data || !data.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-treemapChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-treemapChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-treemapWrap');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            treemap.width(availableWidth).height(availableHeight);
            var sunWrap = g.select('.nv-treemapWrap').datum(data);
            d3.transition(sunWrap).call(treemap);

        });

        renderWatch.renderEnd('treemapChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    treemap.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.data.name,
            value: evt.data.value,
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    treemap.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    treemap.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    treemap.dispatch.on('elementClick.select', function(evt){
        dispatch.selectChange(evt);
    });



    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.treemap = treemap;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
        defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},

        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            treemap.color(color);
        }},
        valueFormat: {get: function(){return valueFormat;}, set: function(_){
            valueFormat = _;
            tooltip.valueFormatter(_);
        }},
        keyFormat: {get: function(){return treemap.keyFormat();}, set: function(_){
            treemap.keyFormat(_);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            treemap.duration(duration);
        }},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });
    nv.utils.inheritOptions(chart, treemap);
    nv.utils.initOptions(chart);
    return chart;
};
// based on http://bl.ocks.org/kerryrodden/477c1bfb081b783f80ad
nv.models.trend = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , font = 'serif'
    //, groupColorByParent = true
        , duration = 500
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMousemove', 'elementMouseover', 'elementMouseout', 'renderEnd')
        , format = function (d) { return d3.format(",.0f")(d) + " TWh"; }
        ;

    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();

        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin);
            var availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-trend').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-trend nv-chart-' + id);

            var g = container.selectAll('.nv-wrap.nv-trend');

            g.selectAll('*').remove();

            function addAxesAndLegend (svg, xAxis, yAxis, margin, chartWidth, chartHeight) {
                var legendWidth  = 200,
                    legendHeight = 100;

                // clipping to make sure nothing appears behind legend
                svg.append('clipPath')
                    .attr('id', 'axes-clip')
                    .append('polygon')
                    .attr('points', (-margin.left)                 + ',' + (-margin.top)                 + ' ' +
                    (chartWidth - legendWidth - 1) + ',' + (-margin.top)                 + ' ' +
                    (chartWidth - legendWidth - 1) + ',' + legendHeight                  + ' ' +
                    (chartWidth + margin.right)    + ',' + legendHeight                  + ' ' +
                    (chartWidth + margin.right)    + ',' + (chartHeight + margin.bottom) + ' ' +
                    (-margin.left)                 + ',' + (chartHeight + margin.bottom));

                var axes = svg.append('g')
                    .attr('clip-path', 'url(#axes-clip)');

                axes.append('g')
                    .attr('class', 'x axis')
                    .attr('transform', 'translate(0,' + chartHeight + ')')
                    .call(xAxis);

                axes.append('g')
                    .attr('class', 'y axis')
                    .call(yAxis)
                    .append('text')
                    .attr('transform', 'rotate(-90)')
                    .attr('y', 6)
                    .attr('dy', '.71em')
                    .style('text-anchor', 'end')
                    .text('Time (s)');

                var legend = svg.append('g')
                    .attr('class', 'legend')
                    .attr('transform', 'translate(' + (chartWidth - legendWidth) + ', 0)');

                legend.append('rect')
                    .attr('class', 'legend-bg')
                    .attr('width',  legendWidth)
                    .attr('height', legendHeight);

                legend.append('rect')
                    .attr('class', 'outer')
                    .attr('width',  75)
                    .attr('height', 20)
                    .attr('x', 10)
                    .attr('y', 10);

                legend.append('text')
                    .attr('x', 115)
                    .attr('y', 25)
                    .text('5% - 95%');

                legend.append('rect')
                    .attr('class', 'inner')
                    .attr('width',  75)
                    .attr('height', 20)
                    .attr('x', 10)
                    .attr('y', 40);

                legend.append('text')
                    .attr('x', 115)
                    .attr('y', 55)
                    .text('25% - 75%');

                legend.append('path')
                    .attr('class', 'median-line')
                    .attr('d', 'M10,80L85,80');

                legend.append('text')
                    .attr('x', 115)
                    .attr('y', 85)
                    .text('Median');
            }

            function drawPaths (svg, data, x, y) {
                var upperOuterArea = d3.svg.area()
                    .interpolate('basis')
                    .x (function (d) { return x(d.date) || 1; })
                    .y0(function (d) { return y(d.pct95); })
                    .y1(function (d) { return y(d.pct75); });

                var upperInnerArea = d3.svg.area()
                    .interpolate('basis')
                    .x (function (d) { return x(d.date) || 1; })
                    .y0(function (d) { return y(d.pct75); })
                    .y1(function (d) { return y(d.pct50); });

                var medianLine = d3.svg.line()
                    .interpolate('basis')
                    .x(function (d) { return x(d.date); })
                    .y(function (d) { return y(d.pct50); });

                var lowerInnerArea = d3.svg.area()
                    .interpolate('basis')
                    .x (function (d) { return x(d.date) || 1; })
                    .y0(function (d) { return y(d.pct50); })
                    .y1(function (d) { return y(d.pct25); });

                var lowerOuterArea = d3.svg.area()
                    .interpolate('basis')
                    .x (function (d) { return x(d.date) || 1; })
                    .y0(function (d) { return y(d.pct25); })
                    .y1(function (d) { return y(d.pct05); });


                svg.selectAll('path').remove();

                svg.datum(data);

                svg.append('path')
                    .attr('class', 'area upper outer')
                    .attr('d', upperOuterArea)
                    .attr('clip-path', 'url(#rect-clip)');

                svg.append('path')
                    .attr('class', 'area lower outer')
                    .attr('d', lowerOuterArea)
                    .attr('clip-path', 'url(#rect-clip)');

                svg.append('path')
                    .attr('class', 'area upper inner')
                    .attr('d', upperInnerArea)
                    .attr('clip-path', 'url(#rect-clip)');

                svg.append('path')
                    .attr('class', 'area lower inner')
                    .attr('d', lowerInnerArea)
                    .attr('clip-path', 'url(#rect-clip)');

                svg.append('path')
                    .attr('class', 'median-line')
                    .attr('d', medianLine)
                    .attr('clip-path', 'url(#rect-clip)');
            }

            function addMarker (marker, svg, chartHeight, x) {
                var radius = 32,
                    xPos = x(marker.date) - radius - 3,
                    yPosStart = chartHeight - radius - 3,
                    yPosEnd = (marker.type === 'Client' ? 80 : 160) + radius - 3;

                var markerG = svg.append('g')
                    .attr('class', 'marker '+marker.type.toLowerCase())
                    .attr('transform', 'translate(' + xPos + ', ' + yPosStart + ')')
                    .attr('opacity', 0);

                markerG.transition()
                    .duration(1000)
                    .attr('transform', 'translate(' + xPos + ', ' + yPosEnd + ')')
                    .attr('opacity', 1);

                markerG.append('path')
                    .attr('d', 'M' + radius + ',' + (chartHeight-yPosStart) + 'L' + radius + ',' + (chartHeight-yPosStart))
                    .transition()
                    .duration(1000)
                    .attr('d', 'M' + radius + ',' + (chartHeight-yPosEnd) + 'L' + radius + ',' + (radius*2));

                markerG.append('circle')
                    .attr('class', 'marker-bg')
                    .attr('cx', radius)
                    .attr('cy', radius)
                    .attr('r', radius);

                markerG.append('text')
                    .attr('x', radius)
                    .attr('y', radius*0.9)
                    .text(marker.type);

                markerG.append('text')
                    .attr('x', radius)
                    .attr('y', radius*1.5)
                    .text(marker.version);
            }

            function startTransitions (svg, chartWidth, chartHeight, rectClip, markers, x) {
                rectClip.transition()
                    .duration(1000)
                    .attr('width', chartWidth);

                markers.forEach(function (marker) {
                    addMarker(marker, svg, chartHeight, x);
                });
            }

            function makeChart (svg, series, markers) {
                var chartWidth  = availableWidth,
                    chartHeight = availableHeight;

                var x = d3.time.scale().range([0, chartWidth])
                        .domain(d3.extent(series, function (d) { return d.date; })),
                    y = d3.scale.linear().range([chartHeight, 0])
                        .domain([0, d3.max(series, function (d) { return d.pct95; })]);

                var xAxis = d3.svg.axis().scale(x).orient('bottom')
                        .innerTickSize(-chartHeight).outerTickSize(0).tickPadding(10),
                    yAxis = d3.svg.axis().scale(y).orient('left')
                        .innerTickSize(-chartWidth).outerTickSize(0).tickPadding(10);

                // clipping to start chart hidden and slide it in later
                var rectClip = svg.append('clipPath')
                    .attr('id', 'rect-clip')
                    .append('rect')
                    .attr('width', 0)
                    .attr('height', chartHeight);

                addAxesAndLegend(svg, xAxis, yAxis, margin, chartWidth, chartHeight);
                drawPaths(svg, series, x, y);
                startTransitions(svg, chartWidth, chartHeight, rectClip, markers, x);
            }

            if (data.series && data.series.length){
                makeChart(g, data.series, data.markers);
            }

            chart.update = function() {

                if ( duration === 0 ) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };

            chart.container = this;

            //g.attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            container.on('click', function (d, i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });

        });

        renderWatch.renderEnd('trend immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        font:       {get: function(){return font;}, set: function(_){font=_;}},
        id:         {get: function(){return id;}, set: function(_){id=_;}},
        duration:   {get: function(){return duration;}, set: function(_){duration=_;}},
        groupColorByParent: {get: function(){return groupColorByParent;}, set: function(_){groupColorByParent=!!_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    != undefined ? _.top    : margin.top;
            margin.right  = _.right  != undefined ? _.right  : margin.right;
            margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   != undefined ? _.left   : margin.left;
        }},
        color: {get: function(){return color;}, set: function(_){
            color=nv.utils.getColor(_);
        }},
        format: {get: function(){return format;}, set: function(_){
            format=d3.functor(_);
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};
nv.models.trendChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var trend = nv.models.trend();
    var tooltip = nv.models.tooltip();

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , font = 'serif'
        , id = Math.round(Math.random() * 100000)
        , defaultState = null
        , noData = null
        , duration = 250
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd')
        ;

    tooltip.duration(0);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    tooltip
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return d;
        });

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(trend);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;

            // Display No Data message if there's nothing to show.
            if (!data || !data.series || !data.series.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var gChart = container.selectAll('g.nv-wrap.nv-trendChart').data([data]);
            var gChartEnter = gChart.enter().append('g').attr('class', 'nvd3 nv-wrap nv-trendChart');
            //var g = gChart.select('g');

            gChartEnter.append('g').attr('class', 'nv-trendWrap');

            gChart.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            trend.width(availableWidth).height(availableHeight);

            var wrap = gChart.select('.nv-trendWrap').datum(data);
            wrap.call(trend);

        });

        renderWatch.renderEnd('trendChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    trend.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.data.name,
            value: evt.data.size,
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    trend.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    trend.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.trend = trend;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
        defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},

        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            trend.color(color);
        }},
        font: {get: function(){return font;}, set: function(_){
            font = _;
            trend.font(font);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            trend.duration(duration);
        }},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });
    nv.utils.inheritOptions(chart, trend);
    nv.utils.initOptions(chart);
    return chart;
};
// based on http://bl.ocks.org/kerryrodden/477c1bfb081b783f80ad
nv.models.wordcloud = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , id = Math.floor(Math.random() * 10000) //Create semi-unique ID in case user doesn't select one
        , container = null
        , color = nv.utils.defaultColor()
        , font = 'serif'
        //, groupColorByParent = true
        , duration = 500
        , dispatch = d3.dispatch('chartClick', 'elementClick', 'elementDblClick', 'elementMousemove', 'elementMouseover', 'elementMouseout', 'renderEnd')
        ;

    var max,
        fontSize = d3.scale['sqrt']().range([10, 100]);

    var layout = d3.layout.cloud()
        .timeInterval(Infinity)
        .font(font)
        .spiral('archimedean')
        .fontSize(function(d) {
            return fontSize(+d.value);
        })
        .text(function(d) {
            return d.key;
        });


    //============================================================
    // chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();

        selection.each(function(data) {
            container = d3.select(this);
            var availableWidth = nv.utils.availableWidth(width, container, margin);
            var availableHeight = nv.utils.availableHeight(height, container, margin);

            nv.utils.initSVG(container);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('.nv-wrap.nv-wordcloud').data([data]);
            var wrapEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-wordcloud nv-chart-' + id);

            var g = container.selectAll('.nv-wrap.nv-wordcloud');

            function draw(data, bounds) {

                var scale = bounds ? Math.min(
                    availableWidth / Math.abs(bounds[1].x - availableWidth / 2),
                    availableWidth / Math.abs(bounds[0].x - availableWidth / 2),
                    availableHeight / Math.abs(bounds[1].y - availableHeight / 2),
                    availableHeight / Math.abs(bounds[0].y - availableHeight / 2)) / 2 : 1;

                var text = g.selectAll("text")
                    .data(data, function(d) {
                        return d.text.toLowerCase();
                    });

                text
                    .style("font-size", function(d) {
                        return d.size + "px";
                    })
                    .transition()
                    .duration(1000)
                    .attr("transform", function(d) {
                        return "translate(" + [d.x, d.y] + ")rotate(" + d.rotate + ")";
                    });

                text.enter().append("text")
                    .attr("text-anchor", "middle")
                    .style("opacity", 1e-6)
                    .style("font-size", function(d) {
                        return d.size + "px";
                    })
                    .transition()
                    .duration(500)
                    .attr("transform", function(d) {
                        return "translate(" + [d.x, d.y] + ")rotate(" + d.rotate + ")";
                    })
                    .style("opacity", 1);

                text.style("font-family", function(d) {
                    return d.font;
                })
                    .style("fill", function(d) {
                        return color(d.text.toLowerCase());
                    })
                    .text(function(d) {
                        return d.text;
                    });

                g.transition().attr("transform", "translate(" + [availableWidth >> 1, availableHeight >> 1] + ")scale(" + scale + ")");
            }

            if (data.length){
                fontSize
                    .domain([+data.slice(-1)[0].value || 1, +data[0].value]);

                layout
                    .stop()
                    .size([availableWidth, availableHeight])
                    .font(font)
                    .words(data)
                    .on('end', draw)
                    .start();
            }

            chart.update = function() {

                if ( duration === 0 ) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };

            chart.container = this;

            g.attr('transform', 'translate(' + availableWidth / 2 + ',' + availableHeight / 2 + ')');

            container.on('click', function (d, i) {
                dispatch.chartClick({
                    data: d,
                    index: i,
                    pos: d3.event,
                    id: id
                });
            });

        });

        layout.on('end', chart.draw);

        renderWatch.renderEnd('wordcloud immediate');
        return chart;
    }

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        font:       {get: function(){return font;}, set: function(_){font=_;}},
        id:         {get: function(){return id;}, set: function(_){id=_;}},
        duration:   {get: function(){return duration;}, set: function(_){duration=_;}},
        groupColorByParent: {get: function(){return groupColorByParent;}, set: function(_){groupColorByParent=!!_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    != undefined ? _.top    : margin.top;
            margin.right  = _.right  != undefined ? _.right  : margin.right;
            margin.bottom = _.bottom != undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   != undefined ? _.left   : margin.left;
        }},
        color: {get: function(){return color;}, set: function(_){
            color=nv.utils.getColor(_);
        }}
    });

    nv.utils.initOptions(chart);

    return chart;
};
nv.models.wordcloudChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var wordcloud = nv.models.wordcloud();
    var tooltip = nv.models.tooltip();

    var margin = {top: 30, right: 20, bottom: 20, left: 20}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , font = 'serif'
        , id = Math.round(Math.random() * 100000)
        , defaultState = null
        , noData = null
        , duration = 250
        , dispatch = d3.dispatch('stateChange', 'changeState','renderEnd')
        ;

    tooltip.duration(0);

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);
    tooltip
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return d;
        });

    //============================================================
    // Chart function
    //------------------------------------------------------------

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(wordcloud);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var that = this;
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                if (duration === 0) {
                    container.call(chart);
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;

            // Display No Data message if there's nothing to show.
            if (!data || !data.length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var gChart = container.selectAll('g.nv-wrap.nv-wordcloudChart').data([data]);
            var gChartEnter = gChart.enter().append('g').attr('class', 'nvd3 nv-wrap nv-wordcloudChart');
            //var g = gChart.select('g');

            gChartEnter.append('g').attr('class', 'nv-wordcloudWrap');

            gChart.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            wordcloud.width(availableWidth).height(availableHeight);

            var wrap = gChart.select('.nv-wordcloudWrap').datum(data);
            wrap.call(wordcloud);

        });

        renderWatch.renderEnd('wordcloudChart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    wordcloud.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.data.name,
            value: evt.data.size,
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    wordcloud.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    wordcloud.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.wordcloud = wordcloud;
    chart.tooltip = tooltip;
    chart.options = nv.utils.optionsFunc.bind(chart);

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        noData:         {get: function(){return noData;},         set: function(_){noData=_;}},
        defaultState:   {get: function(){return defaultState;},   set: function(_){defaultState=_;}},

        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            wordcloud.color(color);
        }},
        font: {get: function(){return font;}, set: function(_){
            font = _;
            wordcloud.font(font);
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            wordcloud.duration(duration);
        }},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });
    nv.utils.inheritOptions(chart, wordcloud);
    nv.utils.initOptions(chart);
    return chart;
};

nv.version = "1.9.50";
})();