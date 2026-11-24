var request = require("noder-js/request");
var Promise = require("noder-js/promise");

var profile;

var AuthenticationError = exports.AuthenticationError = function (message) {
    this.message = message;
};

exports.done = request("/api/profile", { headers: { Accept: "application/json" } }).then(function (xhr) {
    profile = JSON.parse(xhr.responseText);
    exports.userDisplayName = profile.name;
    exports.logoutUrl = profile.logoutUrl;
    exports.profileUrl = profile.profileUrl;
}, function () {
    return Promise.reject(new AuthenticationError("L'authentification a échoué!"));
});

exports.isAuthenticated = function () {
    return !!profile;
};

exports.hasRole = function (role) {
    return !!profile && profile.roles.indexOf(role) !== -1;
};
