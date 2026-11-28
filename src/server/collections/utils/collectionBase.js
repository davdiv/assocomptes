var ObjectID = require("mongodb").ObjectId;
var NotFoundError = require("../../../common/notFoundError");
var SimpleError = require("../../../common/simpleError");
var searchSanitizer = require("./searchSanitizer");

module.exports = class {
    constructor(collection, historyCollection) {
        this.collection = collection;
        this.historyCollection = historyCollection;
    }

    processFromDB(doc) {
        var res = doc.current;
        res.id = doc._id.toString();
        return res;
    }

    processToDB(doc) {
        delete doc.id;
        return {
            current : doc
        };
    }

    async insert(doc, req) {
        var self = this;
        var processedDoc = self.processToDB(doc);
        processedDoc.current.lastChangeBy = req.identity.username;
        processedDoc.current.lastChangeTimestamp = new Date();
        const result = await this.collection.insertOne(processedDoc);
        return self.processFromDB({ _id: result.insertedId, current: processedDoc.current });
    }

    async remove(docId, lastChangeTimestamp, req) {
        const id = new ObjectID(docId);
        const previousDoc = await this.collection.findOne({
            _id: id
        }, {
            projection : {
                "current" : 1
            }
        });
        if (!previousDoc) {
            return await Promise.reject(new SimpleError("Le document à supprimer n'existe pas (ou plus)."));
        }
        const oldCurrent = previousDoc.current;
        const concurrentModification = oldCurrent.lastChangeTimestamp.getTime() !== lastChangeTimestamp;
        if (!concurrentModification) {
            var removeInfo = {
                lastChangeTimestamp: new Date(),
                lastChangeBy: req.identity.username
            };
            const result = await this.collection.deleteOne({
                _id : id,
                'current.lastChangeTimestamp' : oldCurrent.lastChangeTimestamp
            });
            if (result.deletedCount == 1) {
                if (this.historyCollection) {
                    await this.historyCollection.insertOne({
                        id: id,
                        version: oldCurrent,
                        deleted: removeInfo
                    });
                }
                return {};
            }
        }
        return await Promise.reject(new SimpleError("Modification concurrente."));
    }

    async save(doc, req) {
        const id = new ObjectID(doc.id);
        const previousDoc = await this.collection.findOne({
            _id: id
        }, {
            projection : {
                "current" : 1
            }
        });
        if (!previousDoc) {
            return await Promise.reject(new SimpleError("Le document à mettre à jour n'existe pas (ou plus)."));
        }
        const oldCurrent = previousDoc.current;
        const processedDoc = this.processToDB(doc);
        const newCurrent = processedDoc.current;
        const lastChangeTimestamp = newCurrent.lastChangeTimestamp;
        const concurrentModification = oldCurrent.lastChangeTimestamp.getTime() !== lastChangeTimestamp.getTime();
        if (!concurrentModification) {
            newCurrent.lastChangeTimestamp = new Date();
            newCurrent.lastChangeBy = req.identity.username;
            const result = await this.collection.updateOne({
                _id : id,
                'current.lastChangeTimestamp' : lastChangeTimestamp
            }, {
                '$set' : processedDoc
            });
            if (result.modifiedCount == 1) {
                if (this.historyCollection) {
                    await this.historyCollection.insertOne({
                        id: id,
                        version: previousDoc.current
                    });
                }
                return this.processFromDB({
                    _id : id,
                    current : doc
                });
            }
        }
        return await Promise.reject(new SimpleError("Modification concurrente."));
    }

    get(id) {
        var self = this;
        return self.collection.findOne({
            _id : new ObjectID(id),
        }, {
            projection : {
                "current" : 1
            }
        }).then(function (res) {
            if (res) {
                return self.processFromDB(res);
            } else {
                return Promise.reject(new NotFoundError());
            }
        });
    }

    search(query, options) {
        var self = this;
        var sanitizedQuery;
        var sanitizedOptions;
        try {
            sanitizedQuery = searchSanitizer.sanitizeQuery(query);
            sanitizedOptions = searchSanitizer.sanitizeOptions(options);
        } catch (e) {
            return Promise.reject(e);
        }
        return self.collection.find(sanitizedQuery, Object.assign({}, sanitizedOptions, {
            projection : { "current" : 1 }
        })).toArray().then(function (array) {
            return array.map(self.processFromDB, self);
        });
    }

    suggestions(query) {
        throw new Error("Not implemented.");
    }

};
