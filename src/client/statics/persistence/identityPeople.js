var klass = require("hsp/klass");
var RestCache = require("./utils/restCache");

var IdentityPeopleCache = klass({
    $extends : RestCache,
    $constructor : function () {
        RestCache.$constructor.call(this, "identities");
    },
    readRole : "readPeople",
    canSave: function() {
        return false;
    }
});

module.exports = new IdentityPeopleCache();
