//隔离服务框架和控制器逻辑,比如以后不用express框架了,但是希望逻辑代码依然可以继续使用,
//就需要将框架和逻辑隔离开,这里就是隔离的地方
//方法:getReqParams 提前框架的参数 => {   data:{},client,version,,,,,  }
//方法:willSend  返回数据给框架,,,主要就是这2个方法和express框架衔接,,其他都和express框架无关了,
//主要用于api服务,所有没有使用cookie为基础的session
//这里session走的是参数,不是cookie,如果要走cookie,
//如果需要,在getReqParams willSend 方法里面添加即可
//resb 代表的数据结构就是通用的{ code:1,data:{},msg:'xxxx'}
//如果要修改session相关,修改session相关函数即可

const logger    = require('./zwlogger');
const zwbasesrv = require('./zwbasesrv');
const multer    = require('multer');
const crypto    = require('crypto');
const fs        = require('fs');
const zwrpc     = require('./zwrpc');
const ZWRPCMgr  = zwrpc.ZWRPCMgr;
const ZWRPCData = zwrpc.ZWRPCData;

const diskstorage = multer.diskStorage({
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '_' + Math.random()  );
    }
});


/**
 * 通用参数类,用于将express框架的参数提出来,和框架解耦
 *
 * @class ZWParam
 */
class ZWParam
{
    /**
     * 设备id
     * @type string
     * @memberof ZWParam
     */
    deviceid='';

    /**
     * 客户端类型
     * @type string
     * @memberof ZWParam
     */
    client='';

    /**
     * 请求的路径
     * @type string
     * @memberof ZWParam
     */
    path = '';

    /**
     * sessionid
     * @type string
     * @memberof ZWParam
     */
    sessionid = '';

    /**
     * session对象
     * @type ZWSession
     * @memberof ZWParam
     */
    session = null;


    /**
     * 文件列表,上传文件会有这个数据
     * @type []
     * @memberof ZWParam
     */
    files = [];

    /**
     * 默认真正参数数据都放到data里面,
     * @type {}
     * @memberof ZWParam
     */
    data = {};
}

/**
 * 通用返回数据结构,用于将数据返回给express框架,和框架解耦
 *
 * @class ZWResb
 */
class ZWResb
{
    /**
     * 错误码,0表示成功
     * @type Number
     * @memberof ZWResb
     */
    code = 0;

    /**
     * 返回的提示信息
     * @type string
     * @memberof ZWResb
     */
    msg = '';

    /**
     * 真正需要返回的数据
     *
     * @memberof ZWResb
     */
    data = {};

    /**
     * 快捷生成通用返回数据
     *
     * @static
     * @param {*} err
     * @param {*} [obj={}]
     * @param {string} [msg="操作成功"]
     * @returns {ZWResb}
     * @memberof ZWResb
     */
    static makeResb(err, obj = {}, msg = "操作成功") {
        let ret     = new ZWResb();
        ret.code    = err == null ? 0 : 1;
        ret.msg     = err != null ? ((typeof err == 'string') ? err : err.message) : msg;
        ret.data    = obj;
        return ret;
    }
}

class ZWBaseCtr {


    /** 
     * Creates an instance of ZWBaseCtr.
     * @param {zwbasesrv} SrvObj
     * @memberof ZWBaseCtr
     */
    constructor(SrvObj) {
        this._SrvObj = SrvObj;
        this.canRPC = SrvObj && this.getSrv().ctrGetSrvCfgInfo().canRPC;
    }
    configRPC()
    {
        /**
        * rpc管理器,可以实现无代码修改的RPC,无缝衔接分布式调用
        * @type ZWRPCMgr
        * @memberof ZWBaseCtr
        */
        this._rpcMgr = new ZWRPCMgr( this,this.getSrv().ctrGetPeerMgr() );

        //然后...注册RPC 函数
    }


    /**
     * 服务开始监听端口接受请求之前通知控制器
     * @returns {Promise}
     * @memberof ZWBaseCtr
     */
    async srvWillStart()
    {
        this.ctrConfig();
        //最后才开RPC处理,至少需要路由注册完成之后才可以进行RPC配置,因为RPC需要路由路径
        if( this.canRPC ) this.configRPC();

    }

    /*
     * 服务器已经开始监听端口接受请求了
     * 这里可以做控制器的一些任务开始之类事情
     * @memberof ZWBaseCtr
     */
    srvStartOk()
    {

    }

