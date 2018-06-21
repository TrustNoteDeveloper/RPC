'use strict'

const tempdb = require('../trustnote-common/db');

class DataBase {

    constructor() {
        this.db = tempdb;
    }

    query (sqlstr, arr ) {
        let resolve;
        const waitPromise = new Promise(r => resolve = r);
        if (arr) {
            this.db.query(sqlstr, arr, function(rows){ 
                resolve(rows);
            })
        } else {
            this.db.query(sqlstr, function(rows){
                resolve(rows);
            })
        }
        return waitPromise;
    }

}

module.exports = new DataBase();
