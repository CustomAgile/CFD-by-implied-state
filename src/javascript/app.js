Ext.define("TSCFDByImpliedState", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: {
        margin: 10
    },

    config: {
        defaultSettings: {
            metric_field: "Count",
        }
    },

    items: [{
        id: Utils.AncestorPiAppFilter.RENDER_AREA_ID,
        xtype: 'container',
        flex: 1,
        layout: {
            type: 'hbox',
            align: 'middle',
            defaultMargins: '0 10 10 0',
        }
    }, {
        id: Utils.AncestorPiAppFilter.PANEL_RENDER_AREA_ID,
        xtype: 'container',
        layout: {
            type: 'hbox',
            align: 'middle',
            defaultMargins: '0 10 10 0',
        }
    }, {
        xtype: 'container',
        itemId: 'display_box'
    }],

    integrationHeaders: {
        name: "TSCFDByImpliedState"
    },

    launch: function () {
        Rally.data.wsapi.Proxy.superclass.timeout = 240000;

        this.ancestorFilterPlugin = Ext.create('Utils.AncestorPiAppFilter', {
            ptype: 'UtilsAncestorPiAppFilter',
            pluginId: 'ancestorFilterPlugin',
            // Set to false to prevent the '-- None --' selection option if your app can't support
            // querying by a null ancestor (e.g. Lookback _ItemHierarchy)
            allowNoEntry: false, // Lookback can't query _ItemHierarchy by a null ancestor
            whiteListFields: ['Milestones', 'Tags', 'c_EnterpriseApprovalEA'],
            settingsConfig: {
                labelWidth: 100,
                minWidth: 200,
                margin: 10,
            },
            filtersHidden: false,
            listeners: {
                scope: this,
                ready: function (plugin) {
                    if (!this.getSetting('type_path')) {
                        this.down('#display_box').add({
                            xtype: 'container',
                            html: 'No settings applied.  Select "Edit App Settings." from the gear menu.'
                        });
                        return;
                    }
                    else {
                        plugin.addListener({
                            scope: this,
                            select: this._makeChart,
                            change: this._makeChart
                        });
                        this._makeChart();
                    }
                }
            }
        });
        this.addPlugin(this.ancestorFilterPlugin);
    },

    setLoading: function (loading) {
        var displayBox = this.down('#display_box');
        displayBox.setLoading(loading);
    },

    _makeChart: async function () {
        var me = this;
        if (me.loadingChart) {
            return;
        }
        me.loadingChart = true;
        me.loadingFailed = false;
        var container = this.down('#display_box');
        container.removeAll();

        this.setLoading("Loading Filters...");

        var project = this.getContext().getProject().ObjectID;
        var type_path = this.getSetting('type_path');
        var value_field = this.getSetting('metric_field');
        var period_length = this.getSetting('time_period') || 1;

        var title = "Implied State CFD Over Last " + period_length + " Month(s)";
        var start_date = Rally.util.DateTime.add(new Date(), 'month', -1 * period_length);

        var filters = new Rally.data.lookback.QueryFilter.and([
            { property: '_TypeHierarchy', value: type_path },
        ]);

        var dateFilters = new Rally.data.lookback.QueryFilter.or([
            { property: '_ValidFrom', operator: ">=", value: Rally.util.DateTime.toIsoString(start_date) },
            { property: '_ValidTo', operator: ">=", value: Rally.util.DateTime.toIsoString(start_date) }
        ]);
        filters = filters.and(dateFilters);

        if (!this.searchAllProjects()) {
            var projectFilter = new Rally.data.lookback.QueryFilter({
                property: '_ProjectHierarchy',
                value: project
            });
            filters = filters.and(projectFilter);
        }

        var milestoneFilter = this.getMilestoneFilter();
        if (milestoneFilter) {
            filters = filters.and(milestoneFilter);
        }

        var ancestorFilter = this.ancestorFilterPlugin.getAncestorFilterForType(type_path);
        if (ancestorFilter) {
            // ancestorFilterPlugin.getAncestorFilterForType() returns milestone refs like '/milestone/1234',
            // as the query value, but lookback requires the object ID only.
            // Convert this query to an _ItemHieararchy. Lookback won't support more than 2 Parent levels (Parent.Parent.Parent returns no results)
            var ancestorLookbackFilter = new Rally.data.lookback.QueryFilter({
                property: '_ItemHierarchy',
                value: Rally.util.Ref.getOidFromRef(ancestorFilter.value) || 0
            });
            filters = filters.and(ancestorLookbackFilter);
        }

        if (this.ancestorFilterPlugin._hasFilters()) {
            var multiLevelFilters = await this.ancestorFilterPlugin.getAllFiltersForType(type_path, true).catch((e) => {
                Rally.ui.notify.Notifier.showError({ message: (e.message || e) });
                me.loadingFailed = true;
                this.setLoading(false);
            });

            if (me.loadingFailed) { return; }

            var dataContext = this.getContext().getDataContext();
            if (this.searchAllProjects()) {
                dataContext.project = null;
            }

            this.setLoading("Gathering Data...");

            try {
                var records = await Ext.create('Rally.data.wsapi.Store', {
                    model: type_path,
                    autoLoad: false,
                    context: dataContext,
                    limit: Infinity,
                    fetch: ['ObjectID'],
                    filters: multiLevelFilters,
                    enablePostGet: true
                }).load();

                var ids = [0];
                if (records && records.length) {
                    ids = _.map(records, function (record) {
                        return record.get('ObjectID');
                    });
                }

                var itemsFilter = new Rally.data.lookback.QueryFilter({
                    property: 'ObjectID',
                    operator: 'in',
                    value: ids
                });
                filters = filters.and(itemsFilter);
            }
            catch (e) {
                Rally.ui.notify.Notifier.showError({ message: 'Failed while fetching records for multi-level filter. Request most likely timed out.' });
                me.setLoading(false);
                me.loadingChart = false;
                return;
            }
        }

        var date_change_filter = Rally.data.lookback.QueryFilter.or([
            { property: '_PreviousValues.ActualStartDate', operator: 'exists', value: true },
            { property: '_PreviousValues.ActualEndDate', operator: 'exists', value: true },
            { property: '_SnapshotNumber', value: 0 }
        ]);

        var border_filter = Rally.data.lookback.QueryFilter.or([
            { property: '__At', value: Rally.util.DateTime.toIsoString(Rally.util.DateTime.add(start_date, 'day', 1)) },
            { property: '__At', value: 'current' }
        ]);

        var change_filter = border_filter.or(date_change_filter);

        container.add({
            xtype: 'rallychart',
            storeType: 'Rally.data.lookback.SnapshotStore',
            calculatorType: 'Rally.TechnicalServices.ImpliedCFDCalculator',
            calculatorConfig: {
                startDate: start_date,
                endDate: new Date(),
                value_field: value_field
            },
            storeConfig: {
                filters: filters,
                compress: true,
                fetch: [value_field, 'ActualStartDate', 'ActualEndDate', '_UnformattedID', 'Milestones'],
                removeUnauthorizedSnapshots: true,
                enablePostGet: true,
                listeners: {
                    load: function () {
                        me.setLoading(false);
                        me.loadingChart = false;
                    }
                }
            },
            chartColors: ["#CCCCCC", "#00a9e0", "#009933"],
            chartConfig: {
                chart: {
                    zoomType: 'xy',
                    events: {
                        redraw: function () { }
                    }
                },
                title: {
                    text: title
                },
                xAxis: {
                    tickmarkPlacement: 'on',
                    tickInterval: 30,
                    title: {
                        text: ''
                    }
                },
                yAxis: [{
                    title: {
                        text: value_field
                    }
                }],
                plotOptions: {
                    series: {
                        marker: { enabled: false },
                        stacking: 'normal'
                    }
                }
            }
        });
    },

    getOptions: function () {
        return [{
            text: 'About...',
            handler: this._launchInfo,
            scope: this
        }];
    },

    _launchInfo: function () {
        if (this.about_dialog) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink', {});
    },

    isExternal: function () {
        return typeof (this.getAppId()) == 'undefined';
    },

    _addCountToChoices: function (store) {
        store.add({ name: 'Count', value: 'Count', fieldDefinition: {} });
    },

    _filterOutExceptNumbers: function (store) {
        store.filter([{
            filterFn: function (field) {
                var field_name = field.get('name');

                if (field_name == 'Formatted ID' || field_name == 'Object ID') {
                    return false;
                }
                if (field_name == 'Latest Discussion Age In Minutes') {
                    return false;
                }

                if (field_name == 'Count') { return true; }

                var attribute_definition = field.get('fieldDefinition').attributeDefinition;
                var attribute_type = null;
                if (attribute_definition) {
                    attribute_type = attribute_definition.AttributeType;
                }
                if (attribute_type == "QUANTITY" || attribute_type == "INTEGER" || attribute_type == "DECIMAL") {
                    return true;
                }

                return false;
            }
        }]);
    },

    getSettingsFields: function () {
        var me = this;

        var time_period = this.getSetting('time_period') || 1;

        return [{
            name: 'type_path',
            xtype: 'rallyportfolioitemtypecombobox',
            valueField: 'TypePath',
            defaultSelectionPosition: null,
            labelWidth: 100,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10
        },
        {
            name: 'metric_field',
            xtype: 'rallyfieldcombobox',
            fieldLabel: 'Measure',
            labelWidth: 100,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10,
            autoExpand: false,
            alwaysExpanded: false,
            model: 'PortfolioItem',
            listeners: {
                ready: function (field_box) {
                    me._addCountToChoices(field_box.getStore());
                    me._filterOutExceptNumbers(field_box.getStore());
                    var value = me.getSetting('metric_field');

                    if (value) {
                        field_box.setValue(value);
                    }
                    if (!field_box.getValue()) {
                        field_box.setValue(field_box.getStore().getAt(0));
                    }
                }
            },
            readyEvent: 'ready'
        },
        {
            name: 'time_period',
            xtype: 'rallycombobox',
            fieldLabel: 'Start',
            labelWidth: 100,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10,
            value: time_period,
            displayField: 'name',
            valueField: 'value',
            store: Ext.create('Rally.data.custom.Store', {
                data: [
                    { name: 'A Month Ago', value: 1 },
                    { name: '2 Months Ago', value: 2 },
                    { name: '3 Months Ago', value: 3 }
                ]
            })
        }
        ];
    },

    isMilestoneScoped: function () {
        var result = false;

        var tbscope = this.getContext().getTimeboxScope();
        if (tbscope && tbscope.getType() == 'milestone') {
            result = true;
        }
        return result;
    },

    searchAllProjects: function () {
        return this.ancestorFilterPlugin.getIgnoreProjectScope();
    },

    getMilestoneFilter: function () {
        var result;
        if (this.isMilestoneScoped()) {
            var timeboxScope = this.getContext().getTimeboxScope();
            if (timeboxScope) {
                // timeboxScope.getQueryFilter() returns milestone refs like '/milestone/1234',
                // as the query value, but lookback requires the object ID only.
                var oid = null;
                var milestone = timeboxScope.getRecord();
                if (milestone) {
                    oid = milestone.get('ObjectID');
                }
                result = new Rally.data.lookback.QueryFilter({
                    property: 'Milestones',
                    value: oid
                });
            }
        }
        return result;
    },

    onTimeboxScopeChange: function () {
        this.callParent(arguments);
        this._makeChart();
    },

});
