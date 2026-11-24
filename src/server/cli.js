var roleOptions = {
    readPeople: "read-people-group",
    writePeople: "write-people-group",
    readAccountSheets: "read-account-sheets-group",
    writeAccountSheets: "write-account-sheets-group",
    readDeposits: "read-deposits-group",
    writeDeposits: "write-deposits-group"
};

var parse = function(argv) {
    var minimist = require("minimist");
    var defaults = {
        "port" : parseInt(process.env.PORT, 10) || 8080,
        "db-url" : process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'mongodb://localhost:27017/test',
        "db-empty" : process.env.ASSOCOMPTES_DB_EMPTY == "empty"
    };
    var roles = Object.entries(roleOptions);
    for (var [role, option] of roles) {
        var envName = "ASSOCOMPTES_" + option.replaceAll("-", "_").toUpperCase();
        defaults[option] = process.env[envName]?.trim() || role;
    }
    var options = minimist(argv, {
        "string" : Object.values(roleOptions),
        "boolean" : [ "help", "version", "dev", "db-empty" ],
        "alias" : {
            "help" : "h",
            "version" : "v"
        },
        "default" : defaults
    });
    options.roleGroups = Object.fromEntries(roles.map(([role, option]) => [role, options[option]]));
    return options;
};

var execute = async function(options) {
    if (options.version) {
        console.log(require("../../package.json").version);
        return 0;
    } else if (options.help) {
        var packageJson = require("../../package.json");
        console.log(packageJson.name + ": " + packageJson.description);
        return 0;
    } else {
        var server = require("./server");
        await server(options);
    }
};

module.exports = async function(argv) {
    try {
      var options = parse(argv);
      return await execute(options);
    } catch (e) {
      console.error(e.stack || e);
      return 1;
    }
};