    /**
     * 生成 通用数据结构
     * @static
     * @param {*} err
     * @param {*} [obj={}]
     * @param {string} [msg="操作成功"]
     * @returns {ZWResb}
     * @memberof ZWBaseCtr
     */
    static makeResb(err, obj = {}, msg = "操作成功") {
        return ZWResb.makeResb(err,obj,msg);
    }

    /**
     * 快捷生成通用数据结构
     * 
     * @param {*} obj 要返回的对象
     * @returns {Promise<ZWResb>}
     * @memberof ZWBaseCtr
     */
    rr(obj) {
        //如果已经是通用对象了,就直接返回了
        if( obj.hasOwnProperty('code') && 
            obj.hasOwnProperty('msg') && 
            obj.hasOwnProperty('data') )
        return Promise.resolve( obj );
        return Promise.resolve(this.makeResb(null, obj));
    }

    getLogPrefix()
    {
        return this.constructor.name + ':';
    }

    /**
     * 日志
     * @param {args} str 
     */
    log(message, ...args)
    {
        logger.log( this.getLogPrefix(), message, ...args );
    }

    /**
     * 错误日志
     * @param {args} str 
     */
    error( message, ...args )
    {
        logger.error( this.getLogPrefix() , message, ...args);
    }
    /**
     * 快捷生成通用数据结构
     *
     * @param {string} err 错误描述
     * @returns { Promise<ZWResb> }
     * @memberof ZWBaseCtr
     */
    re(err) {
        return Promise.resolve(this.makeResb(err));
    }

    /**
     * 生成通用 数据结构
     *
     * @param {*} err
     * @param {*} [obj={}]
     * @param {string} [msg="操作成功"]
     * @returns {ZWResb}
     * @memberof ZWBaseCtr
     */
    makeResb(err, obj = {}, msg = "操作成功") {
        return ZWBaseCtr.makeResb(err, obj, msg);
    }

    /**
     * 继承修改 修改控制器配置
     * 
     * 先调用 super
     * @memberof ZWBaseCtr
     */
    ctrConfig() {
        //加密方式,0 不加密,1 aes-128-cbc 位加密方式
        this.encryType = 0;
        this.clientTypes = ['ios', 'android', 'mac', 'win', 'wx_xcx','rpc' ];
        //控制器输入输出的日志是否打印
        
        this.logout = true;
    }

    /**
     *
     * 获取服务对象
     * @returns {zwbasesrv}
     * @memberof ZWBaseCtr
     */
    getSrv() {
        return this._SrvObj;
    }
    /**
     * 设置控制器注册的路由器
     * 这里循环引用了!!!!
     * @param {*} router
     * @memberof ZWBaseCtr
     */
    setAtRouter( router )
    {
        this._AtRouter = router;
    }
    /**
     * 获取控制器路由路径
     * 比如,http://xxx.com/api/v2/xxxx => /api/v2/xxxx
     * @returns {string}
     * @memberof ZWBaseCtr
     */
    getRouterPath()
    {
        if( this._fullpath ) return this._fullpath; 
        this._fullpath = this._AtRouter.getCtrPath( this );
        return this._fullpath;
    }
    /**
     * 获取同一个路由链下面的的一个控制器实例
     * 如果没有注册,就返回null;
     * @param {string} path
     * @returns { ZWBaseCtr }
     * @memberof ZWBaseCtr
     */
    importCtr( path )
    {
        return this._AtRouter.getCtr( path );
    }
    /**
     * 获取同一个路由链下面的的一个控制器实例
     * 根据类名获取实例,如果没有当前注册过的实例就生成一个新的
     * 新实例不会调用 srvStartOK,srvWillStart,但会调用 ctrConfig 
     * @param {*} calssname
     * @returns { ZWBaseCtr }
     * @memberof ZWBaseCtr
     */
    instanceCtr( calssname )
    {
        /**
         * @type ZWBaseCtr
         */

        let v = null;
        v = this._AtRouter.getCtryByClass( path );
        if( v == null )
        {
            v = new calssname( this.getSrv() );
            v.ctrConfig();
        }
        return v;
    }

    /**
     * 获取数据库对象,操作数据库
     *
     * @returns 
     * @memberof ZWBaseCtr
     */
    getDB() {
        return this.getSrv().ctrGetDB();
    }
    
