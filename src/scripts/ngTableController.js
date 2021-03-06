/**
 * ngTable: Table + Angular JS
 *
 * @author Vitalii Savchuk <esvit666@gmail.com>
 * @url https://github.com/esvit/ng-table/
 * @license New BSD License <http://creativecommons.org/licenses/BSD/>
 */

(function () {
  /**
   * @ngdoc object
   * @name ngTableController
   *
   * @description
   * Each {@link ngTable ngTable} directive creates an instance of `ngTableController`
   */
  angular.module('ngTable').controller('ngTableController', ['$scope', 'NgTableParams', '$timeout', '$parse', '$compile', '$attrs', '$element',
    'ngTableColumn', 'ngTableEventsChannel',
    function ($scope, NgTableParams, $timeout, $parse, $compile, $attrs, $element, ngTableColumn, ngTableEventsChannel) {
      var isFirstTimeLoad = true;
      $scope.$filterRow = {};
      $scope.$loading = false;

      // until such times as the directive uses an isolated scope, we need to ensure that the check for
      // the params field only consults the "own properties" of the $scope. This is to avoid seeing the params
      // field on a $scope higher up in the prototype chain
      if (!$scope.hasOwnProperty("params")) {
        $scope.params = new NgTableParams(true);
      }
      $scope.params.settings().$scope = $scope;

      var delayFilter = (function () {
        var timer = 0;
        return function (callback, ms) {
          $timeout.cancel(timer);
          timer = $timeout(callback, ms);
        };
      })();

      function onDataReloadStatusChange(newStatus/*, oldStatus*/) {
        if (!newStatus || $scope.params.hasErrorState()) {
          return;
        }

        $scope.params.settings().$scope = $scope;

        var currentParams = $scope.params;

        if (currentParams.hasFilterChanges()) {
          var applyFilter = function () {
            currentParams.page(1);
            currentParams.reload();
          };
          if (currentParams.settings().filterDelay) {
            delayFilter(applyFilter, currentParams.settings().filterDelay);
          } else {
            applyFilter();
          }
        } else {
          currentParams.reload();
        }
      }

      // watch for when a new NgTableParams is bound to the scope
      // CRITICAL: the watch must be for reference and NOT value equality; this is because NgTableParams maintains
      // the current data page as a field. Checking this for value equality would be terrible for performance
      // and potentially cause an error if the items in that array has circular references
      $scope.$watch('params', function (newParams, oldParams) {
        if (newParams === oldParams || !newParams) {
          return;
        }

        newParams.reload();
      }, false);
      $scope.$watch('params.isDataReloadRequired()', onDataReloadStatusChange);

      $scope.expanded = true;
      $scope.$watch($attrs.listView, function (newVal) {
        $scope.expanded = !newVal;
      });


      this.compileDirectiveTemplates = function () {
        if (!$element.hasClass('ng-table')) {
          $scope.templates = {
            header: ($attrs.templateHeader ? $attrs.templateHeader : 'ng-table/header.html'),
            pagination: ($attrs.templatePagination ? $attrs.templatePagination : 'ng-table/pager.html')
          };
          $element.addClass('ng-table');
          var headerTemplate = null;

          // $element.find('> thead').length === 0 doesn't work on jqlite
          var theadFound = false;
          angular.forEach($element.children(), function (e) {
            if (e.tagName === 'THEAD') {
              theadFound = true;
            }
          });
          if (!theadFound) {
            headerTemplate = angular.element(document.createElement('thead')).attr('ng-include', 'templates.header');
            $element.prepend(headerTemplate);
          }
          var paginationTemplate = angular.element(document.createElement('div')).attr({
            'ng-table-pagination': 'params',
            'template-url': 'templates.pagination',
            'expanded': 'expanded'
          });
          $element.after(paginationTemplate);
          if (headerTemplate) {
            $compile(headerTemplate)($scope);
          }
          $compile(paginationTemplate)($scope);
        }
      };

      this.loadFilterData = function ($columns) {
        angular.forEach($columns, function ($column) {
          var def;
          def = $column.filterData($scope, {
            $column: $column
          });
          if (!def) {
            delete $column.filterData;
            return;
          }

          // if we're working with a deferred object, let's wait for the promise
          if ((angular.isObject(def) && angular.isObject(def.promise))) {
            delete $column.filterData;
            return def.promise.then(function (data) {
              // our deferred can eventually return arrays, functions and objects
              if (!angular.isArray(data) && !angular.isFunction(data) && !angular.isObject(data)) {
                // if none of the above was found - we just want an empty array
                data = [];
              } else if (angular.isArray(data)) {
                data.unshift({
                  title: '',
                  id: ''
                });
              }
              $column.data = data;
            });
          }
          // otherwise, we just return what the user gave us. It could be a function, array, object, whatever
          else {
            return $column.data = def;
          }
        });
      };

      this.buildColumns = function (columns) {
        return columns.map(function (col) {
          return ngTableColumn.buildColumn(col, $scope)
        })
      };

      this.parseNgTableDynamicExpr = function (attr) {
        if (!attr || attr.indexOf(" with ") > -1) {
          var parts = attr.split(/\s+with\s+/);
          return {
            tableParams: parts[0],
            columns: parts[1]
          };
        } else {
          throw new Error('Parse error (expected example: ng-table-dynamic=\'tableParams with cols\')');
        }
      };

      this.setupBindingsToInternalScope = function (tableParamsExpr) {

        // note: this we're setting up watches to simulate angular's isolated scope bindings

        // note: is REALLY important to watch for a change to the ngTableParams *reference* rather than
        // $watch for value equivalence. This is because ngTableParams references the current page of data as
        // a field and it's important not to watch this
        var tableParamsGetter = $parse(tableParamsExpr);
        $scope.$watch(tableParamsGetter, (function (params) {
          if (angular.isUndefined(params)) {
            return;
          }
          $scope.paramsModel = tableParamsGetter;
          $scope.params = params;
        }), false);

        if ($attrs.showFilter) {
          $scope.$parent.$watch($attrs.showFilter, function (value) {
            $scope.show_filter = value;
          });
        }
        if ($attrs.disableFilter) {
          $scope.$parent.$watch($attrs.disableFilter, function (value) {
            $scope.$filterRow.disabled = value;
          });
        }
      };


      function commonInit() {
        ngTableEventsChannel.onAfterReloadData(bindDataToScope, $scope, isMyPublisher);
        ngTableEventsChannel.onPagesChanged(bindPagesToScope, $scope, isMyPublisher);

        function bindDataToScope(params, newDatapage) {
          if (params.settings().groupBy) {
            $scope.$groups = newDatapage;
          } else {
            $scope.$data = newDatapage;
          }
        }

        function bindPagesToScope(params, newPages) {
          $scope.pages = newPages
        }

        function isMyPublisher(publisher) {
          return $scope.params === publisher;
        }
      }

      commonInit();
    }]);
})();
