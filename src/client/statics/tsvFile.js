var sanitizeSpreadsheetCell = require("./utils/sanitizeSpreadsheetCell");

module.exports = function (columnsDefinition, dataArray) {
    var content = [];
    columnsDefinition.forEach(function (column, index) {
        if (index > 0) {
            content.push("\t");
        }
        content.push(sanitizeSpreadsheetCell(column.title));
    });
    content.push("\n");
    dataArray.forEach(function (object) {
        columnsDefinition.forEach(function (column, index) {
            if (index > 0) {
                content.push("\t");
            }
            content.push(sanitizeSpreadsheetCell(column.getValue(object)));
        });
        content.push("\n");
    });
    return content.join("");
};