    /**
     * 处理上传文件
     *
     * @param {*} req
     * @param {*} res
     * @returns { Promise<string> }
     * @memberof ZWBaseCtr
     */
    async doUploadFile(req,res)
    {
        return new Promise((resolve,reject)=>{
            let uploader = multer( { storage:diskstorage, limits: {fields:10,fileSize:1024*1024*10,files:4} } );
            uploader = uploader.any();
            uploader(req,res,(err)=>{
                resolve(err);
            });
        });
    }
    /**
     * 处理路由,找到对应的 方法,然后分解数据,在这里将框架和逻辑分开.
     * 
     * 框架相关的就是 doRouter和 getReqParams 
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWBaseCtr
     */
    async doRouter(req, res, next) {
        //检查参数,然后执行方法,返回
        try 
        {
            let param = null;
            let resb = this.makeResb('服务器错误,稍候再试');
            do
            {
                param = this.getReqParams(req);//1.获取参数
                if( !param )
                {
                    resb.msg = '不支持的请求方式';
                    break;
                }

                if( this.logout ) this.log('req param:' ,JSON.stringify( param ) );
                
                //首先进行映射检查,如果根本没有对应的方法,直接返回了
                let func = this.getRouterFunc( param.path );
                if ( !func || typeof func !== 'function' )
                {
                    resb = await this.ctr_root(this.decryptionData(param));//5.
                    break;
                }

                //2..检查参数
                resb = await this.checkParam(param);
                if( resb.code !== 0 )
                {
                    break;
                }

                //如果是上传文件,先接收文件数据,
                if( ( this.getFuncNameWithPath(param.path) ) === this.ctr_uploadfile.name )
                {
                    let uperr = await this.doUploadFile(req,res);
                    if( uperr )
                        resb = this.makeResb('上传文件失败');
                    else //如果成功了就把文件数据附加到参数里面
                        param.files = req.files;
                }
                if( resb.code !== 0 )
                {
                    break;
                }

                //执行响应
                resb = await func.call(this, this.decryptionData(param));

            }while( 0 );

            //逻辑处理完成之后,加密然后返回给框架
            this.willSend( param, res ,resb );//7.
        }
        catch (err) 
        {
            next(err);
        }
        return Promise.resolve();
    }
    /**
     * 将要返回数据,继承修改,可以添加cookie,session之类的操作
     * @param {ZWParam} param 请求的参数
     * @param {*} res 框架的返回函数
     * @param {ZWResb} resb 需要返回的对象
     * @memberof ZWBaseCtr
     */
    willSend( param , res , resb )
    {
        if( param && param.session )
        {
            resb.sessionid = param.session.sessionid;
            param.session.touchend( resb.code == 0 );
        }

        let dealedresb = this.encryptionData(resb);
        let retstr = JSON.stringify(dealedresb);
        if( this.logout )
            this.log( 'resb data:', retstr );
        res.send( retstr );
    }
    //处理express框架来的数据,
    /**
     * 获取请求参数
     * 
     * 从 express 框架里面提取出参数
     * 如果需要额外的参数,请继承修改行为
     * @param {*} req
     * @returns {ZWParam}
     * @memberof ZWBaseCtr
     */
    getReqParams(req) {
        //暂时只支持post,get,其他需要自己继承修改行为
        let param = null;
        if (req.method == "POST") {
            param = req.body;
        }
        else if (req.method == "GET") {
            param = req.query || req.params;
        } else return null;

        param = param || {};
        param.path = req.path;
        //如果还需要请求的其他参数,比如什么iP,agent,cookie,session,继承修改
        let t = new ZWParam();
        Object.assign(t,param);
        return t;
    }

    /**
     * 参数检查,可能在param上面附加数据,比如session
     *
     * @param {ZWParam} param
     * @returns { Promise<ZWResb> }返回通用数据结构
     * @memberof ZWBaseCtr
     */
    async checkParam(param) {
        let ret = this.makeResb('无效的参数!');

        do
        {
            /*
                    client:'ios/android/mac/win',
                    lang:'zh',
                    version:'1.0',
                    deviceid:'ddddd',
                    sessionid:'xxx',
                    */
            let ctrfuncname = this.getFuncNameWithPath(param.path);
            if( ctrfuncname === this.ctr_test.name )
            {
                ret.code = 0;
                ret.msg = '测试方法不检查参数';
                break;
            }
            if (!param ||
                !param.client ||
                !param.version ||
                !param.deviceid 
            )
            {
                ret.msg = "无效的参数!";
                ret.code = 9998;
                break;
            }

            if (this.clientTypes.indexOf(param.client) == -1) {
                ret.msg = '无效的访问来源';
                ret.code = 9998;
                break;
            }
            
            //rpc调用不需要 后面流程了,直接返回成功了
            if( ctrfuncname === this.ctr_rpc.name )
            {
                ret.msg = '操作成功';
                ret.code = 0;
                break;
            }

            //如果在获取参数就添加了session,这里返回空或者返回一样
            let t = await this.getSession( param );
            if( t ) 
            {
                param.session = t;
                param.sessionid = t.sessionid;
            }
            else
            {
                ret.msg = '服务器错误';
                ret.code = 9997;
                break;
            }
            
            if ( !await this.checkToken( ctrfuncname ,param  )  )
            {
                ret.code = 9999;//返回这个错误码,需要客户端进行登录操作
                ret.msg = '无效的token';
                break;
            }

            ret.code = 0;
            ret.msg = '操作成功';

        } while (0);
        return new Promise((resolve, reject) => { resolve(ret) });
    }

