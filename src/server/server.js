var express = require("express");
var path = require("path");
var routes = require("../common/routes.js");
var serialization = require("../common/serialization");
var RestRouter = require("./restRouter");
var apiErrorReporter = require("./apiErrorReporter");
var initDatabase = require("./database/init");
var PeopleCollection = require("./collections/people");
var AccountSheetsCollection = require("./collections/accountSheets");
var DepositsCollection = require("./collections/deposits");
var identityPeople = require("./identityPeople");
var auth = require("./auth");

var startServer = async function (options, db) {
    var staticsRoot = path.join(__dirname, "../../build/client");
    var devHtmlFile = path.join(staticsRoot, "statics-dev/index.html");
    var prodHtmlFile = path.join(staticsRoot, "statics/index.html");

    var sendHtmlFile = function (req, res) {
        var dev = "dev" in req.query ? req.query.dev != "false" : options.dev;
        res.sendFile(dev ? devHtmlFile : prodHtmlFile);
    };

    var app = express();

    app.set("json replacer", serialization.replacer);

    app.use(auth(process.env));
    routes.forEach(function (curRoute) {
        app.get(curRoute.path, sendHtmlFile);
    });
    app.use(express.static(staticsRoot));

    app.get("/api/profile", function (req, res) {
        res.set("Cache-Control", "no-store").json(req.identity);
    });
    app.get("/api/identities/:id", auth.requireGroup("readPeople"), identityPeople(db.collection("keycloakPeople")));
    app.use("/api/people", new RestRouter(new PeopleCollection(db.collection("people"), db.collection("peopleHistory")), "readPeople", "writePeople"));
    app.use("/api/account/sheets", new RestRouter(new AccountSheetsCollection(db.collection("accountSheets"), db.collection("accountSheetsHistory")), "readAccountSheets", "writeAccountSheets"));
    app.use("/api/account/deposits", new RestRouter(new DepositsCollection(db.collection("deposits"), db.collection("depositsHistory")), "readDeposits", "writeDeposits"));
    app.use("/api", apiErrorReporter);

    var server = app.listen(options.port);
    server.on("listening", function () {
        console.log("Web server started on http://localhost:%d", server.address().port);
    });

    await new Promise(() => {});
};

module.exports = async function (options) {
    const db = await initDatabase(options)
    await startServer(options, db);
};
