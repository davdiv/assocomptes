var net = require("net");

function getIdentityHeader(req, name) {
    return Buffer.from(req.get(name) || "", "latin1").toString("utf8");
}

module.exports = function (env, roleGroups) {
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
    var profileUrl = (env.AUTH_PROFILE_URL || "").trim();
    var profile = profileUrl ? new URL(profileUrl) : null;
    if (profile && profile.protocol !== "https:") {
        throw new Error("AUTH_PROFILE_URL must use HTTPS");
    }
    var roles = Object.entries(roleGroups);

    return function (req, res, next) {
        var peer = req.socket.remoteAddress;
        var username = getIdentityHeader(req, "Remote-User").trim();
        if ((peer !== proxy && peer !== "::ffff:" + proxy) || !username || username.includes(",")) {
            return res.sendStatus(401);
        }

        if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" &&
                req.get("Origin") !== origin.origin) {
            return res.sendStatus(403);
        }

        var groups = getIdentityHeader(req, "Remote-Groups").split(",").map(group => group.trim()).filter(Boolean);
        req.identity = {
            username: username,
            name: getIdentityHeader(req, "Remote-Name") || username,
            email: getIdentityHeader(req, "Remote-Email"),
            groups: groups,
            roles: roles.filter(([, group]) => groups.includes(group)).map(([role]) => role),
            logoutUrl: logout.href,
            profileUrl: profile && profile.href
        };
        next();
    };
};

module.exports.requireGroup = function (role) {
    return function (req, res, next) {
        if (!req.identity.roles.includes(role)) {
            return res.sendStatus(403);
        }
        next();
    };
};