    /**
     * 检查token操作,
     *
     * @param {string} ctrfuncname-请求的响应的函数名
     * @param {ZWParam} param
     * @returns {Promise<boolean>}
     * @memberof ZWBaseCtr
     */
    async checkToken( ctrfuncname,param )
    {
        return Promise.resolve( true );
    }

    /**
     * 这里session用文件存储,可以自己继承修改
     * 获取session,如果没有会生成新的session,并且对param添加sessionid字段
     * 会更新session过期时间到最新
     * @param {ZWParam} param
     * @returns{ Promise<ZWSession> }
     * @memberof ZWBaseCtr
     */
    async getSession( param )
    {
        let cache = this.getSrv().ctrGetSessionCache();
        let v;
        if( param.sessionid )
        {
            v = cache.get( param.sessionid );
            if( v )
            {
                if( !v.isVaild() )
                {
                    cache.del( param.sessionid );
                    this.delSession( v );
                }
                else
                {
                    v.touch();
                    return Promise.resolve(v);  
                }
            }
            v = await this.loadSession( param.sessionid );
            if( v )
            {
                if( !v.isVaild() )
                {
                    this.delSession(v);
                }
                else 
                {
                    v.touch();
                    cache.set( v.sessionid , v );
                    return Promise.resolve(v);
                }
            }
        }
        
        //如果持久化存储里面依然不存在,那么重新生成了,
        v = await this.makeSession( param );

        //更新缓存
        cache.set( v.sessionid , v );

        return Promise.resolve(v);
    }

    /**
     * **** **** **** **** **** **** **** **** **** **** ***
     * 重载session实现方式:
     * 1.框架自带的,修改 getReqParams 和 willSend 即可
     * 2.控制器继承修改 getSessionSampleObj ,返回 自己的Session类对象,必须有sessionid字段&isvaild,touch,touchend 3个方法即可
     * 3.控制器继承修改 5个session方法,make,load,del,dump,loadall
     * * **** **** **** **** **** **** **** **** **** **** ***
     */

    /**
     * 
     * 返回session范例对象,用于加载session
     * @returns
     * @memberof ZWBaseCtr
     */
    getSessionSampleObj()
    {
        if( this._sessoinobj ) return this._sessoinobj;
        this._sessoinobj = new ZWSession();
        return this._sessoinobj;
    }
    /**
     * 从持久化存储里面加载session
     *
     * @param {string} sessionid
     * @returns {Promise<ZWSession>}
     * @memberof ZWBaseCtr
     */

    async loadSession( sessionid )
    {
        return this.getSessionSampleObj().loadSession( sessionid );
    }
    
    /**
     * 返回加载了多少个Sesssion数据
     *
     * @returns {Promise<number>}
     * @memberof ZWBaseCtr
     */
    async loadAllSessionToCache()
    {
        //加载所有文件到cache即可,这里无顺序
        let cache = this.getSrv().ctrGetSessionCache();
        let max = this.getSrv().ctrGetSrvCfgInfo().session_max_cache;
        this.log('load session ...');
        let loadcount = await this.getSessionSampleObj().loadAllSessionToCache( max,cache );
        this.log('load session :',loadcount);
        return Promise.resolve( loadcount );
    }

    /**
     * 存储session到持久化存储
     * 
     * @param {ZWSession} session
     * @returns {Promise<boolean>}
     * @memberof ZWBaseCtr
     */
    async dumpSession( session )
    {
        let r = await session.dumpSession();
        if( r ) this.log('dump session:',session.sessionid);
        return Promise.resolve(r);
    }

