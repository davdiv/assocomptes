var ValidationError = require("../../../common/validation/utils/validationError");

var MAX_QUERY_DEPTH = 30;
var SEARCH_MAX_TIME_MS = 5000;

var forbiddenQueryKeys = {
    "$where" : true,
    "$function" : true,
    "$accumulator" : true,
    "$expr" : true,
    "$regex" : true
};

var allowedOptions = {
    "limit" : true,
    "skip" : true,
    "sort" : true
};

var invalidSearch = function (reason) {
    return new ValidationError("search.invalid", null, [ reason ]);
};

var isPlainObject = function (value) {
    if (value === null || typeof value !== "object") {
        return false;
    }
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

var isValidSortDirection = function (direction) {
    return direction === 1 || direction === -1 ||
        direction === "asc" || direction === "desc" ||
        direction === "ascending" || direction === "descending";
};

var sanitizeSort = function (sort) {
    if (typeof sort === "string") {
        if (!sort) {
            throw invalidSearch("sort field names must not be empty");
        }
        return sort;
    }
    if (Array.isArray(sort)) {
        var allStrings = true;
        var allPairs = true;
        sort.forEach(function (item) {
            if (typeof item === "string") {
                allPairs = false;
                if (!item) {
                    throw invalidSearch("sort field names must not be empty");
                }
            } else if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && item[0] &&
                isValidSortDirection(item[1])) {
                allStrings = false;
            } else {
                throw invalidSearch("invalid sort");
            }
        });
        if (sort.length === 0 || (!allStrings && !allPairs)) {
            throw invalidSearch("invalid sort");
        }
        return sort;
    }
    if (isPlainObject(sort)) {
        var keys = Object.keys(sort);
        if (keys.length === 0) {
            throw invalidSearch("invalid sort");
        }
        keys.forEach(function (key) {
            if (!key || !isValidSortDirection(sort[key])) {
                throw invalidSearch("invalid sort");
            }
        });
        return sort;
    }
    throw invalidSearch("invalid sort");
};

var sanitizeQueryValue = function (value, depth) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (value instanceof Date || value instanceof RegExp) {
        return value;
    }
    if (depth >= MAX_QUERY_DEPTH) {
        throw invalidSearch("query is too deeply nested");
    }
    if (Array.isArray(value)) {
        value.forEach(function (item) {
            sanitizeQueryValue(item, depth + 1);
        });
        return value;
    }
    if (isPlainObject(value)) {
        return sanitizeQueryObject(value, depth + 1);
    }
    throw invalidSearch("unsupported query value");
};

var sanitizeQueryObject = function (query, depth) {
    if (depth > MAX_QUERY_DEPTH) {
        throw invalidSearch("query is too deeply nested");
    }
    Object.keys(query).forEach(function (key) {
        if (forbiddenQueryKeys[key]) {
            throw invalidSearch("unsupported query operator: " + key);
        }
        query[key] = sanitizeQueryValue(query[key], depth + 1);
    });
    return query;
};

var sanitizeQuery = function (query) {
    query = query || {};
    if (!isPlainObject(query)) {
        throw invalidSearch("query must be an object");
    }
    return sanitizeQueryObject(query, 0);
};

var sanitizeOptions = function (options) {
    options = options || {};
    if (!isPlainObject(options)) {
        throw invalidSearch("options must be an object");
    }
    var result = {
        maxTimeMS : SEARCH_MAX_TIME_MS
    };
    Object.keys(options).forEach(function (key) {
        if (!allowedOptions[key]) {
            throw invalidSearch("unsupported search option: " + key);
        }
        if (key === "limit") {
            if (typeof options.limit !== "number" || !isFinite(options.limit) ||
                Math.floor(options.limit) !== options.limit || options.limit < 1) {
                throw invalidSearch("limit must be a positive integer");
            }
            result.limit = options.limit;
        } else if (key === "skip") {
            if (typeof options.skip !== "number" || !isFinite(options.skip) ||
                Math.floor(options.skip) !== options.skip || options.skip < 0) {
                throw invalidSearch("skip must be a non-negative integer");
            }
            result.skip = options.skip;
        } else {
            result.sort = sanitizeSort(options.sort);
        }
    });
    return result;
};

module.exports = {
    sanitizeQuery : sanitizeQuery,
    sanitizeOptions : sanitizeOptions
};
