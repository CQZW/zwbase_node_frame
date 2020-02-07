const crypto    = require('crypto');

class ZWSession
{
    _hash       = '';
    _lastdumpat = null;

    //默认的字段
    sessionid
    userid = '';
    expire

    constructor( param )
    {
        this._makeSession( param );
    }
    static createSessionWithJson( json )
    {
        let sess = new ZWSession( null );
        sess._jsonToSession( json );
        if( !sess.sessionid ) return null;
        return sess;
    }
    _makeSession( param )
    {
        this.lastdumpat = null;
        this.sessionid = this.makeSessionId( param );
        this.touch();
        this._hash = this.makeHash();
    }
    _jsonToSession( json )
    {
        let obj = JSON.parse( json );
        if( !obj )return;
        Object.assign( this, obj);
        this.expire = new Date( this.expire );
        this._lastdumpat = new Date();
        this._hash = this.makeHash();
    }
    makeHash()
    {
        let keys = Object.keys( this );
        let s = '';
        for( let k of keys )
        {
            if( k.indexOf('_') == 0 ) continue;
            s += this[k];
        }
        let md5         = crypto.createHash("md5");
        md5.update( s );
        return md5.digest('hex').toLowerCase();  
    }
    /**
     * 生成sessionid
     *
     * @param {*} param
     * @returns
     * @memberof ZWSession
     */
    makeSessionId( param )
    {
        let md5         = crypto.createHash("md5");
        md5.update( Math.random()*10000 + 'zwsession');
        return md5.digest('hex').toLowerCase();  
    }

    /**
     * 是否有修改
     *
     * @returns
     * @memberof ZWSession
     */
    isChanged()
    {
        return this._hash != this.makeHash();
    }

    /**
     * 是否需要dump到存储里面
     *
     * @memberof ZWSession
     */
    isNeedDump( )
    {
        if( this._lastdumpat == null )  return true;
        if( !this.isChanged() )         return false;
        let now = new Date().getTime();
        let lastdump = this._lastdumpat.getTime();
        let diff = now - lastdump;
        diff /= 1000;
        return diff > 60;//修改了超过1分钟了
    }
    /**
     * 是否合法过期了
     *
     * @memberof ZWSession
     */
    isVaild()
    {
        if( this.expire && this.expire.getTime() > new Date().getTime() ) return true;
        return false;
    }

    /**
     * session已经被存储了,
     *
     * @memberof ZWSession
     */
    dumped()
    {
        this._lastdumpat = new Date();
        this._hash = this.makeHash();
    }
    
    /**
     * 让session最新,被访问了
     *
     * @memberof ZWSession
     */
    touch()
    {
        this.expire = new Date( new Date().getTime() + 1000*3600*24* 7 );
    }
    /**
     * 销毁一个session
     *
     * @memberof ZWSession
     */
    destroy()
    {

    }
}

module.exports = ZWSession