    /**
     * 删除session
     *
     * @param {*} session
     * @returns
     * @memberof ZWBaseCtr
     */
    async delSession( session )
    {
        return session.delSession();
    }

    /**
     * 生成新的session
     *
     * @param {ZWParam} param
     * @returns {Promise<ZWSession>}
     * @memberof ZWBaseCtr
     */
    async makeSession( param )
    {//创建一个新的session 信息
        let cls = Object.getPrototypeOf( this.getSessionSampleObj() ).constructor;
        return Promise.resolve( new cls(param) );
    }

    /**
     * 从请求路径 里面提取出控制器的响应方法名称
     * 
     * 比如 user.getinfo 返回 getinfo
     * @param {string} path
     * @returns {string} 方法名字
     * @memberof ZWBaseCtr
     */
    getFuncNameWithPath(path) {

        //XXXX testctr.func
        //XXXX testctr/func
        let i = path.lastIndexOf('.');
        if( i != -1 )
            return 'ctr_' + path.substring(i+1);
        i = path.lastIndexOf('/');
        if( i != -1 )
            return 'ctr_' + path.substring(i+1);
        return null;
    }

    //根据path寻找合适的方法,继承可修改该行为
    //路由方法,必须返回 Promise 对象
    //规则,枚举对象里面的 ctr_ 开头的方法,作为响应方法 
    // 比如/user.getinfo 需要寻找 user对象下面 ctr_getinfo的方法
    /**
     * 根据请求参数 返回响应的方法
     * 
     * @param {string} path 
     * @returns {function}
     * @memberof ZWBaseCtr
     */
    getRouterFunc(path) {
        if (!this instanceof ZWBaseCtr) return null;
        let funcname = this.getFuncNameWithPath(path);
        if( !funcname ) return null;
        return this[funcname];
    }


    /**
     * 从请求参数里面解密数据 
     * 
     * 继承修改解密逻辑
     * @param {ZWParam} param
     * @returns {ZWParam}
     * @memberof ZWBaseCtr
     */
    decryptionData(param) {
        if (this.encryType == 0) return param;
        if (this.encryType == 1) {
            //将 resb.data 字段进行解密,
            let desdata = '';
            let srcdata = param.data;
            if (!srcdata || typeof srcdata != 'string' || !srcdata.length) {
                param.data = {};
                return param;
            }
            srcdata = new Buffer(srcdata, 'base64');
            let t = this.getKeyAndIvForDec(param);
            const decipher = crypto.createDecipheriv('aes-128-cbc', t[0], t[1]);
            desdata += decipher.update(srcdata, 'base64', 'utf8');
            desdata += decipher.final('utf8');
            param.data = JSON.parse(desdata);
            return param;
        }
        return param;
    }

    /**
     * 将准备返回的数据加密
     *
     * 继承修改加密逻辑
     * @param {ZWResb}  通用数据结构
     * @returns {ZWResb} 通用数据结构
     * @memberof ZWBaseCtr
     */
    encryptionData(resb) {
        if (this.encryType == 0) return resb;
        if (this.encryType == 1) {
            //将 resb.data 字段进行加密,
            let desdata = '';
            let srcdata = resb.data;
            if (!srcdata || resb.code) {
                resb.data = "";
                return resb;
            }
            srcdata = JSON.stringify(srcdata);
            let t = this.getKeyAndIvForEnc(resb);
            const cipher = crypto.createCipheriv('aes-128-cbc', t[0], t[1]);
            desdata += cipher.update(srcdata, 'utf8', 'base64');
            desdata += cipher.final('base64');
            resb.data = desdata;
            return resb;
        }
        return resb;
    }

    /**
     * 获取加密用的 key iv
     * 
     * 继承修改秘钥返回
     * @param {ZWParam} resb
     * @returns {Array<string>},[key,iv]
     * @memberof ZWBaseCtr
     */
    getKeyAndIvForEnc(resb) {
        // ase-128-cbc 加密算法要求key和iv长度都为16
        logger.error('your must change key and iv in your prj');
        let _key = "837fe8729c1ba792";
        let _iv = "6aece0773ffea97b";
        return [_key, _iv];
    }
    /**
     * 获取解密的key iv
     *  
     * 继承修改秘钥返回
     * @param {ZWParam} param
     * @returns {Array<string>},[key,iv]
     * @memberof ZWBaseCtr
     */
    getKeyAndIvForDec(param) {
        logger.error('your must change key and iv in your prj');
        return this.getKeyAndIvForDec();
    }

