//隔离服务框架和控制器逻辑,比如以后不用express框架了,但是希望逻辑代码依然可以继续使用,
//就需要将框架和逻辑隔离开,这里就是隔离的地方
//方法:getReqParams 提前框架的参数 => {   data:{},client,version,,,,,  }
//方法:willSend  返回数据给框架,,,主要就是这2个方法和express框架衔接,,其他都和express框架无关了,
//如果需要,在getReqParams willSend 方法里面添加即可
//resb 代表的数据结构就是通用的{ code:1,data:{},msg:'xxxx'}

const logger    = require('./zwlogger');
const multer    = require('multer');
const crypto    = require('crypto');
const ZWRPCMgr  = require('./zwrpc').ZWRPCMgr;
const ZWRPCData = require('./zwrpc').ZWRPCData;

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
     * 客户端类型
     * @type string
     * @memberof ZWParam
     */
    client='';

    /**
     * API版本号
     *
     * @memberof ZWParam
     */
    version = 1.0;

    /**
     * token 认证数据
     *
     * @memberof ZWParam
     */
    token = '';

    /**
     * 请求的路径
     * @type string
     * @memberof ZWParam
     */
    path = '';

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


    /**
     * 请求的时间
     *
     * @memberof BaseParam
     */
    reqat = 0;

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

    /**
     * 服务器返回的token,之所以放到外面,是因为可能token要用于解密 data 数据
     * 比如登录之后,初始化token,都放到这里,
     * @memberof ZWResb
     */
    token;
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
    /**
     * 配置RPC调用,
     * @param {boolean} ctr_just_for_call,控制器只是用于调用的情况,简单来说 想要暴露的RPC接口,就在
     * =true的时候注册的
     * @memberof ZWBaseCtr
     */
    configRPC( ctr_just_for_call = undefined )
    {
        /**
        * rpc管理器,可以实现无代码修改的RPC,无缝衔接分布式调用
        * @type {ZWRPCMgr}
        * @memberof ZWBaseCtr
        */
        this._rpcMgr = new ZWRPCMgr( this,this.getSrv().ctrGetRPCBridge() );
        //然后...注册RPC 函数

    }
    
    /**
     * 服务开始监听端口接受请求之前通知控制器
     * @returns {Promise}
     * @memberof ZWBaseCtr
     */
    async srvWillStart()
    {
        return this.ctrConfig();
    }
    /**
     * 服务即将停止,清理资源,准备退出了
     *
     * @memberof ZWBaseCtr
     */
    srvWillStop( code )
    {
        this.log('srv will stop ...',code);
        this._stop = true;
        if( this._rpcMgr ) this._rpcMgr.stop();
        if( this._job_timer ) clearTimeout( this._job_timer );
    }
    /*
     * 服务器已经开始监听端口接受请求了
     * 这里可以做控制器的一些任务开始之类事情
     * @memberof ZWBaseCtr
     */
    srvStartOk()
    {
        //最后才开RPC处理,至少需要路由注册完成之后才可以进行RPC配置
        if( this.canRPC ) this.configRPC();
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
        return ZWResb.makeResb(err, obj, msg);
    }

   /**
    * 控制器配置,服务启动之前会被执行,这里做启动服务之前最后的准备工作
    * @returns Promise
    * @memberof ZWBaseCtr
    */
   async ctrConfig() {

        /**
         *加密方式,0 不加密,1 aes-128-cbc 位加密方式 
         */
        this.encryType = 0;
        /**
         * 运行访问的客户端列表,可以自定义,只要param.client的值是其中之一就行了
         */
        this.clientTypes = ['ios', 'android', 'mac', 'win' ];
        
        /**
         *控制器输入输出的日志是否打印 
         */
        this.log_http_io = true;

        /**
         * multer文件上传限制
         * 默认 一次最多10个字段,一个文件10MB限制,一次最多4个文件
         */
        this.multer_limits = {fields:10,fileSize:1024*1024*10,files:4};


        return Promise.resolve();
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
     * 获取控制器响应HTTP路径,如果没有挂载路由器下面,返回null
     * 比如,http://xxx.com/api/v2/xxxx => /api/v2/xxxx
     * @returns {string}
     * @memberof ZWBaseCtr
     */
    getRouterPath()
    {
        if( ! this._AtRouter ) return null;
        if( this._fullpath ) return this._fullpath;
        this._fullpath = this._AtRouter.getCtrPath( this );
        return this._fullpath;
    }
    /**
     * 获取同一个路由链下面的的一个控制器实例
     * 如果没有注册到任何路由,就返回null;
     * @param {string} path
     * @returns { ZWBaseCtr }
     * @memberof ZWBaseCtr
     */
    importCtr( path )
    {
        if( !this._AtRouter ) return null;
        return this._AtRouter.getCtr( path );
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
            let uploader = multer( { storage:diskstorage, limits: this.multer_limits } );
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
                //如果是上传文件,先接收文件数据,上传文件使用 multipart/form-data header.
                //需要先使用multer将数据解出来,否则body是没有数据的,
                let bupfile = 
                req.headers['content-type'].match(/^multipart\/form-data/i) &&
                this.getFuncNameWithPath(req.path) == this.ctr_uploadfile.name;
                if( bupfile )
                {
                    let uperr = await this.doUploadFile(req,res);
                    if( uperr )
                    {
                        this.error('doUploadFile err:',uperr);
                        resb = this.makeResb('上传文件失败');
                        break;
                    }
                }
                
                param = this.getReqParams(req);
                if( !param )
                {
                    resb.msg = '不支持的请求方式';
                    break;
                }
                
                if( this.log_http_io ) this.log('req param:' ,JSON.stringify( param ) );

                //首先进行映射检查,如果根本没有对应的方法,直接返回了
                let func = this.getRouterFunc( param.path );
                if ( !func || typeof func !== 'function' )
                {
                    //找不到方法响应,直接丢给root,并且参数都不去解密了
                    resb = await this.ctr_root( param );
                    break;
                }
                
                resb = await this.checkParam(param);
                if( resb.code !== 0 )
                {
                    break;
                }

                //真正的执行响应
                resb = await func.call(this, this.decryptionData(param));

            }while( 0 );

            //逻辑处理完成之后,加密然后返回给框架
            this.willSend( param, res ,resb );
        }
        catch (err) 
        {
            next(err);
        }
        return Promise.resolve();
    }
    /**
     * 将要返回数据
     * @param {ZWParam} param 请求的参数
     * @param {*} res 框架的返回函数
     * @param {ZWResb} resb 需要返回的对象
     * @memberof ZWBaseCtr
     */
    willSend( param , res , resb )
    {
        //访问结束之前存储session数据
        this.dumpSession( param );

        let dealedresb = this.encryptionData(resb);
        let retstr = JSON.stringify(dealedresb);
        if( this.log_http_io )
        {
            if( param.reqat )
            {
                let s = (new Date().getTime() - param.reqat) + ' ms';
                this.log( 'resb data:', retstr , s );
            }
            else 
                this.log( 'resb data:', retstr );
        }
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
        param.path  = req.path;
        param.files = req.files;

        //如果还需要请求的其他参数,比如什么iP,agent,cookie,自己继承修改即可
        //ZWParam 要求的参数,client等,可以客户端传递,也可以这里通过req补齐
        let t = new ZWParam();
        Object.assign(t,param);
        t.reqat = new Date().getTime();
        return t;
    }

    /**
     * 参数检查
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
                !param.version
            )
            {
                ret.msg = "无效的参数!";
                ret.code = 9999;
                break;
            }

            if ( this.clientTypes.indexOf(param.client) == -1 ) {
                ret.msg = '无效的访问来源';
                ret.code = 9999;
                break;
            }

            //在检查token之前加载session数据,可能检查token需要用到
            await this.loadSession( ctrfuncname , param );

            //进行token检查处理
            ret = await this.checkToken( ctrfuncname ,param  );
            if ( ret.code != 0 ) break;

            ret.code = 0;
            ret.msg = '操作成功';

        } while (0);
        return new Promise((resolve, reject) => { resolve(ret) });
    }
    /**
     * 加载session流程处理
     * 在通常的设计里面,需要一个session,所以这里子类实现具体逻辑
     * @param {string} ctrfuncname
     * @param {*} param
     * @memberof ZWBaseCtr
     */
    async loadSession( ctrfuncname, param )
    {
        return Promise.resolve();
    }
    /**
     * 存储session 
     * 一次访问结束的时候存储下session数据
     * @param {*} param
     * @memberof ZWBaseCtr
     */
    async dumpSession( param )
    {
        return Promise.resolve();
    }
    
    /**
     * 检查token操作,默认不检查任何路由的token,直接通过检查
     *
     * @param {string} ctrfuncname-请求的响应的函数名
     * @param {ZWParam} param
     * @returns {Promise<ZWResb>} 返回true表明检查通过
     * @memberof ZWBaseCtr
     */
    async checkToken( ctrfuncname,param )
    {
        return Promise.resolve(  this.makeResb( null ) );
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
     * 开始后台任务,默认10秒执行一次
     * startRuningJob 如果继承链上的每个子类都需要后台任务,最好只保留一个,满足最小时间那个即可吧
     * @param {number} [time_ms=10000]
     * @param {boolean} 是否马上执行第一次,否则要等时间到了才执行第一次,默认false
     * @memberof ZWBaseCtr
     */
    startRuningJob( time_ms = 10000 , firenow = false ) {
        this._time_ms = time_ms;
        if( firenow )
            this.job_runing( this.getSrv().ctrGetMachineLock(),this.getSrv().ctrGetGlobalLock() );
        else 
            this._runjob();
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
        if( this._stop ) Promise.resolve();//如果准备停止了,就不继续后台任务了
        this._runjob();
        return Promise.resolve();
    }
    _runjob()
    {
        this._job_timer = setTimeout(()=>{
            
            this.job_runing( this.getSrv().ctrGetMachineLock(),this.getSrv().ctrGetGlobalLock() )

        }, this._time_ms );
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
     * 变量方法 注册RPC响应,
     * @param {string} funcname,需要响应的方法,
     * @param {string} type,注册方式:<-> 调用响应,-> 只调用出去,<- 只响应进入
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    regRPC( funcname ,type )
    {
        if( type == '<->' )
            return this._rpcMgr.regRPC(funcname);
        if( type == '->' )
            return this._rpcMgr.regRPCForCall(funcname);
        if( type == '<-' )
            return this._rpcMgr.regRPCForResb(funcname);
        throw new Error('invaild reg type');
    }
    /**
     * 变量/对象 删除RPC响应
     *
     * @param {string} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    unRegRPC( funcname )
    {
        return this._rpcMgr.unRegRPC(funcname);
    }
    
    async ctr_rpcinfo( param )
    {
        let ret = this.makeResb('未知错误');
        try
        {
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
     * RPC需要实现这3个方法 rpc_encode rpc_decode getRPCMgr
     * 需要自己实现特殊的数据转换
     * @param {ZWRPCData} rpcdata
     * @returns {ZWRPCData} 返回处理之后的 rpcdata
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
     * 获取一个方法的唯一ID
     * 
     * @param {*} funcname
     * @memberof ZWBaseCtr
     */
    getFuncUniqueId( funcname )
    {
        let cls_name = Object.getPrototypeOf( this ).constructor.name;
        return cls_name + '.' +  funcname;
    }

    _rpc_ctrs = {};
    /**
     * 根据类型获取用于RPC调用的控制器
     * @returns {ZWBaseCtr}
     * @memberof ZWBaseCtr
     */
    getCtrForRPC( cls )
    {
        let t = this._rpc_ctrs[ cls.name ];
        if( t ) return t;
        t = new cls( this.getSrv() );
        if( !(t instanceof ZWBaseCtr) ) return null;
        t.configRPC( true );
        return t;
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

let expmodel = {};
expmodel.ZWParam = ZWParam;
expmodel.ZWResb = ZWResb;

module.exports.ctr      = ZWBaseCtr;
//这里将model和ctr放同一个文件,只是为了方便,如果有公共的model,或者依赖不便的model,通常还是需要单独文件
module.exports.model    = expmodel;