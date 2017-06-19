(function (root, factory) {
  'use strict';

  if (typeof define === 'function' && define.amd) {
    define(['angular'], factory);
  } else if (typeof exports === 'object') {
    factory(require('angular'));
    module.exports = 'ngStorage';
  } else {
    factory(root.angular);
  }
}(this , function (angular) {
  'use strict';

  //SQLITE storage wrapper -> Seperate file?
  //Plugin functions as promise functions
  function openDb(options){
    return new Promise((resolve, reject) => {
      window.sqlitePlugin.openDatabase(options, function (db){
        resolve(db);
      },
      function(error) {
        console.error(error);
        reject(error);
      });
    });
  }

  function transaction(db, query, params){
    return new Promise((resolve, reject) => {
      db.executeSql(query, params, function(res) {
        resolve(res);
      },
      function(error) {
        reject(error);
      });
    });
  }
  //SqliteKeyValueStorage prototype
  //try to polyfill whatwg standard
  //https://html.spec.whatwg.org/multipage/webstorage.html#webstorage

  var SqliteKeyValueStorage = function() {
    this._keys = [];
    this.length = 0;
  };

  SqliteKeyValueStorage.prototype.init =  async function (options) {
    console.info('Init SqliteKeyValueStorage: ', options);
    this._options = options;

    if(!this._db){
      this._db = await openDb(options);
      await this._executeSql('CREATE TABLE IF NOT EXISTS ' + this._options.table + ' (storagekey text PRIMARY KEY, storagevalue text)');
    }

    var result = await this._executeSql('SELECT * FROM ' + this._options.table);
    if(typeof result.rows.length === "number"){
      this.length = result.rows.length;
    }

    for(var i = 0; i < result.rows.length; i++){
      var key = result.rows.item(i).storagekey;
      this[key]  = result.rows.item(i).storagevalue;
      if(this._keys.indexOf(key) === -1){
        this._keys.push(key);
      }
    }
    return this;
  }

  SqliteKeyValueStorage.prototype._executeSql = async function (query, params) {
    try{
      if(typeof params === "undefined"){
        params = [];
      }
      var result = await transaction(this._db, query, params);
      return result;
    } catch(e){
      console.error(e);
    }
  };

  SqliteKeyValueStorage.prototype.key = function (i) {
    return this._keys[i];
  };

  SqliteKeyValueStorage.prototype.getItem = function (key) {
    //FIXME return cached value
    return this[key];
  };

  SqliteKeyValueStorage.prototype.setItem = function (key, value) {
    this[key] = value;
    if(this._keys.indexOf(key) === -1){
      this.length++;
      this._keys.push(key);
    }
    try{
      var query = "REPLACE INTO " + this._options.table + " VALUES(?,?)";
      this._executeSql(query, [key, value]);
    }catch(e){
      //FIXME Fail silently if db not initialized
    }
    return undefined;
  };

  SqliteKeyValueStorage.prototype.removeItem = function (key) {
    delete this[key];
    if(this._keys.indexOf(key) !== -1){
      this.length--;
      this._keys.pop(key);
      var query = "DELETE FROM " + this._options.table + " WHERE storagekey LIKE ?";
      this._executeSql(query, [key]);
    }
    return undefined;
  };

  SqliteKeyValueStorage.prototype.clear = function () {
    for(var i = 0; i < this._keys.length; i++){
      var key = this._keys[i];
      if('_' !== key[0]){
        delete this[this._keys[i]];
      }
    }
    this.length = 0;
    this._keys = [];
    var query = "DELETE FROM " + this._options.table ;
    this._executeSql(query);
    return undefined;
  };
  //END SQLITE storage wrapper


  angular = (angular && angular.module ) ? angular : window.angular;


  function isStorageSupported() {
    if(window.SqliteKeyValueStorage){
      return window.SqliteKeyValueStorage;
    }else{
      window.SqliteKeyValueStorage = new SqliteKeyValueStorage();
      return window.SqliteKeyValueStorage;
    }
  }

  return angular.module('ngStorage', [])

  .provider('$sqliteStorage', _storageProvider())

  function _storageProvider() {
    var providerWebStorage = isStorageSupported();

    return function () {
      var serializer = angular.toJson;
      var deserializer = angular.fromJson;

      this.setSerializer = function (s) {
        if (typeof s !== 'function') {
          throw new TypeError('[ngStorage] - Provider.setSerializer expects a function.');
        }

        serializer = s;
      };

      this.setDeserializer = function (d) {
        if (typeof d !== 'function') {
          throw new TypeError('[ngStorage] - Provider.setDeserializer expects a function.');
        }

        deserializer = d;
      };

      this.supported = function() {
        return !!providerWebStorage;
      };

      this.get = function (key) {
        return providerWebStorage && deserializer(providerWebStorage.getItem(key));
      };

      this.set = function (key, value) {
        return providerWebStorage && providerWebStorage.setItem(key, serializer(value));
      };

      this.remove = function (key) {
        providerWebStorage && providerWebStorage.removeItem(key);
      }

      this.$get = [
        '$rootScope',
        '$window',
        '$log',
        '$timeout',
        '$document',

        function(
          $rootScope,
          $window,
          $log,
          $timeout,
          $document
        ){

          var isSupported = isStorageSupported(),
          webStorage = isSupported || ($log.warn('SQlite plugin not available!'), {setItem: angular.noop, getItem: angular.noop, removeItem: angular.noop}),
          $storage = {
            $default: function(items) {
              for (var k in items) {
                angular.isDefined($storage[k]) || ($storage[k] = angular.copy(items[k]) );
              }

              return $storage;
            },
            $init: async function(options){
              await webStorage.init(options);
              $storage.$sync();
              $storage.$initDone = true;

              //Migrate localstorage
              if(options.copyLocalStorage == true){
                var prefix = "";
                var removeItems = [];
                if(options.localStoragePrefix){
                  prefix = options.localStoragePrefix;
                  var prefixLength = prefix.length;
                }
                for (var i = 0, l = localStorage.length; i < l; i++) {
                    var k = localStorage.key(i)
                    if(prefix == ""){
                      $storage[k] = deserializer(localStorage.getItem(k));
                      removeItems.push(k);
                    }else if (prefix === k.slice(0, prefixLength)) {
                      $storage[k.slice(prefixLength)] = deserializer(localStorage.getItem(k));
                      removeItems.push(k);
                    }
                }

                //Remove after adding
                for(var i = 0; i < removeItems.length; i++){
                  localStorage.removeItem(removeItems[i]);
                }
              }

              $rootScope.$apply(function () {
                return $storage;
              });
              return $storage;
            },
            $reset: function(items) {
              for (var k in $storage) {
                '$' === k[0] || '_' === k[0] || k === "length" || (delete $storage[k]);
              }

              webStorage.clear();
              return $storage.$default(items);
            },
            $sync: function () {
              for (var i = 0, l = webStorage.length, k; i < l; i++) {
                (k = webStorage.key(i)) && ($storage[k] = deserializer(webStorage.getItem(k)));
              }
            },
            $apply: function() {
              var temp$storage;

              _debounce = null;
              if (!angular.equals($storage, _last$storage) && $storage.$initDone === true) {
                temp$storage = angular.copy(_last$storage);
                angular.forEach($storage, function(v, k) {
                  if (angular.isDefined(v) && '$' !== k[0] && '_' !== k[0] && k !== "length") {
                    webStorage.setItem(k, serializer(v));
                    delete temp$storage[k];
                  }
                });

                for (var k in temp$storage) {
                  webStorage.removeItem(k);
                }

                _last$storage = angular.copy($storage);
              }
            },
            $supported: function() {
              return !!isSupported;
            }
          },
          _last$storage,
          _debounce;

          $storage.$sync();

          _last$storage = angular.copy($storage);

          $rootScope.$watch(function() {
            _debounce || (_debounce = $timeout($storage.$apply, 100, false));
          });

          $window.addEventListener && $window.addEventListener('beforeunload', function() {
            $storage.$apply();
          });

          return $storage;
        }
      ];
    };
  }

}));