    /**
     *
     * 开始后台任务
     * @param {number} [time_ms=10000]
     * @memberof ZWBaseCtr
     */
    startRuningJob( time_ms = 10000 ) {
        this._time_ms = time_ms;
        setTimeout(()=>{this.job_runing( this.getSrv().ctrGetMachineLock(),this.getSrv().ctrGetGlobalLock() )}, time_ms);
    }

    /**
     * 
     * 执行后台任务
     * @param {boolean} machine_lock 当前机器锁状态
     * @param {boolean} global_lock 当前全局锁状态
     * @returns
     * @memberof ZWBaseCtr
     */
    async job_runing( machine_lock ,global_lock ) {
        setTimeout(()=>{this.job_runing( this.getSrv().ctrGetMachineLock(),this.getSrv().ctrGetGlobalLock() )}, this._time_ms );
        return Promise.resolve();
    }

    //路由响应函数,全部用ctr_开头,全部需要返回  Promise
    /**
     *上传文件控制器响应函数,param里面包含文件参数,files,
     * 具体参考 multer,继承修改该方法,一个控制器上传文件方法仅此一个就够了
     * @param {ZWParam}  param 会添加 files 参数,
     * @returns {Promise<ZWResb>}
     * @memberof ZWBaseCtr
     */
    async ctr_uploadfile( param )
    {
        return this.re('not any one can do uploadfile ...');
    }

    getRPCMgr()
    {
        return this._rpcMgr;
    }
    
    /**
     * 注册/取消 响应 请确定该机器每个进程代码一致性,
     * 该版本RPC实现 机器-机器 之间调用不是基于 进程-进程,基于同一机器每个进程一样的假设
     * 
     * 变量方法 注册RPC响应,
     * 注册之后,
     * @param {*} var_obj
     * @param {string} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    regRPC( var_obj , funcname )
    {
        return this._rpcMgr.regRPC(var_obj,funcname);
    }
    /**
     * 变量/对象 删除RPC响应
     *
     * @param {*} var_obj
     * @param {string} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    unRegRPC( var_obj , funcname )
    {
        return this._rpcMgr.unRegRPC(var_obj,funcname);
    }
    /**
     * 服务器之间内部RPC调用
     *
     * @param {ZWParam} param
     * @returns {Promise<ZWResb>}
     * @memberof ZWBaseCtr
     */
    async ctr_rpc( param )
    {
        let ret = this.makeResb('未知错误');
        try
        {
            ret.data    = await this._rpcMgr.onRPC( param.data );
            ret.code    = 0 ;
            ret.msg     = '操作成功';
        }
        catch(e)
        {
            this.error('ctr_rpc error:',e);
            ret.msg = e.message;
        }
        return this.rr(ret);
    }
    async ctr_rpcinfo( param )
    {
        let ret = this.makeResb('未知错误');
        try
        {
            ret.data    = this.getSrv().ctrGetPeerMgr().getAllPeers();
            ret.code    = 0 ;
            ret.msg     = '操作成功';
        }
        catch(e)
        {
            this.error('ctr_rpc error:',e);
        }
        return this.rr(ret);
    }
    /**  
     * RPC需要实现这3个方法,默认什么都不做,普通类型的数据没什么需要特别处理的,
     * 需要自己实现特殊的数据转换
     */
    rpc_encode( rpcdata )
    {
        return rpcdata;
    }
    rpc_decode( rpcdata )
    {
        return rpcdata;
    }
    getRPCMgr()
    {
        return this._rpcMgr;
    }

    /**
     * 控制器 根 响应
     * 
     * 如果该路由前缀找不到对应的响应方法 由 这里处理
     * 
     * 比如 user.getxxx 找不到 getxxx 都到这里响应
     * @param {ZWParam} param
     * @returns {Promise<ZWResb>} 通用数据结构
     * @memberof ZWBaseCtr
     */
    async ctr_root(param) {
        //root 里面不要引用param参数,因为可能没有通过检查,
        return this.re('not any one can do this...');
    }

    async ctr_test( param )
    {
        return this.re('i am test ctr');
    }

}

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
        md5.update( Math.random()*10000 + 'ZWSession');
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

    async loadSession(sessionid)
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
    async loadAllSessionToCache( maxcount,cacheobj )
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


let expmodel = {};
expmodel.ZWParam = ZWParam;
expmodel.ZWResb = ZWResb;
expmodel.ZWSession = ZWSession;

module.exports.ctr      = ZWBaseCtr;
module.exports.model    = expmodel;