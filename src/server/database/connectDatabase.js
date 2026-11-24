var mongodb = require("mongodb");

module.exports = async function(dbUrl) {
    const client = await mongodb.MongoClient.connect(dbUrl, {
        writeConcern : { w : 1 }
    });
    return client.db();
};
