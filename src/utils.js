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

})();