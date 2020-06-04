Ext.override(Rally.ui.chart.Chart, {
    /*
    *   Override to await prepareChartData
    */
    _onStoresLoaded: async function () {
        this._unmask();
        this.fireEvent('storesLoaded', this);

        if (this.serviceUnavailable) {
            return this._setErrorMessage(this.serviceUnavailableErrorMessage);
        }
        if (this.workspaceHalted) {
            return this._setErrorMessage(this.haltedWorkspaceErrorMessage);
        }
        if (!this.queryValid) {
            return this._setErrorMessage(this.authorizationErrorMessage);
        }
        if (this._noDataLoaded()) {
            return this._setErrorMessage(this.queryErrorMessage);
        }

        Ext.Array.sort(this.loadedStores, function (left, right) {
            return left.rank - right.rank;
        });

        this._unWrapStores();

        this.fireEvent('storesValidated', this);
        this.chartData = await this.calculator.prepareChartData(this.loadedStores);

        if (!this.chartData) {
            return;
        }

        this.fireEvent('snapshotsAggregated', this);

        this.fireEvent('readyToRender', this);
        this._validateAggregation();
        this.fireEvent('chartRendered', this);
    }
});