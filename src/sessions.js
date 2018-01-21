let MemoryState = require('node-shared-state').MemoryState,
    Events = require('events');

class Sessions extends Events{
    /**
     *
     * @param sessionsCollection
     * @param sharedState
     * @param onlineTimeout
     */
    constructor({sessionsCollection, sharedState, onlineTimeout}={}) {
        super();
        sharedState = sharedState || new MemoryState({prefix: "sessions"});
        this.sessionsCollection = sessionsCollection;
        this.onlineSessions = sharedState.Hashes({prefix: "h"});
        this.onlineTimeout = onlineTimeout || 60 * 10 * 1000;   //10 min as ms
        this.onlineTimers = new Map();
    }

    /**
     * Create or update session.
     * @param {string} sid
     * @param {object} session
     * @param callback
     */
    set(sid, session, callback){
        let now = new Date(),
            //update query
            update = {
                $set: {
                    ...session,
                    lastTime: now,
                },
                $setOnInsert: {
                    initTime: now,
                }
            },
            //options for query
            options = {upsert: true, returnOriginal: false, projection: {_id: false}};

        //query session by sid
        this.sessionsCollection.findOneAndUpdate({_id: sid}, update, options, (err, res) => {
            if(err){
                callback && callback(err);
            }else{
                let session = res.value;
                //touching session
                this.touch(sid, session, (err) => {
                    callback && callback(err, !err && session);
                });
            }
        });
    }

    /**
     * Get session by sid.
     * @param {string} sid
     * @param callback
     */
    get(sid, callback){
        //finding session in online sessions
        this.onlineSessions.get(sid, (err, session) => {
            if(err){
                callback && callback(err);
            }else if(session){
                //touch session if found
                this.touch(sid, session, (err) => {
                    callback && callback(err, !err && session);
                }, true);
            }else{
                //finding session in mongodb
                this.sessionsCollection.findOne({_id: sid}, {projection: {_id: false}}, (err, session) => {
                    if(err || !session){
                        callback && callback(err);
                    }else{
                        //touch session if found.
                        this.touch(sid, session, (err) => {
                            callback(err, !err && session);
                        })
                    }
                });
            }
        })
    }

    /**
     * Set session as online.
     * @param {string} sid
     * @param {object} session
     * @param callback
     * @param {boolean} [onlyTimer] - if true, then not save session to store
     */
    touch(sid, session, callback, onlyTimer){
        let updateTimer = () => {
            let onlineTimer = this.onlineTimers.get(sid);
            if (onlineTimer) clearTimeout(onlineTimer);
            onlineTimer = setTimeout(() => this.destroy(sid), this.onlineTimeout);
            this.onlineTimers.set(sid, onlineTimer);
            callback && callback();
        };

        if(onlyTimer){
            updateTimer();
        }else{
            this.onlineSessions.set(sid, session, (err) => {
                if(err){
                    callback && callback(err);
                }else{
                    updateTimer();
                }
            });
        }
    }

    /**
     * Set session as offline.
     * @param {string} sid
     * @param callback
     */
    destroy(sid, callback){
        this.onlineSessions.del(sid);   //remove from online sessions hash.
        this.onlineTimers.delete(sid);  //remove session's timer.
        this.emit("offline", sid);      //emit 'offline' event listeners.
        callback && callback();
    }
}

module.exports = Sessions;


