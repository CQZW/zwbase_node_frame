const crypto    = require('crypto');
const fs        = require('fs');

class ZWSession
{
    _hash       = '';
    _lastdumpat = null;

    //默认的字段
    sessionid;//继承/新建 必须包含
    expire
    userinfo = {}

    constructor( param )
    {
        if( typeof param == 'string')
            this._jsonToSession( param );
        else 
            this._makeSession( param );
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
     * 继承/新建必须实现
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
     * 继承/新建必须实现
     * @memberof ZWSession
     */
    touch()
    {
        this.expire = new Date( new Date().getTime() + 1000*3600*24* 7 );
    }
    
    /**
     * 访问这个Session结束,就是一次请求完成了
     * * 继承/新建必须实现
     * @param {*} bok-这次访问接口成功还是失败了
     * @memberof ZWSession
     */
    touchend( bok )
    {
        //如果最后访问失败了,如果是新建的session就不要存储了,免得浪费空间
        //如果有大量session一直产生,但是一次没成功返回数据,估计异常了
    }

    static async loadSession(sessionid)
    {
        return new Promise( (resolve,reject)=>{
            let path = './session/' + sessionid + '.sess';
            fs.readFile( path ,(err,data )=>{
                if( err ) resolve( null);
                else
                {
                    resolve(  new ZWSession( data.toString() ) );
                }
            });
        });
    }
    static async loadAllSessionToCache( maxcount,cacheobj )
    {
        //加载所有文件到cache即可,这里无顺序 
        let max = maxcount;
        let path = './session/';
        let files = await fs.promises.readdir( path );
        let i = 0;
        for( ; i < files.length;i++)
        {
            let one = files[i];
            if( one.indexOf( '.sess') == -1 ) continue;
            let buf = await fs.promises.readFile( path + one );
            if( !buf ) continue;
            buf = buf.toString();
            let obj = new ZWSession( buf );
            if( !obj )
            {
                fs.promises.unlink( path+one);
                continue;
            }
            cacheobj.set( obj.sessionid,obj);
            if( i >= max ) break;
        }
        return Promise.resolve( i );
    }

    async dumpSession()
    {
        if( this.isNeedDump() )
        {
            let dumpstr = JSON.stringify( this );
            return new Promise( (resolve,reject)=>{
                let path = './session/' + this.sessionid+ '.sess';
                fs.writeFile( path ,dumpstr,(err)=>{
                    resolve( err == null );
                    this.dumped();
                });
            });
        }
        else
            return Promise.resolve( false );
    }

    async delSession()
    {
        return fs.promises.unlink( './session/' + this.sessionid+ '.sess' );
    }


}

module.exports = ZWSession