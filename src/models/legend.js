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
