Ext.define("TSCFDByImpliedState", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: {
        margin: 10
    },
    integrationHeaders: {
        name: "TSCFDByImpliedState"
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
        itemId: 'display_box',
        flex: 1,
        type: 'vbox',
        align: 'stretch'
    }],

    launch: function () {
        Rally.data.wsapi.Proxy.superclass.timeout = 240000;
        this.down('#display_box').on('resize', this.onChartResize, this);
        this.ancestorFilterPlugin = Ext.create('Utils.AncestorPiAppFilter', {
            ptype: 'UtilsAncestorPiAppFilter',
            pluginId: 'ancestorFilterPlugin',
            allowNoEntry: false,
            overrideGlobalWhitelist: true,
            projectScope: 'current',
            whiteListFields: ['Milestones', 'Tags', 'c_EnterpriseApprovalEA', 'c_EAEpic', 'DisplayColor'],
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
        let status = this.cancelPreviousLoad();
        var container = this.down('#display_box');
        container.removeAll();

        var type_path = this.getSetting('type_path');
        var value_field = this.getSetting('metric_field');
        var period_length = this.getSetting('time_period') || 1;
        var title = "Implied State CFD Over Last " + period_length + " Month" + (period_length === 1 ? "" : "s") + " (" + value_field + ")";
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
            this.setLoading("Loading Projects...");
            let projectIds = await this._getScopedProjectList();
            var projectFilter = new Rally.data.lookback.QueryFilter({
                property: 'Project',
                operator: 'in',
                value: projectIds
            });
            filters = filters.and(projectFilter);
        }

        this.setLoading("Loading Filters...");

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

        let multiLevelFilters = await this.ancestorFilterPlugin.getAllFiltersForType(type_path, true).catch((e) => {
            this.showError(e, 'Error while loading multi-level filters');
            this.setLoading(false);
        });

        if (status.cancelLoad || !multiLevelFilters) {
            return;
        }

        var timeboxFilter = await this.getTimeboxFilter(type_path);
        if (timeboxFilter) {
            if (this.getContext().getTimeboxScope().getType() === 'release') {
                // If searching across the workspace, we need to filter after getting snapshots because 
                // filtering by release with lookback API requires having all of the release IDs
                if (this.searchAllProjects()) {
                    multiLevelFilters.push(timeboxFilter);
                }
                else {
                    filters = filters.and(timeboxFilter);
                }
            }
            else {
                filters = filters.and(timeboxFilter);
            }
        }

        this.setLoading("Loading Historical Data...");

        container.add({
            xtype: 'rallychart',
            storeType: 'Rally.data.lookback.SnapshotStore',
            calculatorType: 'Rally.TechnicalServices.ImpliedCFDCalculator',
            calculatorConfig: {
                startDate: start_date,
                endDate: new Date(),
                value_field: value_field,
                type_path: type_path,
                additionalFilters: multiLevelFilters,
                status: status
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

    onChartResize: function () {
        let container = this.down('#display_box');
        let chart = this.down('rallychart');

        if (container && chart) {
            chart.setHeight(container.getHeight());
        }
    },

    cancelPreviousLoad: function () {
        if (this.globalStatus) {
            this.globalStatus.cancelLoad = true;
        }

        let chart = this.down('rallychart');

        if (chart && chart.calculator && chart.calculator.status) {
            chart.calculator.status.cancelLoad = true;
        }

        let newStatus = { cancelLoad: false };
        this.globalStatus = newStatus;
        return newStatus;
    },

    async _getScopedProjectList() {
        let projectStore = Ext.create('Rally.data.wsapi.Store', {
            model: 'Project',
            fetch: ['Name', 'ObjectID', 'Children', 'Parent'],
            filters: [{ property: 'ObjectID', value: this.getContext().getProject().ObjectID }],
            limit: 1,
            pageSize: 1,
            autoLoad: false
        });

        let results = await projectStore.load();
        let parents = [];
        let children = [];
        if (results && results.length) {
            if (this.getContext().getProjectScopeDown()) {
                children = await this._getAllChildProjects(results);
            }

            if (this.getContext().getProjectScopeUp()) {
                parents = await this._getAllParentProjects(results[0]);
            }

            if (children.length) {
                results = children.concat(parents);
            }
            else if (parents.length) {
                results = parents;
            }

            this.projectIds = _.map(results, (p) => {
                return p.get('ObjectID');
            });

            this.projectRefs = _.map(results, (p) => {
                return p.get('_ref');
            });
        }
        else {
            this.projectIds = [];
            this.projectRefs = [];
        }

        return this.projectIds;
    },

    async _getAllChildProjects(allRoots = [], fetch = ['Name', 'Children', 'ObjectID']) {
        if (!allRoots.length) { return []; }

        const promises = allRoots.map(r => this._wrap(r.getCollection('Children', { fetch, limit: Infinity, filters: [{ property: 'State', value: 'Open' }] }).load()));
        const children = _.flatten(await Promise.all(promises));
        const decendents = await this._getAllChildProjects(children, fetch);
        const removeDupes = {};
        let finalResponse = _.flatten([...decendents, ...allRoots, ...children]);

        // eslint-disable-next-line no-return-assign
        finalResponse.forEach(s => removeDupes[s.get('_ref')] = s);
        finalResponse = Object.values(removeDupes);
        return finalResponse;
    },

    async _getAllParentProjects(p) {
        let projectStore = Ext.create('Rally.data.wsapi.Store', {
            model: 'Project',
            fetch: ['Name', 'ObjectID', 'Parent'],
            filters: [{ property: 'ObjectID', value: p.get('Parent').ObjectID }],
            limit: 1,
            pageSize: 1,
            autoLoad: false
        });

        let results = await projectStore.load();
        if (results && results.length) {
            if (results[0].get('Parent')) {
                let parents = await this._getAllParentProjects(results[0]);
                return [p].concat(parents);
            }
            return [p, results[0]];
        }
        return [p];
    },

    async _wrap(deferred) {
        if (!deferred || !_.isFunction(deferred.then)) {
            return Promise.reject(new Error('Wrap cannot process this type of data into a ECMA promise'));
        }
        return new Promise((resolve, reject) => {
            deferred.then({
                success(...args) {
                    resolve(...args);
                },
                failure(error) {
                    reject(error);
                }
            });
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

    getTimeboxFilter: async function (artifactType) {
        var tbscope = this.getContext().getTimeboxScope();
        if (tbscope) {
            let type = tbscope.getType();
            if (type === 'milestone') {
                return this.getMilestoneFilter(tbscope.getRecord());
            }
            else if (type === 'release' && artifactType.toLowerCase().indexOf('feature') > -1) {
                if (this.searchAllProjects()) {
                    return {
                        property: 'Release.Name',
                        value: tbscope.getRecord().get('Name')
                    }
                }
                else {
                    let filter = await this.getReleaseFilter(tbscope.getRecord());
                    return filter;
                }
            }
        }
        return null;
    },

    searchAllProjects: function () {
        return this.ancestorFilterPlugin.getIgnoreProjectScope();
    },

    getReleaseFilter: async function (release) {
        try {
            let records = await Ext.create('Rally.data.wsapi.Store', {
                model: 'Release',
                autoLoad: false,
                context: this.getContext(),
                limit: Infinity,
                fetch: ['ObjectID'],
                filters: [
                    {
                        property: 'Name',
                        value: release.get('Name')
                    }
                ],
                enablePostGet: true
            }).load();

            let ids = [0];
            if (records && records.length) {
                ids = _.map(records, function (record) {
                    return record.get('ObjectID');
                });
            }
            return new Rally.data.lookback.QueryFilter({
                property: 'Release',
                operator: 'in',
                value: ids
            });
        }
        catch (e) {
            this.showError(e, 'Failed while fetching releases');
        }
        return null;
    },

    getMilestoneFilter: function (milestone) {
        // timeboxScope.getQueryFilter() returns milestone refs like '/milestone/1234',
        // as the query value, but lookback requires the object ID only.
        var oid = null;
        if (milestone) {
            oid = milestone.get('ObjectID');
        }
        return new Rally.data.lookback.QueryFilter({
            property: 'Milestones',
            value: oid
        });
    },

    onTimeboxScopeChange: function () {
        this.callParent(arguments);
        this._makeChart();
    },

    showError(msg, defaultMsg) {
        Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMsg) });
    },

    parseError(e, defaultMessage) {
        defaultMessage = defaultMessage || 'An error occurred while loading the report';

        if (typeof e === 'string' && e.length) {
            return e;
        }
        if (e.message && e.message.length) {
            return e.message;
        }
        if (e.exception && e.error && e.error.errors && e.error.errors.length) {
            if (e.error.errors[0].length) {
                return e.error.errors[0];
            } else {
                if (e.error && e.error.response && e.error.response.status) {
                    return `${defaultMessage} (Status ${e.error.response.status})`;
                }
            }
        }
        if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
            return e.exceptions[0].error.statusText;
        }
        return defaultMessage;
    }

});
