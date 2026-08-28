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
