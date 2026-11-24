var net = require("net");

module.exports = function (env) {
    var proxy = env.AUTH_TRUSTED_PROXY;
    if (!net.isIP(proxy)) {
        throw new Error("AUTH_TRUSTED_PROXY must be Traefik's IP address");
    }
    var origin = new URL(env.AUTH_ORIGIN);
    var logout = new URL(env.AUTH_LOGOUT_URL);
    if (origin.protocol !== "https:" || origin.origin !== env.AUTH_ORIGIN ||
            logout.protocol !== "https:") {
        throw new Error("AUTH_ORIGIN must be a canonical HTTPS origin and AUTH_LOGOUT_URL must use HTTPS");
    }
    logout.searchParams.set("rd", origin.href);

    return function (req, res, next) {
        var peer = req.socket.remoteAddress;
        var username = (req.get("Remote-User") || "").trim();
        if ((peer !== proxy && peer !== "::ffff:" + proxy) || !username || username.includes(",")) {
            return res.sendStatus(401);
        }

        if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" &&
                req.get("Origin") !== origin.origin) {
            return res.sendStatus(403);
        }

        req.identity = {
            username: username,
            name: req.get("Remote-Name") || username,
            email: req.get("Remote-Email") || "",
            groups: (req.get("Remote-Groups") || "").split(",").map(group => group.trim()).filter(Boolean),
            logoutUrl: logout.href
        };
        next();
    };
};

module.exports.requireGroup = function (group) {
    return function (req, res, next) {
        if (!req.identity.groups.includes(group)) {
            return res.sendStatus(403);
        }
        next();
    };
};
