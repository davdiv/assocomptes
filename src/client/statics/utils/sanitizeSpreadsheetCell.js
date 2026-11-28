var dangerousStart = /^[=+@\t\r\n]/;
var negativeNumber = /^-(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

module.exports = function (value) {
    if (value == null) {
        return "";
    }
    var str = value + "";
    if (dangerousStart.test(str) || (str.charAt(0) === "-" && !negativeNumber.test(str))) {
        str = "'" + str;
    }
    return str.replace(/\t/g, "    ").replace(/\r|\n/g, " ");
};
