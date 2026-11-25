var dangerousStart = /^[=+\-@\t\r\n]/;

module.exports = function (value) {
    if (value == null) {
        return "";
    }
    var str = value + "";
    if (dangerousStart.test(str)) {
        str = "'" + str;
    }
    return str.replace(/\t/g, "    ").replace(/\r|\n/g, " ");
};
