﻿require([
    'Normalizer',
    'Warehouse',
    'BrowserDetector',
    'Sender',
    'whenthen'
], function (Normalizer, Warehouse, BrowserDetector, Sender, Async) {

    //Originally by Ryan Lynch 
    function extend(){
        for(var i=1; i<arguments.length; i++)
            for(var key in arguments[i])
                if(arguments[i].hasOwnProperty(key))
                    arguments[0][key] = arguments[i][key];
        return arguments[0];
    }

    function ErrorObject (error) {
        for (var err in error) {
            // TODO: don't forget to check against hasOwnProperty
            this[err] = error[err];
        }
    }

    function Report (error, type, callback) {
        this.error = error;
        this.type = type || 'error';
        this.fieldProperties = {};
        this.callback = callback;
    }

    Report.prototype.addProperties = addErrorProperties;
    Report.prototype.fillProperties = fillErrorProperties;

    var options = {};
    var namespace = 'errortracker';

    //Keeps error properties
    var properties = {
    };

    //Defualt error properties
    var defaultProperties = {
        DateTime: function () { return new Date(); },
        Location: function () { return window.location.href; },
        Agent: navigator.userAgent
    };

    //Determine whether errors should be logged to user or not
    var debugMode = false;
    //Keeps all errors in a stack structure
    var stack = [];

    /**
    * Keep track of different kind of reporters
    * A more abstract layer for console[log/warn/error/info]
    */
    var reporters = {
        LOG: 'log',
        WARN: 'warn',
        FATAL: 'error',
        INFO: 'info'
    };

    //Keeps errortracker storages
    var storages = {
        LOCAL_STORAGE: 'localStorage',
        INDEXED_DB: 'indexedDb',
        COOKIE: 'cookie'
    };

    function enableDebugMode() {
        debugMode = true;
    }

    function disableDebugMode() {
        debugMode = false;
    }

    //checks if storage is full or not
    function isGreaterThanMaxStorageSize() {
        if (Warehouse.getSize() > Warehouse.MAX_STORAGE_SIZE) {
            return true;
        } else {
            return false;
        }
    }

    //sync storage if storage is full
    function refreshStorage() {
        if (isGreaterThanMaxStorageSize()) {
            syncStorage();
        }
    }

    //prints error logs in console
    function printError(reporterType, error) {
        if (debugMode) {
            var reporter = console[reporterType];
            reporter.call(console, error);
        }
    }

    function fillErrorProperties (pass) {
        var errorProperties = extend({}, properties, defaultProperties),
            fieldProperties = {},
            asyncFunctions = [],
            i;
        var _this = this;

        //categorize properties
        for (p in errorProperties) {
            if (!errorProperties.hasOwnProperty(p))
                continue;
            if (typeof errorProperties[p] === 'object' && errorProperties[p].async === true) {
                (function (p) {
                    asyncFunctions.push(function (pass) {
                        try {
                            return errorProperties[p].value(pass);    
                        } catch (e) {
                            return 'Error happened while creating this property' +
                          e.message;
                        }                    
                    });
                }(p));
            }
            else if (typeof errorProperties[p] === 'function') {
                try {
                    this.fieldProperties[p] = errorProperties[p]();
                } catch (e) {
                    this.fieldProperties[p]= 'Error happened while creating this property' +
                      e.message;
                }
            } else if (typeof errorProperties[p] !== 'function')
                this.fieldProperties[p] = errorProperties[p];
        }

        if (asyncFunctions.length === 0) {
            extend(this.fieldProperties, this.error);
            pass('fieldProperties', this.fieldProperties);
            return;
        }

        Async.when.apply(null, asyncFunctions).
        then(function (results) {
            //remove length property
            results.length = undefined;
            extend(_this.fieldProperties, results, _this.error);
            pass('fieldProperties', _this.fieldProperties);
        });
        return;
    }

    //Taking snapshot of DOM
    function takeSnapshot (callback) {
        html2canvas(document.body, {
            onrendered: function (snapshot) {
                callback(snapshot);
            }
        });
    }

    function isIgnoredError (errorObject) {
        var isIgnored = false;
        var finalResults = false;
        var partialResults = [];

        //make sure user has configured an exclude object
        if (typeof options.exclude !== 'object' || typeof options.exclude.length === 'undefined')
            return false;

        var rules = options.exclude;
        var property;
        for (property in rules) {
            if (!rules.hasOwnProperty(property))
                continue;

            partialResults.push( validateRule (rules[property], errorObject) );
        }

        for (var i = 0; i < partialResults.length; i++) {
            finalResults = finalResults || partialResults[i];
        }

        return finalResults;

        function validateRule (validationObject, errorObject) {
            var finalResults = validationObject._consider === 'any' ? false : true;
            var partialResults = [];

            for (property in validationObject) {
                if (!validationObject.hasOwnProperty(property) || property.slice(0,1) === '_')
                    continue;

                var expression = new RegExp(validationObject[property]);
                partialResults.push( expression.test(errorObject[property]) );
                //console.log(validationObject[property], '-> ', errorObject[property]);
            }
            //console.log(partialResults);

            for (var i = 0; i < partialResults.length; i++) {
                if (validationObject._consider === 'any')
                    finalResults = finalResults || partialResults[i];
                else
                    finalResults = finalResults && partialResults[i];
            }
            return finalResults;
        }
    }

    //main function of errortracker
    function report(reporterType, extraInfo, callback) {
        if (typeof reporterType !== 'string') {
            console.warn('errortracker only accepts strings as first argument');
        }

        var error = Normalizer.normalizeError(extraInfo);
        var errorObject = new ErrorObject(error);
        var report = new Report(error, reporterType, callback);
        Async.when(function (pass) {
            report.fillProperties(pass);
        }).then (function (results) {
            results.length = undefined;
            var readyReport = results.fieldProperties;
            
            if ( isIgnoredError(readyReport) ) {
                if (typeof report.callback === 'function')
                    callback();
                return;
            }

            stack.push(readyReport);
            Warehouse.save(readyReport);
            printError(reporterType, readyReport);
            refreshStorage();
            if (typeof report.callback === 'function')
                callback();
        });

        /*
        takeSnapshot(function (snapshot) {
            addProperties({ ViewType: reporterType, Snapshot: snapshot.toDataURL() });
            fillProperties(errorObject);

            if ( isIgnoredError(errorObject) ) {
                return;
            }

            stack.push(errorObject);
            Warehouse.save(errorObject);
            printError(reporterType, errorObject);
            refreshStorage();
        });*/
    }

    function clearStack() {
        while (stack.pop() != null);
        // we can also do this: stack = [];
    }

    //prints out a string version of stack into console
    function printStack() {
        stack.forEach(function (error) {
            console.log(error);
        });
    }

    //return namespace
    function getNamespace() {
        return namespace;
    }

    //remove all errors from storage
    function clearStorage() {
        Warehouse.clear();
    }

    //retunrs all error objects as JSON
    function storageToJSON() {
        return Warehouse.toJSON();
    }

    //sync errors in storage with server database
    function syncStorage(successCallback, failCallback) {
        var storageJSON = storageToJSON();

        if (storageJSON) {
            // call a web service via ajax in order to save error object in server db
            Sender.send(options.addToServerDbUrl, storageJSON, function () {
                clearStorage();
                clearStack();
                if (typeof successCallback === 'function')
                    successCallback();
            }, function () {
                if (typeof failCallback === 'function')
                    failCallback();
            });

        } else {
            if (typeof successCallback === 'function')
                successCallback();
        }

    }

    //Add new property to errortracker report object
    function addProperties(propObj) {
        for (var prop in propObj) {
            properties[prop] = propObj[prop];
        }
    }

    //Add new properties to error object of a report
    function addErrorProperties(propObj) {
        for (var prop in propObj) {
            this.properties[prop] = propObj[prop];
        }
    }

    function initialize(c) {
        options = c;
        Warehouse.initialize(c.storage);
    }

    //Our global object act as ErrorTracker
    window.errortracker = {
        initialize: initialize,
        getNamespace: getNamespace,
        enableDebugMode: enableDebugMode,
        disableDebugMode: disableDebugMode,
        report: report,
        storages: storages,
        reporters: reporters,
        clearStack: clearStack,
        printStack: printStack,
        clearStorage: clearStorage,
        storageToJSON: storageToJSON,
        syncStorage: syncStorage,
        addProperties: addProperties
    };

});
